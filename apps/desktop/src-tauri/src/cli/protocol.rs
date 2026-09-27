//! The protocol between the `jackalope` command and the host that owns the
//! profile, plus the blocking client both ends use to speak it.
//!
//! Compiled directly into the desktop binary and the CLI binary from this one
//! file, so the two can never drift. The CLI deliberately does not link
//! `jackalope_lib`, which would pull in the whole Tauri graph, so everything
//! here stays on `std` plus `serde`.

// Compiled into both binaries, each of which uses a different subset.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

/// Bumped when a request or response shape changes incompatibly. A client that
/// finds a different version refuses to attach rather than guessing.
pub const VERSION: u32 = 1;

/// Matches `identifier` in tauri.conf.json. The lib asserts they agree so this
/// cannot drift; the CLI needs it without loading Tauri's config.
pub const IDENTIFIER: &str = "dev.jackalope.desktop";

/// Written by the host inside its profile at `preferences/host.json`. It is the
/// single rendezvous point: the CLI reads it to attach, and a second app launch
/// reads it to promote the running host instead of starting a rival process.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Handshake {
    pub version: u32,
    pub pid: u32,
    /// Unix domain socket path, or a Windows named pipe name.
    pub endpoint: String,
    /// Whether the host currently shows a window.
    pub windowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "request", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    /// Liveness probe. A handshake file can outlive its host, so clients
    /// confirm someone is actually listening before trusting it.
    Ping,
    /// Raise the host's window, building it first when the host is headless.
    ShowWindow,
    /// Every project the workspace knows about.
    Projects,
    /// The project for a repository, registering it when it is new.
    EnsureProject { path: String },
    /// Open conversations, newest first.
    Sessions,
    /// Begin a conversation in a repository and send its first message. With
    /// no agent, routing picks one.
    StartSession {
        project_path: String,
        text: String,
        #[serde(default)]
        agent: Option<String>,
        /// A model for the agent; absent uses the agent's default. Omitted
        /// when unset so hosts that predate it still accept the request.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    /// Add a message to a conversation.
    Send { session_id: String, text: String },
    /// A conversation and the state of its current work.
    SessionDetail { session_id: String },
    /// `pause`, `resume`, `finish` or `retry`.
    SessionAction { session_id: String, action: String },
    /// Answer a question an agent asked.
    Answer {
        run_id: String,
        prompt_id: String,
        text: String,
    },
    /// Stop the work a conversation is running.
    Stop { run_id: String },
    /// Waits until work changes, then returns. Clients use a second connection
    /// for this so it never blocks their other requests.
    Watch { since: u64 },
    /// Reports which conversation a terminal the app started is showing, so the
    /// app can hand that conversation to another terminal.
    Attached {
        terminal: String,
        session_id: Option<String>,
    },
    /// Which agents are ready and which one routes by default. Probing sign-in
    /// can take seconds, so clients ask on a connection of their own.
    Overview,
    /// A repository's commit authorship settings.
    CommitPolicy { project_path: String },
    /// `user`, `coAuthor` or `agent`.
    SetCommitAttribution {
        project_path: String,
        attribution: String,
    },
    /// Open the app's Changes page on a checkout (the project or a worktree).
    ShowChanges { path: String },
    /// Extract learnings from a conversation's history (up to the previous /learn,
    /// if present) and save them to project context.
    SessionLearn { session_id: String },
    /// Account quota windows, as the app's status bar shows them.
    Usage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    /// The project's theme accent as `#rrggbb`, when the app has one for it.
    #[serde(default)]
    pub accent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub project_id: String,
    pub paused: bool,
    /// Messages waiting to be sent to an agent.
    pub pending: usize,
    pub error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    /// `you` or `agent`. An agent message carries the output of the work the
    /// preceding messages started.
    pub role: String,
    pub text: String,
    /// Whether this message has been dispatched to an agent yet.
    pub sent: bool,
    /// For an agent message, which attempt produced it when the work was
    /// retried; absent when there was only one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub run_id: String,
    pub question: String,
    pub options: Vec<String>,
}

