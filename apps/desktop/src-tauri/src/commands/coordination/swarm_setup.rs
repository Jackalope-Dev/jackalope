//! One-click Jackalope Swarm: uploads the Worker bundled with this app to the
//! connected Cloudflare account, binds it to the connected Artifacts namespace,
//! sets a generated token as its `SWARM_TOKEN` secret, publishes it on
//! workers.dev, checks it and saves the connection.
//!
//! Running it again updates the same Worker in place and keeps its token, so
//! other computers using that token keep working. The bundle comes from
//! `pnpm --filter @jackalope/swarm bundle`; `pnpm check:swarm-bundle` fails when
//! it no longer matches apps/swarm.

use super::cloud::{self, Connection, Deployment};
use super::Coordinator;
use crate::commands::cloudflare_artifacts::{self, WorkersAccess};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};

const WORKER: &str = include_str!("../../../resources/swarm-worker/worker.js");
const MANIFEST: &str = include_str!("../../../resources/swarm-worker/manifest.json");
const API_ROOT: &str = "https://api.cloudflare.com/client/v4/accounts";
const PROGRESS_EVENT: &str = "swarm-setup-progress";
/// A first workers.dev publish can take a little while to answer everywhere.
const HEALTH_ATTEMPTS: u32 = 20;
const HEALTH_WAIT: Duration = Duration::from_secs(3);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: String,
    script: String,
    main_module: String,
    compatibility_date: String,
    compatibility_flags: Vec<String>,
    artifacts_binding: String,
    durable_objects: Vec<DurableObject>,
    /// wrangler.jsonc migrations: each has a `tag` and its class changes.
    migrations: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DurableObject {
    name: String,
    class_name: String,
}

fn manifest() -> &'static Manifest {
    static PARSED: OnceLock<Manifest> = OnceLock::new();
    PARSED.get_or_init(|| {
        serde_json::from_str(MANIFEST).expect("the bundled swarm manifest is valid JSON")
    })
}

pub(super) fn bundled_version() -> &'static str {
    &manifest().version
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Account,
    Deploy,
    Publish,
    Verify,
}

/// What the person can do about a failed step.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Recovery {
    /// Connect Cloudflare again, allowing Workers.
    Reauthorize,
    /// Replace the API token with one that can edit Workers scripts.
    Token,
    /// Choose the account's workers.dev subdomain in the dashboard.
    Subdomain,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    step: Step,
    message: String,
    recovery: Option<Recovery>,
    /// A Cloudflare dashboard page that resolves the failure, when there is one.
    link: Option<String>,
}

impl Failure {
    fn new(step: Step, message: impl Into<String>) -> Self {
        Self {
            step,
            message: message.into(),
            recovery: None,
            link: None,
        }
    }
}

fn permission_failure(step: Step, oauth: bool) -> Failure {
    if oauth {
        Failure {
            step,
            message: "Cloudflare has not allowed Jackalope to deploy Workers yet.".into(),
            recovery: Some(Recovery::Reauthorize),
            link: None,
        }
    } else {
        Failure {
            step,
            message: "Your Cloudflare API token cannot deploy Workers. Give it Account → Workers Scripts → Edit as well as Artifacts → Edit, then try again.".into(),
            recovery: Some(Recovery::Token),
            link: Some("https://dash.cloudflare.com/profile/api-tokens".into()),
        }
    }
}

