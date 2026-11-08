//! Cloud resources for a project in the connected Cloudflare account: R2 buckets,
//! D1 databases, KV namespaces, Queues, Hyperdrive configs and Turnstile widgets,
//! plus Durable Objects and Workers, which need only the Workers plan.
//!
//! Every resource is named `<prefix>-<suffix>` and looked up by that name before it
//! is created, so running setup again reuses what exists. The result is written to
//! `.jackalope/cloudflare.json` in the project: kinds, names, IDs, the account and a
//! wrangler bindings snippet, never a secret. A Hyperdrive connection string is kept
//! only in protected storage and sent only to Cloudflare. Deleting a real resource is
//! a separate, per-resource action; forgetting one only edits the manifest.

use super::{
    account_storage,
    cloudflare::{
        api::Reply,
        connection::{self, AccountAccess},
        scopes::{self, Scope},
    },
    tasks::TaskRuntime,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};

mod api;
#[cfg(test)]
mod tests;

use api::Api;

const PROGRESS_EVENT: &str = "cloudflare-resources-progress";
pub(super) const MANIFEST_PATH: &str = ".jackalope/cloudflare.json";
const POSTGRES_FILE: &str = "cloudflare-postgres.bin";
const TOKENS_URL: &str = "https://dash.cloudflare.com/profile/api-tokens";
const MAX_DOMAINS: usize = 10;

/// Projects with setup running; one run per project at a time.
static RUNNING: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static POSTGRES_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    R2,
    D1,
    Kv,
    Queue,
    Hyperdrive,
    Turnstile,
    DurableObjects,
    Workers,
}

/// Setup order; also the order resources appear in the manifest.
const KINDS: [Kind; 8] = [
    Kind::Workers,
    Kind::R2,
    Kind::D1,
    Kind::Kv,
    Kind::Queue,
    Kind::DurableObjects,
    Kind::Hyperdrive,
    Kind::Turnstile,
];

impl Kind {
    fn label(self) -> &'static str {
        match self {
            Kind::R2 => "an R2 bucket",
            Kind::D1 => "a D1 database",
            Kind::Kv => "a KV namespace",
            Kind::Queue => "a queue",
            Kind::Hyperdrive => "a Hyperdrive config",
            Kind::Turnstile => "a Turnstile widget",
            Kind::DurableObjects => "Durable Objects",
            Kind::Workers => "a Worker",
        }
    }

    /// The resource's name in an agent's launch summary.
    fn noun(self) -> &'static str {
        match self {
            Kind::R2 => "R2 bucket",
            Kind::D1 => "D1 database",
            Kind::Kv => "KV namespace",
            Kind::Queue => "Queue",
            Kind::Hyperdrive => "Hyperdrive config",
            Kind::Turnstile => "Turnstile widget",
            Kind::DurableObjects => "Durable Object class",
            Kind::Workers => "Worker",
        }
    }

    /// The suffix after the prefix in the resource's name.
    fn suffix(self) -> &'static str {
        match self {
            Kind::R2 => "assets",
            Kind::D1 => "db",
            Kind::Kv => "config",
            Kind::Queue => "jobs",
            Kind::Hyperdrive => "postgres",
            Kind::Turnstile => "turnstile",
            Kind::DurableObjects | Kind::Workers => "",
        }
    }

    fn binding(self) -> &'static str {
        match self {
            Kind::R2 => "ASSETS",
            Kind::D1 => "DB",
            Kind::Kv => "CONFIG",
            Kind::Queue => "JOBS",
            Kind::Hyperdrive => "HYPERDRIVE",
            Kind::Turnstile => "TURNSTILE_SITE_KEY",
            Kind::DurableObjects => "SESSIONS",
            Kind::Workers => "",
        }
    }

    /// Whether setup calls Cloudflare for this kind. Durable Objects and Workers are
    /// declared in wrangler configuration and created when the Worker deploys.
    fn provisioned(self) -> bool {
        !matches!(self, Kind::DurableObjects | Kind::Workers)
    }

    /// The Connect Cloudflare scope, and API token permission, that creates this kind.
    /// Cloudflare may not allow the public client to request these; a refusal comes
    /// back as `invalid_scope` and leads to an API token.
    fn scope(self) -> &'static Scope {
        match self {
            Kind::R2 => &scopes::R2,
            Kind::D1 => &scopes::D1,
            Kind::Kv => &scopes::KV,
            Kind::Queue => &scopes::QUEUES,
            Kind::Hyperdrive => &scopes::HYPERDRIVE,
            Kind::Turnstile => &scopes::TURNSTILE,
            Kind::DurableObjects | Kind::Workers => &scopes::WORKERS,
        }
    }

    fn permission(self) -> &'static str {
        self.scope().permission
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Account,
    R2,
    D1,
    Kv,
    Queue,
    Hyperdrive,
    Turnstile,
    DurableObjects,
    Workers,
    Manifest,
}

