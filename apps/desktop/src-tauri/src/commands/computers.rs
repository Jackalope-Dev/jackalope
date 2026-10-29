//! Bot computers: a persistent machine an agent controls instead of the
//! person's own desktop.
//!
//! A computer belongs to a bot (`owner_kind` `bot`) or, after the person
//! approves an agent's `computer_request`, to one task (`task`). Providers
//! implement [`Provider`]: `local-docker` runs a Linux sandbox from the image in
//! `resources/computer`, `remote-machine` reaches the same in-sandbox agent on a
//! machine the person runs, over HTTPS with a pairing secret, and
//! `jackalope-hosted` is reserved and unavailable. Every provider speaks the
//! desktop helper's JSON-lines protocol through a [`Transport`], so desktop
//! control, screenshots, input, accessibility snapshots, bounded commands and
//! browser URLs share one path.
//!
//! The index lives in `task-runs-v1/computers/computers.json`; per-computer and
//! per-machine secrets go through `account_storage` and never enter the index,
//! journals or the renderer except as a viewer URL fragment.

mod browser;
pub(crate) mod docker;
pub(crate) mod remote;
#[cfg(test)]
mod tests;

use super::{
    account_storage,
    harness::{PendingUserPrompt, QuestionPresentation},
    tasks::{TaskRun, TaskRuntime},
};
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc, Mutex, OnceLock},
    time::Duration,
};

pub(crate) const LOCAL_DOCKER: &str = "local-docker";
pub(crate) const REMOTE_MACHINE: &str = "remote-machine";
pub(crate) const HOSTED: &str = "jackalope-hosted";
/// Jackalope-hosted computers are planned; the provider exists so settings and
/// saved records have a stable name, but it refuses every operation.
const HOSTED_AVAILABLE: bool = false;
const BOT: &str = "bot";
const TASK: &str = "task";

static RESOURCES: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_directory(path: PathBuf) {
    let _ = RESOURCES.set(path);
}