/// Maps a Workers API refusal to a step failure. Permission errors (401/403, or
/// Cloudflare's 10000 authentication error) lead to reconnecting or a new token.
fn api_failure(step: Step, status: u16, body: &Value, oauth: bool) -> Failure {
    let code = body["errors"][0]["code"].as_u64().unwrap_or_default();
    if matches!(status, 401 | 403) || code == 10000 {
        return permission_failure(step, oauth);
    }
    if status == 429 {
        return Failure::new(step, "Cloudflare is rate limiting requests. Retry shortly.");
    }
    let detail: String = body["errors"][0]["message"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(300)
        .collect();
    Failure::new(
        step,
        if detail.is_empty() {
            format!("Cloudflare returned {status}. Retry, or check Workers in the Cloudflare dashboard.")
        } else {
            format!("Cloudflare returned {status}: {detail}")
        },
    )
}

/// The migrations to send for a script whose current tag is `current`, as
/// `wrangler deploy` computes them: everything for a new script, only later
/// steps for an existing one, and nothing once it is up to date.
fn migrations_to_upload(migrations: &[Value], current: Option<&str>) -> Option<Value> {
    let last = migrations.last()?["tag"].as_str()?;
    let steps = |from: usize| -> Vec<Value> {
        migrations[from..]
            .iter()
            .map(|migration| {
                let mut step = migration.clone();
                if let Some(object) = step.as_object_mut() {
                    object.remove("tag");
                }
                step
            })
            .collect()
    };
    match current {
        None => Some(json!({"new_tag": last, "steps": steps(0)})),
        Some(tag) => match migrations.iter().position(|m| m["tag"] == tag) {
            Some(index) if index + 1 == migrations.len() => None,
            Some(index) => {
                Some(json!({"old_tag": tag, "new_tag": last, "steps": steps(index + 1)}))
            }
            None => Some(json!({"old_tag": tag, "new_tag": last, "steps": steps(0)})),
        },
    }
}

/// The upload metadata. Secrets are sent as bindings so a Worker never runs
/// without its token, and the full binding list replaces the previous one.
fn metadata(manifest: &Manifest, namespace: &str, token: &str, migrations: Option<Value>) -> Value {
    let mut bindings = vec![json!({
        "type": "artifacts",
        "name": manifest.artifacts_binding,
        "namespace": namespace,
    })];
    bindings.extend(manifest.durable_objects.iter().map(|object| {
        json!({
            "type": "durable_object_namespace",
            "name": object.name,
            "class_name": object.class_name,
        })
    }));
    bindings.push(json!({"type": "secret_text", "name": "SWARM_TOKEN", "text": token}));
    bindings.push(json!({"type": "plain_text", "name": "SWARM_VERSION", "text": manifest.version}));
    let mut metadata = json!({
        "main_module": manifest.main_module,
        "compatibility_date": manifest.compatibility_date,
        "compatibility_flags": manifest.compatibility_flags,
        "bindings": bindings,
    });
    if let Some(migrations) = migrations {
        metadata["migrations"] = migrations;
    }
    metadata
}

/// A `multipart/form-data` body with the metadata part and the module part.
fn multipart(boundary: &str, metadata: &Value, module: &str, code: &str) -> Vec<u8> {
    let mut body = Vec::with_capacity(code.len() + 2048);
    let mut part = |headers: String, content: &[u8]| {
        body.extend_from_slice(format!("--{boundary}\r\n{headers}\r\n\r\n").as_bytes());
        body.extend_from_slice(content);
        body.extend_from_slice(b"\r\n");
    };
    part(
        "Content-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json"
            .into(),
        metadata.to_string().as_bytes(),
    );
    part(
        format!("Content-Disposition: form-data; name=\"{module}\"; filename=\"{module}\"\r\nContent-Type: application/javascript+module"),
        code.as_bytes(),
    );
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

/// A random value from the operating system's generator (UUID v4 uses getrandom).
fn random(bytes: usize) -> String {
    let mut data = Vec::with_capacity(bytes + 16);
    while data.len() < bytes {
        data.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    data.truncate(bytes);
    URL_SAFE_NO_PAD.encode(data)
}

/// A new SWARM_TOKEN: 48 random bytes, 64 URL-safe characters.
fn generate_token() -> String {
    random(48)
}

fn worker_url(script: &str, subdomain: &str) -> String {
    format!("https://{script}.{subdomain}.workers.dev")
}

struct Api<'a> {
    access: &'a WorkersAccess,
    client: reqwest::Client,
}

impl Api<'_> {
    async fn send(
        &self,
        method: reqwest::Method,
        route: &str,
        body: Option<(String, Vec<u8>)>,
    ) -> Result<(u16, Value), String> {
        let mut request = self
            .client
            .request(
                method,
                format!("{API_ROOT}/{}/workers{route}", self.access.account_id),
            )
            .bearer_auth(&self.access.token);
        if let Some((content_type, bytes)) = body {
            request = request.header("content-type", content_type).body(bytes);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Could not reach Cloudflare. Check your connection and retry.")?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await.unwrap_or_default();
        Ok((
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        ))
    }

    async fn expect(
        &self,
        step: Step,
        method: reqwest::Method,
        route: &str,
        body: Option<(String, Vec<u8>)>,
    ) -> Result<Value, Failure> {
        let (status, value) = self
            .send(method, route, body)
            .await
            .map_err(|message| Failure::new(step, message))?;
        if !(200..300).contains(&status) || value["success"] != true {
            return Err(api_failure(step, status, &value, self.access.oauth));
        }
        Ok(value["result"].clone())
    }

    fn json(value: &Value) -> Option<(String, Vec<u8>)> {
        Some(("application/json".into(), value.to_string().into_bytes()))
    }
}

/// The account's workers.dev subdomain. Cloudflare reports 10007 when there is none.
async fn subdomain(api: &Api<'_>) -> Result<String, Failure> {
    let (status, value) = api
        .send(reqwest::Method::GET, "/subdomain", None)
        .await
        .map_err(|message| Failure::new(Step::Account, message))?;
    if value["errors"][0]["code"] == 10007 {
        return Err(Failure {
            step: Step::Account,
            message: "This Cloudflare account has no workers.dev subdomain yet. Choose one, then try again.".into(),
            recovery: Some(Recovery::Subdomain),
            link: Some(format!(
                "https://dash.cloudflare.com/{}/workers/onboarding",
                api.access.account_id
            )),
        });
    }
    if !(200..300).contains(&status) || value["success"] != true {
        return Err(api_failure(Step::Account, status, &value, api.access.oauth));
    }
    value["result"]["subdomain"]
        .as_str()
        .filter(|name| {
            !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.'))
        })
        .map(str::to_owned)
        .ok_or_else(|| {
            Failure::new(
                Step::Account,
                "Cloudflare did not return a workers.dev subdomain.",
            )
        })
}

/// The migration tag of an existing script, or None when it does not exist yet.
async fn migration_tag(api: &Api<'_>, script: &str) -> Result<Option<String>, Failure> {
    let (status, value) = api
        .send(reqwest::Method::GET, &format!("/services/{script}"), None)
        .await
        .map_err(|message| Failure::new(Step::Account, message))?;
    let code = value["errors"][0]["code"].as_u64().unwrap_or_default();
    if status == 404 || matches!(code, 10007 | 10090 | 10092) {
        return Ok(None);
    }
    if !(200..300).contains(&status) || value["success"] != true {
        return Err(api_failure(Step::Account, status, &value, api.access.oauth));
    }
    Ok(
        value["result"]["default_environment"]["script"]["migration_tag"]
            .as_str()
            .filter(|tag| !tag.is_empty())
            .map(str::to_owned),
    )
}

/// The token for a new setup attempt, kept so a retry uploads the same one.
static PENDING_TOKEN: Mutex<Option<(String, String)>> = Mutex::new(None);
static RUNNING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Keeps the saved token when the saved connection is this Worker, so other
/// computers that use it keep working after an update.
fn choose_token(saved: Option<&Connection>, account_id: &str, url: &str) -> String {
    if let Some(saved) = saved {
        let same_deployment = saved
            .deployment
            .as_ref()
            .is_some_and(|deployment| deployment.account_id == account_id);
        if same_deployment || saved.url == url {
            return saved.token.clone();
        }
    }
    let mut pending = PENDING_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
    match pending.as_ref() {
        Some((account, token)) if account == account_id => token.clone(),
        _ => {
            let token = generate_token();
            *pending = Some((account_id.into(), token.clone()));
            token
        }
    }
}

async fn healthy(client: &reqwest::Client, url: &str) -> bool {
    for attempt in 0..HEALTH_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(HEALTH_WAIT).await;
        }
        let Ok(response) = client.get(format!("{url}/health")).send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let value: Value = response.json().await.unwrap_or(Value::Null);
        // An older deployment may answer until the new version reaches this location.
        if value["ok"] == true && value["version"] == bundled_version() {
            return true;
        }
    }
    false
}

