//! Resident native helper: one long-lived process per desktop session that
//! answers JSON-lines requests, so actions avoid a process start each time.
//! Requests are `{"id":n,...}` lines; responses are `{"id":n,"ok":bool,
//! "result"|"error"}` lines. Lines with another ID or invalid JSON are skipped.
//! Cancellation, timeouts and unexpected exit kill the process; the next call
//! starts a fresh one. Uncertain input is never replayed.

use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};

/// A helper process command and the lines it reads before serving requests.
pub(crate) struct Launch {
    pub command: Command,
    pub preamble: Vec<String>,
}

pub(crate) type Launcher = Arc<dyn Fn() -> Result<Launch, String> + Send + Sync>;

/// How long an unused helper stays alive before the janitor stops it.
pub(crate) const IDLE: Duration = Duration::from_secs(180);
const START_TIMEOUT: Duration = Duration::from_secs(45);
const LINE_LIMIT: usize = 8 * 1024 * 1024;

struct Running {
    child: Child,
    tree: super::super::process_control::ProcessTree,
    stdin: ChildStdin,
    lines: mpsc::Receiver<String>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) struct Helper {
    launcher: Launcher,
    running: Option<Running>,
    next_id: u64,
    last_used: Instant,
    /// Processes started by this helper, including restarts after a crash.
    pub starts: u32,
    /// Processes that completed the protocol handshake.
    pub ready: u32,
}

/// Failure of a helper call. `uncertain` means a request was delivered and
/// the process stopped before answering, so the action may have happened.
#[derive(Debug)]
pub(crate) struct CallError {
    pub message: String,
    pub uncertain: bool,
}

impl From<CallError> for String {
    fn from(error: CallError) -> Self {
        error.message
    }
}

impl Helper {
    pub fn new(launcher: Launcher) -> Self {
        Self {
            launcher,
            running: None,
            next_id: 0,
            last_used: Instant::now(),
            starts: 0,
            ready: 0,
        }
    }

    pub fn alive(&mut self) -> bool {
        match self.running.as_mut() {
            Some(running) => matches!(running.child.try_wait(), Ok(None)),
            None => false,
        }
    }

    pub fn shutdown(&mut self) {
        self.running = None;
    }

    /// Stops the process when it has been unused for `idle`. Returns whether it stopped.
    pub fn shutdown_if_idle(&mut self, idle: Duration) -> bool {
        if self.running.is_some() && self.last_used.elapsed() >= idle {
            self.shutdown();
            return true;
        }
        false
    }