/// The Docker build context bundled with the app.
pub(crate) fn image_directory() -> Result<PathBuf, String> {
    let relative = Path::new("resources/computer");
    if let Some(root) = RESOURCES.get() {
        let path = root.join(relative);
        if path.join("Dockerfile").is_file() {
            return Ok(path);
        }
    }
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    if cfg!(any(debug_assertions, test)) && path.join("Dockerfile").is_file() {
        return Ok(path);
    }
    Err("The bot computer image definition is missing. Reinstall Jackalope.".into())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSettings {
    #[serde(default = "default_cpus")]
    pub cpus: f32,
    #[serde(default = "default_memory")]
    pub memory_mb: u32,
    /// Outbound network access. Off removes the viewer and browser ports too.
    #[serde(default = "enabled")]
    pub network: bool,
    /// Host folder mounted read-only at /workspace/project, for task computers.
    #[serde(default)]
    pub project_mount: Option<String>,
}

fn default_cpus() -> f32 {
    2.0
}
fn default_memory() -> u32 {
    4096
}
fn enabled() -> bool {
    true
}

impl Default for ComputerSettings {
    fn default() -> Self {
        Self {
            cpus: default_cpus(),
            memory_mb: default_memory(),
            network: true,
            project_mount: None,
        }
    }
}

impl ComputerSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.5..=16.0).contains(&self.cpus) {
            return Err("Choose between 0.5 and 16 CPUs.".into());
        }
        if !(1024..=65536).contains(&self.memory_mb) {
            return Err("Choose between 1 GB and 64 GB of memory.".into());
        }
        if let Some(path) = &self.project_mount {
            let path = Path::new(path);
            if !path.is_absolute() || !path.is_dir() {
                return Err("The project folder to share must be an existing folder.".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Computer {
    pub id: String,
    pub name: String,
    /// `bot` or `task`.
    pub owner_kind: String,
    pub owner_id: String,
    /// `local-docker`, `remote-machine` or `jackalope-hosted`. Unknown values
    /// written by a newer app are kept and reported unavailable.
    pub provider: String,
    /// The paired remote machine, for `remote-machine`.
    #[serde(default)]
    pub machine_id: Option<String>,
    /// Key for saved website decisions: `bot:<id>` or a project ID.
    #[serde(default)]
    pub decisions: String,
    pub created_at: String,
    #[serde(default)]
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub settings: ComputerSettings,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    #[serde(default)]
    computers: Vec<Computer>,
}

fn index_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn read(root: &Path) -> Result<Index, String> {
    let path = root.join("computers.json");
    if !path.exists() {
        return Ok(Index::default());
    }
    let bytes = super::history::read_bounded(&path, 4_000_000)?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "Saved computers could not be read. The file was left unchanged.".into())
}

fn write(root: &Path, index: &Index) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(index).map_err(|e| e.to_string())?;
    super::history::write_atomic(&root.join("computers.json"), &bytes)
}

pub(crate) fn list(root: &Path) -> Result<Vec<Computer>, String> {
    let _guard = index_lock().lock().map_err(|e| e.to_string())?;
    Ok(read(root)?.computers)
}

pub(crate) fn find(root: &Path, kind: &str, owner: &str) -> Option<Computer> {
    list(root)
        .ok()?
        .into_iter()
        .find(|computer| computer.owner_kind == kind && computer.owner_id == owner)
}

fn get(root: &Path, id: &str) -> Result<Computer, String> {
    list(root)?
        .into_iter()
        .find(|computer| computer.id == id)
        .ok_or_else(|| "That computer no longer exists.".into())
}

/// Creates or updates the owner's computer record. Changing the provider of a
/// computer that already has a machine requires deleting it first.
pub(crate) fn configure(
    root: &Path,
    kind: &str,
    owner: &str,
    name: &str,
    provider: &str,
    machine_id: Option<String>,
    settings: ComputerSettings,
    decisions: &str,
) -> Result<Computer, String> {
    if ![BOT, TASK].contains(&kind) || owner.trim().is_empty() || owner.len() > 200 {
        return Err("Choose a bot or task computer.".into());
    }
    settings.validate()?;
    match provider {
        LOCAL_DOCKER => {}
        REMOTE_MACHINE => {
            let machine = machine_id.as_deref().ok_or("Choose a paired machine.")?;
            remote::machine(root, machine)?;
        }
        HOSTED => return Err(hosted_unavailable()),
        _ => return Err("Choose a local sandbox or a cloud machine.".into()),
    }
    let _guard = index_lock().lock().map_err(|e| e.to_string())?;
    let mut index = read(root)?;
    if let Some(machine) = machine_id.as_deref().filter(|_| provider == REMOTE_MACHINE) {
        if let Some(other) = index.computers.iter().find(|c| {
            c.machine_id.as_deref() == Some(machine)
                && !(c.owner_kind == kind && c.owner_id == owner)
        }) {
            return Err(format!(
                "That machine is already {}'s computer.",
                other.name
            ));
        }
    }
    let name: String = name.trim().chars().take(80).collect();
    let name = if name.is_empty() {
        "Computer".to_string()
    } else {
        name
    };
    if let Some(existing) = index
        .computers
        .iter_mut()
        .find(|c| c.owner_kind == kind && c.owner_id == owner)
    {
        if existing.provider != provider || existing.machine_id != machine_id {
            return Err("Delete this computer before choosing another kind of machine.".into());
        }
        existing.name = name;
        existing.settings = settings;
        let updated = existing.clone();
        write(root, &index)?;
        return Ok(updated);
    }
    let computer = Computer {
        id: uuid::Uuid::new_v4().simple().to_string(),
        name,
        owner_kind: kind.into(),
        owner_id: owner.into(),
        provider: provider.into(),
        machine_id: machine_id.filter(|_| provider == REMOTE_MACHINE),
        decisions: decisions.into(),
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used_at: None,
        settings,
    };
    index.computers.push(computer.clone());
    write(root, &index)?;
    Ok(computer)
}

fn touch(root: &Path, id: &str) {
    if let Ok(_guard) = index_lock().lock() {
        if let Ok(mut index) = read(root) {
            if let Some(computer) = index.computers.iter_mut().find(|c| c.id == id) {
                computer.last_used_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = write(root, &index);
            }
        }
    }
}

fn hosted_unavailable() -> String {
    "Jackalope-hosted computers are not available yet. Use a local sandbox or your own cloud machine."
        .into()
}

// ---- secrets ----

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComputerSecret {
    #[serde(default)]
    pub vnc_password: String,
}

fn secret_path(root: &Path, id: &str) -> PathBuf {
    root.join("secrets").join(format!("{id}.bin"))
}

/// The computer's viewer password, created on first use. VNC authentication
/// uses only eight characters; the viewer port is bound to loopback.
pub(crate) fn secret(root: &Path, id: &str) -> Result<ComputerSecret, String> {
    let path = secret_path(root, id);
    if let Some(bytes) = account_storage::read(&path)? {
        if let Ok(secret) = serde_json::from_slice::<ComputerSecret>(&bytes) {
            if !secret.vnc_password.is_empty() {
                return Ok(secret);
            }
        }
    }
    let secret = ComputerSecret {
        vnc_password: uuid::Uuid::new_v4().simple().to_string()[..8].to_string(),
    };
    std::fs::create_dir_all(root.join("secrets")).map_err(|e| e.to_string())?;
    account_storage::write(
        &path,
        &serde_json::to_vec(&secret).map_err(|e| e.to_string())?,
    )?;
    Ok(secret)
}

// ---- providers ----

/// What a provider reports about a computer's machine.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MachineState {
    Missing,
    Stopped,
    Running,
}

