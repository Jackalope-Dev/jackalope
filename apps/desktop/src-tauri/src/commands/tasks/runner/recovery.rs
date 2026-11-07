//! Changes a lost attempt left on its computer.
//!
//! When contact with a computer is lost mid-run, the agent's changes stay in
//! the run's folder there, and planned work is retried elsewhere as a fresh
//! attempt. The folder, its Git-sync worktree, its `jackalope/<run>` branch
//! and its `refs/jackalope/incoming/<run>/` and `refs/jackalope/result/<run>`
//! refs are all keyed by the run name, which follows the local workspace
//! ([`runs::run_name`]), so a later run of that workspace on the computer
//! would otherwise find them and bring them into its own workspace.
//!
//! Once the computer answers again, an attempt that another attempt replaced
//! has its changes fetched through the same collection a finished run uses
//! and saved beside its history as `<id>.remote.patch`, with its saved output
//! in `<id>.remote.artifacts`, as a result that does not apply is saved. They
//! are never applied: the retry may have moved on. The run is then removed
//! from the computer, folder, worktree, branch and refs together. Only a
//! continuation of the lost attempt itself still brings its changes into the
//! workspace; any other attempt of that workspace that finds them on the
//! computer saves them for the lost attempt the same way first.

use super::remote::patch_files;
use super::*;
use crate::commands::computers::pool::LeftChanges;
use std::sync::OnceLock;

/// How often the sweep looks for changes to recover.
const TICK: Duration = Duration::from_secs(30);
/// How often one computer is asked, at most.
const PROBE_EVERY: Duration = Duration::from_secs(60);
/// Failed fetches before the sweep stops trying.
const TRIES: u32 = 3;

/// Held while changes left on a computer are recovered, and while a run
/// prepares on a computer, so the two never handle the same run at once.
pub(super) fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

impl TaskRuntime {
    /// Starts the background sweep that recovers changes left on computers
    /// that answer again. Called once at startup.
    pub fn launch_lost_host_recovery(&self) {
        static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let runtime = self.clone();
        let spawned = std::thread::Builder::new()
            .name("lost-host-recovery".into())
            .spawn(move || loop {
                std::thread::sleep(TICK);
                runtime.recover_left_changes();
            });
        if let Err(error) = spawned {
            eprintln!("Changes left on lost computers will not be recovered: {error}");
        }
    }
}

/// Lost attempts whose changes the sweep should fetch now: still on their
/// computer, replaced by another attempt, not given up on, and with no active
/// run of the same workspace on that computer.
pub(super) fn waiting(runs: &[TaskRun]) -> Vec<&TaskRun> {
    runs.iter()
        .filter(|run| {
            let Some(host) = run.host.as_ref() else {
                return false;
            };
            let Some(left) = host.left.as_ref() else {
                return false;
            };
            left.on_host
                && run.status == RunStatus::Failed
                && (left.recovered_at.is_some() || left.tries < TRIES)
                && runs
                    .iter()
                    .any(|other| other.retry_of.as_deref() == Some(run.id.as_str()))
                && !runs.iter().any(|other| {
                    other.id != run.id
                        && other.status.is_active()
                        && same_run(other, &host.id, &run.workspace)
                })
        })
        .collect()
}

/// Whether `run` uses the run folder of `workspace` on computer `host`.
fn same_run(run: &TaskRun, host: &str, workspace: &str) -> bool {
    run.host.as_ref().is_some_and(|other| other.id == host)
        && runs::run_name(&run.workspace) == runs::run_name(workspace)
}

impl TaskRuntime {
    /// Records that a lost attempt's changes stayed on its computer.
    pub(super) fn changes_left(&self, id: &str) {
        self.update(id, |run| {
            if let Some(host) = &mut run.host {
                host.left = Some(LeftChanges {
                    on_host: true,
                    ..Default::default()
                });
            }
        });
    }

    /// A lost attempt whose changes sit in the run folder `workspace` uses on
    /// `computer`, and which attempt `id` must not bring into its workspace:
    /// any attempt but `id` itself and `previous`, the one `id` continues.
    pub(super) fn left_by_other(
        &self,
        id: &str,
        previous: Option<&str>,
        computer: &str,
        workspace: &str,
    ) -> Option<TaskRun> {
        self.inner
            .lock()
            .unwrap()
            .runs
            .values()
            .find(|run| {
                run.id != id
                    && Some(run.id.as_str()) != previous
                    && run
                        .host
                        .as_ref()
                        .and_then(|host| host.left.as_ref())
                        .is_some_and(|left| left.on_host)
                    && same_run(run, computer, workspace)
            })
            .cloned()
    }