    fn start(&mut self, canceled: &AtomicBool) -> Result<(), CallError> {
        let fail = |message: String| CallError {
            message,
            uncertain: false,
        };
        let Launch {
            mut command,
            preamble,
        } = (self.launcher)().map_err(fail)?;
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command
            .spawn()
            .map_err(|e| fail(format!("The desktop helper could not start: {e}")))?;
        let tree = match super::super::process_control::ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(fail(error));
            }
        };
        let stdout = child.stdout.take().expect("piped stdout");
        let stdin = child.stdin.take().expect("piped stdin");
        let (sender, lines) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match std::io::Read::take(&mut reader, LINE_LIMIT as u64).read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        if sender.send(line).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        self.running = Some(Running {
            child,
            tree,
            stdin,
            lines,
        });
        self.starts += 1;
        let running = self.running.as_mut().unwrap();
        for line in preamble {
            if writeln!(running.stdin, "{line}").is_err() {
                self.shutdown();
                return Err(fail("The desktop helper stopped during start-up.".into()));
            }
        }
        match self.exchange(&json!({"action":"hello"}), START_TIMEOUT, canceled) {
            Ok(value) if value["protocol"] == 1 => {
                self.ready += 1;
                Ok(())
            }
            Ok(_) => {
                self.shutdown();
                Err(fail(
                    "The desktop helper speaks an unknown protocol.".into(),
                ))
            }
            Err(error) => {
                self.shutdown();
                Err(fail(error.message))
            }
        }
    }

    /// Sends one request, starting the helper first when none is running.
    pub fn call(
        &mut self,
        payload: &Value,
        timeout: Duration,
        canceled: &AtomicBool,
    ) -> Result<Value, CallError> {
        if canceled.load(Ordering::SeqCst) {
            return Err(CallError {
                message: "Desktop access was revoked.".into(),
                uncertain: false,
            });
        }
        if !self.alive() {
            self.shutdown();
            self.start(canceled)?;
        }
        self.last_used = Instant::now();
        let result = self.exchange(payload, timeout, canceled);
        self.last_used = Instant::now();
        result
    }

    fn exchange(
        &mut self,
        payload: &Value,
        timeout: Duration,
        canceled: &AtomicBool,
    ) -> Result<Value, CallError> {
        self.next_id += 1;
        let id = self.next_id;
        let mut message = payload.clone();
        message["id"] = json!(id);
        let running = self.running.as_mut().ok_or(CallError {
            message: "The desktop helper is not running.".into(),
            uncertain: false,
        })?;
        if writeln!(running.stdin, "{message}")
            .and_then(|_| running.stdin.flush())
            .is_err()
        {
            self.shutdown();
            return Err(CallError {
                message: "The desktop helper stopped before receiving the action. Try again."
                    .into(),
                uncertain: false,
            });
        }
        let deadline = Instant::now() + timeout;
        loop {
            if canceled.load(Ordering::SeqCst) {
                self.shutdown();
                return Err(CallError {
                    message: "Desktop access was revoked. An in-flight action may have occurred; do not replay it.".into(),
                    uncertain: true,
                });
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                self.shutdown();
                return Err(CallError {
                    message: "The desktop operation timed out. Inspect the window before retrying; an action may have occurred.".into(),
                    uncertain: true,
                });
            }
            let lines = &self.running.as_ref().unwrap().lines;
            match lines.recv_timeout(remaining.min(Duration::from_millis(50))) {
                Ok(line) => {
                    let Ok(response) =
                        serde_json::from_str::<Value>(line.trim_start_matches('\u{feff}').trim())
                    else {
                        continue;
                    };
                    if response["id"] != json!(id) {
                        continue;
                    }
                    return if response["ok"] == true {
                        Ok(response["result"].clone())
                    } else {
                        Err(CallError {
                            message: response["error"]
                                .as_str()
                                .unwrap_or("The desktop helper failed.")
                                .chars()
                                .take(1200)
                                .collect(),
                            uncertain: false,
                        })
                    };
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.shutdown();
                    return Err(CallError {
                        message: "The desktop helper stopped unexpectedly. Inspect the window before retrying; an action may have occurred.".into(),
                        uncertain: true,
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A JSON-lines fixture helper: answers hello, echoes `value`, fails on
    /// `fail`, exits on `crash` and never answers `hang`.
    fn fixture() -> Launcher {
        Arc::new(|| {
            #[cfg(windows)]
            let command = {
                use std::os::windows::process::CommandExt;
                let script = "$ErrorActionPreference='Stop';while(($l=[Console]::In.ReadLine()) -ne $null){$r=$l|ConvertFrom-Json;switch($r.action){'hello'{'{\"id\":'+$r.id+',\"ok\":true,\"result\":{\"protocol\":1}}'}'crash'{exit 3}'hang'{Start-Sleep 30}'fail'{'{\"id\":'+$r.id+',\"ok\":false,\"error\":\"fixture failure\"}'}default{'noise';'{\"id\":'+$r.id+',\"ok\":true,\"result\":{\"value\":'+$r.value+',\"pid\":'+$PID+'}}'}};[Console]::Out.Flush()}";
                let mut command = Command::new(
                    std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
                        .join("System32/WindowsPowerShell/v1.0/powershell.exe"),
                );
                command
                    .args(["-NoProfile", "-NonInteractive", "-Command", script])
                    .creation_flags(0x08000000);
                command
            };
            #[cfg(unix)]
            let command = {
                use std::os::unix::process::CommandExt;
                let script = r#"while IFS= read -r line; do id=$(printf %s "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p'); case "$line" in *'"hello"'*) echo "{\"id\":$id,\"ok\":true,\"result\":{\"protocol\":1}}";; *'"crash"'*) exit 3;; *'"hang"'*) sleep 30;; *'"fail"'*) echo "{\"id\":$id,\"ok\":false,\"error\":\"fixture failure\"}";; *) value=$(printf %s "$line" | sed -n 's/.*"value":\([0-9]*\).*/\1/p'); echo noise; echo "{\"id\":$id,\"ok\":true,\"result\":{\"value\":$value,\"pid\":$$}}";; esac; done"#;
                let mut command = Command::new("/bin/sh");
                command.args(["-c", script]).process_group(0);
                command
            };
            Ok(Launch {
                command,
                preamble: Vec::new(),
            })
        })
    }

    #[test]
    fn resident_helper_reuses_restarts_and_stops_when_idle() {
        let canceled = AtomicBool::new(false);
        let mut helper = Helper::new(fixture());
        let timeout = Duration::from_secs(20);
        let first = helper
            .call(&json!({"action":"echo","value":1}), timeout, &canceled)
            .unwrap();
        assert_eq!(first["value"], 1);
        let second = helper
            .call(&json!({"action":"echo","value":2}), timeout, &canceled)
            .unwrap();
        assert_eq!(second["value"], 2);
        assert_eq!(first["pid"], second["pid"], "the process is reused");
        assert_eq!(helper.starts, 1);

        let failed = helper
            .call(&json!({"action":"fail"}), timeout, &canceled)
            .unwrap_err();
        assert_eq!(failed.message, "fixture failure");
        assert!(!failed.uncertain);
        assert!(helper.alive(), "an action error keeps the helper");

        let crashed = helper
            .call(&json!({"action":"crash"}), timeout, &canceled)
            .unwrap_err();
        assert!(crashed.uncertain, "{}", crashed.message);
        let restarted = helper
            .call(&json!({"action":"echo","value":3}), timeout, &canceled)
            .unwrap();
        assert_eq!(restarted["value"], 3);
        assert_ne!(restarted["pid"], first["pid"]);
        assert_eq!(helper.starts, 2);

        assert!(!helper.shutdown_if_idle(Duration::from_secs(3600)));
        assert!(helper.alive());
        assert!(helper.shutdown_if_idle(Duration::ZERO));
        assert!(!helper.alive());
        helper
            .call(&json!({"action":"echo","value":4}), timeout, &canceled)
            .unwrap();
        assert_eq!(helper.starts, 3);
    }

    #[test]
    fn resident_helper_kills_hung_or_revoked_actions() {
        let canceled = AtomicBool::new(false);
        let mut helper = Helper::new(fixture());
        helper
            .call(
                &json!({"action":"echo","value":1}),
                Duration::from_secs(20),
                &canceled,
            )
            .unwrap();
        let hung = helper
            .call(
                &json!({"action":"hang"}),
                Duration::from_millis(300),
                &canceled,
            )
            .unwrap_err();
        assert!(hung.uncertain && hung.message.contains("timed out"));
        assert!(!helper.alive());
        canceled.store(true, Ordering::SeqCst);
        let revoked = helper
            .call(
                &json!({"action":"echo","value":1}),
                Duration::from_secs(20),
                &canceled,
            )
            .unwrap_err();
        assert!(revoked.message.contains("revoked"));
        assert_eq!(helper.starts, 1, "a revoked session never restarts");
    }

    #[test]
    fn resident_helper_reports_a_missing_executable() {
        let mut helper = Helper::new(Arc::new(|| {
            Ok(Launch {
                command: Command::new("jackalope-missing-desktop-helper"),
                preamble: Vec::new(),
            })
        }));
        let error = helper
            .call(
                &json!({"action":"echo"}),
                Duration::from_secs(5),
                &AtomicBool::new(false),
            )
            .unwrap_err();
        assert!(error.message.contains("could not start"));
        assert!(!error.uncertain);
    }
}