/// One JSON-lines conversation with a computer's in-sandbox agent.
pub(crate) trait Transport: Send {
    fn call(
        &mut self,
        payload: &Value,
        timeout: Duration,
        canceled: &AtomicBool,
    ) -> Result<Value, String>;
    fn shutdown(&mut self) {}
}

/// A place bot computers run. Lifecycle methods block and are bounded; actions
/// on a running computer go through [`Provider::transport`]. New providers
/// (a VM API such as Fly, Hetzner or AWS) implement this and register in
/// [`provider`].
pub(crate) trait Provider: Send + Sync {
    /// Whether the provider can be used on this device now, with a reason when not.
    fn available(&self, root: &Path, computer: &Computer) -> Result<(), String>;
    fn state(&self, root: &Path, computer: &Computer) -> Result<MachineState, String>;
    /// Creates the machine and its persistent home volume when missing, then starts it.
    fn start(
        &self,
        root: &Path,
        computer: &Computer,
        progress: &dyn Fn(&str),
    ) -> Result<(), String>;
    fn stop(&self, root: &Path, computer: &Computer) -> Result<(), String>;
    /// Removes the machine and everything it stored.
    fn delete(&self, root: &Path, computer: &Computer) -> Result<(), String>;
    fn transport(&self, root: &Path, computer: &Computer) -> Result<Box<dyn Transport>, String>;
    /// noVNC address for watching (`interactive` false) or taking over.
    fn viewer(
        &self,
        root: &Path,
        computer: &Computer,
        interactive: bool,
    ) -> Result<Option<String>, String>;
    /// Chromium DevTools endpoint reachable from this device, when the browser
    /// tools can drive the computer's browser directly.
    fn devtools(&self, root: &Path, computer: &Computer) -> Option<String>;
}

struct Hosted;

impl Provider for Hosted {
    fn available(&self, _: &Path, _: &Computer) -> Result<(), String> {
        if HOSTED_AVAILABLE {
            Ok(())
        } else {
            Err(hosted_unavailable())
        }
    }
    fn state(&self, _: &Path, _: &Computer) -> Result<MachineState, String> {
        Err(hosted_unavailable())
    }
    fn start(&self, _: &Path, _: &Computer, _: &dyn Fn(&str)) -> Result<(), String> {
        Err(hosted_unavailable())
    }
    fn stop(&self, _: &Path, _: &Computer) -> Result<(), String> {
        Err(hosted_unavailable())
    }
    fn delete(&self, _: &Path, _: &Computer) -> Result<(), String> {
        Ok(())
    }
    fn transport(&self, _: &Path, _: &Computer) -> Result<Box<dyn Transport>, String> {
        Err(hosted_unavailable())
    }
    fn viewer(&self, _: &Path, _: &Computer, _: bool) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn devtools(&self, _: &Path, _: &Computer) -> Option<String> {
        None
    }
}

