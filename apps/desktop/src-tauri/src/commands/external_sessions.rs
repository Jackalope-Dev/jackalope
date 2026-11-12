//! Conversations people had with Claude Code and Codex outside Jackalope, in a terminal
//! or another app, read from those CLIs' own session stores on this device and listed
//! under the project they worked in. Reading is local and read-only; nothing is copied
//! off the device. A person can turn it off in Settings, which also deletes the index.
//!
//! The stores are those of the accounts Jackalope uses for each CLI (the CLI's own
//! sign-in and any added accounts). A session belongs to a project when it ran in the
//! project folder or in a worktree of the same repository. Jackalope's own attempts
//! write to the same stores; they are left out by the session IDs attempts recorded,
//! by Jackalope's data folder and by the `.worktrees/<name>` folders on
//! `jackalope/<name>` branches that Jackalope creates.
//!
//! Continuing one starts a conversation whose first attempt resumes the CLI's session
//! in the folder it ran in, under the account directory it was saved in.

mod claude;
pub(in crate::commands) mod codex;
mod index;
mod read;
#[cfg(test)]
mod tests;

use super::{
    agent_policy::AgentPolicy,
    agent_profiles::AccountBinding,
    live_sessions::{FirstMessage, LiveSessions},
    tasks::{ContinuedSession, RunRequest, TaskRuntime},
};
use index::{Index, Source};
use notify_debouncer_mini::{new_debouncer_opt, notify::RecursiveMode, DebounceEventResult};
use read::TranscriptEntry;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

type Watcher = notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;

/// A listing older than this is refreshed when the app asks for it.
const STALE: Duration = Duration::from_secs(30);
const MIN_INTERVAL: Duration = Duration::from_secs(3);

fn valid_session(id: &str) -> bool {
    (8..=128).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

/// Whether two paths name the same folder, through links when both exist.
pub(in crate::commands) fn same_directory(left: &Path, right: &Path) -> bool {
    left == right
        || matches!(
            (dunce::canonicalize(left), dunce::canonicalize(right)),
            (Ok(left), Ok(right)) if left == right
        )
}

/// What a session file says about itself.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    pub session_id: String,
    pub cwd: String,
    #[serde(default)]
    pub branch: Option<String>,
    /// The first prompt, trimmed; None until the person has typed one.
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
}

/// A session from outside Jackalope, as the work list shows it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSession {
    /// `<agent>:<session id>`.
    pub key: String,
    pub agent: String,
    pub agent_name: String,
    pub session_id: String,
    pub project_id: String,
    pub title: String,
    pub cwd: String,
    pub branch: Option<String>,
    pub started_at: Option<String>,
    pub updated_at: String,
    /// Why it cannot be continued in Jackalope, when it cannot.
    pub unavailable: Option<String>,
    #[serde(skip)]
    source: Source,
    #[serde(skip)]
    path: PathBuf,
    #[serde(skip)]
    home: PathBuf,
}

/// A project folder and the repository it belongs to.
struct ProjectFolder {
    pub id: String,
    pub path: PathBuf,
    pub location: Location,
}

impl ProjectFolder {
    pub fn new(id: &str, path: &str) -> Self {
        let path = PathBuf::from(path);
        Self {
            id: id.to_string(),
            location: Location::of(&path),
            path,
        }
    }

    fn root(&self) -> &Path {
        self.location.canonical.as_deref().unwrap_or(&self.path)
    }
}

/// Where a folder is: its resolved path, the checkout or worktree it is in and that
/// repository's shared Git directory. Found by reading `.git` entries, without Git.
#[derive(Debug, Default, PartialEq)]
struct Location {
    pub canonical: Option<PathBuf>,
    pub top: Option<PathBuf>,
    pub common: Option<PathBuf>,
}

