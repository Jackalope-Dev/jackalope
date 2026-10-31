//! Claude Code launch options, the warm stream-json process that keeps one Claude Code
//! session per live conversation, and the SDK hook callbacks Jackalope answers inside it.
//!
//! A warm process belongs to the attempt running its turn: it is registered in the
//! runtime's process table for that turn, so stopping the attempt kills it. Between turns it
//! is parked here, keyed by Claude's session ID and a fingerprint of its launch command,
//! and it is discarded after [`IDLE`], when the launch would differ, when its turn did not
//! finish cleanly, on app exit, or when the account changes. A follow-up that finds no
//! matching warm process resumes the session from disk with `--resume`, as before.

use super::*;
use crate::commands::process_control::ProcessTree;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::process::{Child, ChildStdin};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::time::Instant;

const IDLE: Duration = Duration::from_secs(600);
const MAX_WARM: usize = 4;
const STOP_ROUNDS: u32 = 3;
const EDIT_CHECK_LIMIT: Duration = Duration::from_secs(60);
const INITIALIZE_LIMIT: Duration = Duration::from_secs(30);
const STREAM_FLUSH: Duration = Duration::from_millis(150);
const FEEDBACK_CHARS: usize = 6000;
const STREAM_CHARS: usize = 120_000;
const TOOL_TIMINGS: usize = 40;

/// SDK hook callbacks registered when a session starts. They need the stream-json
/// control protocol, so they only apply to persistent sessions.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub(super) struct Hooks {
    pub edit_check: bool,
    pub stop_check: bool,
    pub context: bool,
    pub permission: bool,
    pub timing: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Settings {
    pub persistent: bool,
    pub isolated: bool,
    pub partials: bool,
    pub fallback: bool,
    pub shared_cache: bool,
    pub hooks: Hooks,
}

impl Settings {
    fn from_experiments(personal_setup: Option<bool>) -> Self {
        use crate::commands::experiments::is;
        let persistent = is("JACKALOPE_CLAUDE_SESSION", "persistent");
        let hook = |name: &str| persistent && is(name, "on");
        Self {
            persistent,
            isolated: personal_setup
                .map_or_else(|| is("JACKALOPE_CLAUDE_ISOLATION", "on"), |own| !own),
            partials: is("JACKALOPE_CLAUDE_PARTIALS", "on"),
            fallback: is("JACKALOPE_CLAUDE_FALLBACK", "auto"),
            shared_cache: is("JACKALOPE_CLAUDE_PROMPT_CACHE", "shared"),
            hooks: Hooks {
                edit_check: hook("JACKALOPE_CLAUDE_EDIT_CHECK"),
                stop_check: hook("JACKALOPE_CLAUDE_STOP_CHECK"),
                context: hook("JACKALOPE_CLAUDE_CONTEXT_HOOK"),
                permission: hook("JACKALOPE_CLAUDE_PERMISSION_HOOK"),
                timing: hook("JACKALOPE_CLAUDE_TOOL_TIMING"),
            },
        }
    }
}

#[cfg(test)]
fn overrides() -> &'static Mutex<HashMap<String, Settings>> {
    static OVERRIDES: std::sync::OnceLock<Mutex<HashMap<String, Settings>>> =
        std::sync::OnceLock::new();
    OVERRIDES.get_or_init(Default::default)
}

/// Pins a project's Claude settings in tests, which share one process environment.
#[cfg(test)]
pub(super) fn set_test_settings(project_id: &str, settings: Settings) {
    overrides()
        .lock()
        .unwrap()
        .insert(project_id.into(), settings);
}

pub(super) fn settings(runtime: &TaskRuntime, project_id: &str) -> Settings {
    #[cfg(test)]
    let overridden = overrides().lock().unwrap().get(project_id).copied();
    #[cfg(not(test))]
    let overridden = None;
    let mut settings = overridden.unwrap_or_else(|| {
        Settings::from_experiments(crate::commands::project_registry::personal_claude_setup(
            runtime, project_id,
        ))
    });
    // Hook callbacks need the control protocol of a persistent session.
    if !settings.persistent {
        settings.hooks = Hooks::default();
    }
    settings
}

/// Whether the context hook, rather than the first message, delivers this request's
/// selected context, so delivery is recorded when Claude actually receives it.
pub(super) fn context_by_hook(runtime: &TaskRuntime, request: &RunRequest) -> bool {
    runtime
        .policy()
        .ok()
        .and_then(|policy| policy.resolve(&request.agent).ok())
        .is_some_and(|(adapter, _)| adapter == "claude")
        && settings(runtime, &request.project_id).hooks.context
}