    /// Records that a continuation brought the lost attempt `previous`'s
    /// changes into its workspace.
    pub(super) fn left_brought_back(&self, previous: &str, by: &str) {
        self.update(previous, |run| {
            if let Some(left) = run.host.as_mut().and_then(|host| host.left.as_mut()) {
                if left.on_host {
                    left.on_host = false;
                    left.note = Some(format!(
                        "Its changes were brought back by attempt {by}, which continued it."
                    ));
                }
            }
        });
    }

    /// Fetches the changes `lost` left on `computer` through `session`,
    /// whose last status was `status`, saves them beside its history and
    /// removes its run there. Nothing is applied to any workspace. With
    /// `clear`, the run is removed even when its changes cannot be fetched,
    /// because another attempt is about to use its folder. Returns whether
    /// the run is gone from the computer.
    pub(super) fn recover_left(
        &self,
        lost: &TaskRun,
        session: &mut runs::Session,
        status: &serde_json::Value,
        computer: &Computer,
        clear: bool,
    ) -> bool {
        let left = lost
            .host
            .as_ref()
            .and_then(|host| host.left.clone())
            .unwrap_or_default();
        let name = &computer.name;
        if status["exists"] != true {
            self.settle_left(&lost.id, |left| {
                left.on_host = false;
                if left.recovered_at.is_none() {
                    left.note = Some(format!("Nothing was left on {name} to recover."));
                }
            });
            return true;
        }
        if left.recovered_at.is_some() {
            // Saved earlier; only the run on the computer is left to remove.
            let removed = session.try_remove().is_ok();
            self.settle_left(&lost.id, |left| left.on_host = !removed);
            return removed;
        }
        stop_leftover(session, status);
        if status["started"] != true {
            let removed = session.try_remove().is_ok();
            self.settle_left(&lost.id, |left| {
                left.on_host = !removed;
                left.note = Some(format!("Nothing was left on {name} to recover."));
            });
            return removed;
        }
        let workspace = if Path::new(&lost.workspace).is_dir() {
            lost.workspace.as_str()
        } else {
            // Its worktree is gone; the project's repository holds the same
            // commits for a Git-synced result.
            lost.project_path.as_str()
        };
        let saved = session
            .collect_changes(Path::new(workspace))
            .and_then(|collected| {
                let patch = (!collected.patch.is_empty())
                    .then(|| {
                        let path = self.directory.join(format!("{}.remote.patch", lost.id));
                        std::fs::write(&path, &collected.patch)
                            .map(|()| path.to_string_lossy().into_owned())
                            .map_err(|error| format!("the patch could not be saved: {error}"))
                    })
                    .transpose()?;
                let output = self.directory.join(format!("{}.remote.artifacts", lost.id));
                let artifacts = (!collected.artifacts.is_empty()
                    && session
                        .fetch_artifacts(&output, &collected.artifacts)
                        .is_ok())
                .then(|| output.to_string_lossy().into_owned());
                Ok((patch, artifacts, patch_files(&collected.patch)))
            });
        let (patch, artifacts, files) = match saved {
            Ok(saved) => saved,
            Err(error) => {
                let tries = left.tries + 1;
                let note = format!(
                    "The changes left on {name} could not be recovered: {}",
                    error.trim_end_matches('.')
                );
                let removed = clear && session.try_remove().is_ok();
                let line = if removed {
                    Some(format!(
                        "{note}. They were discarded so they cannot mix into a later attempt there."
                    ))
                } else {
                    (tries >= TRIES).then(|| format!("{note}. They stay on {name}."))
                };
                self.settle_left(&lost.id, |left| {
                    left.tries = tries;
                    left.on_host = !removed;
                    left.note = Some(line.clone().unwrap_or_else(|| format!("{note}.")));
                });
                if let Some(line) = line {
                    self.update(&lost.id, |run| activity(run, &line));
                }
                return removed;
            }
        };
        let line = match (&patch, &artifacts) {
            (None, None) => format!("Nothing was left on {name} to recover."),
            _ => {
                let mut line = format!("Changes recovered from {name}");
                if let Some(patch) = &patch {
                    line.push_str(&format!(
                        ": {files} file{} saved at {patch}",
                        if files == 1 { "" } else { "s" }
                    ));
                }
                line.push_str(
                    ". They were not applied, because another attempt replaced this one.",
                );
                if let Some(artifacts) = &artifacts {
                    line.push_str(&format!(" Its saved output is at {artifacts}."));
                }
                line
            }
        };
        let removed = session.try_remove().is_ok();
        let nothing = patch.is_none() && artifacts.is_none();
        self.settle_left(&lost.id, |left| {
            left.on_host = !removed;
            left.recovered_at = Some(Utc::now().to_rfc3339());
            left.patch = patch.clone();
            left.artifacts = artifacts.clone();
            left.files = files;
            left.note = nothing.then(|| line.clone());
        });
        self.update(&lost.id, |run| activity(run, &line));
        removed
    }