impl Location {
    pub fn of(path: &Path) -> Self {
        let Ok(canonical) = dunce::canonicalize(path) else {
            return Self::default();
        };
        for folder in canonical.ancestors() {
            let git = folder.join(".git");
            let common = if git.is_dir() {
                dunce::canonicalize(&git).ok()
            } else if git.is_file() {
                linked_common_dir(&git)
            } else {
                continue;
            };
            return Self {
                top: Some(folder.to_path_buf()),
                common,
                canonical: Some(canonical.clone()),
            };
        }
        Self {
            canonical: Some(canonical),
            ..Self::default()
        }
    }
}

/// A worktree's `.git` file names its administrative folder, whose `commondir` names
/// the shared Git directory; a submodule's has no `commondir` and is its own.
fn linked_common_dir(file: &Path) -> Option<PathBuf> {
    let text = super::history::read_bounded(file, 4096).ok()?;
    let text = String::from_utf8(text).ok()?;
    let admin = text
        .lines()
        .find_map(|line| line.strip_prefix("gitdir:"))?
        .trim();
    let admin = file.parent()?.join(admin);
    let common = match super::history::read_bounded(&admin.join("commondir"), 4096) {
        Ok(bytes) => admin.join(String::from_utf8(bytes).ok()?.trim()),
        Err(_) => admin,
    };
    dunce::canonicalize(common).ok()
}

/// The project a session that ran in `cwd` belongs to: the deepest project folder it is
/// inside, in the same repository, or else a project whose repository it is a worktree of.
fn project_for<'a>(
    projects: &'a [ProjectFolder],
    cwd: &Path,
    location: &Location,
) -> Option<&'a ProjectFolder> {
    let path = location.canonical.as_deref().unwrap_or(cwd);
    let same_repository = |project: &ProjectFolder| {
        location.common.is_none()
            || project.location.common.is_none()
            || location.common == project.location.common
    };
    projects
        .iter()
        .filter(|project| path.starts_with(project.root()) || cwd.starts_with(&project.path))
        .filter(|project| same_repository(project))
        .max_by_key(|project| project.root().components().count())
        .or_else(|| {
            let common = location.common.as_ref()?;
            projects
                .iter()
                .find(|project| project.location.common.as_ref() == Some(common))
        })
}

/// A worktree Jackalope made for an attempt: `.worktrees/<name>` on `jackalope/<name>`.
fn jackalope_worktree(cwd: &Path, branch: Option<&str>) -> bool {
    let (Some(name), Some(parent)) = (cwd.file_name(), cwd.parent().and_then(Path::file_name))
    else {
        return false;
    };
    parent == ".worktrees" && branch == Some(&format!("jackalope/{}", name.to_string_lossy()))
}

/// What decides which indexed sessions are listed and where.
struct Scope<'a> {
    pub projects: &'a [ProjectFolder],
    /// Session IDs Jackalope's own attempts and conversations ran or continued.
    pub recorded: &'a HashSet<String>,
    /// Jackalope's data folder, where its helpers and checks run agents.
    pub data_directory: &'a Path,
}

