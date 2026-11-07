//! An agent CLI process: the child, the process tree it heads and the managed
//! runtime lease that keeps its executable installed while it runs. Attempts
//! register theirs with the runtime, so stopping an attempt ends the whole
//! tree.

use super::*;
use crate::commands::{managed_runtime::UseGuard, process_control::ProcessTree};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, ExitStatus};

/// The longest the agent's stdout lines may be before they are clipped.
pub(super) const STDOUT_LINE_LIMIT: usize = 1_000_000;
/// The longest an agent's diagnostic (stderr) line may be before it is clipped.
pub(super) const STDERR_LINE_LIMIT: usize = 6000;

pub(in crate::commands) struct AgentProcess {
    child: Mutex<Child>,
    tree: ProcessTree,
    _lease: Option<UseGuard>,
}

/// A process just started, with the streams it was given.
pub(in crate::commands) struct Spawned {
    pub process: Arc<AgentProcess>,
    pub stdin: Option<ChildStdin>,
    pub stdout: Option<ChildStdout>,
    pub stderr: Option<ChildStderr>,
    /// How many tries the launch took.
    pub attempts: u32,
    pub elapsed: Duration,
}

impl AgentProcess {
    /// Starts `command` for `agent` at the head of its own process tree,
    /// retrying a transient failure (an antivirus or indexer lock on the
    /// executable, `ETXTBSY` just after a write) up to 3 times. A missing
    /// executable is not retried.
    pub(in crate::commands) fn spawn(
        command: &mut Command,
        agent: &str,
    ) -> Result<Spawned, String> {
        let lease =
            crate::commands::managed_runtime::acquire(std::path::Path::new(command.get_program()))?;
        let started = std::time::Instant::now();
        let mut last: Option<std::io::Error> = None;
        let mut spawned = None;
        for attempt in 1..=3u32 {
            match command.spawn() {
                Ok(child) => {
                    spawned = Some((child, attempt));
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Err(format!("Could not launch {agent}: {error}"));
                }
                Err(error) => {
                    last = Some(error);
                    if attempt < 3 {
                        std::thread::sleep(Duration::from_millis(150));
                    }
                }
            }
        }
        let Some((mut child, attempts)) = spawned else {
            return Err(format!(
                "Could not launch {agent} after 3 attempts: {}",
                last.map_or_else(String::new, |error| error.to_string())
            ));
        };
        let elapsed = started.elapsed();
        let tree = match ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let (stdin, stdout, stderr) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take());
        Ok(Spawned {
            process: Arc::new(Self {
                child: Mutex::new(child),
                tree,
                _lease: lease,
            }),
            stdin,
            stdout,
            stderr,
            attempts,
            elapsed,
        })
    }

    pub(in crate::commands) fn try_wait(&self) -> std::io::Result<Option<ExitStatus>> {
        self.child.lock().unwrap().try_wait()
    }

    #[cfg(test)]
    pub(in crate::commands) fn id(&self) -> u32 {
        self.child.lock().unwrap().id()
    }

    pub(in crate::commands) fn alive(&self) -> bool {
        self.try_wait().is_ok_and(|status| status.is_none())
    }

    /// Ends the process and everything it started.
    pub(in crate::commands) fn terminate(&self) {
        self.tree.terminate();
        let _ = self.child.lock().unwrap().kill();
    }

    /// Ends the process tree and reaps the process.
    pub(in crate::commands) fn finish(&self) -> std::io::Result<ExitStatus> {
        self.terminate();
        self.child.lock().unwrap().wait()
    }
}

impl Drop for AgentProcess {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

impl TaskRuntime {
    /// Runs `start` under the runtime lock and registers the process it
    /// returns as attempt `id`'s, so [`TaskRuntime::stop`] ends its tree.
    /// Refuses a `workspace` another active attempt is using; holding the lock
    /// means no other attempt can take it in between. `None`, without running
    /// `start`, when the attempt was already stopped.
    pub(super) fn register_process<T>(
        &self,
        id: &str,
        workspace: Option<&str>,
        start: impl FnOnce() -> Result<(Option<Arc<AgentProcess>>, T), String>,
    ) -> Result<Option<T>, String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.canceled.contains(id) {
            return Ok(None);
        }
        if workspace.is_some_and(|workspace| super::runner::workspace_in_use(&inner, id, workspace))
        {
            return Err(super::runner::WORKSPACE_IN_USE.into());
        }
        let (process, value) = start()?;
        if let Some(process) = process {
            inner.processes.insert(id.into(), process);
        }
        Ok(Some(value))
    }

    pub(super) fn unregister_process(&self, id: &str) {
        self.inner.lock().unwrap().processes.remove(id);
    }

    /// Whether attempt `id` was not stopped and its agent process still runs.
    pub(super) fn process_alive(&self, id: &str) -> bool {
        let inner = self.inner.lock().unwrap();
        !inner.canceled.contains(id) && inner.processes.get(id).is_some_and(|p| p.alive())
    }

    /// Records that attempt `id`'s agent process is now running.
    pub(super) fn process_started(
        &self,
        id: &str,
        elapsed: Duration,
        attempts: u32,
        update: impl FnOnce(&mut TaskRun),
    ) -> Result<(), String> {
        self.update_checked(id, |run| {
            run.efficiency.timing("processSpawn", elapsed);
            run.process_contained = cfg!(windows);
            if run.status == RunStatus::Starting {
                run.status = RunStatus::Running;
            }
            // The agent is live now; its own activity replaces the startup step.
            run.progress = None;
            if attempts > 1 {
                activity(
                    run,
                    &format!("The agent process started after {attempts} attempts."),
                );
            }
            update(run);
        })
    }
}

/// Reads `stdout` line by line, each clipped to [`STDOUT_LINE_LIMIT`].
pub(super) fn read_lines(
    stdout: impl std::io::Read,
    consume: impl FnMut(String, bool),
) -> std::io::Result<()> {
    crate::commands::process_control::bounded_lines(
        BufReader::new(stdout),
        STDOUT_LINE_LIMIT,
        consume,
    )
}

/// Reads `stderr` line by line, each clipped to [`STDERR_LINE_LIMIT`] and
/// marked when it was.
pub(super) fn read_diagnostics(stderr: impl std::io::Read, mut consume: impl FnMut(String)) {
    let _ = crate::commands::process_control::bounded_lines(
        BufReader::new(stderr),
        STDERR_LINE_LIMIT,
        |mut line, truncated| {
            if truncated {
                line.push_str(" [truncated]");
            }
            consume(line);
        },
    );
}