async fn run(app: &AppHandle, service: &Coordinator) -> Result<Value, Failure> {
    let progress = |step: Step| {
        let _ = app.emit(PROGRESS_EVENT, step);
    };
    let manifest = manifest();
    progress(Step::Account);
    let access = cloudflare_artifacts::workers_access(&service.runtime)
        .await
        .map_err(|message| Failure::new(Step::Account, message))?;
    if access.workers_allowed == Some(false) {
        return Err(permission_failure(Step::Account, true));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| Failure::new(Step::Account, e.to_string()))?;
    let api = Api {
        access: &access,
        client: client.clone(),
    };
    let subdomain = subdomain(&api).await?;
    let current_tag = migration_tag(&api, &manifest.script).await?;
    let url = worker_url(&manifest.script, &subdomain);
    let saved = cloud::connection(&service.runtime)
        .map_err(|message| Failure::new(Step::Account, message))?;
    let token = choose_token(saved.as_ref(), &access.account_id, &url);

    progress(Step::Deploy);
    let boundary = format!("jackalope-{}", random(18));
    let body = multipart(
        &boundary,
        &metadata(
            manifest,
            &access.namespace,
            &token,
            migrations_to_upload(&manifest.migrations, current_tag.as_deref()),
        ),
        &manifest.main_module,
        WORKER,
    );
    api.expect(
        Step::Deploy,
        reqwest::Method::PUT,
        &format!("/scripts/{}", manifest.script),
        Some((format!("multipart/form-data; boundary={boundary}"), body)),
    )
    .await?;

    progress(Step::Publish);
    api.expect(
        Step::Publish,
        reqwest::Method::POST,
        &format!("/scripts/{}/subdomain", manifest.script),
        Api::json(&json!({"enabled": true, "previews_enabled": false})),
    )
    .await?;

    progress(Step::Verify);
    if !healthy(&client, &url).await {
        return Err(Failure::new(
            Step::Verify,
            format!("The Worker was deployed but {url} is not answering yet. Retry in a minute."),
        ));
    }
    let saved = cloud::check_and_save(
        service,
        Connection {
            url,
            token,
            deployment: Some(Deployment {
                account_id: access.account_id.clone(),
                script: manifest.script.clone(),
                namespace: access.namespace.clone(),
                version: manifest.version.clone(),
            }),
        },
    )
    .await
    .map_err(|message| Failure::new(Step::Verify, message))?;
    if let Ok(mut pending) = PENDING_TOKEN.lock() {
        *pending = None;
    }
    Ok(saved)
}