/// The listed sessions, newest first. `account` says why a session cannot continue
/// under the account directory it was saved in, when it cannot.
fn list(
    index: &Index,
    scope: &Scope,
    account: &dyn Fn(&ExternalSession) -> Option<String>,
) -> Vec<ExternalSession> {
    let data_directory =
        dunce::canonicalize(scope.data_directory).unwrap_or_else(|_| scope.data_directory.into());
    let mut locations: HashMap<&str, Location> = HashMap::new();
    let mut newest: HashMap<(Source, &str), (u64, ExternalSession)> = HashMap::new();
    for (path, entry) in &index.files {
        let Some(summary) = &entry.summary else {
            continue;
        };
        let Some(title) = &summary.title else {
            continue;
        };
        if scope.recorded.contains(&summary.session_id) {
            continue;
        }
        let cwd = Path::new(&summary.cwd);
        if jackalope_worktree(cwd, summary.branch.as_deref()) {
            continue;
        }
        let location = locations
            .entry(summary.cwd.as_str())
            .or_insert_with(|| Location::of(cwd));
        let resolved = location.canonical.as_deref().unwrap_or(cwd);
        if resolved.starts_with(&data_directory) || cwd.starts_with(scope.data_directory) {
            continue;
        }
        let Some(project) = project_for(scope.projects, cwd, location) else {
            continue;
        };
        let unavailable = match (&location.canonical, &location.top) {
            (None, _) => Some(format!("{} no longer exists.", summary.cwd)),
            (Some(folder), Some(top)) if folder != top => Some(SUBFOLDER.into()),
            (Some(folder), None) if folder != project.root() => Some(SUBFOLDER.into()),
            _ => None,
        };
        let updated_at = chrono::DateTime::<chrono::Utc>::from(
            UNIX_EPOCH + Duration::from_millis(entry.modified_ms),
        )
        .to_rfc3339();
        let mut session = ExternalSession {
            key: format!("{}:{}", entry.source.adapter(), summary.session_id),
            agent: entry.source.adapter().into(),
            agent_name: super::agents::name(entry.source.adapter()).into(),
            session_id: summary.session_id.clone(),
            project_id: project.id.clone(),
            title: title.clone(),
            cwd: summary.cwd.clone(),
            branch: summary.branch.clone(),
            started_at: summary.started_at.clone(),
            updated_at,
            unavailable,
            source: entry.source,
            path: path.clone(),
            home: entry.home.clone(),
        };
        if session.unavailable.is_none() {
            session.unavailable = account(&session);
        }
        let key = (entry.source, summary.session_id.as_str());
        if newest
            .get(&key)
            .is_none_or(|(modified, _)| *modified < entry.modified_ms)
        {
            newest.insert(key, (entry.modified_ms, session));
        }
    }
    let mut sessions: Vec<_> = newest.into_values().collect();
    sessions.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.key.cmp(&right.1.key)));
    sessions.into_iter().map(|(_, session)| session).collect()
}

const SUBFOLDER: &str = "This conversation started in a subfolder of its checkout, and its CLI resumes a conversation only from the folder it started in. Continue it in a terminal.";

/// The accounts Jackalope uses for each CLI, whose stores are read, and the agent
/// settings that decide whether a session can continue under one of them.
struct Accounts {
    bindings: HashMap<Source, Result<Vec<AccountBinding>, String>>,
    policy: Result<AgentPolicy, String>,
    executables: HashMap<Source, Result<(), String>>,
}

impl Accounts {
    fn load(runtime: &TaskRuntime) -> Self {
        let root = runtime.profiles_root();
        let policy = runtime.policy();
        let mut bindings = HashMap::new();
        let mut executables = HashMap::new();
        for source in Source::ALL {
            bindings.insert(
                source,
                super::agent_profiles::routing_accounts(&root, source.adapter(), None),
            );
            executables.insert(
                source,
                policy
                    .as_ref()
                    .map_err(Clone::clone)
                    .and_then(|policy| policy.resolve(source.adapter()).map(|_| ())),
            );
        }
        Self {
            bindings,
            policy,
            executables,
        }
    }

    /// Each store to read once, even when two accounts share a directory.
    fn homes(&self) -> Vec<(Source, PathBuf)> {
        let mut homes: Vec<(Source, PathBuf)> = Vec::new();
        for source in Source::ALL {
            for binding in self.bindings[&source].iter().flatten() {
                if !homes
                    .iter()
                    .any(|(seen, home)| *seen == source && same_directory(home, &binding.directory))
                {
                    homes.push((source, binding.directory.clone()));
                }
            }
        }
        homes
    }

    fn binding(&self, source: Source, home: &Path) -> Result<&AccountBinding, String> {
        let name = super::agents::name(source.adapter());
        self.bindings[&source]
            .as_ref()
            .map_err(Clone::clone)?
            .iter()
            .find(|binding| same_directory(&binding.directory, home))
            .ok_or_else(|| format!("{name} saved this conversation in {}, which is not one of your {name} accounts in Jackalope. Add that folder as an account in Agents to continue it here.", home.display()))
    }

