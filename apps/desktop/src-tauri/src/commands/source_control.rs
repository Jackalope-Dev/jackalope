//! Code hosts. GitHub goes through the GitHub CLI in `delivery`, `github_workflows`
//! and `issues`, unchanged; this module recognizes GitLab and Bitbucket Cloud from a
//! project's remote and serves the same delivery, following and import requests
//! through the GitLab CLI (`glab`) and the Bitbucket REST API. Each host reports the
//! change request in the shape the GitHub CLI prints, so the webview reads one shape.

pub(crate) mod bitbucket;
pub(crate) mod gitlab;
pub(crate) mod remote;

use super::{process_control, repo, repo::Policy, tasks::TaskRuntime};
use remote::Repository;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::State;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostKind {
    Github,
    Gitlab,
    Bitbucket,
}

/// A check in the shape `gh pr view --json statusCheckRollup` reports one.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Check {
    pub name: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conclusion: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

/// A GitLab merge request or Bitbucket pull request, in the fields and values
/// `gh pr view --json` uses, plus what only these hosts report.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeRequest {
    pub provider: HostKind,
    pub url: String,
    pub number: u64,
    pub title: String,
    /// `OPEN`, `MERGED` or `CLOSED`.
    pub state: &'static str,
    pub is_draft: bool,
    /// The source commit. Bitbucket reports an abbreviated hash.
    pub head_ref_oid: String,
    /// `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, `APPROVED` or empty.
    pub review_decision: &'static str,
    /// `MERGEABLE`, `CONFLICTING` or `UNKNOWN`.
    pub mergeable: &'static str,
    pub status_check_rollup: Vec<Check>,
    /// The pipeline whose failed jobs a follow-up can read: a GitLab pipeline ID or a
    /// Bitbucket Pipelines build number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline: Option<String>,
    /// What else the host says stands in the way of merging, in its own words.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocker: Option<String>,
    pub merge_methods: Vec<&'static str>,
}

impl ChangeRequest {
    pub(crate) fn json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

/// Where a checkout's remote change requests are served.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Route {
    /// The GitHub CLI, as before: github.com, a configured GitHub Enterprise host, and
    /// any host Jackalope does not recognize.
    GitHub,
    GitLab(Repository),
    Bitbucket(Repository),
}

// --- Settings: self-managed hosts and per-project choices (not secret) ---

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredHost {
    pub host: String,
    pub kind: HostKind,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub hosts: Vec<ConfiguredHost>,
    /// A project's own choice of host kind, by project folder.
    pub projects: BTreeMap<String, HostKind>,
}

fn settings_path(integration: &Path) -> PathBuf {
    integration.join("source-control.json")
}

pub(crate) fn settings(integration: &Path) -> Result<Settings, String> {
    match super::platform::read_capped(&settings_path(integration), 1_000_000) {
        Ok(Some(bytes)) => serde_json::from_slice(&bytes).map_err(|_| {
            "Code host settings could not be read. The file was left as it is.".to_string()
        }),
        Ok(None) => Ok(Settings::default()),
        Err(_) => Err("Code host settings could not be read.".into()),
    }
}

fn save_settings(integration: &Path, settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(integration).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    super::history::write_atomic(&settings_path(integration), &bytes)
}

fn project_key(project: &str) -> String {
    project.trim().trim_end_matches(['/', '\\']).to_string()
}

/// Self-managed hosts and per-project choices cover GitLab and GitHub Enterprise.
/// Bitbucket Data Center has a different API, so only bitbucket.org is Bitbucket.
fn configurable(kind: HostKind) -> Result<(), String> {
    if kind == HostKind::Bitbucket {
        return Err("Bitbucket is recognized from bitbucket.org remotes. Bitbucket Data Center is not supported.".into());
    }
    Ok(())
}

// --- Locating a checkout's code host ---

fn git(path: &Path, args: &[&str]) -> Option<String> {
    let result = process_control::run(
        repo::command(path, args, Policy::Inspection),
        Duration::from_secs(10),
    )
    .ok()?;
    let out = result.stdout.trim();
    (result.success && !out.is_empty()).then(|| out.to_string())
}