impl From<Kind> for Step {
    fn from(kind: Kind) -> Self {
        match kind {
            Kind::R2 => Step::R2,
            Kind::D1 => Step::D1,
            Kind::Kv => Step::Kv,
            Kind::Queue => Step::Queue,
            Kind::Hyperdrive => Step::Hyperdrive,
            Kind::Turnstile => Step::Turnstile,
            Kind::DurableObjects => Step::DurableObjects,
            Kind::Workers => Step::Workers,
        }
    }
}

/// What the person can do about a failed step.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Recovery {
    /// Connect Cloudflare again, allowing `scopes`.
    Reauthorize,
    /// Add `permissions` to the API token, or connect with one that has them.
    Token,
    /// Turn the product on in the Cloudflare dashboard (`link`).
    Enable,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    step: Step,
    message: String,
    recovery: Option<Recovery>,
    link: Option<String>,
    /// OAuth scopes to ask for again, for `Reauthorize`.
    scopes: Vec<String>,
    /// API token permissions the step needs, for `Reauthorize` and `Token`.
    permissions: Vec<String>,
}

impl Failure {
    fn new(step: Step, message: impl Into<String>) -> Self {
        Self {
            step,
            message: message.into(),
            recovery: None,
            link: None,
            scopes: Vec::new(),
            permissions: Vec::new(),
        }
    }
}

