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
        if !startable(&inner, id, workspace)? {
            return Ok(None);
        }
        let (process, value) = start()?;
        if let Some(process) = process {
            inner.processes.insert(id.into(), process);
        }
        Ok(Some(value))
    }

    /// Whether attempt `id`, which starts no local process, may still start
    /// in `workspace`: false when it was already stopped, an error when
    /// another active attempt is using the workspace.
    pub(super) fn claim_workspace(&self, id: &str, workspace: &str) -> Result<bool, String> {
        startable(&self.inner.lock().unwrap(), id, Some(workspace))
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

fn startable(inner: &Inner, id: &str, workspace: Option<&str>) -> Result<bool, String> {
    if inner.canceled.contains(id) {
        return Ok(false);
    }
    if workspace.is_some_and(|workspace| super::runner::workspace_in_use(inner, id, workspace)) {
        return Err(super::runner::WORKSPACE_IN_USE.into());
    }
    Ok(true)
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

/// A file an agent reads its prompt or configuration from, readable only by
/// this user and removed when dropped. It is always created new, so it never
/// follows a link or replaces a file already at its path.
pub(super) struct PrivateFile(PathBuf);

impl PrivateFile {
    pub(super) fn create(path: PathBuf, contents: &str) -> std::io::Result<Self> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path)?;
        let created = Self(path);
        std::io::Write::write_all(&mut file, contents.as_bytes())?;
        Ok(created)
    }
}

impl Drop for PrivateFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod private_file_tests {
    use super::PrivateFile;

    #[test]
    fn a_private_file_is_new_owner_only_and_removed_when_dropped() {
        let folder =
            std::env::temp_dir().join(format!("jackalope-private-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join("prompt");
        let file = PrivateFile::create(path.clone(), "the prompt").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "the prompt");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(PrivateFile::create(path.clone(), "again").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "the prompt");
        drop(file);
        assert!(!path.exists());
        #[cfg(unix)]
        {
            let target = folder.join("target");
            std::fs::write(&target, "kept").unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
            assert!(PrivateFile::create(path.clone(), "redirected").is_err());
            assert_eq!(std::fs::read_to_string(&target).unwrap(), "kept");
        }
        std::fs::remove_dir_all(folder).unwrap();
    }
}
