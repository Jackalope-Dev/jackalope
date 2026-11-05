//! Attempts whose agent CLI runs on the project's computer.
//!
//! Workspace preparation, checks, checkpoints, review and integration stay on
//! this device and are unchanged; only the agent process moves. The local
//! workspace is uploaded, the agent's output is read back by cursor and fed to
//! the same event parsers as a local process, and its changes are applied to
//! the local workspace before [`TaskRuntime::complete_attempt`] runs, so the
//! coordinator → execution guard → runtime lock order is untouched. The
//! Jackalope bridge listens on this device's loopback, so bridge tools are not
//! offered to agents on a computer.

use super::*;
use crate::commands::computers::{self, credentials, runs, Computer};

/// How long a run waits for its computer to start; a first image build is slow.
const START_WAIT: Duration = Duration::from_secs(20 * 60);
/// Consecutive failed reads, about two seconds apart, before contact is lost.
const READ_FAILURES: u32 = 60;

impl TaskRuntime {
    /// The computer this attempt's agent runs on, or `None` to run it here.
    /// Planning stays on this device: it needs the bridge for its questions.
    pub(super) fn remote_target(
        &self,
        id: &str,
        req: &RunRequest,
        adapter: &str,
    ) -> Option<Computer> {
        if crate::commands::planning::read_only(id) {
            return None;
        }
        let computer = runs::project_computer(&self.computers_root(), &req.project_id)?;
        if !credentials::REMOTE_ADAPTERS.contains(&adapter) {
            self.update(id, |run| {
                activity(
                    run,
                    &format!(
                        "{} cannot run on {} yet, so it runs on this device.",
                        req.agent, computer.name
                    ),
                )
            });
            return None;
        }
        Some(computer)
    }