/// What the terminal needs to render a conversation: the exchange, the work
/// currently running, and why Jackalope chose the agent it did.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub title: String,
    pub paused: bool,
    pub error: Option<String>,
    pub messages: Vec<Message>,
    pub run_id: Option<String>,
    pub status: Option<String>,
    pub agent: Option<String>,
    pub account: Option<String>,
    pub model: Option<String>,
    /// Why routing picked this agent, when it chose one.
    pub routing: Option<String>,
    /// The step work is on, such as preparing a workspace or starting an agent.
    pub step: Option<String>,
    pub step_detail: Option<String>,
    pub attempt: Option<u32>,
    pub workspace: Option<String>,
    pub branch: Option<String>,
    /// The agent's output so far.
    pub result: String,
    pub questions: Vec<Question>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub id: String,
    pub name: String,
    /// `ready`, `sign-in`, `installed`, `missing` or `disabled`.
    pub state: String,
    pub account: String,
    pub detail: String,
    /// Models configured for this agent in the app; empty when none are listed.
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub default_model: String,
}

/// One account's quota, as last observed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageAccount {
    pub agent: String,
    pub account: String,
    /// The capacity reader's status, such as `available` or `unavailable`.
    pub status: String,
    pub detail: String,
    pub observed_at: Option<String>,
    pub windows: Vec<UsageWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub name: String,
    pub used_percent: Option<f64>,
    /// Unix seconds.
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "response", rename_all = "kebab-case")]
pub enum Response {
    Ok,
    Error {
        message: String,
    },
    Projects {
        projects: Vec<Project>,
    },
    Project {
        project: Project,
    },
    Sessions {
        sessions: Vec<SessionSummary>,
    },
    Session {
        revision: u64,
        // Boxed: far larger than every other response.
        session: Box<SessionView>,
    },
    Started {
        session_id: String,
    },
    /// Work changed; the client re-reads what it is showing.
    Changed {
        revision: u64,
    },
    Overview {
        agents: Vec<AgentStatus>,
        default_agent: String,
    },
    CommitPolicy {
        attribution: String,
        name: String,
        email: String,
    },
    /// Result of extracting and saving learnings from a session.
    Learned {
        count: usize,
        lessons: Vec<String>,
        message: String,
    },
    Usage {
        accounts: Vec<UsageAccount>,
    },
}

impl Response {
    pub fn error(message: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
        }
    }
}

/// Run statuses that mean an agent is still going.
pub const WORKING: &[&str] = &["starting", "running", "routing", "queued", "stopping"];
/// Run statuses for work someone stopped before it finished.
pub const STOPPED: &[&str] = &["stopped", "cancelled", "canceled", "interrupted"];
/// Run statuses for work that ended in failure.
pub const FAILED: &[&str] = &["failed", "error"];

pub fn working(status: Option<&str>) -> bool {
    status.is_some_and(|status| WORKING.contains(&status))
}

/// An error worth showing. Stored errors can be blank, and older records hold
/// the literal text `null`.
pub fn present(error: Option<&str>) -> Option<&str> {
    error.filter(|error| !error.trim().is_empty() && *error != "null")
}

/// The profile root: the explicit override when set, else the platform's
/// per-user application data directory. Mirrors the resolution in `lib.rs`.
pub fn profile_root() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
        let path = PathBuf::from(explicit);
        return path.is_absolute().then_some(path);
    }
    let home = PathBuf::from(std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?);
    #[cfg(target_os = "macos")]
    let root = home.join("Library/Application Support");
    #[cfg(target_os = "linux")]
    let root = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"));
    #[cfg(windows)]
    let root = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData/Roaming"));
    Some(root.join(IDENTIFIER))
}

/// Where the host advertises itself.
pub fn handshake_path() -> Option<PathBuf> {
    Some(profile_root()?.join("task-runs-v1/preferences/host.json"))
}

/// Reads the advertisement without contacting anyone. A handshake can outlive
/// its host, so callers still have to connect before trusting it.
pub fn read_handshake() -> Option<Handshake> {
    let bytes = std::fs::read(handshake_path()?).ok()?;
    let handshake = serde_json::from_slice::<Handshake>(&bytes).ok()?;
    (handshake.version == VERSION).then_some(handshake)
}

#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;
#[cfg(windows)]
type Stream = std::fs::File;

/// Longest wait for one response. The host answers `watch` within 25 seconds
/// even when nothing changes, so anything slower means it is wedged.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(40);

#[cfg(unix)]
fn open(endpoint: &str) -> std::io::Result<Stream> {
    std::os::unix::net::UnixStream::connect(endpoint)
}