/// Launch flags shared by one-shot and persistent Claude Code runs.
pub(super) fn configure(cmd: &mut Command, settings: &Settings, model: Option<&str>) {
    if settings.partials {
        cmd.arg("--include-partial-messages");
    }
    if settings.fallback {
        if let Some(fallback) = fallback_model(model) {
            cmd.args(["--fallback-model", fallback]);
        }
    }
    if settings.isolated {
        cmd.args(["--strict-mcp-config", "--setting-sources", "project,local"]);
    }
    if settings.shared_cache {
        cmd.arg("--exclude-dynamic-system-prompt-sections");
    }
}

/// A different model family for overload fallback. Claude Code rejects a fallback equal to
/// the main model, and the CLI default is unknown here, so an unpinned model gets none.
pub(super) fn fallback_model(model: Option<&str>) -> Option<&'static str> {
    let model = model?.to_ascii_lowercase();
    if model.contains("opus") {
        Some("sonnet")
    } else if model.contains("sonnet") {
        Some("opus")
    } else if model.contains("haiku") {
        Some("sonnet")
    } else {
        None
    }
}

/// The hook registrations sent in the session's `initialize` control request.
pub(super) fn registrations(hooks: &Hooks) -> Value {
    let mut events = serde_json::Map::new();
    if hooks.permission {
        events.insert(
            "PreToolUse".into(),
            json!([{"matcher":"Bash|PowerShell|WebFetch|WebSearch","hookCallbackIds":["permission"],"timeout":30}]),
        );
    }
    let mut post = Vec::new();
    if hooks.edit_check {
        post.push(json!({"matcher":"Edit|Write|MultiEdit|NotebookEdit","hookCallbackIds":["edit_check"],"timeout":EDIT_CHECK_LIMIT.as_secs() + 30}));
    }
    if hooks.timing {
        post.push(json!({"hookCallbackIds":["timing"],"timeout":10}));
    }
    if !post.is_empty() {
        events.insert("PostToolUse".into(), Value::Array(post));
    }
    if hooks.stop_check {
        events.insert(
            "Stop".into(),
            json!([{"hookCallbackIds":["stop"],"timeout":crate::commands::verification::BRIDGE_TIMEOUT_SECS}]),
        );
    }
    if hooks.context {
        events.insert(
            "UserPromptSubmit".into(),
            json!([{"hookCallbackIds":["context"],"timeout":30}]),
        );
    }
    Value::Object(events)
}

fn initialize(hooks: &Hooks) -> Value {
    json!({"type":"control_request","request_id":"jackalope-initialize",
        "request":{"subtype":"initialize","hooks":registrations(hooks)}})
}

fn user_message(text: &str) -> Value {
    json!({"type":"user","message":{"role":"user","content":text},
        "parent_tool_use_id":null,"session_id":"default"})
}

fn control_success(request_id: &str, response: Value) -> Value {
    json!({"type":"control_response","response":{"subtype":"success","request_id":request_id,"response":response}})
}

fn control_error(request_id: &str, error: &str) -> Value {
    json!({"type":"control_response","response":{"subtype":"error","request_id":request_id,"error":error}})
}

fn write_line(stdin: &Mutex<ChildStdin>, value: &Value) -> std::io::Result<()> {
    let mut line = value.to_string();
    line.push('\n');
    let mut stdin = stdin.lock().unwrap();
    stdin.write_all(line.as_bytes())?;
    stdin.flush()
}

/// The launch identity a warm process must share with a follow-up: program, arguments,
/// explicit environment and working directory. The bridge token differs per attempt and is
/// aliased instead (see [`bridge_token`]).
fn identity(cmd: &Command, hooks: &Hooks) -> [u8; 32] {
    let mut hash = Sha256::new();
    let mut add = |value: &std::ffi::OsStr| {
        let bytes = value.as_encoded_bytes();
        hash.update(bytes.len().to_le_bytes());
        hash.update(bytes);
    };
    add(cmd.get_program());
    for arg in cmd.get_args() {
        add(arg);
    }
    if let Some(path) = cmd.get_current_dir() {
        add(path.as_os_str());
    }
    let mut envs: Vec<_> = cmd
        .get_envs()
        .filter(|(name, _)| *name != "JACKALOPE_BRIDGE_TOKEN")
        .collect();
    envs.sort();
    for (name, value) in envs {
        add(name);
        add(value.unwrap_or_default());
    }
    add(format!("{hooks:?}").as_ref());
    hash.finalize().into()
}

