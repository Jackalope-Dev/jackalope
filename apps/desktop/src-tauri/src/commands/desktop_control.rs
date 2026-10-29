use super::{
    harness::PendingUserPrompt,
    tasks::{TaskRun, TaskRuntime},
};
use rmcp::schemars;
mod actions;
mod elements;
pub mod grant;
mod helper;
pub mod indicator;
pub mod platform;
use grant::{Choice, Grant, Scope};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DesktopRequest {
    #[schemars(
        description = "request_access (scope window, app or desktop), snapshot, screenshot, wait_for, focus, list_windows, switch_window, open_app, click, double_click, right_click, drag, type, set_value, press, scroll, invoke, select, clipboard_read, clipboard_write, or release. Ask for the narrowest scope that fits. Escape/Stop/release revokes access; physical input pauses control until the human clicks Resume."
    )]
    pub action: String,
    #[schemars(
        description = "request_access only: window (one window, default), app (every window of one app, e.g. the user's logged-in browser) or desktop (all apps and screens; asked every task, never remembered)."
    )]
    pub scope: Option<String>,
    #[schemars(
        description = "request_access: the app you need (e.g. chrome, firefox, excel), which lists it first and lets a remembered 'Always allow' answer without asking. open_app: program name to launch (desktop grants) or omit to open another window of the granted app."
    )]
    pub app: Option<String>,
    #[schemars(
        description = "request_access: one sentence the user sees explaining why access is needed."
    )]
    pub reason: Option<String>,
    #[schemars(
        description = "Snapshot ID from the latest snapshot, screenshot or wait_for. Required for input and consumed by each input call."
    )]
    pub snapshot_id: Option<String>,
    #[schemars(
        description = "Element ref from the latest snapshot, such as e12. Preferred over coordinates: click/invoke/select/set_value/scroll use accessibility actions that do not move the mouse or steal focus where the app supports them, and fall back to mouse input when needed. Also focus or type into an element."
    )]
    pub element: Option<String>,
    #[schemars(description = "drag: destination element ref.")]
    pub to_element: Option<String>,
    #[schemars(description = "switch_window: window ID from list_windows.")]
    pub window: Option<String>,
    #[schemars(
        description = "X coordinate in pixels relative to the captured window (or monitor for desktop screen captures), when no element ref fits."
    )]
    pub x: Option<i32>,
    pub y: Option<i32>,
    #[schemars(description = "drag: destination coordinates when no destination element fits.")]
    pub to_x: Option<i32>,
    pub to_y: Option<i32>,
    #[schemars(
        description = "type: literal text (≤1000 printable characters). set_value/clipboard_write: new text (≤10000, newlines allowed). select: option name. wait_for: text to wait for in an element name or value. Never supply secrets."
    )]
    pub text: Option<String>,
    #[schemars(
        description = "press: a key or chord such as Enter, Tab, Shift+Tab, ArrowDown, F5, Control+Shift+t or Primary+s (Command on macOS, Control elsewhere). Single characters need a modifier; use type for text. System-wide shortcuts and paste are blocked."
    )]
    pub key: Option<String>,
    #[schemars(description = "Scroll wheel notches, -10 to 10. Positive scrolls up.")]
    pub wheel: Option<i32>,
    #[schemars(
        description = "snapshot/screenshot with a desktop grant and no current window: monitor index from list_windows (default primary)."
    )]
    pub monitor: Option<u32>,
    #[schemars(
        description = "snapshot: true reads only the web page document of a browser window, deeper and with more elements."
    )]
    pub page: Option<bool>,
    #[schemars(
        description = "wait_for: maximum wait in milliseconds, up to 15000 (default 5000)."
    )]
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Window {
    handle: String,
    pid: u32,
    started: String,
    title: String,
    class: String,
    /// Stable app key: image name on Windows, bundle ID on macOS. Older helpers omit it.
    #[serde(default)]
    app: String,
    #[serde(default, rename = "appName")]
    app_name: String,
}

/// One desktop action shown in the Screen view. Input actions keep a small
/// capture of the window afterwards.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopActionRecord {
    pub at: String,
    pub action: String,
    pub summary: String,
    /// accessibility, pointer or keyboard for input actions.
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub focus_changed: bool,
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub capture: Option<super::harness::ScreenshotArtifact>,
}

const ACTION_LOG_LIMIT: usize = 200;

struct Snapshot {
    id: String,
    bounds: Value,
    surface: &'static str,
    window: Option<Window>,
    refs: elements::RefTable,
    site: Option<String>,
    taken: Instant,
    epoch: u64,
}

#[derive(Default)]
struct Access {
    prompt_id: String,
    scope: Option<Scope>,
    choices: Vec<(String, Choice)>,
    grant: Option<Grant>,
    target: Option<Window>,
    snapshot: Option<Snapshot>,
    indicator: Option<indicator::Indicator>,
    site_prompt: Option<(String, String)>,
    sites_allowed: HashSet<String>,
    sites_denied: HashSet<String>,
    site: Option<String>,
}

enum Backend {
    Resident(helper::Helper),
    Oneshot,
}

struct Session {
    canceled: AtomicBool,
    access: Mutex<Access>,
    helper: Mutex<Backend>,
    _lease: super::file_lock::FileLock,
}

impl Session {
    fn new(lease: super::file_lock::FileLock) -> Self {
        Self {
            canceled: AtomicBool::new(false),
            access: Mutex::new(Access::default()),
            helper: Mutex::new(match platform::launcher() {
                Some(launcher) => Backend::Resident(helper::Helper::new(launcher)),
                None => Backend::Oneshot,
            }),
            _lease: lease,
        }
    }