fn list(items: &[&str]) -> String {
    match items {
        [] => String::new(),
        [one] => (*one).into(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

fn permission_failure(step: Step, kinds: &[Kind], oauth: bool) -> Failure {
    let mut permissions: Vec<&str> = kinds.iter().map(|kind| kind.permission()).collect();
    permissions.dedup();
    let labels: Vec<&str> = kinds.iter().map(|kind| kind.label()).collect();
    // Kinds the Worker deploy creates have no scope Connect Cloudflare can ask for.
    let scopes: Vec<String> = kinds
        .iter()
        .filter(|kind| kind.provisioned())
        .map(|kind| kind.scope().name.to_owned())
        .collect();
    if oauth && !scopes.is_empty() {
        return Failure {
            step,
            message: format!(
                "Cloudflare has not allowed Jackalope to create {} yet.",
                list(&labels)
            ),
            recovery: Some(Recovery::Reauthorize),
            link: None,
            scopes,
            permissions: permissions.iter().map(|p| (*p).into()).collect(),
        };
    }
    Failure {
        step,
        message: if oauth {
            format!(
                "Connect Cloudflare cannot create {}. Connect with an API token that has {} instead.",
                list(&labels),
                list(&permissions)
            )
        } else {
            format!(
                "Your Cloudflare API token cannot create {}. Add Account → {} to the token, then try again.",
                list(&labels),
                list(&permissions)
            )
        },
        recovery: Some(Recovery::Token),
        link: Some(TOKENS_URL.into()),
        scopes: Vec::new(),
        permissions: permissions.iter().map(|p| (*p).into()).collect(),
    }
}

/// Maps a refusal for `kind` to a step failure. 401/403 or Cloudflare's 10000
/// authentication error name the permission the step needs.
fn api_failure(kind: Kind, account_id: &str, reply: &Reply, oauth: bool) -> Failure {
    let step = Step::from(kind);
    let code = reply.code();
    if reply.refused_access() {
        return permission_failure(step, &[kind], oauth);
    }
    if reply.status == 429 || code == 971 {
        return Failure::new(step, "Cloudflare is rate limiting requests. Retry shortly.");
    }
    // R2 must be turned on (and its terms accepted) in the dashboard once per account.
    if kind == Kind::R2 && code == 10042 {
        return Failure {
            recovery: Some(Recovery::Enable),
            link: Some(format!("https://dash.cloudflare.com/{account_id}/r2/overview")),
            ..Failure::new(
                step,
                "R2 is not turned on for this Cloudflare account. Turn it on in the dashboard, then try again.",
            )
        };
    }
    let (status, detail) = (reply.status, reply.detail());
    Failure::new(
        step,
        if detail.is_empty() {
            format!("Cloudflare returned {status} while creating {}. Retry, or check the Cloudflare dashboard.", kind.label())
        } else {
            format!("Cloudflare returned {status}: {detail}")
        },
    )
}

/// One provisioned or declared resource. `id` is what bindings reference: the
/// bucket name for R2, the site key for Turnstile, nothing for Durable Objects and Workers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    kind: Kind,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    binding: String,
}

/// `.jackalope/cloudflare.json`. Safe to commit: it holds no secret.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    version: u32,
    account_id: String,
    prefix: String,
    resources: Vec<Resource>,
    /// JSONC to merge into the project's wrangler.jsonc.
    wrangler: String,
    dashboard: String,
    updated_at: String,
}

fn valid_prefix(prefix: &str) -> bool {
    (1..=40).contains(&prefix.len())
        && prefix
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !prefix.starts_with('-')
        && !prefix.ends_with('-')
        && !prefix.contains("--")
}

fn resource_name(prefix: &str, kind: Kind) -> String {
    match kind {
        Kind::DurableObjects => "Session".into(),
        Kind::Workers => prefix.into(),
        _ => format!("{prefix}-{}", kind.suffix()),
    }
}

fn valid_domain(domain: &str) -> bool {
    let labels: Vec<&str> = domain.split('.').collect();
    domain.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

fn normalize_domains(domains: &[String]) -> Result<Vec<String>, String> {
    let mut seen = Vec::new();
    for domain in domains {
        let domain = domain.trim().trim_end_matches('/').to_ascii_lowercase();
        let domain = domain
            .strip_prefix("https://")
            .or_else(|| domain.strip_prefix("http://"))
            .unwrap_or(&domain)
            .to_string();
        if domain.is_empty() {
            continue;
        }
        if !valid_domain(&domain) && domain != "localhost" {
            return Err(format!(
                "{domain} is not a domain. Enter domains such as example.com, one per line."
            ));
        }
        if !seen.contains(&domain) {
            seen.push(domain);
        }
    }
    if seen.is_empty() {
        return Err("Enter at least one domain for Turnstile, such as example.com.".into());
    }
    if seen.len() > MAX_DOMAINS {
        return Err(format!(
            "Turnstile accepts up to {MAX_DOMAINS} domains per widget."
        ));
    }
    Ok(seen)
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value
                .get(index + 1..index + 3)
                .and_then(|pair| u8::from_str_radix(pair, 16).ok())
                .ok_or("The connection string has an invalid % escape.")?;
            out.push(hex);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "The connection string is not valid text.".into())
}

/// The parts of a Postgres connection string Hyperdrive's origin takes.
#[derive(Debug, PartialEq)]
struct PostgresOrigin {
    host: String,
    port: u16,
    database: String,
    user: String,
    password: String,
}

fn parse_postgres(url: &str) -> Result<PostgresOrigin, String> {
    const USAGE: &str =
        "Enter a Postgres connection string such as postgres://user:password@host:5432/database.";
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| USAGE.to_string())?;
    if !matches!(parsed.scheme(), "postgres" | "postgresql") {
        return Err(USAGE.into());
    }
    let host = parsed.host_str().unwrap_or_default().to_string();
    let user = percent_decode(parsed.username())?;
    let password = percent_decode(parsed.password().unwrap_or_default())?;
    let database = percent_decode(parsed.path().trim_start_matches('/'))?;
    if host.is_empty() || user.is_empty() || database.is_empty() || database.contains('/') {
        return Err(USAGE.into());
    }
    if password.is_empty() {
        return Err("Hyperdrive needs the database password in the connection string.".into());
    }
    if matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]") {
        return Err("Hyperdrive connects from Cloudflare, so the database needs a public host, not localhost.".into());
    }
    Ok(PostgresOrigin {
        host,
        port: parsed.port().unwrap_or(5432),
        database,
        user,
        password,
    })
}