/// What deleting the deployed Worker came to.
#[derive(Debug, PartialEq)]
pub(super) enum Removal {
    Deleted,
    /// Cloudflare no longer has the script.
    AlreadyGone,
    /// The Worker is still deployed; the message says how to remove it by hand.
    Kept(String),
}

/// The Workers route that deletes a script. `force` also removes the Durable
/// Objects the script defines, which hold the swarm's fork records.
fn delete_route(script: &str) -> String {
    let script: String = script
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .collect();
    format!("/scripts/{script}?force=true")
}

fn removal(status: u16, body: &Value, oauth: bool, dashboard: &str) -> Removal {
    let code = body["errors"][0]["code"].as_u64().unwrap_or_default();
    if (200..300).contains(&status) && body["success"] != false {
        return Removal::Deleted;
    }
    if status == 404 || matches!(code, 10007 | 10090 | 10092) {
        return Removal::AlreadyGone;
    }
    let reason = if matches!(status, 401 | 403) || code == 10000 {
        if oauth {
            "Cloudflare did not allow Jackalope to delete Workers."
        } else {
            "Your Cloudflare API token cannot delete Workers."
        }
        .to_string()
    } else {
        api_failure(Step::Deploy, status, body, oauth).message
    };
    Removal::Kept(format!(
        "{reason} The Worker is still deployed; delete it in the Cloudflare dashboard: {dashboard}"
    ))
}