fn aliases() -> &'static Mutex<HashMap<String, String>> {
    static ALIASES: std::sync::OnceLock<Mutex<HashMap<String, String>>> =
        std::sync::OnceLock::new();
    ALIASES.get_or_init(Default::default)
}

/// The coordination grant a bridge bearer token currently stands for. A warm Claude process
/// keeps the token it was launched with; while a later attempt runs a turn in it, that token
/// acts as the later attempt's own token, and between turns it maps back to its finished
/// first attempt, which the bridge no longer authorizes.
pub(in crate::commands) fn bridge_token(token: &str) -> String {
    aliases()
        .lock()
        .unwrap()
        .get(token)
        .cloned()
        .unwrap_or_else(|| token.to_string())
}

enum Output {
    Line(String, bool),
    Closed,
}

pub(super) struct Session {
    child: Arc<Mutex<Child>>,
    tree: ProcessTree,
    stdin: Arc<Mutex<ChildStdin>>,
    output: mpsc::Receiver<Output>,
    diagnostics: mpsc::Receiver<String>,
    key: [u8; 32],
    workspace: String,
    session_id: Option<String>,
    bridge_token: Option<String>,
    account: Option<PathBuf>,
    /// The process-wide cost Claude last reported, so a later turn records only its share.
    cost: Option<f64>,
    _runner_lease: Option<crate::commands::managed_runtime::UseGuard>,
}

impl Session {
    fn alive(&self) -> bool {
        self.child
            .lock()
            .unwrap()
            .try_wait()
            .is_ok_and(|status| status.is_none())
    }