/// The JSON for one wrangler value.
fn j(value: impl Serialize) -> String {
    serde_json::to_string(&value).unwrap_or_else(|_| "null".into())
}

/// A wrangler.jsonc fragment binding every resource. Comments explain the parts
/// the person or an agent must finish, such as the Durable Object class.
fn bindings(prefix: &str, resources: &[Resource], date: &str) -> String {
    let find = |kind: Kind| resources.iter().find(|resource| resource.kind == kind);
    let mut entries = Vec::new();
    if let Some(worker) = find(Kind::Workers) {
        entries.push(format!("  \"name\": {}", j(&worker.name)));
        entries.push(format!("  \"compatibility_date\": {}", j(date)));
    }
    if let Some(bucket) = find(Kind::R2) {
        entries.push(format!(
            "  \"r2_buckets\": [{{ \"binding\": {}, \"bucket_name\": {} }}]",
            j(&bucket.binding),
            j(&bucket.name)
        ));
    }
    if let Some(database) = find(Kind::D1) {
        entries.push(format!(
            "  \"d1_databases\": [{{ \"binding\": {}, \"database_name\": {}, \"database_id\": {} }}]",
            j(&database.binding),
            j(&database.name),
            j(database.id.as_deref().unwrap_or_default())
        ));
    }
    if let Some(namespace) = find(Kind::Kv) {
        entries.push(format!(
            "  \"kv_namespaces\": [{{ \"binding\": {}, \"id\": {} }}]",
            j(&namespace.binding),
            j(namespace.id.as_deref().unwrap_or_default())
        ));
    }
    if let Some(queue) = find(Kind::Queue) {
        entries.push(format!(
            "  // Remove consumers if this Worker only sends jobs.\n  \"queues\": {{ \"producers\": [{{ \"binding\": {}, \"queue\": {} }}], \"consumers\": [{{ \"queue\": {} }}] }}",
            j(&queue.binding),
            j(&queue.name),
            j(&queue.name)
        ));
    }
    if let Some(objects) = find(Kind::DurableObjects) {
        entries.push(format!(
            "  // Export a class named {} from your Worker, or rename it here and in the migration.\n  \"durable_objects\": {{ \"bindings\": [{{ \"name\": {}, \"class_name\": {} }}] }}",
            objects.name,
            j(&objects.binding),
            j(&objects.name)
        ));
        entries.push(format!(
            "  \"migrations\": [{{ \"tag\": \"v1\", \"new_sqlite_classes\": [{}] }}]",
            j(&objects.name)
        ));
    }
    if let Some(config) = find(Kind::Hyperdrive) {
        entries.push(format!(
            "  \"hyperdrive\": [{{ \"binding\": {}, \"id\": {} }}]",
            j(&config.binding),
            j(config.id.as_deref().unwrap_or_default())
        ));
    }
    if let Some(widget) = find(Kind::Turnstile) {
        entries.push(format!(
            "  // Store the Turnstile secret key with `wrangler secret put TURNSTILE_SECRET_KEY`.\n  \"vars\": {{ {}: {} }}",
            j(&widget.binding),
            j(widget.id.as_deref().unwrap_or_default())
        ));
    }
    format!(
        "// Cloudflare bindings for {prefix}, set up by Jackalope. Merge into wrangler.jsonc.\n{{\n{}\n}}\n",
        entries.join(",\n")
    )
}