pub(crate) fn provider(name: &str) -> Result<&'static dyn Provider, String> {
    static DOCKER: docker::LocalDocker = docker::LocalDocker;
    static REMOTE: remote::RemoteMachine = remote::RemoteMachine;
    static HOSTED_PROVIDER: Hosted = Hosted;
    match name {
        LOCAL_DOCKER => Ok(&DOCKER),
        REMOTE_MACHINE => Ok(&REMOTE),
        HOSTED => Ok(&HOSTED_PROVIDER),
        _ => Err("This computer was made by a newer Jackalope. Update to use it.".into()),
    }
}

// ---- lifecycle and connections ----

/// What a computer is doing right now, for computers starting or stopping in
/// the background. Errors stay until the next lifecycle action.
#[derive(Clone, Default)]
struct Activity {
    phase: Option<String>,
    error: Option<String>,
}

fn activity() -> &'static Mutex<HashMap<String, Activity>> {
    static ACTIVITY: OnceLock<Mutex<HashMap<String, Activity>>> = OnceLock::new();
    ACTIVITY.get_or_init(Default::default)
}

fn set_phase(id: &str, phase: Option<String>, error: Option<String>) {
    if let Ok(mut map) = activity().lock() {
        if phase.is_none() && error.is_none() {
            map.remove(id);
        } else {
            map.insert(id.into(), Activity { phase, error });
        }
    }
}

fn current_activity(id: &str) -> Activity {
    activity()
        .lock()
        .ok()
        .and_then(|map| map.get(id).cloned())
        .unwrap_or_default()
}

type Connection = Arc<Mutex<Box<dyn Transport>>>;

fn connections() -> &'static Mutex<HashMap<String, Connection>> {
    static CONNECTIONS: OnceLock<Mutex<HashMap<String, Connection>>> = OnceLock::new();
    CONNECTIONS.get_or_init(Default::default)
}

fn disconnect(id: &str) {
    let connection = connections().lock().ok().and_then(|mut map| map.remove(id));
    if let Some(connection) = connection {
        if let Ok(mut transport) = connection.try_lock() {
            transport.shutdown();
        }
    }
}

/// Starts a computer on a background thread. Returns at once; the status
/// reports the phase and any failure.
pub(crate) fn start_background(root: PathBuf, computer: Computer) -> Result<(), String> {
    let provider = provider(&computer.provider)?;
    provider.available(&root, &computer)?;
    {
        let mut map = activity().lock().map_err(|e| e.to_string())?;
        if map.get(&computer.id).is_some_and(|a| a.phase.is_some()) {
            return Ok(());
        }
        map.insert(
            computer.id.clone(),
            Activity {
                phase: Some("Starting".into()),
                error: None,
            },
        );
    }
    std::thread::spawn(move || {
        let id = computer.id.clone();
        let progress = |line: &str| {
            let line: String = line.trim().chars().take(160).collect();
            if !line.is_empty() {
                set_phase(&id, Some(line), None);
            }
        };
        match provider.start(&root, &computer, &progress) {
            Ok(()) => {
                touch(&root, &computer.id);
                set_phase(&computer.id, None, None);
            }
            Err(error) => set_phase(&computer.id, None, Some(error)),
        }
    });
    Ok(())
}

/// Runs one agent request on a running computer, reusing its connection.
pub(crate) fn call(
    root: &Path,
    computer: &Computer,
    payload: Value,
    timeout: Duration,
    canceled: &AtomicBool,
) -> Result<Value, String> {
    let connection = {
        let mut map = connections().lock().map_err(|e| e.to_string())?;
        match map.get(&computer.id) {
            Some(existing) => existing.clone(),
            None => {
                let transport = provider(&computer.provider)?.transport(root, computer)?;
                let connection: Connection = Arc::new(Mutex::new(transport));
                map.insert(computer.id.clone(), connection.clone());
                connection
            }
        }
    };
    let mut transport = connection.lock().map_err(|e| e.to_string())?;
    transport.call(&payload, timeout, canceled)
}