    fn settle_left(&self, id: &str, change: impl FnOnce(&mut LeftChanges)) {
        self.update(id, |run| {
            if let Some(left) = run.host.as_mut().and_then(|host| host.left.as_mut()) {
                change(left);
            }
        });
    }

    /// One pass of the sweep: for each computer that answers again, recover
    /// the changes lost attempts replaced by others left there. A computer
    /// that is stopped is never started for this; its changes wait until
    /// something else starts it.
    pub(super) fn recover_left_changes(&self) {
        let runs: Vec<TaskRun> = self.inner.lock().unwrap().runs.values().cloned().collect();
        let due = waiting(&runs);
        if due.is_empty() {
            return;
        }
        let root = self.computers_root();
        let computers = computers::list(&root).unwrap_or_default();
        let mut by_host: std::collections::BTreeMap<&str, Vec<&TaskRun>> = Default::default();
        for run in due {
            if let Some(host) = &run.host {
                by_host.entry(host.id.as_str()).or_default().push(run);
            }
        }
        for (host, lost) in by_host {
            let Some(computer) = computers
                .iter()
                .find(|computer| computer.id == host)
                .filter(|computer| runs::supports_runs(computer))
            else {
                for run in lost {
                    let name = run
                        .host
                        .as_ref()
                        .map(|host| host.name.clone())
                        .unwrap_or_default();
                    let note = format!(
                        "{name} was removed, so the changes left there cannot be recovered."
                    );
                    self.settle_left(&run.id, |left| {
                        left.on_host = false;
                        left.note = Some(note.clone());
                    });
                    self.update(&run.id, |saved| activity(saved, &note));
                }
                continue;
            };
            if pool::health(host).unavailable() || !probe_due(host) {
                continue;
            }
            let running = computers::provider(&computer.provider)
                .and_then(|provider| provider.state(&root, computer))
                .is_ok_and(|state| state == computers::MachineState::Running);
            if !running {
                continue;
            }
            for run in lost {
                let _guard = lock().lock().unwrap();
                // A run may have started or recovered it since the snapshot.
                let Some(current) = self.run_snapshot(&run.id) else {
                    continue;
                };
                let active: Vec<TaskRun> =
                    self.inner.lock().unwrap().runs.values().cloned().collect();
                if !waiting(&active).iter().any(|due| due.id == current.id) {
                    continue;
                }
                let Ok(mut session) = runs::Session::open(&root, computer, &current.workspace)
                else {
                    break;
                };
                match session.status() {
                    Ok(Some(status)) => {
                        pool::seen(
                            host,
                            Some(&computers::runner::RunnerCapabilities::from_status(Some(
                                &status,
                            ))),
                        );
                        self.recover_left(&current, &mut session, &status, computer, false);
                    }
                    Ok(None) => {
                        let note = format!(
                            "{} runs an image from before Jackalope could recover changes, so the changes left there stay on it.",
                            computer.name
                        );
                        self.settle_left(&current.id, |left| {
                            left.tries = TRIES;
                            left.note = Some(note.clone());
                        });
                    }
                    Err(_) => {
                        session.shutdown();
                        break;
                    }
                }
                session.shutdown();
            }
        }
    }
}

/// Stops a run that is still going on the computer and waits briefly for it
/// to end, so its changes are complete before they are collected.
pub(super) fn stop_leftover(session: &mut runs::Session, status: &serde_json::Value) {
    if status["started"] == true && status["exit"].is_null() {
        let _ = session.stop();
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(500));
            if session
                .status()
                .ok()
                .flatten()
                .is_some_and(|status| !status["exit"].is_null())
            {
                break;
            }
        }
    }
}

/// Whether computer `id` may be asked again: at most every [`PROBE_EVERY`].
fn probe_due(id: &str) -> bool {
    static PROBED: OnceLock<Mutex<HashMap<String, std::time::Instant>>> = OnceLock::new();
    let mut probed = PROBED.get_or_init(Default::default).lock().unwrap();
    if probed.get(id).is_some_and(|at| at.elapsed() < PROBE_EVERY) {
        return false;
    }
    probed.insert(id.into(), std::time::Instant::now());
    true
}