    fn unavailable(&self, session: &ExternalSession) -> Option<String> {
        let name = super::agents::name(&session.agent);
        let binding = match self.binding(session.source, &session.home) {
            Ok(binding) => binding,
            Err(error) => return Some(error),
        };
        let policy = match &self.policy {
            Ok(policy) => policy,
            Err(error) => return Some(error.clone()),
        };
        if let Err(error) = &self.executables[&session.source] {
            return Some(error.clone());
        }
        if !policy.agent_allowed(&session.project_id, &session.agent) {
            return Some(format!(
                "{name} is turned off for this project in Settings."
            ));
        }
        if !policy.account_allowed(&session.project_id, &session.agent, binding) {
            return Some(format!(
                "The {name} account this conversation used ({}) is turned off in Settings.",
                binding.label
            ));
        }
        let account = binding.profile_id.as_deref().unwrap_or("__default");
        if policy
            .projects
            .get(&session.project_id)
            .and_then(|project| project.agent_accounts.get(&session.agent))
            .is_some_and(|assigned| assigned != account)
        {
            return Some(format!("This project uses another {name} account in Settings, so Jackalope cannot continue this conversation under the one it used."));
        }
        None
    }
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Default)]
struct Listing {
    enabled: bool,
    index: Option<Index>,
    sessions: Vec<ExternalSession>,
    refreshed: Option<Instant>,
    error: Option<String>,
    watched: Vec<PathBuf>,
    watcher: Option<Watcher>,
}

struct Shared {
    runtime: TaskRuntime,
    conversations: LiveSessions,
    settings_path: PathBuf,
    index_path: PathBuf,
    state: Mutex<Listing>,
    refreshing: AtomicBool,
    again: AtomicBool,
    alive: AtomicBool,
    app: OnceLock<AppHandle>,
}

