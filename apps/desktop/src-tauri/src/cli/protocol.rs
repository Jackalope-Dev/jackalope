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
}

impl Response {
    pub fn error(message: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
        }
    }
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

#[cfg(unix)]
fn open(endpoint: &str) -> std::io::Result<Stream> {
    let stream = std::os::unix::net::UnixStream::connect(endpoint)?;
    // A wedged host must not hang the terminal indefinitely.
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    Ok(stream)
}

#[cfg(windows)]
fn open(endpoint: &str) -> std::io::Result<Stream> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(endpoint)
}

/// A connection to the running host. One request per line, one response per
/// line, in order.
pub struct Client {
    reader: BufReader<Stream>,
    writer: Stream,
}

impl Client {
    pub fn connect(endpoint: &str) -> Result<Self, String> {
        let writer = open(endpoint).map_err(|error| error.to_string())?;
        let reader = writer.try_clone().map_err(|error| error.to_string())?;
        Ok(Self {
            reader: BufReader::new(reader),
            writer,
        })
    }

    pub fn send(&mut self, request: &Request) -> Result<Response, String> {
        let mut encoded = serde_json::to_vec(request).map_err(|error| error.to_string())?;
        encoded.push(b'\n');
        self.writer
            .write_all(&encoded)
            .map_err(|error| error.to_string())?;
        self.writer.flush().map_err(|error| error.to_string())?;
        let mut line = String::new();
        if self
            .reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            return Err("The Jackalope host closed the connection.".into());
        }
        serde_json::from_str(&line).map_err(|error| error.to_string())
    }
}

/// Connects to the advertised host and proves it is alive. Returns `None` when
/// nothing is running, including when a stale handshake outlived its host.
pub fn attach() -> Option<(Handshake, Client)> {
    let handshake = read_handshake()?;
    let mut client = Client::connect(&handshake.endpoint).ok()?;
    matches!(client.send(&Request::Ping), Ok(Response::Ok)).then_some((handshake, client))
}