/// The remote a checkout publishes to: its branch's remote, then `origin`, then its only remote.
fn remote_url(path: &Path) -> Option<String> {
    let branch = git(path, &["branch", "--show-current"]);
    let configured = branch
        .and_then(|branch| {
            git(
                path,
                &["config", "--get", &format!("branch.{branch}.remote")],
            )
        })
        .filter(|remote| remote != "." && !remote.starts_with('-'));
    let remotes = git(path, &["remote"]).unwrap_or_default();
    let remotes: Vec<_> = remotes.lines().map(str::trim).collect();
    let remote = configured
        .filter(|remote| remotes.contains(&remote.as_str()))
        .or_else(|| remotes.contains(&"origin").then(|| "origin".to_string()))
        .or_else(|| (remotes.len() == 1).then(|| remotes[0].to_string()))?;
    git(path, &["remote", "get-url", "--", &remote])
}

/// Where the checkout's remote lives and what kind of host it is (`None` when unrecognized).
pub(crate) fn locate(
    integration: &Path,
    checkout: &Path,
    project: &str,
) -> Option<(Option<HostKind>, Repository)> {
    let repository = remote::parse_remote(&remote_url(checkout)?)?;
    let settings = settings(integration).unwrap_or_default();
    let configured: Vec<_> = settings
        .hosts
        .iter()
        .map(|host| (host.host.clone(), host.kind))
        .collect();
    let chosen = settings.projects.get(&project_key(project)).copied();
    Some((
        remote::kind_of(&repository.host, &configured, chosen),
        repository,
    ))
}

pub(crate) fn route(integration: &Path, checkout: &Path, project: &str) -> Route {
    match locate(integration, checkout, project) {
        Some((Some(HostKind::Gitlab), repository)) => Route::GitLab(repository),
        Some((Some(HostKind::Bitbucket), repository)) => Route::Bitbucket(repository),
        _ => Route::GitHub,
    }
}

/// The route for a change request address: GitLab and Bitbucket addresses have their
/// own shapes; anything else stays with the GitHub CLI and its own address check.
pub(crate) fn route_url(url: &str) -> (Route, u64) {
    match remote::parse_change_request(url) {
        Some(request) if request.kind == HostKind::Gitlab => {
            (Route::GitLab(request.repository), request.number)
        }
        Some(request) => (Route::Bitbucket(request.repository), request.number),
        None => (Route::GitHub, 0),
    }
}

/// Reads a merge request address through glab only when it is on the task's own
/// remote host or a GitLab host the person named, so a saved address cannot point
/// their GitLab sign-in at another server.
pub(crate) fn check_gitlab_host(
    integration: &Path,
    checkout: &Path,
    project: &str,
    repository: &Repository,
) -> Result<(), String> {
    if let Some((_, own)) = locate(integration, checkout, project) {
        if own.host == repository.host {
            return Ok(());
        }
    }
    let configured: Vec<_> = settings(integration)
        .unwrap_or_default()
        .hosts
        .into_iter()
        .map(|host| (host.host, host.kind))
        .collect();
    if remote::kind_of(&repository.host, &configured, None) == Some(HostKind::Gitlab) {
        Ok(())
    } else {
        Err(format!(
            "{} is not this task's GitLab host. Add it under Settings → Connected work to follow merge requests there.",
            repository.host
        ))
    }
}

// --- What each host can do ---

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub create: bool,
    pub draft: bool,
    pub merge: bool,
    pub merge_methods: Vec<&'static str>,
    pub follow: bool,
    pub review_threads: bool,
    pub ci_logs: bool,
    pub issues: bool,
    pub change_request_list: bool,
}