/// The listing of sessions from outside Jackalope, refreshed in the background when the
/// app asks for a stale one and when a watched store changes.
#[derive(Clone)]
pub struct ExternalSessions(Arc<Shared>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSessionsView {
    pub enabled: bool,
    pub sessions: Vec<ExternalSession>,
    pub refreshing: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTranscript {
    pub session: ExternalSession,
    pub entries: Vec<TranscriptEntry>,
    /// Entries before the first one shown, left out because the transcript is long.
    pub earlier: usize,
    /// Subagent lines, which are not shown.
    pub subagent_lines: usize,
}

impl crate::services::Service for ExternalSessions {
    fn shutdown(&self) {
        self.0.alive.store(false, Ordering::SeqCst);
        if let Ok(mut state) = self.0.state.lock() {
            state.watcher = None;
        }
    }
}

impl ExternalSessions {
    pub fn new(runtime: TaskRuntime, conversations: LiveSessions) -> Self {
        let settings_path = runtime
            .preferences_directory()
            .join("external-sessions.json");
        let settings: Settings = std::fs::read(&settings_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self(Arc::new(Shared {
            index_path: runtime
                .data_directory()
                .join("external-sessions")
                .join("index.json"),
            runtime,
            conversations,
            settings_path,
            state: Mutex::new(Listing {
                enabled: settings.enabled,
                ..Listing::default()
            }),
            refreshing: AtomicBool::new(false),
            again: AtomicBool::new(false),
            alive: AtomicBool::new(true),
            app: OnceLock::new(),
        }))
    }

    pub fn launch(&self, app: AppHandle) {
        let _ = self.0.app.set(app);
        self.refresh();
    }

    fn enabled(&self) -> bool {
        self.0.state.lock().is_ok_and(|state| state.enabled)
    }

    pub fn view(&self) -> ExternalSessionsView {
        let (view, stale) = {
            let state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
            let stale = state.enabled
                && state
                    .refreshed
                    .is_none_or(|refreshed| refreshed.elapsed() > STALE);
            (
                ExternalSessionsView {
                    enabled: state.enabled,
                    sessions: state.sessions.clone(),
                    refreshing: self.0.refreshing.load(Ordering::SeqCst),
                    error: state.error.clone(),
                },
                stale,
            )
        };
        if stale {
            self.refresh();
        }
        view
    }

    fn find(&self, key: &str) -> Option<ExternalSession> {
        let state = self.0.state.lock().ok()?;
        state
            .sessions
            .iter()
            .find(|session| session.key == key)
            .cloned()
    }

    /// Starts a background refresh, or asks the running one to go again.
    pub fn refresh(&self) {
        if !self.enabled() || !self.0.alive.load(Ordering::SeqCst) {
            return;
        }
        if self.0.refreshing.swap(true, Ordering::SeqCst) {
            self.0.again.store(true, Ordering::SeqCst);
            return;
        }
        let service = self.clone();
        std::thread::spawn(move || loop {
            service.refresh_now();
            if service.0.again.swap(false, Ordering::SeqCst) {
                // Stores change with every message of a running session.
                std::thread::sleep(MIN_INTERVAL);
                continue;
            }
            service.0.refreshing.store(false, Ordering::SeqCst);
            // A request that arrived after the check above and before the flag cleared.
            if !service.0.again.swap(false, Ordering::SeqCst)
                || service.0.refreshing.swap(true, Ordering::SeqCst)
            {
                break;
            }
        });
    }

    fn refresh_now(&self) {
        let shared = &self.0;
        let index = {
            let mut state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
            if !state.enabled {
                return;
            }
            state.index.take()
        };
        let mut index = index.unwrap_or_else(|| Index::load(&shared.index_path));
        let accounts = Accounts::load(&shared.runtime);
        let homes = accounts.homes();
        let changed = index.refresh(&homes);
        let projects: Vec<_> = super::project_registry::list(&shared.runtime)
            .iter()
            .map(|project| ProjectFolder::new(&project.id, &project.path))
            .collect();
        let mut recorded = shared.runtime.recorded_sessions();
        recorded.extend(shared.conversations.continued_sessions());
        let sessions = list(
            &index,
            &Scope {
                projects: &projects,
                recorded: &recorded,
                data_directory: shared.runtime.data_directory(),
            },
            &|session| accounts.unavailable(session),
        );
        let roots: Vec<PathBuf> = homes
            .iter()
            .flat_map(|(source, home)| source.roots(home))
            .filter(|root| root.is_dir())
            .collect();
        let emit = {
            let mut state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
            if !state.enabled {
                return;
            }
            // Saved under the lock, so turning reading off cannot be followed by a save.
            let saved = if changed {
                index.save(&shared.index_path).err()
            } else {
                None
            };
            let error = accounts
                .bindings
                .values()
                .find_map(|bindings| bindings.as_ref().err().cloned())
                .or(saved.map(|error| format!("The list of conversations from outside Jackalope could not be saved: {error}")));
            state.index = Some(index);
            state.refreshed = Some(Instant::now());
            let emit = state.sessions != sessions || state.error != error;
            state.sessions = sessions;
            state.error = error;
            if state.watched != roots {
                state.watcher = None;
                state.watcher = self.watch(&roots);
                state.watched = roots;
            }
            emit
        };
        if emit {
            self.changed();
        }
    }

    fn changed(&self) {
        if let Some(app) = self.0.app.get() {
            let _ = app.emit("external-sessions-changed", ());
        }
    }

    /// Watches the stores so a conversation shows up while it is happening. The listing
    /// still refreshes when asked if the platform cannot watch them.
    fn watch(&self, roots: &[PathBuf]) -> Option<Watcher> {
        if roots.is_empty() {
            return None;
        }
        let service: Weak<Shared> = Arc::downgrade(&self.0);
        let config = notify_debouncer_mini::Config::default()
            .with_timeout(Duration::from_secs(2))
            .with_notify_config(
                notify_debouncer_mini::notify::Config::default().with_follow_symlinks(false),
            );
        let mut watcher: Watcher = new_debouncer_opt(config, move |result: DebounceEventResult| {
            if result.is_ok_and(|events| events.is_empty()) {
                return;
            }
            if let Some(shared) = service.upgrade() {
                ExternalSessions(shared).refresh();
            }
        })
        .ok()?;
        for root in roots {
            watcher
                .watcher()
                .watch(root, RecursiveMode::Recursive)
                .ok()?;
        }
        Some(watcher)
    }

    fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let bytes = serde_json::to_vec(&Settings { enabled }).map_err(|e| e.to_string())?;
        if let Some(parent) = self.0.settings_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        super::history::write_atomic(&self.0.settings_path, &bytes)?;
        {
            let mut state = self.0.state.lock().map_err(|e| e.to_string())?;
            state.enabled = enabled;
            if !enabled {
                *state = Listing::default();
            }
        }
        if enabled {
            self.refresh();
        } else {
            match std::fs::remove_file(&self.0.index_path) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(format!(
                        "Reading stopped, but the saved list could not be deleted: {error}"
                    ))
                }
                _ => {}
            }
        }
        self.changed();
        Ok(())
    }

    fn transcript(&self, key: &str) -> Result<ExternalTranscript, String> {
        let mut session = self.find(key).ok_or(GONE)?;
        if !session.path.is_file() {
            // Codex compresses or archives an idle rollout under another name.
            self.refresh_now();
            session = self.find(key).ok_or(GONE)?;
        }
        let transcript = session
            .source
            .transcript(&session.path)
            .ok_or_else(|| format!("{} could not be read.", session.path.display()))?;
        Ok(ExternalTranscript {
            session,
            entries: transcript.entries.into(),
            earlier: transcript.earlier,
            subagent_lines: transcript.subagent_lines,
        })
    }

    fn continue_session(
        &self,
        key: &str,
        conversation_id: String,
        message: FirstMessage,
    ) -> Result<String, String> {
        let session = self.find(key).ok_or(GONE)?;
        if let Some(reason) = &session.unavailable {
            return Err(reason.clone());
        }
        let runtime = &self.0.runtime;
        let project = super::project_registry::list(runtime)
            .into_iter()
            .find(|project| project.id == session.project_id)
            .ok_or(super::project_registry::NOT_REGISTERED)?;
        let accounts = Accounts::load(runtime);
        if let Some(reason) = accounts.unavailable(&session) {
            return Err(reason);
        }
        let binding = accounts.binding(session.source, &session.home)?;
        let workspace = Location::of(Path::new(&session.cwd))
            .canonical
            .ok_or_else(|| format!("{} no longer exists.", session.cwd))?;
        let request = RunRequest {
            agent_profile_id: Some(
                binding
                    .profile_id
                    .clone()
                    .unwrap_or_else(|| "__default".into()),
            ),
            ..RunRequest::new(
                &project.id,
                &project.name,
                &project.path,
                &session.agent,
                String::new(),
            )
        };
        let id = self.0.conversations.create_continuing(
            conversation_id,
            session.title.clone(),
            request,
            message,
            ContinuedSession {
                adapter: session.agent.clone(),
                session_id: session.session_id.clone(),
                workspace: workspace.to_string_lossy().into_owned(),
                home: binding.directory.clone(),
            },
        )?;
        if let Ok(mut state) = self.0.state.lock() {
            state.sessions.retain(|listed| listed.key != session.key);
        }
        self.changed();
        Ok(id)
    }
}

const GONE: &str =
    "This conversation is no longer listed. It may have been removed or continued already.";

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::external_sessions::external_sessions_list,
            commands::external_sessions::external_sessions_set_enabled,
            commands::external_sessions::external_session_transcript,
            commands::external_sessions::external_session_continue,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub async fn external_sessions_list(
    service: State<'_, ExternalSessions>,
) -> Result<ExternalSessionsView, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.view())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn external_sessions_set_enabled(
    service: State<'_, ExternalSessions>,
    enabled: bool,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.set_enabled(enabled))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn external_session_transcript(
    service: State<'_, ExternalSessions>,
    key: String,
) -> Result<ExternalTranscript, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.transcript(&key))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn external_session_continue(
    service: State<'_, ExternalSessions>,
    key: String,
    conversation_id: String,
    message_id: String,
    text: String,
) -> Result<String, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.continue_session(
            &key,
            conversation_id,
            FirstMessage {
                id: message_id,
                text,
                origin: None,
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}