    fn release_alias(&self) {
        if let Some(token) = &self.bridge_token {
            aliases().lock().unwrap().remove(token);
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.release_alias();
        self.tree.terminate();
        let mut child = self.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
}

struct Parked {
    session: Session,
    since: Instant,
}

#[derive(Default)]
pub(super) struct Pool {
    entries: Arc<Mutex<Vec<Parked>>>,
    reaper: std::sync::OnceLock<()>,
    #[cfg(test)]
    idle: Mutex<Option<Duration>>,
}

impl Pool {
    fn idle(&self) -> Duration {
        #[cfg(test)]
        if let Some(idle) = *self.idle.lock().unwrap() {
            return idle;
        }
        IDLE
    }

    fn expired(entries: &mut Vec<Parked>, idle: Duration) -> Vec<Parked> {
        let (keep, gone) = std::mem::take(entries)
            .into_iter()
            .partition(|entry| entry.since.elapsed() < idle && entry.session.alive());
        *entries = keep;
        gone
    }

    fn take(&self, session_id: &str, key: &[u8; 32], workspace: &str) -> Option<Session> {
        let (found, gone) = {
            let mut entries = self.entries.lock().unwrap();
            let gone = Self::expired(&mut entries, self.idle());
            let found = entries
                .iter()
                .position(|entry| entry.session.session_id.as_deref() == Some(session_id))
                .map(|index| entries.remove(index).session);
            (found, gone)
        };
        drop(gone);
        // A mismatched process is dropped, which stops it; the caller resumes from disk.
        found.filter(|session| &session.key == key && session.workspace == workspace)
    }

    fn park(&self, session: Session) {
        let gone = {
            let mut entries = self.entries.lock().unwrap();
            let mut gone = Self::expired(&mut entries, self.idle());
            if let Some(index) = entries
                .iter()
                .position(|entry| entry.session.session_id == session.session_id)
            {
                gone.push(entries.remove(index));
            }
            entries.push(Parked {
                session,
                since: Instant::now(),
            });
            while entries.len() > MAX_WARM {
                gone.push(entries.remove(0));
            }
            gone
        };
        drop(gone);
        self.reaper.get_or_init(|| {
            let entries = Arc::downgrade(&self.entries);
            let idle = self.idle();
            std::thread::spawn(move || loop {
                std::thread::sleep(idle.min(Duration::from_secs(15)));
                let Some(entries) = entries.upgrade() else {
                    return;
                };
                let gone = Self::expired(&mut entries.lock().unwrap(), idle);
                drop(gone);
            });
        });
    }

    pub(super) fn clear(&self) {
        let gone = std::mem::take(&mut *self.entries.lock().unwrap());
        drop(gone);
    }

    pub(super) fn invalidate_account(&self, directory: &Path) {
        let gone: Vec<_> = {
            let mut entries = self.entries.lock().unwrap();
            let (keep, gone) = std::mem::take(&mut *entries)
                .into_iter()
                .partition(|entry| entry.session.account.as_deref() != Some(directory));
            *entries = keep;
            gone
        };
        drop(gone);
    }

    #[cfg(test)]
    pub(super) fn warm(&self) -> usize {
        self.entries.lock().unwrap().len()
    }

    #[cfg(test)]
    pub(super) fn set_idle(&self, idle: Duration) {
        *self.idle.lock().unwrap() = Some(idle);
    }
}

/// Accumulates streamed text from `--include-partial-messages` and publishes it to the
/// in-memory run at a bounded rate. Completed messages still arrive as ordinary events.
pub(super) struct Partials {
    text: String,
    published: Instant,
    pending: bool,
    started: Instant,
}

impl Partials {
    pub(super) fn new(started: Instant) -> Self {
        Self {
            text: String::new(),
            published: Instant::now(),
            pending: false,
            started,
        }
    }

    /// Handles a partial-message event and returns true; returns false for every other
    /// line, clearing streamed text once a completed message or result replaces it.
    pub(super) fn consume(&mut self, runtime: &TaskRuntime, id: &str, line: &str) -> bool {
        if !line.contains("\"stream_event\"") {
            if !self.text.is_empty()
                && (line.contains("\"assistant\"") || line.contains("\"result\""))
            {
                self.complete(runtime, id);
            }
            return false;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            return false;
        };
        if event["type"] != "stream_event" {
            return false;
        }
        if event["parent_tool_use_id"].is_string() {
            return true;
        }
        let inner = &event["event"];
        match inner["type"].as_str() {
            Some("message_start") if !self.text.is_empty() => {
                self.text.clear();
                self.pending = true;
            }
            Some("content_block_delta") if inner["delta"]["type"] == "text_delta" => {
                let delta = inner["delta"]["text"].as_str().unwrap_or_default();
                if delta.is_empty() {
                    return true;
                }
                if self.text.is_empty() {
                    let elapsed = self.started.elapsed();
                    runtime.update(id, |run| run.efficiency.first_token(elapsed));
                }
                let room = STREAM_CHARS.saturating_sub(self.text.chars().count());
                self.text.extend(delta.chars().take(room));
                self.pending = true;
            }
            _ => {}
        }
        if self.pending && self.published.elapsed() >= STREAM_FLUSH {
            self.publish(runtime, id);
        }
        true
    }

    pub(super) fn complete(&mut self, runtime: &TaskRuntime, id: &str) {
        self.text.clear();
        self.publish(runtime, id);
    }

    fn publish(&mut self, runtime: &TaskRuntime, id: &str) {
        self.pending = false;
        self.published = Instant::now();
        let mut inner = runtime.inner.lock().unwrap();
        if let Some(run) = inner.runs.get_mut(id) {
            if run.streaming != self.text {
                run.streaming.clone_from(&self.text);
                runtime.writer.changed(id);
            }
        }
    }
}

/// What one turn needs to answer hook callbacks. Hooks registered at launch stay
/// registered for the life of the process, so a turn answers `{}` for checks that do not
/// apply to it.
pub(super) struct Turn {
    runtime: TaskRuntime,
    id: String,
    project_id: String,
    workspace: String,
    hooks: Hooks,
    bridge: bool,
    final_check: bool,
    edit_check: Option<String>,
    context: Option<RunRequest>,
    delivered: AtomicBool,
    rounds: AtomicU32,
}

impl Turn {
    pub(super) fn answer(&self, callback: &str, input: &Value) -> Value {
        match callback {
            "permission" if self.hooks.permission => self.permission(input),
            "edit_check" if self.hooks.edit_check => self.edit_check(input),
            "timing" if self.hooks.timing => self.timing(input),
            "stop" if self.hooks.stop_check => self.stop(),
            "context" if self.hooks.context => self.context(),
            _ => json!({}),
        }
    }

    fn activity(&self, text: &str) {
        self.runtime.update(&self.id, |run| activity(run, text));
    }

    /// Routine requests are approved under the project's auto-approve setting, skipping the
    /// permission-prompt round trip. Risky ones fall through to that existing ask flow, or
    /// are denied with the reason when the task has no bridge to ask through.
    fn permission(&self, input: &Value) -> Value {
        let tool = input["tool_name"].as_str().unwrap_or_default();
        if tool.is_empty()
            || self.workspace.is_empty()
            || !crate::commands::project_registry::auto_approve(&self.runtime, &self.project_id)
        {
            return json!({});
        }
        let tool_input = &input["tool_input"];
        let label: String = crate::commands::permission_risk::label(tool, tool_input)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(160)
            .collect();
        match crate::commands::permission_risk::assess(tool, tool_input, Path::new(&self.workspace))
        {
            crate::commands::permission_risk::Verdict::Routine => {
                self.activity(&format!("Auto-approved {label}"));
                json!({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow",
                    "permissionDecisionReason":"Routine request approved by the project's auto-approve setting."}})
            }
            crate::commands::permission_risk::Verdict::Risky(_) if self.bridge => json!({}),
            crate::commands::permission_risk::Verdict::Risky(reason) => {
                self.activity(&format!("Denied: {reason} ({label})"));
                json!({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
                    "permissionDecisionReason":format!("Jackalope needs the person to approve this because {reason}, and this task has no way to ask. Continue without it or report what is blocked.")}})
            }
        }
    }