fn manifest_path(project: &Path) -> PathBuf {
    project.join(MANIFEST_PATH)
}

fn read_manifest(project: &Path) -> Result<Option<Manifest>, String> {
    match std::fs::read(manifest_path(project)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|_| {
            format!("{MANIFEST_PATH} could not be read. Fix or remove it, then try again.")
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read {MANIFEST_PATH}: {error}")),
    }
}

/// One clause per resource in the manifest under `folder`, such as "R2 bucket
/// shop-assets bound as ASSETS", for an agent's launch summary. `None` without a
/// readable manifest.
pub(super) fn agent_summary(folder: &Path) -> Option<Vec<String>> {
    let manifest = read_manifest(folder).ok()??;
    Some(
        manifest
            .resources
            .iter()
            .map(|resource| {
                let mut clause = format!("{} {}", resource.kind.noun(), resource.name);
                if !resource.binding.is_empty() {
                    clause.push_str(&format!(" bound as {}", resource.binding));
                }
                clause
            })
            .collect(),
    )
}

/// Rebuilds the manifest from `resources` and writes it beside the project, replacing
/// it atomically. Removing the last resource removes the file.
fn write_manifest(
    project: &Path,
    account_id: &str,
    prefix: &str,
    mut resources: Vec<Resource>,
) -> Result<Option<Manifest>, String> {
    let path = manifest_path(project);
    if resources.is_empty() {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("Could not remove {MANIFEST_PATH}: {error}")),
        };
    }
    resources.sort_by_key(|resource| KINDS.iter().position(|kind| *kind == resource.kind));
    let now = chrono::Utc::now();
    let manifest = Manifest {
        version: 1,
        account_id: account_id.into(),
        prefix: prefix.into(),
        wrangler: bindings(prefix, &resources, &now.format("%Y-%m-%d").to_string()),
        resources,
        dashboard: format!("https://dash.cloudflare.com/{account_id}"),
        updated_at: now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    };
    let directory = path.parent().ok_or("Invalid project folder.")?;
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create .jackalope in the project: {error}"))?;
    let mut text = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    text.push('\n');
    let temporary = directory.join(format!(".cloudflare-{}.json.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, text)
        .map_err(|error| format!("Could not write {MANIFEST_PATH}: {error}"))?;
    std::fs::rename(&temporary, &path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        format!("Could not write {MANIFEST_PATH}: {error}")
    })?;
    Ok(Some(manifest))
}

/// Replaces the resources of the kinds in `results`, keeping others from earlier runs.
fn merged(existing: Option<&Manifest>, account_id: &str, results: Vec<Resource>) -> Vec<Resource> {
    let mut resources: Vec<Resource> = existing
        .filter(|manifest| manifest.account_id == account_id)
        .map(|manifest| manifest.resources.clone())
        .unwrap_or_default();
    resources.retain(|resource| !results.iter().any(|next| next.kind == resource.kind));
    resources.extend(results);
    resources
}

fn project_folder(project_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(project_path);
    if !path.is_dir() {
        return Err("The project folder is not available.".into());
    }
    Ok(path)
}