/// The computer ready for agent work. A stopped computer starts in the
/// background and the agent is told to retry.
pub(crate) fn ready(root: &Path, computer: &Computer) -> Result<(), String> {
    let busy = current_activity(&computer.id);
    if let Some(phase) = busy.phase {
        return Err(format!(
            "{} is starting ({phase}). Call again in about a minute.",
            computer.name
        ));
    }
    let provider = provider(&computer.provider)?;
    provider.available(root, computer)?;
    match provider.state(root, computer)? {
        MachineState::Running => Ok(()),
        _ => {
            if let Some(error) = busy.error {
                set_phase(&computer.id, None, None);
                return Err(format!("{} could not start: {error}", computer.name));
            }
            start_background(root.to_path_buf(), computer.clone())?;
            Err(format!(
                "{} was stopped and is starting now. Call again in about a minute.",
                computer.name
            ))
        }
    }
}

// ---- runs ----

/// A run's computer: its bot's, or the one the person approved for its task.
pub(crate) fn for_run(runtime: &TaskRuntime, run: &TaskRun) -> Option<Computer> {
    let root = runtime.computers_root();
    if let Some(hub) = super::bot_hub::installed() {
        if let Ok((bot, _)) = hub.caller(run) {
            return find(&root, BOT, &bot.id);
        }
    }
    find(&root, TASK, &run.task_id)
}

pub(crate) fn for_run_id(runtime: &TaskRuntime, run_id: &str) -> Option<Computer> {
    for_run(runtime, &runtime.run_snapshot(run_id)?)
}

/// Lets the browser tools drive the computer's own browser for runs that have one.
pub fn install_browser_routing(runtime: TaskRuntime) {
    super::browser::set_router(Box::new(move |run_id| browser::guard(&runtime, run_id)));
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ComputerRequestInput {
    #[schemars(
        description = "One sentence the person sees explaining why the task needs its own computer."
    )]
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ComputerExecInput {
    #[schemars(
        description = "Shell command run with bash -lc inside the computer, as its unprivileged user. Never include secrets."
    )]
    pub command: String,
    #[schemars(description = "Maximum run time in milliseconds, 1000 to 600000 (default 30000).")]
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[schemars(
        description = "Working directory inside the computer (default the home folder). A shared project is at /workspace/project, read-only."
    )]
    #[serde(default)]
    pub cwd: Option<String>,
}

const ALLOW: &str = "Allow a sandbox computer";
const ALLOW_PROJECT: &str = "Allow, and share this project read-only";
const DECLINE: &str = "Do not allow";
const INSTRUCTION: &str = "desktop_control now acts on this computer without access questions: take a snapshot or screenshot, then act by ref or coordinates. Browser tools drive its Chromium when its network is on, and each site asks the person before first use. computer_exec runs bounded shell commands inside it. It is not the person's machine; never type the person's secrets into it.";

fn pending_requests() -> &'static Mutex<HashMap<String, String>> {
    static PENDING: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

fn describe(root: &Path, computer: &Computer) -> Value {
    let state = provider(&computer.provider)
        .and_then(|p| p.state(root, computer))
        .map(state_name)
        .unwrap_or("unavailable");
    json!({"computer": computer.name, "provider": computer.provider, "state": state,
        "network": computer.settings.network, "instruction": INSTRUCTION})
}

/// `computer_request`: reports the run's computer, starting it when stopped,
/// or asks the person to give this task one.
pub async fn request_for_run(
    runtime: TaskRuntime,
    run: TaskRun,
    input: ComputerRequestInput,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || request_blocking(&runtime, &run, input))
        .await
        .map_err(|e| e.to_string())?
}

