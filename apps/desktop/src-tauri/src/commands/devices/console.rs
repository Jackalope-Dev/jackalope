//! The console of the last app launched on a device from each conversation.
//!
//! A launch runs `devicectl device process launch --console`, which relays the app's
//! standard output and error and waits for it to exit. Jackalope owns that process:
//! it keeps the output in a bounded log, stops capturing after the requested time,
//! on detach, on a new launch or when Jackalope quits. Stopping kills `devicectl`
//! outright so it forwards no signal, and the app keeps running on the device.

use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::super::{process_control, xcode};
use super::devicectl;

const MAX_LINES: usize = 4000;
const MAX_BYTES: usize = 512 * 1024;
const LINE_CHARS: usize = 2000;
/// The longest an app's console is captured.
pub const MAX_SECONDS: u64 = 30 * 60;

#[derive(Debug, Default)]
pub struct Log {
    lines: VecDeque<String>,
    /// The number of the first kept line; earlier ones were dropped to stay bounded.
    first: u64,
    bytes: usize,
    partial: [Vec<u8>; 2],
}

impl Log {
    /// Adds output from one stream (0 for stdout, 1 for stderr).
    pub fn push(&mut self, bytes: &[u8], stream: usize) {
        self.partial[stream].extend_from_slice(bytes);
        while let Some(end) = self.partial[stream].iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.partial[stream].drain(..=end).collect();
            let line = String::from_utf8_lossy(&line)
                .trim_end_matches(['\r', '\n'])
                .to_owned();
            self.line(line);
        }
        if self.partial[stream].len() > LINE_CHARS * 4 {
            let rest = std::mem::take(&mut self.partial[stream]);
            self.line(String::from_utf8_lossy(&rest).into_owned());
        }
    }

    /// Ends any unfinished lines.
    pub fn flush(&mut self) {
        for stream in 0..2 {
            let rest = std::mem::take(&mut self.partial[stream]);
            if !rest.is_empty() {
                self.line(String::from_utf8_lossy(&rest).into_owned());
            }
        }
    }

    pub fn line(&mut self, line: String) {
        let line: String = line.chars().take(LINE_CHARS).collect();
        self.bytes += line.len();
        self.lines.push_back(line);
        while self.lines.len() > MAX_LINES || self.bytes > MAX_BYTES {
            let Some(dropped) = self.lines.pop_front() else {
                break;
            };
            self.bytes -= dropped.len();
            self.first += 1;
        }
    }

    /// The number the next line will get.
    pub fn next(&self) -> u64 {
        self.first + self.lines.len() as u64
    }

    /// Up to `limit` lines from line `from`, or the last `limit` lines. Returns the
    /// lines, the number of the first one and whether lines before it were dropped.
    pub fn read(&self, from: Option<u64>, limit: usize) -> (Vec<String>, u64, bool) {
        let end = self.next();
        let start = from
            .unwrap_or_else(|| end.saturating_sub(limit as u64))
            .clamp(self.first, end);
        let skip = (start - self.first) as usize;
        let lines = self.lines.iter().skip(skip).take(limit).cloned().collect();
        (lines, start, from.is_some_and(|from| from < self.first))
    }
}

/// How a capture ended.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ended {
    pub message: String,
    /// The launch itself failed; the app may not have started.
    pub failed: bool,
}

#[derive(Debug)]
pub struct Session {
    pub device_id: String,
    pub device: String,
    pub bundle_id: String,
    pub started_at: String,
    pub log: Mutex<Log>,
    pub ended: Mutex<Option<Ended>>,
    pub pid: Mutex<Option<u64>>,
    stop: AtomicBool,
}

impl Session {
    pub fn running(&self) -> bool {
        self.ended
            .lock()
            .map(|ended| ended.is_none())
            .unwrap_or(false)
    }

