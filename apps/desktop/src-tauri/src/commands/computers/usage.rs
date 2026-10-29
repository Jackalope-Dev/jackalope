//! When bot computers run. Every use (a transport call, a browser attach, a
//! command, a viewer, a start) records activity. A computer holds a lease while
//! an active run routes to it or an open viewer keeps renewing one, and a
//! leased computer is never stopped. One background sweep stops local
//! sandboxes idle past their timeout (the container and home volume stay) and
//! drops idle connections to every computer. Cloud machines are never stopped:
//! their own provider's scheduling applies.
//!
//! On quit, local sandboxes are stopped by a detached `docker stop` unless the
//! person keeps them running; a sandbox found running at the next launch is
//! adopted and its idle timer starts then.

use super::{
    current_activity, disconnect, docker, list, provider, Computer, MachineState, BOT,
    LOCAL_DOCKER, TASK,
};
use crate::commands::tasks::TaskRuntime;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

/// Idle timeouts the settings offer, in minutes; 0 is Never.
pub(crate) const IDLE_CHOICES: [u32; 5] = [0, 5, 10, 30, 60];
pub(crate) const DEFAULT_IDLE_MINUTES: u32 = 10;
const TICK: Duration = Duration::from_secs(30);
/// An open viewer renews its lease more often than this.
const VIEWER_LEASE: Duration = Duration::from_secs(90);
/// Cached connections close after this long without use, on every provider.
const CONNECTION_IDLE: Duration = Duration::from_secs(5 * 60);
/// `last_used_at` in the index is rewritten at most this often.
const PERSIST_EVERY: Duration = Duration::from_secs(5 * 60);

struct Usage {
    last: Instant,
    persisted: Option<Instant>,
    /// The timeout, in minutes, after which the sweep stopped it.
    stopped_idle: Option<u32>,
    /// Past its timeout but already stopped; not inspected again until used.
    settled: bool,
}

impl Usage {
    fn fresh() -> Self {
        Self {
            last: Instant::now(),
            persisted: None,
            stopped_idle: None,
            settled: false,
        }
    }
}

fn usage() -> &'static Mutex<HashMap<String, Usage>> {
    static USAGE: OnceLock<Mutex<HashMap<String, Usage>>> = OnceLock::new();
    USAGE.get_or_init(Default::default)
}

/// Records a use of the computer now.
pub(crate) fn note(root: &Path, id: &str) {
    let persist = {
        let Ok(mut map) = usage().lock() else { return };
        let entry = map.entry(id.into()).or_insert_with(Usage::fresh);
        entry.last = Instant::now();
        entry.stopped_idle = None;
        entry.settled = false;
        let due = entry
            .persisted
            .is_none_or(|at| at.elapsed() >= PERSIST_EVERY);
        if due {
            entry.persisted = Some(Instant::now());
        }
        due
    };
    if persist {
        super::touch(root, id);
    }
}

/// How long since the computer was last used; a computer seen for the first
/// time (such as one left running by an earlier session) starts counting now.
fn idle(id: &str) -> Duration {
    usage()
        .lock()
        .map(|mut map| {
            map.entry(id.into())
                .or_insert_with(Usage::fresh)
                .last
                .elapsed()
        })
        .unwrap_or_default()
}

fn stopped_idle(id: &str) -> Option<u32> {
    usage().lock().ok()?.get(id)?.stopped_idle
}

// ---- leases ----

fn run_leases() -> &'static Mutex<HashSet<String>> {
    static LEASES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    LEASES.get_or_init(Default::default)
}

fn viewer_leases() -> &'static Mutex<HashMap<String, HashMap<String, Instant>>> {
    static LEASES: OnceLock<Mutex<HashMap<String, HashMap<String, Instant>>>> = OnceLock::new();
    LEASES.get_or_init(Default::default)
}

/// Opens or renews an open viewer's lease on the computer.
pub(crate) fn hold_viewer(root: &Path, id: &str, lease: &str) {
    if let Ok(mut map) = viewer_leases().lock() {
        map.entry(id.into()).or_default().insert(
            lease.chars().take(80).collect(),
            Instant::now() + VIEWER_LEASE,
        );
    }
    note(root, id);
}

pub(crate) fn release_viewer(id: &str, lease: &str) {
    if let Ok(mut map) = viewer_leases().lock() {
        if let Some(leases) = map.get_mut(id) {
            leases.remove(lease);
            if leases.is_empty() {
                map.remove(id);
            }
        }
    }
}

