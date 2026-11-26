//! Run on device: the person builds a conversation's workspace for one of their devices,
//! installs it and launches it with its console captured, in one action.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use super::super::{process_control, xcode};
use super::build::{self, Product};
use super::console::{self, Log};
use super::devicectl::{self, Device};

const OUTPUT_LINES: usize = 400;
/// How long a launch must keep running before it counts as started.
const LAUNCH_SETTLE: Duration = Duration::from_secs(3);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Building,
    Installing,
    Launching,
    /// Launched; the console keeps being captured.
    Running,
    Failed,
    Canceled,
}

/// What a Run on device shows.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
    pub device: String,
    pub phase: Phase,
    pub error: Option<String>,
    /// The last lines of build and install output.
    pub output: Vec<String>,
    /// The last lines of the launched app's console.
    pub console: Vec<String>,
    pub console_running: bool,
    pub console_ended: Option<String>,
}

struct Running {
    device: String,
    phase: Mutex<(Phase, Option<String>)>,
    output: Mutex<Log>,
    cancel: AtomicBool,
}

impl Running {
    fn set(&self, phase: Phase, error: Option<String>) {
        if let Ok(mut slot) = self.phase.lock() {
            *slot = (phase, error);
        }
    }

    fn say(&self, line: impl Into<String>) {
        if let Ok(mut log) = self.output.lock() {
            log.line(line.into());
        }
    }

    fn canceled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

fn runs() -> &'static Mutex<HashMap<String, Arc<Running>>> {
    static RUNS: OnceLock<Mutex<HashMap<String, Arc<Running>>>> = OnceLock::new();
    RUNS.get_or_init(Mutex::default)
}

pub fn state(key: &str) -> Option<RunState> {
    let running = runs().lock().ok()?.get(key).cloned()?;
    let (phase, error) = running.phase.lock().ok()?.clone();
    let output = running
        .output
        .lock()
        .map(|log| log.read(None, OUTPUT_LINES).0)
        .unwrap_or_default();
    let session = console::session(key);
    let console_lines = session
        .as_ref()
        .and_then(|session| {
            session
                .log
                .lock()
                .ok()
                .map(|log| log.read(None, OUTPUT_LINES).0)
        })
        .unwrap_or_default();
    Some(RunState {
        device: running.device.clone(),
        phase,
        error,
        output,
        console: if phase == Phase::Running {
            console_lines
        } else {
            Vec::new()
        },
        console_running: session.as_ref().is_some_and(|session| session.running()),
        console_ended: session
            .and_then(|session| session.ended())
            .map(|ended| ended.message),
    })
}

pub fn cancel(key: &str) {
    if let Some(running) = runs().lock().ok().and_then(|map| map.get(key).cloned()) {
        running.cancel.store(true, Ordering::Relaxed);
    }
    console::stop(key);
}

/// What a run needs, gathered on the command's thread.
pub struct Plan {
    pub key: String,
    pub workspace: String,
    pub device: Device,
    pub team: Option<String>,
    pub derived: std::path::PathBuf,
}

/// Starts a run in the background. Refuses a second one for the same conversation.
pub fn start(plan: Plan, changed: impl Fn() + Send + Sync + Clone + 'static) -> Result<(), String> {
    let running = Arc::new(Running {
        device: plan.device.name.clone(),
        phase: Mutex::new((Phase::Building, None)),
        output: Mutex::default(),
        cancel: AtomicBool::new(false),
    });
    {
        let mut map = runs().lock().map_err(|e| e.to_string())?;
        if let Some(previous) = map.get(&plan.key) {
            let phase = previous
                .phase
                .lock()
                .map(|slot| slot.0)
                .unwrap_or(Phase::Failed);
            if matches!(
                phase,
                Phase::Building | Phase::Installing | Phase::Launching
            ) {
                return Err("This conversation is already running on a device.".into());
            }
        }
        map.insert(plan.key.clone(), running.clone());
    }
    std::thread::spawn(move || {
        let result = execute(&plan, &running, changed.clone());
        match result {
            Ok(()) => {}
            Err(_) if running.canceled() => running.set(Phase::Canceled, None),
            Err(error) => {
                running.say(error.clone());
                running.set(Phase::Failed, Some(error));
            }
        }
        changed();
    });
    Ok(())
}

fn execute(
    plan: &Plan,
    running: &Arc<Running>,
    changed: impl Fn() + Send + Sync + Clone + 'static,
) -> Result<(), String> {
    let workspace = Path::new(&plan.workspace);
    let project = build::find_project(workspace)
        .ok_or("This workspace has no Xcode project or workspace to build.")?;
    let schemes = build::list_schemes(&project)?;
    let scheme = build::pick_scheme(&schemes, &project.name())
        .ok_or_else(|| format!("{} has no shared scheme to build.", project.name()))?;
    let destination = plan.device.destination();
    let team = plan.team.as_deref().filter(|team| build::valid_team(team));
    running.say(format!(
        "Building {scheme} for {} ({destination}){}",
        plan.device.name,
        team.map(|team| format!(" with team {team}"))
            .unwrap_or_default()
    ));
    changed();
    let mut command = xcode::xcrun("xcodebuild");
    command
        .args(build::device_build_args(
            &project,
            &scheme,
            &destination,
            &plan.derived,
            team,
        ))
        .current_dir(workspace);
    let observer = running.clone();
    let notify = changed.clone();
    let stopper = running.clone();
    let built = process_control::run_supervised(
        command,
        process_control::Limits::supervised(
            Duration::from_secs(60 * 60),
            Duration::from_secs(15 * 60),
        ),
        move || stopper.canceled(),
        move |bytes, stderr| {
            if let Ok(mut log) = observer.output.lock() {
                log.push(bytes, usize::from(stderr));
            }
            notify();
        },
    )?;
    if running.canceled() {
        return Err("Canceled.".into());
    }
    if !built.success {
        let output = format!("{}\n{}", built.stdout, built.stderr);
        return Err(match built.interruption() {
            Some(why) => format!("The device build {why}."),
            None => build::build_failure(&output, team),
        });
    }
    let app = build::newest_product(&plan.derived)
        .ok_or("The build finished but produced no app for a device.")?;
    let product = Product::read(&app);
    if let Some(problem) = product.problem(&destination, team) {
        return Err(problem);
    }
    running.set(Phase::Installing, None);
    running.say(format!(
        "Installing {} on {}",
        product.name(),
        plan.device.name
    ));
    changed();
    let result = devicectl::run(
        |json| devicectl::install_args(&plan.device.id, &app, json),
        Duration::from_secs(10 * 60),
        &plan.device.name,
        "install the app",
    )?;
    let bundle = devicectl::installed_bundle(&result)
        .or(product.bundle_id)
        .ok_or("The app was installed but its bundle identifier is unknown.")?;
    super::record_install(&plan.key, &plan.device.id, &bundle);
    if running.canceled() {
        return Err("Canceled.".into());
    }
    running.set(Phase::Launching, None);
    running.say(format!("Launching {bundle}"));
    changed();
    let session = console::launch(
        &plan.key,
        &plan.device.id,
        &plan.device.name,
        &bundle,
        Vec::new(),
        console::MAX_SECONDS,
        changed,
    );
    session.wait(LAUNCH_SETTLE);
    if let Some(ended) = session.ended().filter(|ended| ended.failed) {
        return Err(ended.message);
    }
    running.set(Phase::Running, None);
    Ok(())
}