/// What Jackalope offers on a host. `issues` is whether the repository's own
/// tracker can be read: Bitbucket repositories turn theirs on separately.
pub(crate) fn capabilities(kind: HostKind, issues: bool) -> Capabilities {
    let merge_methods = match kind {
        HostKind::Github => vec!["merge", "squash", "rebase"],
        HostKind::Gitlab => vec!["merge", "squash"],
        HostKind::Bitbucket => vec!["merge", "squash", "fastForward"],
    };
    Capabilities {
        create: true,
        draft: true,
        merge: true,
        merge_methods,
        follow: true,
        review_threads: true,
        ci_logs: true,
        issues: kind != HostKind::Bitbucket || issues,
        change_request_list: true,
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    /// `ready`, `unchecked`, `missing` (the CLI is not installed), `signedOut`,
    /// `notConnected` (no Bitbucket token) or `error`.
    pub state: &'static str,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHost {
    /// The host kind requests go to; an unrecognized host goes to the GitHub CLI.
    kind: HostKind,
    recognized: bool,
    host: String,
    repository: String,
    chosen: Option<HostKind>,
    capabilities: Capabilities,
    access: Access,
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::source_control::project_source_control,
            commands::source_control::source_control_settings,
            commands::source_control::source_control_host_save,
            commands::source_control::source_control_host_remove,
            commands::source_control::source_control_project_host,
            commands::source_control::gitlab_cli_status,
            commands::source_control::bitbucket_connection_save,
            commands::source_control::bitbucket_connection_test,
            commands::source_control::bitbucket_connection_remove,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// The project's code host, what Jackalope can do there and whether its sign-in is ready.
#[tauri::command]
pub async fn project_source_control(
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<ProjectHost, String> {
    let integration = state.integration_directory();
    let lookup = integration.clone();
    let path = project_path.clone();
    let (located, chosen) = tauri::async_runtime::spawn_blocking(move || {
        let chosen = settings(&lookup)
            .ok()
            .and_then(|settings| settings.projects.get(&project_key(&path)).copied());
        (locate(&lookup, Path::new(&path), &path), chosen)
    })
    .await
    .map_err(|error| error.to_string())?;
    let (kind, repository) = match located {
        Some((kind, repository)) => (kind, Some(repository)),
        None => (None, None),
    };
    let host = repository
        .as_ref()
        .map(|repository| repository.host.clone())
        .unwrap_or_default();
    let (access, issues) = match (kind, &repository) {
        (Some(HostKind::Gitlab), _) => {
            let host = host.clone();
            let access = tauri::async_runtime::spawn_blocking(move || gitlab::access(&host))
                .await
                .map_err(|error| error.to_string())?;
            (access, true)
        }
        (Some(HostKind::Bitbucket), Some(repository)) => {
            match bitbucket::credentials(&integration) {
                Ok(None) => (bitbucket::not_connected(), false),
                Err(error) => (
                    Access {
                        state: "error",
                        message: error,
                    },
                    false,
                ),
                Ok(Some(credentials)) => {
                    match bitbucket::repository(&credentials, repository).await {
                        Ok(info) => (
                            Access {
                                state: "ready",
                                message: String::new(),
                            },
                            info.has_issues,
                        ),
                        Err(error) => (
                            Access {
                                state: "error",
                                message: error,
                            },
                            false,
                        ),
                    }
                }
            }
        }
        _ => (
            Access {
                state: "unchecked",
                message: String::new(),
            },
            true,
        ),
    };
    let effective = kind.unwrap_or(HostKind::Github);
    Ok(ProjectHost {
        kind: effective,
        recognized: kind.is_some(),
        host,
        repository: repository
            .map(|repository| repository.path)
            .unwrap_or_default(),
        chosen,
        capabilities: capabilities(effective, issues),
        access,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    hosts: Vec<ConfiguredHost>,
    bitbucket: Option<bitbucket::ConnectionView>,
}

#[tauri::command]
pub async fn source_control_settings(
    state: State<'_, TaskRuntime>,
) -> Result<SettingsView, String> {
    let integration = state.integration_directory();
    Ok(SettingsView {
        hosts: settings(&integration)?.hosts,
        bitbucket: bitbucket::credentials(&integration)?.map(|credentials| credentials.view()),
    })
}

/// Adds or changes a self-managed GitLab or GitHub Enterprise host.
#[tauri::command]
pub fn source_control_host_save(
    host: String,
    kind: HostKind,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<ConfiguredHost>, String> {
    configurable(kind)?;
    let host =
        remote::configured_host(&host).ok_or("Enter the host name, such as gitlab.example.com.")?;
    if ["github.com", "gitlab.com", "bitbucket.org"].contains(&host.as_str()) {
        return Err(format!("{host} is recognized already."));
    }
    let integration = state.integration_directory();
    let _guard = SETTINGS_LOCK.lock().map_err(|error| error.to_string())?;
    let mut saved = settings(&integration)?;
    saved.hosts.retain(|item| item.host != host);
    saved.hosts.push(ConfiguredHost { host, kind });
    saved.hosts.sort_by(|a, b| a.host.cmp(&b.host));
    save_settings(&integration, &saved)?;
    Ok(saved.hosts)
}

#[tauri::command]
pub fn source_control_host_remove(
    host: String,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<ConfiguredHost>, String> {
    let integration = state.integration_directory();
    let _guard = SETTINGS_LOCK.lock().map_err(|error| error.to_string())?;
    let mut saved = settings(&integration)?;
    saved
        .hosts
        .retain(|item| !item.host.eq_ignore_ascii_case(host.trim()));
    save_settings(&integration, &saved)?;
    Ok(saved.hosts)
}

/// Sets which kind of host a project's remote is, or clears it to detect it again.
#[tauri::command]
pub fn source_control_project_host(
    project_path: String,
    kind: Option<HostKind>,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    if let Some(kind) = kind {
        configurable(kind)?;
    }
    let key = project_key(&project_path);
    if key.is_empty() {
        return Err("Choose a project.".into());
    }
    let integration = state.integration_directory();
    let _guard = SETTINGS_LOCK.lock().map_err(|error| error.to_string())?;
    let mut saved = settings(&integration)?;
    match kind {
        Some(kind) => saved.projects.insert(key, kind),
        None => saved.projects.remove(&key),
    };
    save_settings(&integration, &saved)
}

/// Whether the GitLab CLI is installed and signed in to `host`.
#[tauri::command]
pub async fn gitlab_cli_status(host: String) -> Result<Access, String> {
    let host = remote::configured_host(&host).unwrap_or_else(|| "gitlab.com".into());
    tauri::async_runtime::spawn_blocking(move || gitlab::access(&host))
        .await
        .map_err(|error| error.to_string())
}

/// Checks a Bitbucket API token with Bitbucket, then keeps it in protected storage.
#[tauri::command]
pub async fn bitbucket_connection_save(
    email: String,
    token: String,
    state: State<'_, TaskRuntime>,
) -> Result<bitbucket::ConnectionView, String> {
    let credentials = bitbucket::Credentials::new(&email, &token)?;
    let name = bitbucket::check(&credentials).await?;
    let integration = state.integration_directory();
    bitbucket::save(&integration, &credentials)?;
    Ok(bitbucket::ConnectionView {
        name: Some(name),
        ..credentials.view()
    })
}

#[tauri::command]
pub async fn bitbucket_connection_test(
    state: State<'_, TaskRuntime>,
) -> Result<bitbucket::ConnectionView, String> {
    let credentials = bitbucket::require(&state.integration_directory())?;
    let name = bitbucket::check(&credentials).await?;
    Ok(bitbucket::ConnectionView {
        name: Some(name),
        ..credentials.view()
    })
}

#[tauri::command]
pub fn bitbucket_connection_remove(state: State<'_, TaskRuntime>) -> Result<(), String> {
    bitbucket::remove(&state.integration_directory())
}

/// Keeps the first `bytes` of `text` on a character boundary; `true` when cut.
pub(crate) fn bounded(text: &str, bytes: usize) -> (String, bool) {
    let mut end = text.len().min(bytes);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].into(), end < text.len())
}

/// A log line without the `section_start:…`/`section_end:…` markers GitLab runners
/// print; `None` for a line that held only markers.
fn without_sections(line: &str) -> Option<String> {
    let mut line = line.to_string();
    let mut marked = false;
    while let Some(start) = ["section_start:", "section_end:"]
        .iter()
        .filter_map(|marker| line.find(marker))
        .min()
    {
        marked = true;
        let end = line[start..]
            .find("\u{1b}[0K")
            .map_or(line.len(), |at| start + at + 4);
        line.replace_range(start..end, "");
    }
    (!marked || !line.trim().is_empty()).then_some(line)
}

/// The last `chars` characters of a job log, without terminal colours or section markers.
pub(crate) fn log_tail(log: &str, chars: usize) -> String {
    let lines: Vec<String> = log
        .lines()
        .filter_map(without_sections)
        .map(|line| {
            let mut clean = String::with_capacity(line.len());
            let mut escape = false;
            for c in line.chars() {
                if escape {
                    escape = !c.is_ascii_alphabetic();
                } else if c == '\u{1b}' {
                    escape = true;
                } else if c != '\r' {
                    clean.push(c);
                }
            }
            clean
        })
        .collect();
    let joined = lines.join("\n");
    let count = joined.chars().count();
    if count <= chars {
        return joined;
    }
    let tail: String = joined.chars().skip(count - chars).collect();
    format!("…{tail}")
}

/// Percent-encodes a value for a URL query or path segment.
pub(crate) fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_hide_what_a_host_cannot_do() {
        let github = capabilities(HostKind::Github, false);
        assert_eq!(github.merge_methods, ["merge", "squash", "rebase"]);
        assert!(github.issues);
        let gitlab = capabilities(HostKind::Gitlab, false);
        assert_eq!(gitlab.merge_methods, ["merge", "squash"]);
        assert!(gitlab.issues && gitlab.review_threads && gitlab.ci_logs);
        assert!(!capabilities(HostKind::Bitbucket, false).issues);
        let bitbucket = capabilities(HostKind::Bitbucket, true);
        assert!(bitbucket.issues);
        assert_eq!(bitbucket.merge_methods, ["merge", "squash", "fastForward"]);
    }

    #[test]
    fn change_request_addresses_route_to_their_host() {
        assert_eq!(
            route_url("https://github.com/acme/shop/pull/12"),
            (Route::GitHub, 0)
        );
        assert!(matches!(
            route_url("https://gitlab.com/group/app/-/merge_requests/4"),
            (Route::GitLab(_), 4)
        ));
        assert!(matches!(
            route_url("https://bitbucket.org/acme/web/pull-requests/9"),
            (Route::Bitbucket(_), 9)
        ));
    }

    #[test]
    fn bitbucket_data_center_is_not_configurable() {
        assert!(configurable(HostKind::Bitbucket).is_err());
        assert!(configurable(HostKind::Gitlab).is_ok());
        assert!(configurable(HostKind::Github).is_ok());
    }

    #[test]
    fn log_tails_drop_colour_and_sections() {
        let log = "section_start:1700000000:step_script\u{1b}[0K\u{1b}[32;1mRunning\u{1b}[0;m\r\nok\nsection_end:1700000001:step_script\u{1b}[0K\nFAIL: thing";
        assert_eq!(log_tail(log, 1000), "Running\nok\nFAIL: thing");
        assert_eq!(log_tail("abcdef", 3), "…def");
    }

    #[test]
    fn values_are_percent_encoded() {
        assert_eq!(encode("group/sub app"), "group%2Fsub%20app");
        assert_eq!(encode("feat/ü"), "feat%2F%C3%BC");
    }

    #[test]
    fn checkouts_locate_their_publishing_remote_and_project_choice() {
        let temp = std::env::temp_dir().join(format!("jackalope-host-{}", uuid::Uuid::new_v4()));
        let checkout = temp.join("repo");
        let integration = temp.join("integrations");
        std::fs::create_dir_all(&checkout).unwrap();
        let run = |args: &[&str]| {
            let result = process_control::run(
                repo::command(&checkout, args, Policy::Isolated),
                Duration::from_secs(20),
            )
            .unwrap();
            assert!(result.success, "{args:?}: {}", result.stderr);
        };
        run(&["init", "-q", "-b", "main"]);
        let project = checkout.to_string_lossy().to_string();
        assert_eq!(route(&integration, &checkout, &project), Route::GitHub);
        run(&["remote", "add", "upstream", "git@github.com:acme/app.git"]);
        run(&["remote", "add", "origin", "git@gitlab.com:team/sub/app.git"]);
        assert_eq!(
            route(&integration, &checkout, &project),
            Route::GitLab(Repository {
                host: "gitlab.com".into(),
                path: "team/sub/app".into()
            })
        );
        run(&["config", "branch.main.remote", "upstream"]);
        assert_eq!(route(&integration, &checkout, &project), Route::GitHub);
        run(&[
            "remote",
            "set-url",
            "upstream",
            "https://git.corp.example/team/app.git",
        ]);
        assert_eq!(route(&integration, &checkout, &project), Route::GitHub);
        save_settings(
            &integration,
            &Settings {
                hosts: vec![ConfiguredHost {
                    host: "git.corp.example".into(),
                    kind: HostKind::Gitlab,
                }],
                projects: BTreeMap::new(),
            },
        )
        .unwrap();
        assert!(matches!(
            route(&integration, &checkout, &project),
            Route::GitLab(_)
        ));
        let mut chosen = settings(&integration).unwrap();
        chosen
            .projects
            .insert(format!("{project}/"), HostKind::Github);
        chosen.projects = chosen
            .projects
            .into_iter()
            .map(|(key, kind)| (project_key(&key), kind))
            .collect();
        save_settings(&integration, &chosen).unwrap();
        assert_eq!(route(&integration, &checkout, &project), Route::GitHub);
        run(&[
            "remote",
            "set-url",
            "upstream",
            "https://ana@bitbucket.org/acme/web.git",
        ]);
        save_settings(&integration, &Settings::default()).unwrap();
        assert!(matches!(
            route(&integration, &checkout, &project),
            Route::Bitbucket(_)
        ));
        let _ = std::fs::remove_dir_all(temp);
    }
}