/// Deletes a Worker that one-click setup deployed, using the saved Cloudflare
/// connection. A Worker in an account other than the connected one is left alone.
pub(super) async fn delete_worker(
    runtime: &crate::commands::tasks::TaskRuntime,
    deployment: &Deployment,
) -> Removal {
    let dashboard = format!(
        "https://dash.cloudflare.com/{}/workers/services/view/{}",
        deployment.account_id, deployment.script
    );
    let access = match cloudflare_artifacts::workers_access(runtime).await {
        Ok(access) if access.account_id == deployment.account_id => access,
        Ok(_) => {
            return Removal::Kept(format!(
                "The Worker is in a Cloudflare account that is no longer connected. Delete it in the Cloudflare dashboard: {dashboard}"
            ))
        }
        Err(_) => {
            return Removal::Kept(format!(
                "Cloudflare is not connected, so the Worker is still deployed. Delete it in the Cloudflare dashboard: {dashboard}"
            ))
        }
    };
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return Removal::Kept(format!(
            "Delete the Worker in the Cloudflare dashboard: {dashboard}"
        ));
    };
    let api = Api {
        access: &access,
        client,
    };
    match api
        .send(
            reqwest::Method::DELETE,
            &delete_route(&deployment.script),
            None,
        )
        .await
    {
        Ok((status, body)) => removal(status, &body, access.oauth, &dashboard),
        Err(message) => Removal::Kept(format!(
            "{message} The Worker is still deployed; delete it in the Cloudflare dashboard: {dashboard}"
        )),
    }
}