fn project_key(project: &Path) -> String {
    let canonical = dunce::canonicalize(project).unwrap_or_else(|_| project.to_path_buf());
    let mut text = canonical.to_string_lossy().into_owned();
    if cfg!(windows) {
        text = text.to_lowercase();
    }
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Saved Hyperdrive connection strings by project, in protected storage.
fn postgres_urls(runtime: &TaskRuntime) -> Result<BTreeMap<String, String>, String> {
    Ok(
        account_storage::read(&runtime.integration_directory().join(POSTGRES_FILE))?
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default(),
    )
}

fn save_postgres_url(
    runtime: &TaskRuntime,
    project: &Path,
    url: Option<&str>,
) -> Result<(), String> {
    let _guard = POSTGRES_LOCK.lock().map_err(|e| e.to_string())?;
    let mut urls = postgres_urls(runtime)?;
    let key = project_key(project);
    match url {
        Some(url) => urls.insert(key, url.into()),
        None => urls.remove(&key),
    };
    let path = runtime.integration_directory().join(POSTGRES_FILE);
    if urls.is_empty() {
        return match account_storage::remove(&path) {
            Ok(()) => Ok(()),
            Err(_) if !path.exists() => Ok(()),
            Err(error) => Err(error),
        };
    }
    account_storage::write_json(&path, &urls)
}

struct RunGuard(String);

impl RunGuard {
    fn acquire(key: String) -> Result<Self, String> {
        let mut running = RUNNING.lock().map_err(|e| e.to_string())?;
        if !running.get_or_insert_with(HashSet::new).insert(key.clone()) {
            return Err("Cloud resource setup is already running for this project.".into());
        }
        Ok(Self(key))
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(mut running) = RUNNING.lock() {
            if let Some(running) = running.as_mut() {
                running.remove(&self.0);
            }
        }
    }
}

/// The kinds the grant is known to lack scopes for. Unknown grants are tried and
/// a refusal is handled when Cloudflare reports it.
fn missing_scopes(kinds: &[Kind], granted: Option<&str>) -> Vec<Kind> {
    let Some(granted) = granted else {
        return Vec::new();
    };
    kinds
        .iter()
        .copied()
        .filter(|kind| kind.provisioned() && !scopes::granted(granted, kind.scope()))
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    prefix: String,
    kinds: Vec<Kind>,
    /// Required for a new Hyperdrive config unless one is saved for the project.
    #[serde(default)]
    postgres_url: Option<String>,
    #[serde(default)]
    turnstile_domains: Vec<String>,
}

/// A validated request: what to set up, in order.
struct Plan {
    prefix: String,
    kinds: Vec<Kind>,
    postgres: Option<PostgresOrigin>,
    domains: Vec<String>,
}

fn plan(request: &Request, saved_postgres: Option<&str>) -> Result<Plan, String> {
    let prefix = request.prefix.trim().to_string();
    if !valid_prefix(&prefix) {
        return Err("Use a name prefix of up to 40 lowercase letters, digits and single hyphens, starting and ending with a letter or digit.".into());
    }
    let kinds: Vec<Kind> = KINDS
        .iter()
        .copied()
        .filter(|kind| request.kinds.contains(kind))
        .collect();
    if kinds.is_empty() {
        return Err("Choose at least one resource.".into());
    }
    let postgres = if kinds.contains(&Kind::Hyperdrive) {
        match request
            .postgres_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .or(saved_postgres)
        {
            Some(url) => Some(parse_postgres(url)?),
            None => None,
        }
    } else {
        None
    };
    let domains = if kinds.contains(&Kind::Turnstile) {
        normalize_domains(&request.turnstile_domains)?
    } else {
        Vec::new()
    };
    Ok(Plan {
        prefix,
        kinds,
        postgres,
        domains,
    })
}

/// Sets up each planned resource in order, stopping at the first failure. Returns
/// what was set up so far either way, so a partial run is still recorded.
async fn provision(
    api: &Api,
    plan: &Plan,
    progress: &(dyn Fn(Step) + Send + Sync),
) -> (Vec<Resource>, Option<Failure>) {
    let mut done = Vec::new();
    for kind in &plan.kinds {
        let kind = *kind;
        progress(Step::from(kind));
        let name = resource_name(&plan.prefix, kind);
        let result = match kind {
            Kind::R2 => api.ensure_r2(&name).await,
            Kind::D1 => api.ensure_d1(&name).await,
            Kind::Kv => api.ensure_kv(&name).await,
            Kind::Queue => api.ensure_queue(&name).await,
            Kind::Hyperdrive => api.ensure_hyperdrive(&name, plan.postgres.as_ref()).await,
            Kind::Turnstile => api.ensure_turnstile(&name, &plan.domains).await,
            Kind::DurableObjects | Kind::Workers => Ok(None),
        };
        match result {
            Ok(id) => done.push(Resource {
                kind,
                name,
                id,
                binding: kind.binding().into(),
            }),
            Err(failure) => return (done, Some(failure)),
        }
    }
    (done, None)
}

fn api_for(access: &AccountAccess) -> Result<Api, String> {
    Ok(Api {
        cloudflare: super::cloudflare::api::Api::new(
            &access.account_id,
            &access.token,
            Duration::from_secs(60),
        )?,
        account_id: access.account_id.clone(),
        oauth: access.oauth,
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    project_path: &'a str,
    step: Step,
}

async fn run(
    app: &AppHandle,
    runtime: &TaskRuntime,
    project_path: &str,
    request: Request,
) -> Result<Option<Manifest>, (Failure, Option<Manifest>)> {
    let progress = |step: Step| {
        let _ = app.emit(PROGRESS_EVENT, Progress { project_path, step });
    };
    let fail = |message: String| (Failure::new(Step::Account, message), None);
    progress(Step::Account);
    let project = project_folder(project_path).map_err(fail)?;
    let new_url = request
        .postgres_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_owned);
    let saved_url = postgres_urls(runtime)
        .map_err(fail)?
        .remove(&project_key(&project));
    let plan = plan(&request, saved_url.as_deref()).map_err(fail)?;
    if let Some(url) = new_url.filter(|_| plan.postgres.is_some()) {
        save_postgres_url(runtime, &project, Some(&url)).map_err(fail)?;
    }
    let access = connection::account_access(runtime).await.map_err(fail)?;
    let existing = read_manifest(&project).map_err(fail)?;
    let missing = missing_scopes(&plan.kinds, access.granted.as_deref());
    if access.oauth && !missing.is_empty() {
        return Err((permission_failure(Step::Account, &missing, true), existing));
    }
    let api = api_for(&access).map_err(fail)?;
    let (results, failure) = provision(&api, &plan, &progress).await;
    let resources = merged(existing.as_ref(), &access.account_id, results);
    if failure.is_none() {
        progress(Step::Manifest);
    }
    let written = write_manifest(&project, &access.account_id, &plan.prefix, resources);
    match (failure, written) {
        (Some(failure), written) => Err((failure, written.ok().flatten().or(existing))),
        (None, Ok(manifest)) => Ok(manifest),
        (None, Err(message)) => Err((Failure::new(Step::Manifest, message), existing)),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    manifest: Option<Manifest>,
    /// A Hyperdrive connection string is saved for this project.
    postgres_saved: bool,
    /// The connected Cloudflare account, when there is one.
    account_id: Option<String>,
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::cloudflare_resources::cloudflare_resources_status,
            commands::cloudflare_resources::cloudflare_resources_provision,
            commands::cloudflare_resources::cloudflare_resources_forget,
            commands::cloudflare_resources::cloudflare_resources_delete,
            commands::cloudflare_resources::cloudflare_resources_turnstile_secret,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub async fn cloudflare_resources_status(
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<Status, String> {
    let project = project_folder(&project_path)?;
    Ok(Status {
        manifest: read_manifest(&project)?,
        postgres_saved: postgres_urls(&state)?.contains_key(&project_key(&project)),
        account_id: connection::connected_account(&state),
    })
}

/// Sets up the requested resources and writes the manifest. Resolves with
/// `{ok: true, manifest}` or `{ok: false, failure, manifest}`; progress arrives as
/// `cloudflare-resources-progress` events naming each step as it starts.
#[tauri::command]
pub async fn cloudflare_resources_provision(
    app: AppHandle,
    project_path: String,
    request: Request,
    state: State<'_, TaskRuntime>,
) -> Result<Value, String> {
    let project = project_folder(&project_path)?;
    let _running = RunGuard::acquire(project_key(&project))?;
    Ok(
        match run(&app, state.inner(), &project_path, request).await {
            Ok(manifest) => json!({"ok": true, "manifest": manifest}),
            Err((failure, manifest)) => {
                json!({"ok": false, "failure": failure, "manifest": manifest})
            }
        },
    )
}

/// Removes a resource from the manifest without touching Cloudflare.
fn forget(runtime: &TaskRuntime, project: &Path, kind: Kind) -> Result<Option<Manifest>, String> {
    let manifest =
        read_manifest(project)?.ok_or("This project has no cloud resources recorded.")?;
    if kind == Kind::Hyperdrive {
        save_postgres_url(runtime, project, None)?;
    }
    let resources = manifest
        .resources
        .into_iter()
        .filter(|resource| resource.kind != kind)
        .collect();
    write_manifest(project, &manifest.account_id, &manifest.prefix, resources)
}

#[tauri::command]
pub async fn cloudflare_resources_forget(
    project_path: String,
    kind: Kind,
    state: State<'_, TaskRuntime>,
) -> Result<Option<Manifest>, String> {
    let project = project_folder(&project_path)?;
    let _running = RunGuard::acquire(project_key(&project))?;
    forget(state.inner(), &project, kind)
}

/// Deletes one recorded resource from Cloudflare, then forgets it. Durable Objects
/// and Workers are only forgotten; they belong to the deployed Worker.
#[tauri::command]
pub async fn cloudflare_resources_delete(
    project_path: String,
    kind: Kind,
    state: State<'_, TaskRuntime>,
) -> Result<Option<Manifest>, String> {
    let project = project_folder(&project_path)?;
    let _running = RunGuard::acquire(project_key(&project))?;
    let manifest =
        read_manifest(&project)?.ok_or("This project has no cloud resources recorded.")?;
    let resource = manifest
        .resources
        .iter()
        .find(|resource| resource.kind == kind)
        .ok_or("That resource is not recorded for this project.")?;
    if kind.provisioned() {
        let access = connection::account_access(state.inner()).await?;
        if access.account_id != manifest.account_id {
            return Err(format!(
                "These resources are in another Cloudflare account. Delete them in the dashboard: {}",
                manifest.dashboard
            ));
        }
        let api = api_for(&access)?;
        let id = resource.id.as_deref().unwrap_or(&resource.name);
        api.delete(kind, id).await?;
    }
    forget(state.inner(), &project, kind)
}

/// The Turnstile widget's secret key, read from Cloudflare when asked so it is never saved.
#[tauri::command]
pub async fn cloudflare_resources_turnstile_secret(
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let project = project_folder(&project_path)?;
    let manifest =
        read_manifest(&project)?.ok_or("This project has no cloud resources recorded.")?;
    let sitekey = manifest
        .resources
        .iter()
        .find(|resource| resource.kind == Kind::Turnstile)
        .and_then(|resource| resource.id.clone())
        .ok_or("This project has no Turnstile widget recorded.")?;
    let access = connection::account_access(state.inner()).await?;
    if access.account_id != manifest.account_id {
        return Err("The Turnstile widget is in another Cloudflare account.".into());
    }
    api_for(&access)?.turnstile_secret(&sitekey).await
}