    pub fn ended(&self) -> Option<Ended> {
        self.ended.lock().ok()?.clone()
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    /// Waits until the capture ends or `wait` passes.
    pub fn wait(&self, wait: Duration) {
        let deadline = Instant::now() + wait;
        while self.running() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<Session>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
    SESSIONS.get_or_init(Mutex::default)
}

pub fn session(key: &str) -> Option<Arc<Session>> {
    sessions().lock().ok()?.get(key).cloned()
}

/// Stops the capture under `key`, keeping its log readable.
pub fn stop(key: &str) {
    if let Some(session) = session(key) {
        session.stop();
    }
}

/// Launches `bundle_id` with its console captured for up to `seconds`, replacing the
/// conversation's earlier capture. `changed` is called as output arrives and when it ends.
pub fn launch(
    key: &str,
    device_id: &str,
    device: &str,
    bundle_id: &str,
    arguments: Vec<String>,
    seconds: u64,
    changed: impl Fn() + Send + Sync + 'static,
) -> Arc<Session> {
    let session = Arc::new(Session {
        device_id: device_id.to_owned(),
        device: device.to_owned(),
        bundle_id: bundle_id.to_owned(),
        started_at: chrono::Utc::now().to_rfc3339(),
        log: Mutex::default(),
        ended: Mutex::default(),
        pid: Mutex::default(),
        stop: AtomicBool::new(false),
    });
    if let Ok(mut map) = sessions().lock() {
        if let Some(previous) = map.insert(key.to_owned(), session.clone()) {
            previous.stop();
        }
    }
    let seconds = seconds.clamp(1, MAX_SECONDS);
    let running = session.clone();
    std::thread::spawn(move || {
        let changed = Arc::new(changed);
        let json = devicectl::json_path();
        let mut command = xcode::xcrun("devicectl");
        command.args(devicectl::launch_args(
            &running.device_id,
            &running.bundle_id,
            true,
            &arguments,
            &json,
        ));
        let observer = running.clone();
        let notify = changed.clone();
        let stopper = running.clone();
        let ran = process_control::run_supervised(
            command,
            process_control::Limits::total(Duration::from_secs(seconds)),
            move || stopper.stop.load(Ordering::Relaxed),
            move |bytes, stderr| {
                if let Ok(mut log) = observer.log.lock() {
                    log.push(bytes, usize::from(stderr));
                }
                notify();
            },
        );
        let output = devicectl::take_json(&json);
        if let Ok(mut log) = running.log.lock() {
            log.flush();
        }
        if let Some(pid) = output
            .as_ref()
            .and_then(|output| devicectl::launched_pid(&output["result"]))
        {
            if let Ok(mut slot) = running.pid.lock() {
                *slot = Some(pid);
            }
        }
        let ended = ending(&running, ran, output.as_ref(), seconds);
        if let Ok(mut slot) = running.ended.lock() {
            *slot = Some(ended);
        }
        changed();
    });
    session
}

fn ending(
    session: &Session,
    ran: Result<process_control::CommandResult, String>,
    output: Option<&serde_json::Value>,
    seconds: u64,
) -> Ended {
    let stopped = |message: String| Ended {
        message,
        failed: false,
    };
    let ran = match ran {
        Ok(ran) => ran,
        Err(error) => {
            return Ended {
                message: format!("devicectl could not start: {error}"),
                failed: true,
            }
        }
    };
    if ran.timed_out {
        return stopped(format!(
            "Console capture stopped after {seconds} seconds; the app keeps running."
        ));
    }
    if session.stop.load(Ordering::Relaxed) {
        return stopped("Console capture stopped; the app keeps running.".into());
    }
    match output.map(|output| devicectl::outcome(output, &session.device, "launch the app")) {
        Some(Ok(result)) => {
            stopped(devicectl::termination(&result).unwrap_or_else(|| "The app exited.".into()))
        }
        Some(Err(error)) => Ended {
            message: error,
            failed: true,
        },
        None => {
            let said = [ran.stderr.trim(), ran.stdout.trim()]
                .into_iter()
                .find(|text| !text.is_empty())
                .unwrap_or("no output");
            Ended {
                message: format!(
                    "devicectl could not launch the app: {}",
                    said.chars().take(600).collect::<String>()
                ),
                failed: true,
            }
        }
    }
}