fn request_blocking(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: ComputerRequestInput,
) -> Result<Value, String> {
    let root = runtime.computers_root();
    if let Some(computer) = for_run(runtime, run) {
        let mut value = describe(&root, &computer);
        if let Err(message) = ready(&root, &computer) {
            value["status"] = json!("starting");
            value["message"] = json!(message);
        } else {
            value["status"] = json!("ready");
        }
        return Ok(value);
    }
    if super::bot_hub::installed().is_some_and(|hub| hub.is_bot_run(run)) {
        return Err("This bot has no computer. The person can add one in the bot's settings under Computer.".into());
    }
    let pending = pending_requests()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&run.id)
        .cloned();
    let Some(prompt_id) = pending else {
        if run.prompts.len() >= 100 {
            return Err("This task has reached its question limit.".into());
        }
        let reason = input
            .reason
            .filter(|reason| !reason.trim().is_empty())
            .map(|reason| {
                format!(
                    " The agent says: \u{201c}{}\u{201d}",
                    reason.trim().chars().take(300).collect::<String>()
                )
            })
            .unwrap_or_default();
        let prompt = PendingUserPrompt {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: run.id.clone(),
            question: format!("The agent asks for its own sandbox computer: a separate Linux desktop with a browser, running in Docker on this device. It cannot see your desktop or files unless you share this project read-only.{reason}"),
            input_type: "choice".into(),
            options: vec![DECLINE.into(), ALLOW.into(), ALLOW_PROJECT.into()],
            default_value: None,
            status: "pending".into(),
            answer: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            answered_at: None,
            presentation: QuestionPresentation {
                header: Some("Sandbox computer".into()),
                allow_other: Some(false),
                ..Default::default()
            },
        };
        let mut pushed = false;
        runtime.update_checked(&run.id, |r| {
            if ["starting", "running"].contains(&r.status.as_str()) {
                r.prompts.push(prompt.clone());
                pushed = true;
            }
        })?;
        if !pushed {
            return Err("This attempt has ended.".into());
        }
        pending_requests()
            .lock()
            .map_err(|e| e.to_string())?
            .insert(run.id.clone(), prompt.id.clone());
        return Ok(json!({"status":"pending","questionId":prompt.id,
            "instruction":"Wait for the person to answer, then call computer_request again."}));
    };
    let fresh = runtime
        .run_snapshot(&run.id)
        .ok_or("This attempt has ended.")?;
    let prompt = fresh
        .prompts
        .iter()
        .find(|p| p.id == prompt_id)
        .ok_or("The computer question is no longer available.")?;
    if prompt.status == "pending" {
        return Ok(json!({"status":"pending","questionId":prompt_id}));
    }
    pending_requests()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&run.id);
    let answer = prompt.answer.clone().unwrap_or_default();
    if answer != ALLOW && answer != ALLOW_PROJECT {
        return Err(
            "The person declined a sandbox computer for this task. Continue without one.".into(),
        );
    }
    let settings = ComputerSettings {
        project_mount: (answer == ALLOW_PROJECT).then(|| run.workspace.clone()),
        ..Default::default()
    };
    let name: String = format!("Task computer: {}", run.prompt.trim())
        .chars()
        .take(80)
        .collect();
    let computer = configure(
        &root,
        TASK,
        &run.task_id,
        &name,
        LOCAL_DOCKER,
        None,
        settings,
        &run.project_id,
    )?;
    runtime.update(&run.id, |r| {
        r.activity.push(format!(
            "You gave this task a sandbox computer{}.",
            if answer == ALLOW_PROJECT {
                " with the project shared read-only"
            } else {
                ""
            }
        ))
    });
    let mut value = describe(&root, &computer);
    match ready(&root, &computer) {
        Ok(()) => value["status"] = json!("ready"),
        Err(message) => {
            value["status"] = json!("starting");
            value["message"] = json!(message);
        }
    }
    Ok(value)
}