    fn edit_check(&self, input: &Value) -> Value {
        let Some(template) = &self.edit_check else {
            return json!({});
        };
        let path = ["file_path", "notebook_path"]
            .iter()
            .find_map(|key| input["tool_input"][*key].as_str())
            .and_then(|path| super::tool_activity::workspace_path(path, &self.workspace));
        let Some(command) = edit_check_command(template, path.as_deref()) else {
            return json!({});
        };
        let result = crate::commands::process_control::run_cancellable(
            edit_check_shell(&command, &self.workspace),
            EDIT_CHECK_LIMIT,
            || !self.runtime.is_running(&self.id),
        );
        let failed = matches!(&result, Ok(result) if !result.success && !result.timed_out);
        self.runtime.update(&self.id, |run| {
            run.efficiency.edit_checks += 1;
            run.efficiency.edit_check_failures += u64::from(failed);
        });
        let Some(result) = result.ok().filter(|_| failed) else {
            return json!({});
        };
        let target = path
            .map(|path| format!(" after editing {path}"))
            .unwrap_or_default();
        self.activity(&format!("Edit check failed{target}: {command}"));
        json!({"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":format!(
            "Jackalope's edit check `{command}` failed{target} (exit {}). Fix the problems this change caused before continuing:\n{}",
            result.exit_code.map_or("unknown".into(), |code| code.to_string()),
            tail(&format!("{}\n{}", result.stdout, result.stderr))
        )}})
    }

    fn timing(&self, input: &Value) -> Value {
        if let (Some(name), Some(ms)) = (input["tool_name"].as_str(), input["duration_ms"].as_u64())
        {
            self.runtime.update(&self.id, |run| {
                let key = format!("tool:{}", name.chars().take(80).collect::<String>());
                let known = run.efficiency.timings.contains_key(&key)
                    || run
                        .efficiency
                        .timings
                        .keys()
                        .filter(|phase| phase.starts_with("tool:"))
                        .count()
                        < TOOL_TIMINGS;
                let key = if known { key } else { "tool:other".into() };
                run.efficiency.timing(&key, Duration::from_millis(ms));
            });
        }
        json!({})
    }

    /// Runs the saved check when Claude tries to finish, and keeps the session working on a
    /// failure for up to [`STOP_ROUNDS`] checks. After that the attempt finishes normally and
    /// the usual final check reports the outcome; a passing check here is reused by it.
    fn stop(&self) -> Value {
        if !self.final_check || self.rounds.load(Ordering::SeqCst) >= STOP_ROUNDS {
            return json!({});
        }
        let Some(run) = self.runtime.run_snapshot(&self.id) else {
            return json!({});
        };
        if !super::runtime::attempt_changed(&run) {
            return json!({});
        }
        let round = self.rounds.fetch_add(1, Ordering::SeqCst) + 1;
        self.activity(&format!(
            "Running the saved check before finishing (round {round} of {STOP_ROUNDS})."
        ));
        let check = crate::commands::verification::saved_check(&self.runtime, &self.id);
        self.runtime
            .update(&self.id, |run| run.efficiency.stop_check_rounds += 1);
        match check {
            Ok(check) if check.result.success => {
                self.activity("The saved check passed.");
                json!({})
            }
            Ok(check) => {
                self.activity("The saved check failed; Claude Code keeps working on it.");
                let last = if round == STOP_ROUNDS {
                    " This is the last automatic round: if it cannot be fixed, finish and explain what still fails."
                } else {
                    ""
                };
                json!({"decision":"block","reason":format!(
                    "Jackalope ran the saved check {} before finishing and it failed (round {round} of {STOP_ROUNDS}). Fix the failures, then finish.{last}\n{}",
                    serde_json::to_string(&check.command).unwrap_or_default(),
                    tail(&format!("{}\n{}", check.result.stdout, check.result.stderr))
                )})
            }
            Err(error) => {
                self.activity(&format!(
                    "The saved check could not run before finishing: {error}"
                ));
                json!({})
            }
        }
    }

    fn context(&self) -> Value {
        let Some(request) = &self.context else {
            return json!({});
        };
        let text = request.context_receipt.text();
        if text.trim().is_empty() || self.delivered.swap(true, Ordering::SeqCst) {
            return json!({});
        }
        crate::commands::knowledge::learning::observe_delivery(&self.runtime, request);
        json!({"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":text.trim()}})
    }
}