    /// Runs one helper request. Lock order: access (held by the caller), then helper.
    fn call(&self, payload: Value, timeout: Duration) -> Result<Value, String> {
        let mut backend = self.helper.lock().map_err(|e| e.to_string())?;
        if let Backend::Resident(helper) = &mut *backend {
            match helper.call(&payload, timeout, &self.canceled) {
                Ok(value) => return Ok(value),
                // A helper that never completed its handshake falls back to one
                // process per action instead of leaving the platform unusable.
                Err(error)
                    if !error.uncertain && helper.ready == 0 && cfg!(target_os = "macos") =>
                {
                    *backend = Backend::Oneshot;
                }
                Err(error) => return Err(error.message),
            }
        }
        drop(backend);
        native(payload, &self.canceled)
    }
}

static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, Arc<Session>>> {
    SESSIONS.get_or_init(Mutex::default)
}

/// Stops resident helpers nobody has used for a while; the next action restarts one.
fn start_janitor() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(5));
            let open: Vec<Arc<Session>> = match sessions().lock() {
                Ok(entries) => entries.values().cloned().collect(),
                Err(_) => continue,
            };
            for session in open {
                if let Ok(mut backend) = session.helper.try_lock() {
                    if let Backend::Resident(helper) = &mut *backend {
                        helper.shutdown_if_idle(helper::IDLE);
                    }
                }
            }
        });
    });
}

pub fn close(id: &str) {
    if let Some(session) = sessions().lock().unwrap().remove(id) {
        session.canceled.store(true, Ordering::SeqCst);
        if let Ok(mut backend) = session.helper.try_lock() {
            if let Backend::Resident(helper) = &mut *backend {
                helper.shutdown();
            }
        }
    }
}

/// Read-only grant state for the agent-screen panel.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopView {
    /// choosing, active, paused, canceled or busy (an operation holds the grant).
    pub status: String,
    pub reason: String,
    pub window: Option<String>,
    pub app: Option<String>,
    /// window, app or desktop once granted.
    pub scope: Option<String>,
    /// Whether this grant can be saved as "Always allow" for the project.
    pub rememberable: bool,
    pub remembered: bool,
    /// Host of the browser page last read, when known.
    pub site: Option<String>,
}

/// Never waits behind an in-flight desktop operation and never changes the grant.
pub fn view(id: &str) -> Option<DesktopView> {
    let session = sessions().lock().ok()?.get(id).cloned()?;
    if session.canceled.load(Ordering::SeqCst) {
        return None;
    }
    let busy = |status: &str| DesktopView {
        status: status.into(),
        reason: String::new(),
        window: None,
        app: None,
        scope: None,
        rememberable: false,
        remembered: false,
        site: None,
    };
    let Ok(mut access) = session.access.try_lock() else {
        return Some(busy("busy"));
    };
    let Some(grant) = access.grant.clone() else {
        return (!access.prompt_id.is_empty()).then(|| busy("choosing"));
    };
    let (status, reason) = match access.indicator.as_mut().map(|indicator| indicator.state()) {
        Some(Ok(state)) => (state.status, state.reason),
        Some(Err(error)) => ("canceled".into(), error),
        None => ("choosing".into(), String::new()),
    };
    Some(DesktopView {
        status,
        reason,
        window: access
            .target
            .as_ref()
            .map(|window| window.title.clone())
            .or_else(|| (grant.scope == Scope::Desktop).then(|| "Full desktop".into())),
        app: (!grant.label.is_empty()).then(|| grant.label.clone()),
        scope: Some(grant.scope.as_str().into()),
        rememberable: matches!(grant.scope, Scope::Window | Scope::App),
        remembered: grant.remembered.is_some(),
        site: access.site.clone(),
    })
}

fn current(runtime: &TaskRuntime, id: &str) -> Result<TaskRun, String> {
    runtime
        .integration_runs()?
        .into_iter()
        .find(|r| r.id == id && ["starting", "running"].contains(&r.status.as_str()))
        .ok_or_else(|| "This attempt has ended or is stopping. Desktop access is revoked.".into())
}

fn session(runtime: &TaskRuntime, id: &str, create: bool) -> Result<Arc<Session>, String> {
    current(runtime, id)?;
    let active: Vec<String> = runtime
        .integration_runs()?
        .into_iter()
        .filter(|r| ["starting", "running"].contains(&r.status.as_str()))
        .map(|r| r.id)
        .collect();
    let mut entries = sessions().lock().map_err(|e| e.to_string())?;
    entries.retain(|key, value| {
        if active.contains(key) {
            true
        } else {
            value.canceled.store(true, Ordering::SeqCst);
            false
        }
    });
    if let Some(session) = entries.get(id) {
        return Ok(session.clone());
    }
    if !create {
        return Err(
            "Request desktop access and wait for the user to choose a window first.".into(),
        );
    }
    if !entries.is_empty() {
        return Err(
            "Another task owns desktop control. Stop or release that task's desktop access first."
                .into(),
        );
    }
    let session = Arc::new(Session::new(platform::lease()?));
    entries.insert(id.into(), session.clone());
    start_janitor();
    Ok(session)
}

fn selected(
    run: &TaskRun,
    prompt_id: &str,
    choices: &[(String, Choice)],
) -> Result<Option<Choice>, String> {
    let prompt = run
        .prompts
        .iter()
        .find(|p| p.id == prompt_id && p.run_id == run.id)
        .ok_or("Desktop access question is unavailable. Release access and request it again.")?;
    selected_answer(&run.id, prompt, prompt_id, choices)
}