/// `computer_exec`: one bounded shell command inside the run's computer.
pub async fn exec_for_run(
    runtime: TaskRuntime,
    run: TaskRun,
    input: ComputerExecInput,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = runtime.computers_root();
        let computer = for_run(&runtime, &run).ok_or(
            "This task has no computer. Call computer_request first, or use a bot with a computer.",
        )?;
        ready(&root, &computer)?;
        let timeout = input.timeout_ms.unwrap_or(30_000).clamp(1000, 600_000);
        let value = call(
            &root,
            &computer,
            json!({"action":"exec","command":input.command,"timeout_ms":timeout,"cwd":input.cwd}),
            Duration::from_millis(timeout) + Duration::from_secs(15),
            &AtomicBool::new(false),
        )?;
        let summary: String = input.command.chars().take(80).collect();
        runtime.update(&run.id, |r| {
            r.activity.push(format!(
                "Ran in {}: {summary} (exit {})",
                computer.name, value["exitCode"]
            ))
        });
        let mut value = value;
        value["untrustedContent"] = json!(true);
        Ok(value)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn release_run(run_id: &str) {
    if let Ok(mut pending) = pending_requests().lock() {
        pending.remove(run_id);
    }
    super::desktop_control::computer::close(run_id);
}

// ---- views and app commands ----

fn state_name(state: MachineState) -> &'static str {
    match state {
        MachineState::Missing => "not-created",
        MachineState::Stopped => "stopped",
        MachineState::Running => "running",
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerStatus {
    #[serde(flatten)]
    pub computer: Computer,
    /// not-created, stopped, running, starting or unavailable.
    pub state: String,
    pub phase: Option<String>,
    pub error: Option<String>,
    /// Whether a viewer can be opened now.
    pub viewer: bool,
}

pub(crate) fn status(root: &Path, computer: Computer) -> ComputerStatus {
    let busy = current_activity(&computer.id);
    let provider = provider(&computer.provider);
    let (state, mut error) = match provider.and_then(|p| {
        p.available(root, &computer)
            .and_then(|_| p.state(root, &computer))
    }) {
        Ok(state) => (state_name(state).to_string(), None),
        Err(error) => ("unavailable".to_string(), Some(error)),
    };
    let state = if busy.phase.is_some() {
        "starting".to_string()
    } else {
        state
    };
    if busy.error.is_some() {
        error = busy.error;
    }
    ComputerStatus {
        viewer: state == "running"
            && (computer.settings.network || computer.provider != LOCAL_DOCKER),
        computer,
        state,
        phase: busy.phase,
        error,
    }
}

fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> {
    async move {
        tauri::async_runtime::spawn_blocking(work)
            .await
            .map_err(|e| e.to_string())?
    }
}

#[tauri::command]
pub async fn computer_docker_status() -> Result<docker::DockerStatus, String> {
    blocking(|| Ok(docker::detect())).await
}

#[tauri::command]
pub async fn computer_list(
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Vec<ComputerStatus>, String> {
    let root = state.computers_root();
    blocking(move || {
        Ok(list(&root)?
            .into_iter()
            .map(|computer| status(&root, computer))
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn computer_status(
    owner_kind: String,
    owner_id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Option<ComputerStatus>, String> {
    let root = state.computers_root();
    blocking(
        move || Ok(find(&root, &owner_kind, &owner_id).map(|computer| status(&root, computer))),
    )
    .await
}

#[tauri::command]
pub async fn computer_configure(
    owner_kind: String,
    owner_id: String,
    owner_name: String,
    provider: String,
    machine_id: Option<String>,
    settings: ComputerSettings,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<ComputerStatus, String> {
    if owner_kind != BOT {
        return Err("Only bots get a computer from settings; tasks ask for one.".into());
    }
    let root = state.computers_root();
    blocking(move || {
        let computer = configure(
            &root,
            BOT,
            &owner_id,
            &format!("{} computer", owner_name.trim()),
            &provider,
            machine_id,
            settings,
            &format!("bot:{owner_id}"),
        )?;
        Ok(status(&root, computer))
    })
    .await
}

#[tauri::command]
pub async fn computer_start(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<ComputerStatus, String> {
    let root = state.computers_root();
    blocking(move || {
        let computer = get(&root, &id)?;
        set_phase(&id, None, None);
        start_background(root.clone(), computer.clone())?;
        Ok(status(&root, computer))
    })
    .await
}

#[tauri::command]
pub async fn computer_stop(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<ComputerStatus, String> {
    let root = state.computers_root();
    blocking(move || {
        let computer = get(&root, &id)?;
        stop(&root, &computer)?;
        Ok(status(&root, computer))
    })
    .await
}

pub(crate) fn stop(root: &Path, computer: &Computer) -> Result<(), String> {
    disconnect(&computer.id);
    set_phase(&computer.id, None, None);
    provider(&computer.provider)?.stop(root, computer)
}

/// Deletes the machine, its home volume and saved secret, then the record.
#[tauri::command]
pub async fn computer_delete(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<(), String> {
    let root = state.computers_root();
    blocking(move || delete(&root, &id)).await
}

pub(crate) fn delete(root: &Path, id: &str) -> Result<(), String> {
    let computer = get(root, id)?;
    if current_activity(id).phase.is_some() {
        return Err("Wait for the computer to finish starting, then delete it.".into());
    }
    disconnect(id);
    if let Ok(provider) = provider(&computer.provider) {
        provider.delete(root, &computer)?;
    }
    let _ = account_storage::remove(&secret_path(root, id));
    set_phase(id, None, None);
    let _guard = index_lock().lock().map_err(|e| e.to_string())?;
    let mut index = read(root)?;
    index.computers.retain(|c| c.id != id);
    write(root, &index)
}

#[tauri::command]
pub async fn computer_viewer(
    id: String,
    interactive: bool,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Option<String>, String> {
    let root = state.computers_root();
    blocking(move || {
        let computer = get(&root, &id)?;
        provider(&computer.provider)?.viewer(&root, &computer, interactive)
    })
    .await
}

/// A run's computer as the Screen view shows it.
pub(crate) fn view_for_run(runtime: &TaskRuntime, run_id: &str) -> Option<ComputerStatus> {
    let computer = for_run_id(runtime, run_id)?;
    Some(status(&runtime.computers_root(), computer))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinesView {
    pub machines: Vec<remote::Machine>,
    /// Whether Jackalope-hosted computers can be chosen yet.
    pub hosted_available: bool,
}

#[tauri::command]
pub async fn computer_machines(
    state: tauri::State<'_, TaskRuntime>,
) -> Result<MachinesView, String> {
    let root = state.computers_root();
    blocking(move || {
        Ok(MachinesView {
            machines: remote::machines(&root)?,
            hosted_available: HOSTED_AVAILABLE,
        })
    })
    .await
}

/// Pairs a machine after checking that it answers with the secret.
#[tauri::command]
pub async fn computer_machine_add(
    name: String,
    url: String,
    secret: String,
    viewer_url: Option<String>,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<remote::Machine, String> {
    let root = state.computers_root();
    remote::add(&root, &name, &url, &secret, viewer_url).await
}

#[tauri::command]
pub async fn computer_machine_test(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<remote::MachineHealth, String> {
    let root = state.computers_root();
    let (machine, token) = blocking({
        let root = root.clone();
        move || {
            let machine = remote::machine(&root, &id)?;
            let token = remote::token(&root, &id)?;
            Ok((machine, token))
        }
    })
    .await?;
    Ok(remote::health(&machine.url, &token).await)
}

#[tauri::command]
pub async fn computer_machine_remove(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<(), String> {
    let root = state.computers_root();
    blocking(move || remote::remove(&root, &id)).await
}

type BridgeError = (axum::http::StatusCode, axum::Json<Value>);

fn bridge_failure(error: String) -> BridgeError {
    (
        axum::http::StatusCode::BAD_REQUEST,
        axum::Json(json!({"error": error})),
    )
}

fn bridge_run(
    service: &super::coordination::Coordinator,
    headers: &axum::http::HeaderMap,
) -> Result<TaskRun, BridgeError> {
    service.authorized_run(headers).map_err(|status| {
        (
            status,
            axum::Json(json!({"error":"Task authorization required"})),
        )
    })
}

pub(super) async fn bridge_request(
    axum::extract::State(service): axum::extract::State<super::coordination::Coordinator>,
    headers: axum::http::HeaderMap,
    axum::Json(input): axum::Json<ComputerRequestInput>,
) -> Result<axum::Json<Value>, BridgeError> {
    let run = bridge_run(&service, &headers)?;
    request_for_run(service.runtime.clone(), run, input)
        .await
        .map(axum::Json)
        .map_err(bridge_failure)
}

pub(super) async fn bridge_exec(
    axum::extract::State(service): axum::extract::State<super::coordination::Coordinator>,
    headers: axum::http::HeaderMap,
    axum::Json(input): axum::Json<ComputerExecInput>,
) -> Result<axum::Json<Value>, BridgeError> {
    let run = bridge_run(&service, &headers)?;
    exec_for_run(service.runtime.clone(), run, input)
        .await
        .map(axum::Json)
        .map_err(bridge_failure)
}