/// The edit check for one edited file. `{file}` becomes the double-quoted workspace path;
/// a path that would need further shell escaping skips the check rather than risk it.
fn edit_check_command(template: &str, path: Option<&str>) -> Option<String> {
    if !template.contains("{file}") {
        return Some(template.to_string());
    }
    let path = path?;
    if path.is_empty()
        || path
            .chars()
            .any(|c| c.is_control() || "\"%$`!^&|<>;".contains(c))
    {
        return None;
    }
    Some(template.replace("{file}", &format!("\"{path}\"")))
}

/// The shell for an edit check. On Windows the command line reaches `cmd.exe` verbatim, so
/// the double quotes around `{file}` are cmd's own rather than escaped program arguments.
fn edit_check_shell(command: &str, workspace: &str) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut cmd = super::command("cmd.exe");
        cmd.args(["/D", "/S", "/C"])
            .raw_arg(format!("\"{command}\""));
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = super::command("/bin/sh");
        cmd.args(["-c", command]);
        cmd
    };
    cmd.current_dir(workspace)
        .env_remove("JACKALOPE_BRIDGE_TOKEN")
        .env_remove("JACKALOPE_BRIDGE_URL");
    cmd
}

fn tail(text: &str) -> String {
    let text = text.trim();
    let count = text.chars().count();
    if count <= FEEDBACK_CHARS {
        return text.to_string();
    }
    let kept: String = text.chars().skip(count - FEEDBACK_CHARS).collect();
    format!("[earlier output omitted]\n{kept}")
}

pub(super) struct Launch<'a> {
    pub id: &'a str,
    pub request: &'a RunRequest,
    pub cmd: Command,
    pub input: String,
    pub workspace: String,
    pub previous_session: Option<String>,
    pub settings: Settings,
    pub final_check: bool,
    pub context_by_hook: bool,
    pub runner_lease: Option<crate::commands::managed_runtime::UseGuard>,
}

pub(super) struct Outcome {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub quota_stopped: bool,
}