    fn remote_progress(&self, id: &str, label: &str, detail: &str) {
        self.update(id, |run| {
            let mut step = super::preparation::StepProgress::new("agent", label, 1);
            step.detail = detail.into();
            run.progress = Some(step);
        });
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn run_remote(
        &self,
        id: &str,
        req: &RunRequest,
        adapter: &str,
        cmd: Command,
        input: String,
        workspace: &str,
        computer: Computer,
    ) -> Result<(), String> {
        let root = self.computers_root();
        let (argv, env) = runs::translate(adapter, &cmd, &root)?;
        {
            let inner = self.inner.lock().unwrap();
            if inner.canceled.contains(id) {
                drop(inner);
                self.update(id, |r| {
                    r.status = "stopped".into();
                    r.ended_at = Some(Utc::now().to_rfc3339());
                });
                return Ok(());
            }
            if inner.runs.values().any(|r| {
                r.id != id
                    && r.workspace == workspace
                    && ["starting", "running", "stopping"].contains(&r.status.as_str())
            }) {
                return Err(
                    "Another attempt is using this workspace. Stop it or wait before continuing."
                        .into(),
                );
            }
        }
        self.update_checked(id, |run| {
            run.remote = Some(RemoteExecution {
                computer_id: computer.id.clone(),
                computer_name: computer.name.clone(),
            })
        })?;
        self.remote_progress(id, &format!("Starting {}", computer.name), "");
        computers::ready_within(&root, &computer, START_WAIT)?;
        computers::usage::note(&root, &computer.id);
        let mut session = runs::Session::open(&root, &computer, workspace)?;
        let launched = std::time::Instant::now();
        let label = format!("Sending files to {}", computer.name);
        session.upload(Path::new(workspace), &|sent, total| {
            self.remote_progress(
                id,
                &label,
                &format!("{} of {}", megabytes(sent), megabytes(total)),
            );
        })?;
        self.update(id, |run| {
            run.efficiency.timing("remoteUpload", launched.elapsed());
        });
        if self.inner.lock().unwrap().canceled.contains(id) {
            session.remove();
            session.shutdown();
            self.update(id, |r| {
                r.status = "stopped".into();
                r.ended_at = Some(Utc::now().to_rfc3339());
            });
            return Ok(());
        }
        let immediate = session.start(&argv, &env, &input)?;
        self.update_checked(id, |r| {
            if r.status == "starting" {
                r.status = "running".into();
            }
            r.progress = None;
            activity(
                r,
                &format!(
                    "The agent runs on {}. Jackalope tools such as peers, questions and the browser are not available there yet.",
                    computer.name
                ),
            );
        })?;
        let (exit, quota_stopped, lost) = match immediate {
            Some(exit) => (Some(exit), false, false),
            None => self.follow_remote(id, adapter, &mut session, &computer, launched),
        };
        let code = exit
            .as_ref()
            .and_then(|exit| exit["code"].as_i64())
            .map(|c| c as i32);
        let ended_cleanly = exit
            .as_ref()
            .is_some_and(|exit| exit["reason"].is_null() && exit["error"].is_null());
        if let Some(error) = exit.as_ref().and_then(|exit| exit["error"].as_str()) {
            let error = error.to_string();
            self.update(id, |run| {
                run.error.get_or_insert(format!(
                    "The agent could not start on {}: {error}",
                    computer.name
                ));
            });
        }
        if let Some(reason) = exit.as_ref().and_then(|exit| exit["reason"].as_str()) {
            if reason == "timeout" {
                self.update(id, |run| {
                    run.error.get_or_insert("The agent exceeded the six-hour limit on its computer. Inspect the saved work and continue the task.".into());
                });
            }
        }
        if !lost {
            self.remote_progress(
                id,
                &format!("Bringing changes back from {}", computer.name),
                "",
            );
            match session.collect() {
                Ok(patch) => {
                    let files = patch_files(&patch);
                    if let Err(error) = runs::apply(Path::new(workspace), &patch) {
                        let saved = self.directory.join(format!("{id}.remote.patch"));
                        let kept = std::fs::write(&saved, &patch).is_ok();
                        self.update(id, |run| {
                            run.error.get_or_insert(format!(
                                "The agent's changes on {} could not be applied to the workspace: {error}{}",
                                computer.name,
                                if kept { format!(" They are saved at {}.", saved.display()) } else { String::new() }
                            ));
                        });
                    } else if files > 0 {
                        self.update(id, |run| {
                            activity(
                                run,
                                &format!(
                                    "Brought back changes to {files} file{} from {}.",
                                    if files == 1 { "" } else { "s" },
                                    computer.name
                                ),
                            )
                        });
                    }
                }
                Err(error) => self.update(id, |run| {
                    run.error.get_or_insert(format!(
                        "The agent's changes could not be collected from {}: {error}",
                        computer.name
                    ));
                }),
            }
            session.remove();
        }
        session.shutdown();
        self.update(id, |run| run.progress = None);
        let success = ended_cleanly && code == Some(0) && !lost;
        self.complete_attempt(id, req, success, code, quota_stopped)
    }

    /// Reads the run until it ends, feeding output to the adapter's parser and
    /// relaying stop and quota decisions. Returns its exit, whether quota stopped
    /// it and whether contact with the computer was lost.
    fn follow_remote(
        &self,
        id: &str,
        adapter: &str,
        session: &mut runs::Session,
        computer: &Computer,
        launched: std::time::Instant,
    ) -> (Option<serde_json::Value>, bool, bool) {
        let mut out = 0u64;
        let mut err = 0u64;
        let mut stdout = runs::Lines::new(1_000_000);
        let mut stderr = runs::Lines::new(6000);
        let mut partials = super::claude_session::Partials::new(launched);
        let mut stop_sent = false;
        let mut quota_stopped = false;
        let mut failures = 0u32;
        let mut last_note = std::time::Instant::now();
        let exit = loop {
            let (canceled, quota) = {
                let inner = self.inner.lock().unwrap();
                (
                    inner.canceled.contains(id),
                    inner
                        .runs
                        .get(id)
                        .is_some_and(|run| run.routing.is_some() && run.quota_failure.is_some()),
                )
            };
            if (canceled || quota) && !stop_sent {
                quota_stopped = quota && !canceled;
                stop_sent = session.stop().is_ok();
            }
            if last_note.elapsed() > Duration::from_secs(60) {
                computers::usage::note(&self.computers_root(), &computer.id);
                last_note = std::time::Instant::now();
            }
            match session.read(&mut out, &mut err) {
                Ok(page) => {
                    failures = 0;
                    for (line, truncated) in stdout.push(&page.stdout) {
                        self.remote_event(id, adapter, &mut partials, launched, line, truncated);
                    }
                    for (line, truncated) in stderr.push(&page.stderr) {
                        self.remote_diagnostic(id, line, truncated);
                    }
                    if page.exit.is_some() {
                        break page.exit;
                    }
                }
                Err(error) => {
                    failures += 1;
                    if failures >= READ_FAILURES {
                        self.update(id, |run| {
                            run.error.get_or_insert(format!(
                                "Lost contact with {}: {error}. The agent there stops on its own after ten minutes; its changes were not brought back.",
                                computer.name
                            ));
                        });
                        return (None, quota_stopped, true);
                    }
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        };
        if let Some((line, truncated)) = stdout.finish() {
            self.remote_event(id, adapter, &mut partials, launched, line, truncated);
        }
        if let Some((line, truncated)) = stderr.finish() {
            self.remote_diagnostic(id, line, truncated);
        }
        if adapter == "claude" {
            partials.complete(self, id);
        }
        (exit, quota_stopped, false)
    }

    fn remote_event(
        &self,
        id: &str,
        adapter: &str,
        partials: &mut super::claude_session::Partials,
        launched: std::time::Instant,
        line: String,
        truncated: bool,
    ) {
        if adapter == "claude" && !truncated && partials.consume(self, id, &line) {
            return;
        }
        let _ = self.update_output(id, |r| {
            if !truncated && super::efficiency::useful_event(&line, adapter) {
                r.efficiency.first_activity(launched.elapsed());
            }
            if truncated {
                activity(
                    r,
                    "An oversized agent event was omitted. Inspect the agent session for full output.",
                );
            } else {
                consume_adapter_event(r, &line, adapter);
            }
        });
    }

    fn remote_diagnostic(&self, id: &str, mut line: String, truncated: bool) {
        if truncated {
            line.push_str(" [truncated]");
        }
        let _ = self.update_output(id, |r| r.diagnostics.push(line));
    }
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_000_000.0)
}

/// Files a Git patch touches.
fn patch_files(patch: &[u8]) -> usize {
    patch
        .split(|byte| *byte == b'\n')
        .filter(|line| line.starts_with(b"diff --git "))
        .count()
}

#[cfg(test)]
mod tests {
    #[test]
    fn counts_patch_files() {
        assert_eq!(super::patch_files(b""), 0);
        assert_eq!(
            super::patch_files(b"diff --git a/x b/x\n+1\ndiff --git a/y b/y\n"),
            2
        );
    }
}