#[cfg(windows)]
fn open(endpoint: &str) -> std::io::Result<Stream> {
    // ERROR_PIPE_BUSY: every instance is taken for a moment while the host
    // stands up the next one. Waiting briefly beats reporting it as absent.
    const PIPE_BUSY: i32 = 231;
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(endpoint)
        {
            Err(error)
                if error.raw_os_error() == Some(PIPE_BUSY)
                    && std::time::Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(50));
            }
            result => return result,
        }
    }
}

/// A connection to the running host. One request per line, one response per
/// line, in order.
///
/// A thread of its own writes each request and reads its response, so a
/// wedged host times out on every platform: Windows pipes opened as files have
/// no read timeout. The same thread does both because synchronous I/O on a
/// Windows pipe is serialised, so a read waiting on one thread would hold up a
/// write from another.
pub struct Client {
    requests: Option<mpsc::Sender<Vec<u8>>>,
    responses: Receiver<std::io::Result<String>>,
    /// Set once a response is lost, since any later line would answer the
    /// wrong request.
    broken: bool,
    worker: std::thread::JoinHandle<()>,
    /// Shut down on drop to end a read the worker is blocked in.
    #[cfg(unix)]
    socket: Stream,
}

impl Client {
    pub fn connect(endpoint: &str) -> Result<Self, String> {
        let stream = open(endpoint).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        let socket = stream.try_clone().map_err(|error| error.to_string())?;
        let (requests, pending) = mpsc::channel::<Vec<u8>>();
        let (answer, responses) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let mut stream = BufReader::new(stream);
            while let Ok(request) = pending.recv() {
                let exchanged = stream
                    .get_mut()
                    .write_all(&request)
                    .and_then(|()| stream.get_mut().flush())
                    .and_then(|()| {
                        let mut line = String::new();
                        match stream.read_line(&mut line)? {
                            0 => Err(std::io::ErrorKind::UnexpectedEof.into()),
                            _ => Ok(line),
                        }
                    });
                let failed = exchanged.is_err();
                if answer.send(exchanged).is_err() || failed {
                    return;
                }
            }
        });
        Ok(Self {
            requests: Some(requests),
            responses,
            broken: false,
            worker,
            #[cfg(unix)]
            socket,
        })
    }

    pub fn send(&mut self, request: &Request) -> Result<Response, String> {
        if self.broken {
            return Err("The connection to Jackalope was lost.".into());
        }
        let mut encoded = serde_json::to_vec(request).map_err(|error| error.to_string())?;
        encoded.push(b'\n');
        let sent = self
            .requests
            .as_ref()
            .is_some_and(|requests| requests.send(encoded).is_ok());
        let line = match sent.then(|| self.responses.recv_timeout(RESPONSE_TIMEOUT)) {
            Some(Ok(Ok(line))) => line,
            Some(Ok(Err(error))) if error.kind() != std::io::ErrorKind::UnexpectedEof => {
                self.broken = true;
                return Err(error.to_string());
            }
            Some(Err(RecvTimeoutError::Timeout)) => {
                self.broken = true;
                return Err("Jackalope did not answer in time.".into());
            }
            _ => {
                self.broken = true;
                return Err("The Jackalope host closed the connection.".into());
            }
        };
        serde_json::from_str(&line).map_err(|error| error.to_string())
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        // An idle worker ends when its requests stop; one blocked on a
        // wedged host is interrupted so the connection closes now.
        self.requests = None;
        if self.worker.is_finished() {
            return;
        }
        #[cfg(unix)]
        let _ = self.socket.shutdown(std::net::Shutdown::Both);
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            // SAFETY: the join handle keeps the thread handle valid, and
            // cancelling a thread's synchronous I/O only makes that call
            // return an error, which ends the worker.
            unsafe {
                windows_sys::Win32::System::IO::CancelSynchronousIo(self.worker.as_raw_handle());
            }
        }
    }
}

/// Connects to the advertised host and proves it is alive. Returns `None` when
/// nothing is running, including when a stale handshake outlived its host.
pub fn attach() -> Option<(Handshake, Client)> {
    let handshake = read_handshake()?;
    let mut client = Client::connect(&handshake.endpoint).ok()?;
    matches!(client.send(&Request::Ping), Ok(Response::Ok)).then_some((handshake, client))
}