impl TaskRuntime {
    /// Runs one turn in a warm or newly started Claude Code session. `None` means the
    /// attempt was stopped before launch and has already been marked stopped.
    pub(super) fn run_claude_session(&self, launch: Launch) -> Result<Option<Outcome>, String> {
        let Launch {
            id,
            request,
            mut cmd,
            input,
            workspace,
            previous_session,
            settings,
            final_check,
            context_by_hook,
            runner_lease,
        } = launch;
        cmd.current_dir(&workspace);
        let key = identity(&cmd, &settings.hooks);
        let warm = previous_session
            .as_deref()
            .and_then(|session| self.claude_sessions.take(session, &key, &workspace));
        let bridge_token = request
            .coordination
            .as_ref()
            .map(|context| context.token.clone());
        let started = Instant::now();
        let mut inner = self.inner.lock().unwrap();
        if inner.canceled.contains(id) {
            drop(inner);
            self.update(id, |run| {
                run.status = "stopped".into();
                run.ended_at = Some(Utc::now().to_rfc3339());
            });
            return Ok(None);
        }
        if inner.runs.values().any(|run| {
            run.id != id
                && run.workspace == workspace
                && ["starting", "running", "stopping"].contains(&run.status.as_str())
        }) {
            return Err(
                "Another attempt is using this workspace. Stop it or wait before continuing."
                    .into(),
            );
        }
        let (mut session, transport, spawn_attempts) = match warm {
            Some(session) => {
                inner.processes.insert(id.into(), session.child.clone());
                drop(inner);
                (session, "reused", 1)
            }
            None => {
                if let Some(previous) = &previous_session {
                    cmd.args(["--resume", previous]);
                }
                cmd.stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                let (mut child, attempts) = super::runtime::spawn_agent(&mut cmd, &request.agent)?;
                let tree = match ProcessTree::attach(&child) {
                    Ok(tree) => tree,
                    Err(error) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(error);
                    }
                };
                let (Some(stdin), Some(stdout), Some(stderr)) =
                    (child.stdin.take(), child.stdout.take(), child.stderr.take())
                else {
                    tree.terminate();
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Claude Code did not expose its session streams.".into());
                };
                let child = Arc::new(Mutex::new(child));
                inner.processes.insert(id.into(), child.clone());
                drop(inner);
                let (lines, output) = mpsc::channel();
                std::thread::spawn(move || {
                    let _ = crate::commands::process_control::bounded_lines(
                        BufReader::new(stdout),
                        1_000_000,
                        |line, truncated| {
                            let _ = lines.send(Output::Line(line, truncated));
                        },
                    );
                    let _ = lines.send(Output::Closed);
                });
                let (errors, diagnostics) = mpsc::channel();
                std::thread::spawn(move || {
                    let _ = crate::commands::process_control::bounded_lines(
                        BufReader::new(stderr),
                        6000,
                        |mut line, truncated| {
                            if truncated {
                                line.push_str(" [truncated]");
                            }
                            let _ = errors.send(line);
                        },
                    );
                });
                let session = Session {
                    child,
                    tree,
                    stdin: Arc::new(Mutex::new(stdin)),
                    output,
                    diagnostics,
                    key,
                    workspace: workspace.clone(),
                    session_id: None,
                    bridge_token: bridge_token.clone(),
                    account: request
                        .account_binding
                        .as_ref()
                        .map(|binding| binding.directory.clone()),
                    cost: None,
                    _runner_lease: runner_lease,
                };
                let transport = if previous_session.is_some() {
                    "resumed"
                } else {
                    "started"
                };
                (session, transport, attempts)
            }
        };
        self.update_checked(id, |run| {
            run.efficiency.claude_transport = Some(transport.into());
            run.efficiency.timing("processSpawn", started.elapsed());
            run.process_contained = cfg!(windows);
            if run.status == "starting" {
                run.status = "running".into();
            }
            run.progress = None;
            if spawn_attempts > 1 {
                activity(
                    run,
                    &format!("The agent process started after {spawn_attempts} attempts."),
                );
            }
        })?;
        if let (Some(own), Some(current)) = (&session.bridge_token, &bridge_token) {
            if own != current {
                aliases()
                    .lock()
                    .unwrap()
                    .insert(own.clone(), current.clone());
            }
        }
        let turn = Arc::new(Turn {
            runtime: self.clone(),
            id: id.into(),
            project_id: request.project_id.clone(),
            workspace: workspace.clone(),
            hooks: settings.hooks,
            bridge: request.coordination.is_some(),
            final_check,
            edit_check: crate::commands::project_registry::edit_check(self, &request.project_id),
            context: context_by_hook.then(|| request.clone()),
            delivered: AtomicBool::new(false),
            rounds: AtomicU32::new(0),
        });
        let mut state = TurnState {
            partials: Partials::new(started),
            finished: None,
            closed: false,
        };
        let delivered = if transport == "reused" {
            Ok(())
        } else {
            self.initialize(&session, &turn, &mut state)
        }
        .and_then(|()| {
            write_line(&session.stdin, &user_message(&input))
                .map_err(|error| format!("Could not deliver task: {error}"))
        });
        if let Err(error) = delivered {
            if !state.closed {
                self.update(id, |run| {
                    run.error.get_or_insert(error);
                });
            }
        } else {
            self.drive_turn(&session, &turn, &mut state);
        }
        state.partials.complete(self, id);
        session.release_alias();
        let quota_stopped = self.claude_quota_stopped(id);
        while let Ok(line) = session.diagnostics.recv_timeout(if state.closed {
            Duration::from_millis(200)
        } else {
            Duration::ZERO
        }) {
            let _ = self.update_output(id, |run| run.diagnostics.push(line));
        }
        self.inner.lock().unwrap().processes.remove(id);
        let exit_code = if state.closed || !session.alive() {
            session.tree.terminate();
            session
                .child
                .lock()
                .unwrap()
                .wait()
                .ok()
                .and_then(|status| status.code())
        } else {
            None
        };
        let success = state.finished == Some(true) && exit_code.is_none();
        let run = self.run_snapshot(id);
        if let Some(run) = &run {
            if let Some(total) = run.usage.estimated_cost_usd {
                let previous = session.cost.replace(total);
                if let Some(previous) = previous.filter(|previous| *previous <= total) {
                    self.update(id, |run| {
                        run.usage.estimated_cost_usd = Some(total - previous)
                    });
                }
            }
        }
        let canceled = self.inner.lock().unwrap().canceled.contains(id);
        if success && !canceled && !quota_stopped && session.alive() {
            if let Some(session_id) = run.and_then(|run| run.session_id) {
                session.session_id = Some(session_id);
                self.claude_sessions.park(session);
            }
        }
        Ok(Some(Outcome {
            success,
            exit_code,
            quota_stopped,
        }))
    }

    fn claude_quota_stopped(&self, id: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .runs
            .get(id)
            .is_some_and(|run| run.routing.is_some() && run.quota_failure.is_some())
    }

    fn initialize(
        &self,
        session: &Session,
        turn: &Arc<Turn>,
        state: &mut TurnState,
    ) -> Result<(), String> {
        write_line(&session.stdin, &initialize(&turn.hooks))
            .map_err(|error| format!("Could not start the Claude Code session: {error}"))?;
        let deadline = Instant::now() + INITIALIZE_LIMIT;
        let mut early = Vec::new();
        let result = loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match session
                .output
                .recv_timeout(left.min(Duration::from_millis(100)))
            {
                Ok(Output::Line(line, truncated)) => {
                    let response = (!truncated)
                        .then(|| serde_json::from_str::<Value>(&line).ok())
                        .flatten()
                        .filter(|event| {
                            event["type"] == "control_response"
                                && event["response"]["request_id"] == "jackalope-initialize"
                        });
                    match response {
                        Some(event) if event["response"]["subtype"] == "success" => break Ok(()),
                        Some(event) => {
                            break Err(format!(
                                "Claude Code rejected the session setup: {}",
                                event["response"]["error"]
                                    .as_str()
                                    .unwrap_or("unknown error")
                            ))
                        }
                        None => early.push((line, truncated)),
                    }
                }
                Ok(Output::Closed) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    state.closed = true;
                    break Err("Claude Code exited while starting its session.".into());
                }
                Err(mpsc::RecvTimeoutError::Timeout) if left.is_zero() => {
                    break Err("Claude Code did not start its session in time.".into());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        };
        for (line, truncated) in early {
            self.handle_line(session, turn, state, line, truncated);
        }
        result
    }

    fn drive_turn(&self, session: &Session, turn: &Arc<Turn>, state: &mut TurnState) {
        let mut quota_stopped = false;
        while state.finished.is_none() {
            while let Ok(line) = session.diagnostics.try_recv() {
                let _ = self.update_output(&turn.id, |run| run.diagnostics.push(line));
            }
            match session.output.recv_timeout(Duration::from_millis(100)) {
                Ok(Output::Line(line, truncated)) => {
                    self.handle_line(session, turn, state, line, truncated)
                }
                Ok(Output::Closed) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    state.closed = true;
                    return;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if !quota_stopped && self.claude_quota_stopped(&turn.id) {
                quota_stopped = true;
                session.tree.terminate();
                let _ = session.child.lock().unwrap().kill();
            }
        }
    }

    fn handle_line(
        &self,
        session: &Session,
        turn: &Arc<Turn>,
        state: &mut TurnState,
        line: String,
        truncated: bool,
    ) {
        let id = turn.id.as_str();
        if truncated {
            let _ = self.update_output(id, |run| {
                activity(
                    run,
                    "An oversized agent event was omitted. Inspect the agent session for full output.",
                )
            });
            return;
        }
        if state.partials.consume(self, id, &line) {
            return;
        }
        let event = serde_json::from_str::<Value>(&line).unwrap_or(Value::Null);
        match event["type"].as_str() {
            Some("control_request") => {
                let request_id = event["request_id"].as_str().unwrap_or_default().to_string();
                let request = event["request"].clone();
                let turn = turn.clone();
                let stdin = session.stdin.clone();
                std::thread::spawn(move || {
                    let reply = if request["subtype"] == "hook_callback" {
                        control_success(
                            &request_id,
                            turn.answer(
                                request["callback_id"].as_str().unwrap_or_default(),
                                &request["input"],
                            ),
                        )
                    } else {
                        control_error(&request_id, "Jackalope does not handle this request.")
                    };
                    let _ = write_line(&stdin, &reply);
                });
                return;
            }
            Some("control_response" | "control_cancel_request") => return,
            _ => {}
        }
        let started = state.partials.started;
        let _ = self.update_output(id, |run| {
            if super::efficiency::useful_event(&line, "claude") {
                run.efficiency.first_activity(started.elapsed());
            }
            consume_adapter_event(run, &line, "claude");
        });
        if event["type"] == "result" && event["parent_tool_use_id"].as_str().is_none() {
            state.finished = Some(event["is_error"] != true);
        }
    }
}

struct TurnState {
    partials: Partials,
    finished: Option<bool>,
    closed: bool,
}

#[cfg(test)]
#[path = "claude_session_tests.rs"]
mod tests;