fn viewer_held(id: &str) -> bool {
    let Ok(mut map) = viewer_leases().lock() else {
        return false;
    };
    let now = Instant::now();
    let Some(leases) = map.get_mut(id) else {
        return false;
    };
    leases.retain(|_, expires| *expires > now);
    if leases.is_empty() {
        map.remove(id);
        return false;
    }
    true
}

/// Whether an active run or an open viewer holds the computer.
pub(crate) fn in_use(id: &str) -> bool {
    run_leases().lock().is_ok_and(|held| held.contains(id)) || viewer_held(id)
}

/// Recomputes which computers active runs hold, mirroring [`super::for_run`]:
/// a bot conversation holds its bot's computer, any other run its task's.
/// Held computers count as used, so idle time starts when the run ends.
pub(crate) fn refresh_run_leases(runtime: &TaskRuntime) {
    let root = runtime.computers_root();
    let computers = list(&root).unwrap_or_default();
    let hub = crate::commands::bot_hub::installed();
    let mut held = HashSet::new();
    for run in runtime.active_runs() {
        let owner = match hub.and_then(|hub| hub.caller(&run).ok()) {
            Some((bot, _)) => (BOT, bot.id),
            None => (TASK, run.task_id.clone()),
        };
        if let Some(computer) = computers
            .iter()
            .find(|c| c.owner_kind == owner.0 && c.owner_id == owner.1)
        {
            held.insert(computer.id.clone());
        }
    }
    for id in &held {
        note(&root, id);
    }
    if let Ok(mut leases) = run_leases().lock() {
        *leases = held;
    }
}

// ---- stopping ----

fn stopping() -> &'static Mutex<HashSet<String>> {
    static STOPPING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    STOPPING.get_or_init(Default::default)
}

/// Whether an idle stop is in progress; a use waits for it, then starts again.
pub(crate) fn is_stopping(id: &str) -> bool {
    stopping().lock().is_ok_and(|set| set.contains(id))
}

/// Whether a computer idle for `idle` should stop under a timeout in minutes.
pub(crate) fn idle_due(timeout_minutes: u32, idle: Duration, leased: bool) -> bool {
    timeout_minutes > 0 && !leased && idle >= Duration::from_secs(u64::from(timeout_minutes) * 60)
}

fn stop_if_idle(root: &Path, computer: &Computer) {
    let minutes = computer.settings.idle_stop_minutes;
    if minutes == 0 || current_activity(&computer.id).phase.is_some() {
        return;
    }
    let idle = {
        let Ok(mut map) = usage().lock() else { return };
        let entry = map.entry(computer.id.clone()).or_insert_with(Usage::fresh);
        if entry.settled || entry.stopped_idle.is_some() {
            return;
        }
        entry.last.elapsed()
    };
    if !idle_due(minutes, idle, false) {
        return;
    }
    let Ok(local) = provider(LOCAL_DOCKER) else {
        return;
    };
    if local.available(root, computer).is_err() {
        return;
    }
    match local.state(root, computer) {
        Ok(MachineState::Running) => {}
        Ok(_) => {
            if let Ok(mut map) = usage().lock() {
                if let Some(entry) = map.get_mut(&computer.id) {
                    entry.settled = true;
                }
            }
            return;
        }
        Err(_) => return,
    }
    {
        let Ok(mut set) = stopping().lock() else {
            return;
        };
        // A use that arrived while Docker answered keeps it running.
        let used = usage()
            .lock()
            .map(|map| {
                map.get(&computer.id)
                    .is_none_or(|u| u.last.elapsed() < idle)
            })
            .unwrap_or(true);
        if used || in_use(&computer.id) || current_activity(&computer.id).phase.is_some() {
            return;
        }
        set.insert(computer.id.clone());
    }
    release_connections(root, computer);
    let result = local.stop(root, computer);
    if let Ok(mut set) = stopping().lock() {
        set.remove(&computer.id);
    }
    match result {
        Ok(()) => {
            if let Ok(mut map) = usage().lock() {
                if let Some(entry) = map.get_mut(&computer.id) {
                    entry.stopped_idle = Some(minutes);
                }
            }
            eprintln!("{}: {}", computer.name, stopped_notice(minutes));
        }
        Err(error) => eprintln!("{} could not be stopped while idle: {error}", computer.name),
    }
}