/// Sets up or updates the person's swarm Worker. Resolves with
/// `{ok: true, connection}` or `{ok: false, failure}`; progress arrives as
/// `swarm-setup-progress` events naming each step as it starts.
#[tauri::command]
pub async fn swarm_setup(app: AppHandle, state: State<'_, Coordinator>) -> Result<Value, String> {
    let Ok(_running) = RUNNING.try_lock() else {
        return Err("Swarm setup is already running.".into());
    };
    Ok(match run(&app, state.inner()).await {
        Ok(_) => json!({"ok": true, "connection": cloud::status_value(&state.runtime)?}),
        Err(failure) => json!({"ok": false, "failure": failure}),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Manifest {
        serde_json::from_value(json!({
            "version": "abc123",
            "script": "jackalope-swarm",
            "mainModule": "worker.js",
            "compatibilityDate": "2026-09-28",
            "compatibilityFlags": [],
            "artifactsBinding": "ARTIFACTS",
            "durableObjects": [{"name": "SWARM", "className": "Swarm"}],
            "migrations": [
                {"tag": "v1", "new_sqlite_classes": ["Swarm"]},
                {"tag": "v2", "renamed_classes": [{"from": "Swarm", "to": "Hive"}]}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn bundled_worker_and_manifest_agree() {
        let manifest = manifest();
        assert_eq!(manifest.version.len(), 16);
        assert_eq!(manifest.script, "jackalope-swarm");
        assert_eq!(manifest.main_module, "worker.js");
        assert_eq!(manifest.artifacts_binding, "ARTIFACTS");
        assert!(!manifest.migrations.is_empty());
        // Every Durable Object the upload binds is exported by the module.
        for object in &manifest.durable_objects {
            assert!(WORKER.contains(&format!("var {} = class", object.class_name)));
            assert!(WORKER.contains(&format!("\n  {},\n", object.class_name)));
        }
        assert!(WORKER.contains("as default\n};"));
    }

    #[test]
    fn metadata_binds_the_connected_namespace_objects_and_secret() {
        let value = metadata(&fixture(), "team-repos", "s".repeat(64).as_str(), None);
        assert_eq!(value["main_module"], "worker.js");
        assert_eq!(value["compatibility_date"], "2026-09-28");
        assert_eq!(value["compatibility_flags"], json!([]));
        assert!(value.get("migrations").is_none());
        let bindings = value["bindings"].as_array().unwrap();
        assert_eq!(
            bindings[0],
            json!({"type": "artifacts", "name": "ARTIFACTS", "namespace": "team-repos"})
        );
        assert_eq!(
            bindings[1],
            json!({"type": "durable_object_namespace", "name": "SWARM", "class_name": "Swarm"})
        );
        assert_eq!(
            bindings[2],
            json!({"type": "secret_text", "name": "SWARM_TOKEN", "text": "s".repeat(64)})
        );
        assert_eq!(
            bindings[3],
            json!({"type": "plain_text", "name": "SWARM_VERSION", "text": "abc123"})
        );
    }

    #[test]
    fn migrations_follow_the_scripts_current_tag() {
        let manifest = fixture();
        let all = migrations_to_upload(&manifest.migrations, None).unwrap();
        assert_eq!(all["new_tag"], "v2");
        assert!(all.get("old_tag").is_none());
        assert_eq!(all["steps"][0], json!({"new_sqlite_classes": ["Swarm"]}));
        assert_eq!(all["steps"].as_array().unwrap().len(), 2);

        let later = migrations_to_upload(&manifest.migrations, Some("v1")).unwrap();
        assert_eq!(later["old_tag"], "v1");
        assert_eq!(later["steps"].as_array().unwrap().len(), 1);
        assert!(later["steps"][0].get("renamed_classes").is_some());

        assert!(migrations_to_upload(&manifest.migrations, Some("v2")).is_none());
        let unknown = migrations_to_upload(&manifest.migrations, Some("old")).unwrap();
        assert_eq!(unknown["old_tag"], "old");
        assert_eq!(unknown["steps"].as_array().unwrap().len(), 2);
        assert!(migrations_to_upload(&[], None).is_none());

        let metadata = metadata(
            &manifest,
            "n",
            "t",
            migrations_to_upload(&manifest.migrations, None),
        );
        assert_eq!(metadata["migrations"]["new_tag"], "v2");
    }

    #[test]
    fn multipart_sends_metadata_then_the_es_module() {
        let body = multipart(
            "b0und",
            &json!({"main_module": "worker.js"}),
            "worker.js",
            "export default {};",
        );
        let text = String::from_utf8(body).unwrap();
        assert_eq!(
            text,
            "--b0und\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{\"main_module\":\"worker.js\"}\r\n\
             --b0und\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\nexport default {};\r\n\
             --b0und--\r\n"
        );
    }

    #[test]
    fn permission_errors_lead_to_reconnecting_or_a_new_token() {
        let refused = json!({"success": false, "errors": [{"code": 10000, "message": "Authentication error"}]});
        let oauth = api_failure(Step::Deploy, 403, &refused, true);
        assert_eq!(oauth.recovery, Some(Recovery::Reauthorize));
        assert_eq!(oauth.step, Step::Deploy);
        let token = api_failure(Step::Account, 400, &refused, false);
        assert_eq!(token.recovery, Some(Recovery::Token));
        assert!(token.message.contains("Workers Scripts → Edit"));
        let other = api_failure(
            Step::Deploy,
            400,
            &json!({"errors": [{"code": 10021, "message": "Uncaught Error\n at worker.js"}]}),
            true,
        );
        assert_eq!(other.recovery, None);
        assert_eq!(
            other.message,
            "Cloudflare returned 400: Uncaught Error at worker.js"
        );
        assert_eq!(
            api_failure(Step::Publish, 429, &Value::Null, true).recovery,
            None
        );
    }

    #[test]
    fn failures_serialize_for_the_settings_card() {
        let value = serde_json::to_value(permission_failure(Step::Account, false)).unwrap();
        assert_eq!(value["step"], "account");
        assert_eq!(value["recovery"], "token");
        assert_eq!(
            value["link"],
            "https://dash.cloudflare.com/profile/api-tokens"
        );
    }

    #[test]
    fn deleting_the_worker_forces_out_its_durable_objects() {
        assert_eq!(
            delete_route("jackalope-swarm"),
            "/scripts/jackalope-swarm?force=true"
        );
        assert_eq!(delete_route("a/../b?x"), "/scripts/abx?force=true");
    }

    #[test]
    fn worker_removal_treats_missing_scripts_as_gone_and_refusals_as_kept() {
        let dash = "https://dash.cloudflare.com/a/workers/services/view/jackalope-swarm";
        assert_eq!(
            removal(200, &json!({"success": true}), true, dash),
            Removal::Deleted
        );
        assert_eq!(removal(404, &Value::Null, true, dash), Removal::AlreadyGone);
        assert_eq!(
            removal(400, &json!({"errors": [{"code": 10007}]}), false, dash),
            Removal::AlreadyGone
        );
        let Removal::Kept(oauth) = removal(403, &Value::Null, true, dash) else {
            panic!("a refusal keeps the Worker");
        };
        assert!(oauth.contains("did not allow Jackalope"));
        assert!(oauth.ends_with(dash));
        let Removal::Kept(token) = removal(400, &json!({"errors": [{"code": 10000}]}), false, dash)
        else {
            panic!("a refusal keeps the Worker");
        };
        assert!(token.contains("API token cannot delete Workers"));
        let Removal::Kept(other) = removal(500, &Value::Null, false, dash) else {
            panic!("a server error keeps the Worker");
        };
        assert!(other.starts_with("Cloudflare returned 500"));
    }

    #[test]
    fn generated_tokens_are_long_random_and_url_safe() {
        let token = generate_token();
        assert_eq!(token.len(), 64);
        assert!(token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(token, generate_token());
        // The Worker and the desktop both require at least 32 characters.
        assert!(cloud::validate(&Connection {
            url: "https://jackalope-swarm.me.workers.dev".into(),
            token,
            deployment: None,
        })
        .is_ok());
    }

    #[test]
    fn updates_keep_the_saved_token_and_retries_reuse_the_pending_one() {
        let url = worker_url("jackalope-swarm", "me");
        assert_eq!(url, "https://jackalope-swarm.me.workers.dev");
        let manual = Connection {
            url: url.clone(),
            token: "manual".into(),
            deployment: None,
        };
        assert_eq!(choose_token(Some(&manual), "acct", &url), "manual");
        let managed = Connection {
            url: "https://old.example".into(),
            token: "managed".into(),
            deployment: Some(Deployment {
                account_id: "acct".into(),
                script: "jackalope-swarm".into(),
                namespace: "jackalope".into(),
                version: "v".into(),
            }),
        };
        assert_eq!(choose_token(Some(&managed), "acct", &url), "managed");
        let first = choose_token(Some(&managed), "other-account", &url);
        assert_eq!(first.len(), 64);
        assert_eq!(choose_token(None, "other-account", &url), first);
        assert_ne!(choose_token(None, "third-account", &url), first);
    }
}