fn selected_answer<T: Clone>(
    run_id: &str,
    prompt: &PendingUserPrompt,
    prompt_id: &str,
    choices: &[(String, T)],
) -> Result<Option<T>, String> {
    if prompt.run_id != run_id || prompt.id != prompt_id {
        return Err("Desktop access question does not belong to this attempt.".into());
    }
    if prompt.status != "answered" {
        return Ok(None);
    }
    choices
        .iter()
        .find(|(label, _)| Some(label) == prompt.answer.as_ref())
        .map(|(_, choice)| Some(choice.clone()))
        .ok_or_else(|| "Desktop access was declined. Nothing was granted.".into())
}

fn take_snapshot(access: &mut Access, id: Option<&str>) -> Result<Snapshot, String> {
    let snapshot = access
        .snapshot
        .take()
        .ok_or("Take a fresh snapshot or screenshot before input.")?;
    if Some(snapshot.id.as_str()) != id || snapshot.taken.elapsed() > Duration::from_secs(60) {
        return Err("The desktop snapshot is stale. Take a new snapshot before input.".into());
    }
    Ok(snapshot)
}

#[cfg(windows)]
fn native_command(script: &str, payload: Option<Value>) -> Result<std::process::Command, String> {
    use std::os::windows::process::CommandExt;
    let windows =
        std::env::var_os("SystemRoot").ok_or("Windows system directory is unavailable.")?;
    let mut command = std::process::Command::new(
        std::path::PathBuf::from(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    );
    command
        .env_clear()
        .env("SystemRoot", &windows)
        .env("WINDIR", &windows)
        .env("TEMP", std::env::temp_dir())
        .env("TMP", std::env::temp_dir())
        .args(["-NoProfile", "-NonInteractive", "-Command", script]);
    if let Some(payload) = payload {
        command.env("JACKALOPE_DESKTOP_REQUEST", payload.to_string());
    }
    command.creation_flags(0x08000000);
    Ok(command)
}

/// One request through a short-lived helper, for readiness checks and platforms
/// without a resident helper.
#[cfg(windows)]
fn native(payload: Value, canceled: &AtomicBool) -> Result<Value, String> {
    let launcher = platform::launcher().ok_or("Desktop helper is unavailable.")?;
    helper::Helper::new(launcher)
        .call(&payload, Duration::from_secs(45), canceled)
        .map_err(String::from)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn native(payload: Value, canceled: &AtomicBool) -> Result<Value, String> {
    let command = platform::command(payload)?;
    if canceled.load(Ordering::SeqCst) {
        return Err("Desktop access was revoked.".into());
    }
    let output = super::process_control::run_cancellable(command, Duration::from_secs(20), || {
        canceled.load(Ordering::SeqCst)
    })?;
    if canceled.load(Ordering::SeqCst) {
        return Err(
            "Desktop access was revoked. An in-flight action may have occurred; do not replay it."
                .into(),
        );
    }
    if output.timed_out {
        return Err("The desktop operation timed out. Inspect the window before retrying; an action may have occurred.".into());
    }
    if !output.success || output.truncated {
        return Err(format!(
            "Desktop operation failed: {}",
            output.stderr.chars().take(1200).collect::<String>()
        ));
    }
    serde_json::from_str(output.stdout.trim_start_matches('\u{feff}').trim())
        .map_err(|_| "Desktop helper returned invalid output.".into())
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn native(_: Value, _: &AtomicBool) -> Result<Value, String> {
    Err("Guarded native desktop control is unavailable on this desktop. Task browser automation is available separately.".into())
}

const TIMEOUT: Duration = Duration::from_secs(20);

/// Everything one call needs; the access lock is held for the whole call.
struct Call<'a> {
    runtime: &'a TaskRuntime,
    run: &'a TaskRun,
    session: &'a Arc<Session>,
    access: &'a mut Access,
}

impl Call<'_> {
    fn denied(&self) -> Vec<u32> {
        let mut pids = vec![std::process::id()];
        if let Some(pid) = self.access.indicator.as_ref().and_then(|i| i.pid()) {
            pids.push(pid);
        }
        pids
    }

    fn store(&self) -> std::path::PathBuf {
        grant::store_path(&self.runtime.preferences_directory())
    }

    fn activity(&self, text: String) -> Result<(), String> {
        self.runtime
            .update_checked(&self.run.id, |r| r.activity.push(text.clone()))
    }

    fn windows(&self) -> Result<(Vec<Window>, Value), String> {
        let value = self
            .session
            .call(json!({"action":"list","deny":self.denied()}), TIMEOUT)?;
        let denied = self.denied();
        let windows: Vec<Window> = serde_json::from_value(value["windows"].clone())
            .map_err(|_| "Invalid window inventory.")?;
        Ok((
            windows
                .into_iter()
                .filter(|window| !denied.contains(&window.pid))
                .collect(),
            value["monitors"].clone(),
        ))
    }

    /// Asks for, or reads the answer to, the access question. Returns a
    /// response for the agent while no grant exists.
    fn acquire(
        &mut self,
        request: &DesktopRequest,
        fresh: &TaskRun,
    ) -> Result<Option<Value>, String> {
        if self.access.prompt_id.is_empty() {
            if fresh.prompts.len() >= 100 {
                return Err("This task has reached its question limit.".into());
            }
            let scope = Scope::parse(request.scope.as_deref())?;
            platform::capabilities().scope(scope)?;
            let (windows, _) = self.windows()?;
            if scope != Scope::Desktop && windows.is_empty() {
                return Err("No available desktop windows were found.".into());
            }
            let remembered = grant::remembered(&self.store(), &self.run.project_id);
            if let Some((saved, choice)) =
                grant::remembered_choice(&remembered, scope, request.app.as_deref(), &windows)
            {
                self.activate(choice, Some(saved))?;
                return Ok(None);
            }
            let choices = grant::options(
                scope,
                &windows,
                &self.run.project_name,
                request.app.as_deref(),
            );
            if choices.is_empty() {
                return Err("No matching desktop windows were found.".into());
            }
            let mut options = vec!["Do not allow".to_owned()];
            options.extend(choices.iter().map(|(label, _)| label.clone()));
            let prompt = PendingUserPrompt {
                id: uuid::Uuid::new_v4().to_string(),
                run_id: self.run.id.clone(),
                question: grant::question(scope, &self.run.project_name, request.reason.as_deref()),
                input_type: "choice".into(),
                options,
                default_value: None,
                status: "pending".into(),
                answer: None,
                created_at: chrono::Utc::now().to_rfc3339(),
                answered_at: None,
                presentation: super::harness::QuestionPresentation {
                    header: Some("Desktop control".into()),
                    allow_other: Some(false),
                    ..Default::default()
                },
            };
            self.push_prompt(&prompt)?;
            self.access.prompt_id = prompt.id;
            self.access.scope = Some(scope);
            self.access.choices = choices;
            return Ok(Some(
                json!({"status":"pending","questionId":self.access.prompt_id,"instruction":"Wait for the user to choose. Call desktop_control again after their answer; do not use another transport to bypass access."}),
            ));
        }
        let Some(choice) = selected(fresh, &self.access.prompt_id, &self.access.choices)? else {
            return Ok(Some(
                json!({"status":"pending","questionId":self.access.prompt_id}),
            ));
        };
        let mut saved = None;
        if let Choice::App {
            key,
            label,
            remember: true,
            ..
        } = &choice
        {
            saved = Some(grant::remember(
                &self.store(),
                &self.run.project_id,
                Scope::App,
                key,
                label,
            )?);
        }
        self.activate(choice, None)?;
        if let Some(saved) = saved {
            self.activity(format!(
                "You chose to always allow {} in this project. Remove it in project settings.",
                saved.label
            ))?;
        }
        Ok(None)
    }

    fn push_prompt(&self, prompt: &PendingUserPrompt) -> Result<(), String> {
        current(self.runtime, &self.run.id)?;
        self.runtime.update_checked(&self.run.id, |r| {
            if ["starting", "running"].contains(&r.status.as_str()) {
                r.prompts.push(prompt.clone());
            }
        })?;
        current(self.runtime, &self.run.id).map(|_| ())
    }

    fn activate(
        &mut self,
        choice: Choice,
        saved: Option<grant::RememberedGrant>,
    ) -> Result<(), String> {
        let mut grant = Grant::from_choice(choice);
        grant.remembered = saved.as_ref().map(|saved| saved.id.clone());
        let indicator = indicator::Indicator::start(&grant)?;
        indicator.watch(self.session, self.runtime.clone(), self.run.id.clone());
        self.access.indicator = Some(indicator);
        self.access.target = grant.window.clone();
        let how = match &saved {
            Some(saved) => format!(
                "Desktop control started from your remembered permission for {} in this project.",
                saved.label
            ),
            None => "You granted desktop control.".into(),
        };
        self.activity(format!(
            "{how} The agent may use {}. Escape, Stop or Revoke ends it; your input pauses it until Resume.",
            grant.describe()
        ))?;
        self.access.grant = Some(grant);
        Ok(())
    }

    fn browser(&self) -> bool {
        self.access
            .target
            .as_ref()
            .is_some_and(|window| grant::is_browser(&grant::app_key(window)))
    }

    /// Asks once per site for browser windows in window and app grants. Returns
    /// a pending response while the question is open.
    fn site_gate(&mut self, url: Option<&str>) -> Result<Option<Value>, String> {
        let grant = self.access.grant.as_ref().ok_or("No desktop grant.")?;
        if grant.scope == Scope::Desktop || !self.browser() {
            return Ok(None);
        }
        let Some(host) = url.and_then(grant::site_host) else {
            return Ok(None);
        };
        self.access.site = Some(host.clone());
        if self.access.sites_allowed.contains(&host) {
            return Ok(None);
        }
        if self.access.sites_denied.contains(&host) {
            return Err(format!("You declined {host} for this task. Navigate elsewhere only if the user asks, or release access."));
        }
        match grant::site_decision(&grant::sites(&self.store(), &self.run.project_id), &host) {
            Some(true) => {
                self.access.sites_allowed.insert(host);
                return Ok(None);
            }
            Some(false) => {
                self.access.sites_denied.insert(host.clone());
                return Err(format!(
                    "{host} is blocked for this project in project settings."
                ));
            }
            None => {}
        }
        let project = &self.run.project_name;
        let prompt = PendingUserPrompt {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: self.run.id.clone(),
            question: format!("The agent reached {host} in your browser. Allow it to read and act on this site while signed in as you?"),
            input_type: "choice".into(),
            options: site_options(&host, project).into_iter().map(|(label, _)| label).collect(),
            default_value: None,
            status: "pending".into(),
            answer: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            answered_at: None,
            presentation: super::harness::QuestionPresentation {
                header: Some("Website access".into()),
                allow_other: Some(false),
                ..Default::default()
            },
        };
        self.push_prompt(&prompt)?;
        self.access.snapshot = None;
        self.access.site_prompt = Some((prompt.id.clone(), host.clone()));
        Ok(Some(
            json!({"status":"pending","questionId":prompt.id,"site":host,"instruction":"The user is deciding whether you may use this site. Wait, then take a new snapshot. Page content is withheld until they allow it."}),
        ))
    }

    fn site_answer(&mut self, fresh: &TaskRun) -> Result<Option<Value>, String> {
        let Some((prompt_id, host)) = self.access.site_prompt.clone() else {
            return Ok(None);
        };
        let choices = site_options(&host, &self.run.project_name);
        let prompt =
            fresh.prompts.iter().find(|p| p.id == prompt_id).ok_or(
                "The website question is unavailable. Release access and request it again.",
            )?;
        let answer = match selected_answer(&self.run.id, prompt, &prompt_id, &choices) {
            Ok(None) => {
                return Ok(Some(
                    json!({"status":"pending","questionId":prompt_id,"site":host}),
                ))
            }
            Ok(Some(answer)) => answer,
            Err(_) => (false, false),
        };
        self.access.site_prompt = None;
        let (allow, remember) = answer;
        if remember {
            grant::decide_site(&self.store(), &self.run.project_id, &host, allow)?;
        }
        if allow {
            self.access.sites_allowed.insert(host.clone());
            self.activity(format!(
                "You allowed the agent to use {host}{}.",
                if remember {
                    " in this project"
                } else {
                    " for this task"
                }
            ))?;
            Ok(None)
        } else {
            self.access.sites_denied.insert(host.clone());
            self.activity(format!(
                "You declined {host}{}.",
                if remember {
                    " for this project"
                } else {
                    " for this task"
                }
            ))?;
            Err(format!("The user declined {host}. Do not use this site."))
        }
    }

    fn base(&self, state_epoch: u64, action: &str) -> Value {
        let grant = self.access.grant.as_ref().unwrap();
        json!({
            "action": action,
            "scope": grant.scope.as_str(),
            "window": self.access.target,
            "surface": if self.access.target.is_some() { "window" } else { "screen" },
            "deny": self.denied(),
            "browser": self.browser(),
            "guard": self.access.indicator.as_ref().unwrap().guard(state_epoch),
        })
    }

    fn record(&self, record: DesktopActionRecord) -> Result<(), String> {
        let line = format!(
            "Desktop {}{}",
            record.summary,
            record
                .method
                .as_deref()
                .map(|method| format!(
                    " ({method}{})",
                    if record.focus_changed {
                        ", focus changed"
                    } else {
                        ""
                    }
                ))
                .unwrap_or_default()
        );
        self.runtime.update_checked(&self.run.id, |r| {
            r.activity.push(line.clone());
            r.desktop_actions.push(record.clone());
            let excess = r.desktop_actions.len().saturating_sub(ACTION_LOG_LIMIT);
            r.desktop_actions.drain(..excess);
        })
    }

    fn capture_path(&self, id: &str) -> Result<std::path::PathBuf, String> {
        let directory =
            std::path::Path::new(&self.run.workspace).join(".jackalope/artifacts/screenshots");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        Ok(directory.join(format!("{id}.png")))
    }

    /// Captures a temporary PNG into the task's evidence folder.
    fn capture(
        &self,
        epoch: u64,
        thumb: Option<u32>,
        monitor: Option<u32>,
        name: &str,
    ) -> Result<(Value, super::harness::ScreenshotArtifact), String> {
        let id = uuid::Uuid::new_v4().to_string();
        let temporary = std::env::temp_dir().join(format!("jackalope-desktop-{id}.png"));
        let mut payload = self.base(epoch, "screenshot");
        payload["path"] = json!(temporary);
        payload["thumb"] = json!(thumb);
        payload["monitor"] = json!(monitor);
        let result = self.session.call(payload, TIMEOUT);
        let bytes = std::fs::read(&temporary);
        let _ = std::fs::remove_file(&temporary);
        let value = result?;
        current(self.runtime, &self.run.id)?;
        let bytes = bytes.map_err(|e| e.to_string())?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("The capture exceeds the 8 MiB preview limit.".into());
        }
        let (width, height) = super::harness::png_dimensions(&bytes)?;
        let file = self.capture_path(&id)?;
        std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
        let artifact = super::harness::ScreenshotArtifact {
            id,
            name: name.into(),
            url: "desktop://granted".into(),
            file_path: file.to_string_lossy().into_owned(),
            width,
            height,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        Ok((value, artifact))
    }

    fn observe(&mut self, request: &DesktopRequest, epoch: u64) -> Result<Value, String> {
        let grant_scope = self.access.grant.as_ref().unwrap().scope;
        if self.access.target.is_none() && grant_scope != Scope::Desktop {
            return Err("Switch to a window in the grant first.".into());
        }
        let surface = if self.access.target.is_some() {
            "window"
        } else {
            "screen"
        };
        let mut value = match request.action.as_str() {
            "screenshot" => {
                let (mut value, artifact) = self.capture(
                    epoch,
                    None,
                    request.monitor,
                    if surface == "window" {
                        "Desktop window capture"
                    } else {
                        "Desktop monitor capture"
                    },
                )?;
                self.runtime
                    .update_checked(&self.run.id, |r| r.screenshots.push(artifact.clone()))?;
                value["artifact"] = json!(artifact);
                value
            }
            "wait_for" => return self.wait_for(request, epoch),
            _ => {
                let mut payload = self.base(epoch, "snapshot");
                payload["page"] = json!(request.page.unwrap_or(false));
                payload["monitor"] = json!(request.monitor);
                self.session.call(payload, TIMEOUT)?
            }
        };
        self.finish_observation(&mut value, epoch, surface)?
            .map_or(Ok(value), Ok)
    }

    /// Gates the site, records the snapshot and adds its ID. Returns a
    /// replacement response when the site question is pending.
    fn finish_observation(
        &mut self,
        value: &mut Value,
        epoch: u64,
        surface: &'static str,
    ) -> Result<Option<Value>, String> {
        let url = value["site"]["url"].as_str().map(str::to_owned);
        if let Some(pending) = self.site_gate(url.as_deref())? {
            return Ok(Some(pending));
        }
        let refs = elements::normalize(value);
        if let Some(host) = url.as_deref().and_then(grant::site_host) {
            value["site"]["host"] = json!(host);
        }
        let state = self.access.indicator.as_mut().unwrap().state()?;
        if state.status != "active" || state.epoch != epoch {
            return Err("Desktop control paused or changed during capture. Wait for the user to resume and take a new snapshot.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.access.snapshot = Some(Snapshot {
            id: id.clone(),
            bounds: value["bounds"].clone(),
            surface,
            window: self.access.target.clone(),
            refs,
            site: url.as_deref().and_then(grant::site_host),
            taken: Instant::now(),
            epoch,
        });
        value["snapshotId"] = json!(id);
        value["untrustedContent"] = json!(true);
        Ok(None)
    }

    fn wait_for(&mut self, request: &DesktopRequest, epoch: u64) -> Result<Value, String> {
        let text = request.text.clone().unwrap_or_default();
        let deadline = Instant::now() + Duration::from_millis(request.timeout_ms.unwrap_or(5000));
        loop {
            let mut payload = self.base(epoch, "snapshot");
            payload["page"] = json!(request.page.unwrap_or(false));
            let mut value = self.session.call(payload, TIMEOUT)?;
            if let Some(pending) = self.finish_observation(&mut value, epoch, "window")? {
                return Ok(pending);
            }
            if let Some(found) = elements::RefTable::find_text(&value, &text) {
                value["found"] = found;
                return Ok(value);
            }
            self.access.snapshot = None;
            if Instant::now() >= deadline || self.session.canceled.load(Ordering::SeqCst) {
                return Err(format!("\u{201c}{text}\u{201d} did not appear before the timeout. Take a snapshot to inspect the window."));
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    fn input(&mut self, request: &DesktopRequest, epoch: u64) -> Result<Value, String> {
        let snapshot = take_snapshot(self.access, request.snapshot_id.as_deref())?;
        if snapshot.epoch != epoch {
            return Err("Desktop control changed since the snapshot. Take a fresh snapshot after the user resumes.".into());
        }
        if snapshot.window != self.access.target {
            return Err(
                "The current window changed since the snapshot. Take a new snapshot.".into(),
            );
        }
        let capabilities = platform::capabilities();
        let mut action = request.action.clone();
        let mut payload = self.base(epoch, &action);
        payload["bounds"] = snapshot.bounds.clone();
        payload["surface"] = json!(snapshot.surface);
        for (key, value) in [
            ("x", request.x),
            ("y", request.y),
            ("to_x", request.to_x),
            ("to_y", request.to_y),
            ("wheel", request.wheel),
        ] {
            payload[key] = json!(value);
        }
        payload["text"] = json!(request.text);
        let area = elements::area(&snapshot.bounds);
        let mut target_name = None;
        for (field, x, y) in [("element", "x", "y"), ("to_element", "to_x", "to_y")] {
            let reference = if field == "element" {
                &request.element
            } else {
                &request.to_element
            };
            let Some(reference) = reference else { continue };
            let element = snapshot.refs.resolve(reference)?;
            if field == "element" {
                target_name = Some(format!(
                    "{reference} \u{201c}{}\u{201d}",
                    element.name.chars().take(60).collect::<String>()
                ));
            }
            if capabilities.element_actions {
                payload[field] = json!(reference);
            } else {
                let (cx, cy) = snapshot.refs.center(reference, area)?;
                payload[x] = json!(cx);
                payload[y] = json!(cy);
            }
        }
        if !capabilities.element_actions && action == "invoke" {
            action = "click".into();
            payload["action"] = json!("click");
        }
        if let Some(key) = &request.key {
            let chord = actions::chord(key)?;
            if !capabilities.chords && !actions::LEGACY_KEYS.contains(&key.as_str()) {
                return Err(
                    "This desktop supports only navigation keys and Primary+a/s/z/y.".into(),
                );
            }
            payload["chord"] = chord.native();
            payload["key"] = json!(platform::key(key));
        }
        current(self.runtime, &self.run.id)?;
        let mut value = self.session.call(payload, TIMEOUT)?;
        let summary = summarize(request, target_name.as_deref());
        std::thread::sleep(Duration::from_millis(120));
        let after = self
            .capture(epoch, Some(480), None, &format!("After {summary}"))
            .ok();
        let site = after
            .as_ref()
            .and_then(|(result, _)| result["site"]["url"].as_str().and_then(grant::site_host))
            .or(snapshot.site.clone());
        if let Some(host) = &site {
            value["site"] = json!({"host": host});
            self.access.site = Some(host.clone());
        }
        self.record(DesktopActionRecord {
            at: chrono::Utc::now().to_rfc3339(),
            action,
            summary,
            method: value["method"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| Some("pointer or keyboard".into())),
            focus_changed: value["focusChanged"] == true,
            site,
            capture: after.map(|(_, artifact)| artifact),
        })?;
        Ok(value)
    }

    fn dispatch(&mut self, request: &DesktopRequest, epoch: u64) -> Result<Value, String> {
        let grant = self.access.grant.clone().unwrap();
        let action = request.action.as_str();
        if actions::is_input(request) {
            return self.input(request, epoch);
        }
        if actions::OBSERVE.contains(&action) {
            let value = self.observe(request, epoch)?;
            if value["status"] != "pending" {
                self.record(DesktopActionRecord {
                    at: chrono::Utc::now().to_rfc3339(),
                    action: action.into(),
                    summary: summarize(request, None),
                    site: self.access.site.clone(),
                    capture: serde_json::from_value(value["artifact"].clone()).ok(),
                    ..Default::default()
                })?;
            }
            return Ok(value);
        }
        self.access.snapshot = None;
        let denied = self.denied();
        let value = match action {
            "list_windows" => {
                let (windows, monitors) = self.windows()?;
                let listed: Vec<Value> = windows
                    .iter()
                    .filter(|window| grant.allows(window, &denied))
                    .map(|window| json!({"window": window.handle, "title": window.title, "app": grant::app_label(window), "current": self.access.target.as_ref().is_some_and(|t| t.handle == window.handle)}))
                    .collect();
                let mut value = json!({"windows": listed, "untrustedContent": true});
                if grant.scope == Scope::Desktop {
                    value["monitors"] = monitors;
                }
                value
            }
            "switch_window" => {
                if grant.scope == Scope::Window {
                    return Err("This grant covers one window. Release it and request an app or desktop grant to switch windows.".into());
                }
                let wanted = request.window.as_deref().unwrap_or_default();
                let (windows, _) = self.windows()?;
                let window = windows
                    .into_iter()
                    .find(|window| window.handle == wanted && grant.allows(window, &denied))
                    .ok_or(
                        "That window is closed or outside this grant. Call list_windows again.",
                    )?;
                let mut payload = self.base(epoch, "focus");
                payload["window"] = json!(window);
                payload["surface"] = json!("window");
                let value = self.session.call(payload, TIMEOUT)?;
                self.access.target = Some(window.clone());
                self.record(DesktopActionRecord {
                    at: chrono::Utc::now().to_rfc3339(),
                    action: action.into(),
                    summary: format!(
                        "switched to \u{201c}{}\u{201d}",
                        window.title.chars().take(80).collect::<String>()
                    ),
                    focus_changed: true,
                    ..Default::default()
                })?;
                value
            }
            "open_app" => {
                let name = match grant.scope {
                    Scope::Desktop => request.app.clone().ok_or("Name the app to open.")?,
                    Scope::App => {
                        if request.app.as_ref().is_some_and(|app| {
                            app.to_lowercase() != grant.app
                                && app.to_lowercase() != grant.label.to_lowercase()
                        }) {
                            return Err(
                                "An app grant can open only another window of the granted app."
                                    .into(),
                            );
                        }
                        grant.app.clone()
                    }
                    _ => {
                        return Err(
                            "A window grant cannot open apps. Ask for an app or desktop grant."
                                .into(),
                        )
                    }
                };
                platform::open_app(&name)?;
                self.record(DesktopActionRecord {
                    at: chrono::Utc::now().to_rfc3339(),
                    action: action.into(),
                    summary: format!("opened {name}"),
                    ..Default::default()
                })?;
                json!({"status":"opened","instruction":"Call list_windows, then switch_window to the new window before taking a snapshot."})
            }
            "clipboard_read" | "clipboard_write" => {
                let mut payload = self.base(epoch, action);
                payload["text"] = json!(request.text);
                let mut value = self.session.call(payload, TIMEOUT)?;
                let summary = if action == "clipboard_read" {
                    value["untrustedContent"] = json!(true);
                    format!(
                        "read the clipboard ({} characters)",
                        value["text"].as_str().map_or(0, |t| t.chars().count())
                    )
                } else {
                    format!(
                        "replaced the clipboard ({} characters)",
                        request.text.as_deref().map_or(0, |t| t.chars().count())
                    )
                };
                self.record(DesktopActionRecord {
                    at: chrono::Utc::now().to_rfc3339(),
                    action: action.into(),
                    summary,
                    ..Default::default()
                })?;
                value
            }
            "focus" => {
                let value = self.session.call(self.base(epoch, "focus"), TIMEOUT)?;
                self.record(DesktopActionRecord {
                    at: chrono::Utc::now().to_rfc3339(),
                    action: action.into(),
                    summary: "focused the window".into(),
                    focus_changed: true,
                    ..Default::default()
                })?;
                value
            }
            _ => return Err("Unsupported desktop action.".into()),
        };
        Ok(value)
    }
}

fn site_options(host: &str, project: &str) -> Vec<(String, (bool, bool))> {
    vec![
        (format!("Allow {host} for this task"), (true, false)),
        (format!("Always allow {host} in {project}"), (true, true)),
        (format!("Not {host}"), (false, false)),
        (format!("Never allow {host} in {project}"), (false, true)),
    ]
}

fn summarize(request: &DesktopRequest, target: Option<&str>) -> String {
    let at = || {
        target.map(str::to_owned).unwrap_or_else(|| {
            format!(
                "({}, {})",
                request.x.unwrap_or_default(),
                request.y.unwrap_or_default()
            )
        })
    };
    let quoted = |text: &Option<String>| {
        let text = text.as_deref().unwrap_or_default();
        let short: String = text.chars().take(40).collect();
        if short.len() < text.len() {
            format!("\u{201c}{short}\u{2026}\u{201d}")
        } else {
            format!("\u{201c}{short}\u{201d}")
        }
    };
    let verb = request.action.replace('_', " ");
    match request.action.as_str() {
        "type" => match target {
            Some(target) => format!("typed {} into {target}", quoted(&request.text)),
            None => format!("typed {}", quoted(&request.text)),
        },
        "set_value" => format!("set {} to {}", at(), quoted(&request.text)),
        "press" => format!("pressed {}", request.key.as_deref().unwrap_or_default()),
        "scroll" => format!("scrolled {} at {}", request.wheel.unwrap_or_default(), at()),
        "drag" => format!(
            "dragged {} to {}",
            at(),
            request.to_element.clone().unwrap_or_else(|| format!(
                "({}, {})",
                request.to_x.unwrap_or_default(),
                request.to_y.unwrap_or_default()
            ))
        ),
        "select" => format!("selected {} in {}", quoted(&request.text), at()),
        "wait_for" => format!("waited for {}", quoted(&request.text)),
        "snapshot" | "screenshot" => format!("took a {}", request.action),
        _ => format!("{verb} {}", at()),
    }
}

pub async fn execute(
    runtime: TaskRuntime,
    run: TaskRun,
    request: DesktopRequest,
) -> Result<Value, String> {
    actions::validate(&request)?;
    if request.action == "release" {
        close(&run.id);
        return Ok(json!({"status":"released"}));
    }
    if !platform::supported() {
        return Err("Guarded native desktop control is unavailable on this desktop. Task browser automation is available separately.".into());
    }
    platform::capabilities().action(&request.action)?;
    let owned = session(&runtime, &run.id, request.action == "request_access")?;
    let id = run.id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let mut access = owned
            .access
            .try_lock()
            .map_err(|_| "A desktop operation is already in progress. Wait for it to finish.")?;
        let fresh = current(&runtime, &run.id)?;
        let mut call = Call { runtime: &runtime, run: &run, session: &owned, access: &mut access };
        if call.access.grant.is_none() {
            if let Some(response) = call.acquire(&request, &fresh)? {
                return Ok(response);
            }
        }
        let grant = call.access.grant.clone().ok_or("No desktop grant.")?;
        let state = call.access.indicator.as_mut().ok_or("Desktop indicator is unavailable.")?.state()?;
        if state.status == "canceled" {
            return Err("Desktop control canceled by the user.".into());
        }
        if request.action == "request_access" {
            return Ok(json!({"status":state.status,"pauseReason":state.reason,"scope":grant.scope.as_str(),"granted":grant.describe(),"window":call.access.target,"instruction":"The indicator must be active. If paused, wait for the human to click Resume. Never resume or refocus through another tool. Take a snapshot next, then act on elements by ref. Escape or Stop cancels access."}));
        }
        if state.status != "active" {
            call.access.snapshot = None;
            return Err("Desktop control paused. Wait for the user to click Resume on the bar; then take a fresh snapshot. Do not reclaim focus or bypass the pause.".into());
        }
        if let Some(pending) = call.site_answer(&fresh)? {
            return Ok(pending);
        }
        let value = call.dispatch(&request, state.epoch)?;
        current(&runtime, &run.id)?;
        Ok(value)
    })
    .await
    .map_err(|e| e.to_string())?;
    if result.as_ref().err().is_some_and(|e| {
        e.contains("Desktop access was declined") || e.contains("Desktop control canceled")
    }) {
        close(&id);
    }
    result
}

/// Saves the attempt's current window or app grant as "Always allow" for its project.
#[tauri::command]
pub async fn desktop_control_remember(
    run_id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<grant::RememberedGrant, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let run = current(&runtime, &run_id)?;
        let session = sessions()
            .lock()
            .map_err(|e| e.to_string())?
            .get(&run_id)
            .cloned()
            .ok_or("This attempt has no desktop grant.")?;
        let grant = session
            .access
            .try_lock()
            .map_err(|_| "The agent is acting right now. Try again in a moment.")?
            .grant
            .clone()
            .ok_or("This attempt has no desktop grant yet.")?;
        let saved = grant::remember(
            &grant::store_path(&runtime.preferences_directory()),
            &run.project_id,
            grant.scope,
            &grant.app,
            &grant.label,
        )?;
        let _ = runtime.update_checked(&run_id, |r| {
            r.activity.push(format!(
                "You chose to always allow {} in this project.",
                saved.label
            ))
        });
        Ok(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPermissions {
    pub grants: Vec<grant::RememberedGrant>,
    pub sites: Vec<grant::SiteDecision>,
}

#[tauri::command]
pub fn desktop_control_permissions(
    project_id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> DesktopPermissions {
    let path = grant::store_path(&state.preferences_directory());
    DesktopPermissions {
        grants: grant::remembered(&path, &project_id),
        sites: grant::sites(&path, &project_id),
    }
}

#[tauri::command]
pub fn desktop_control_forget(
    project_id: String,
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<(), String> {
    grant::forget(
        &grant::store_path(&state.preferences_directory()),
        &project_id,
        &id,
    )
}

pub(super) async fn bridge(
    axum::extract::State(service): axum::extract::State<super::coordination::Coordinator>,
    headers: axum::http::HeaderMap,
    axum::Json(input): axum::Json<DesktopRequest>,
) -> Result<axum::Json<Value>, (axum::http::StatusCode, axum::Json<Value>)> {
    let run = service.authorized_run(&headers).map_err(|status| {
        (
            status,
            axum::Json(json!({"error":"Task authorization required"})),
        )
    })?;
    execute(service.runtime.clone(), run, input)
        .await
        .map(axum::Json)
        .map_err(|error| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(json!({"error":error})),
            )
        })
}

#[cfg(test)]
mod tests;