pub(crate) fn stopped_notice(minutes: u32) -> String {
    format!(
        "Stopped after {minutes} minute{} idle",
        if minutes == 1 { "" } else { "s" }
    )
}

/// Closes the computer's cached agent connection and any task browser
/// attached to its Chromium, so the next use reconnects (and starts it again).
pub(crate) fn release_connections(root: &Path, computer: &Computer) {
    disconnect(&computer.id);
    crate::commands::browser::detach_remote(&root.join(&computer.id));
}

fn quitting() -> &'static AtomicBool {
    static QUITTING: AtomicBool = AtomicBool::new(false);
    &QUITTING
}

fn sweep(runtime: &TaskRuntime) {
    if quitting().load(Ordering::SeqCst) {
        return;
    }
    refresh_run_leases(runtime);
    let root = runtime.computers_root();
    let Ok(computers) = list(&root) else { return };
    for computer in &computers {
        if in_use(&computer.id) {
            continue;
        }
        if idle(&computer.id) >= CONNECTION_IDLE {
            disconnect(&computer.id);
        }
        if computer.provider == LOCAL_DOCKER {
            stop_if_idle(&root, computer);
        }
    }
}

/// Starts the idle sweep once per process.
pub fn launch(runtime: TaskRuntime) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("computer-idle".into())
        .spawn(move || loop {
            std::thread::sleep(TICK);
            if quitting().load(Ordering::SeqCst) {
                return;
            }
            sweep(&runtime);
        });
    if let Err(error) = spawned {
        eprintln!("Bot computers will not stop when idle: {error}");
    }
}

// ---- status ----

/// What the status line adds after the state: whether the computer is in use,
/// how long it has been idle and when it stops, or that it stopped while idle.
pub(crate) fn describe(
    state: &str,
    local: bool,
    timeout_minutes: u32,
    in_use: bool,
    idle: Duration,
    stopped_idle: Option<u32>,
) -> Option<String> {
    match state {
        "running" if in_use => Some("in use".into()),
        "running" => {
            let minutes = idle.as_secs() / 60;
            let mut parts = vec![if minutes == 0 {
                "just used".to_string()
            } else {
                format!("idle {minutes} min")
            }];
            if local && timeout_minutes > 0 {
                let left = (u64::from(timeout_minutes) * 60).saturating_sub(idle.as_secs());
                parts.push(format!("stops in {} min", left.div_ceil(60).max(1)));
            }
            Some(parts.join(" · "))
        }
        "stopped" => stopped_idle.map(stopped_notice),
        _ => None,
    }
}

pub(crate) struct UsageView {
    pub in_use: bool,
    pub stopped_idle: bool,
    pub line: Option<String>,
}

pub(crate) fn view(computer: &Computer, state: &str) -> UsageView {
    let in_use = in_use(&computer.id);
    let stopped = if state == "stopped" {
        stopped_idle(&computer.id)
    } else {
        None
    };
    let idle = if state == "running" {
        idle(&computer.id)
    } else {
        Duration::ZERO
    };
    UsageView {
        in_use,
        stopped_idle: stopped.is_some(),
        line: describe(
            state,
            computer.provider == LOCAL_DOCKER,
            computer.settings.idle_stop_minutes,
            in_use,
            idle,
            stopped,
        ),
    }
}

// ---- preferences and quit ----

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerPreferences {
    /// Leave local sandboxes running when Jackalope quits.
    #[serde(default)]
    pub keep_running_on_quit: bool,
}

pub(crate) fn preferences(root: &Path) -> ComputerPreferences {
    let path = root.join("preferences.json");
    crate::commands::history::read_bounded(&path, 64_000)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn save_preferences(root: &Path, value: &ComputerPreferences) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    crate::commands::history::write_atomic(&root.join("preferences.json"), &bytes)
}

/// Runs as Jackalope exits: stops the idle sweep, closes connections and,
/// unless the person keeps them running, asks Docker to stop every local
/// sandbox without waiting for it.
pub fn shutdown(root: &Path) {
    quitting().store(true, Ordering::SeqCst);
    let computers = list(root).unwrap_or_default();
    for computer in &computers {
        disconnect(&computer.id);
    }
    if preferences(root).keep_running_on_quit {
        return;
    }
    let names: Vec<String> = computers
        .iter()
        .filter(|computer| computer.provider == LOCAL_DOCKER)
        .map(docker::container)
        .collect();
    if !names.is_empty() {
        docker::stop_detached(&names);
    }
}
