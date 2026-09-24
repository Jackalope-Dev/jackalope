//! Serves the `jackalope` command from the process that owns the profile.
//!
//! Only one process may hold a profile — `TaskRuntime` and `Coordinator` each
//! take an exclusive file lock — so the CLI never opens the profile itself. It
//! connects here instead, which also means CLI clients inherit the host's
//! approved-account lease rather than needing their own.

use crate::cli_protocol as protocol;
use crate::cli_protocol::{Handshake, Request, Response, VERSION};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use super::live_sessions::{LiveSession, LiveSessions};
use super::tasks::{TaskRun, TaskRuntime};

/// Owns the listening endpoint and the handshake file, and removes both on
/// shutdown so a later run never trusts a dead host's advertisement.
pub struct CliHost {
    handshake: PathBuf,
    /// The private directory holding the Unix socket; nothing on Windows,
    /// where the endpoint is a named pipe rather than a filesystem path.
    directory: Option<PathBuf>,
}

impl CliHost {
    pub fn shutdown(&self) {
        let _ = std::fs::remove_file(&self.handshake);
        if let Some(directory) = &self.directory {
            // Bounded and explicit: remove the socket we created, then the one
            // directory that held it. Never a recursive delete.
            let _ = std::fs::remove_file(directory.join(SOCKET));
            let _ = std::fs::remove_dir(directory);
        }
    }
}

#[cfg(unix)]
const SOCKET: &str = "cli.sock";
#[cfg(windows)]
const SOCKET: &str = "cli.sock";

/// Creates a short, private directory for the socket. macOS caps Unix socket
/// paths near 104 bytes and a profile directory can easily exceed that, so the
/// socket lives under the temp root and the handshake file records where.
#[cfg(unix)]
fn create_endpoint_directory() -> Result<PathBuf, String> {
    use std::os::unix::fs::DirBuilderExt;
    let directory = PathBuf::from("/tmp").join(format!("jl-cli-{}", uuid::Uuid::new_v4().simple()));
    let mut builder = std::fs::DirBuilder::new();
    builder.mode(0o700);
    builder.create(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}

/// Clears the endpoint a previous host advertised when nothing is listening on
/// it any more. A host killed outright never runs its shutdown, so without this
/// its socket directory would linger. Only a directory we created — matching
/// the `jl-cli-` prefix under the temp root — is ever removed, and only after
/// confirming no one answers there.
fn remove_stale_endpoint(handshake_path: &Path) {
    let Ok(bytes) = std::fs::read(handshake_path) else {
        return;
    };
    let Ok(previous) = serde_json::from_slice::<Handshake>(&bytes) else {
        return;
    };
    if crate::cli_protocol::Client::connect(&previous.endpoint).is_ok() {
        // Someone is listening. Leave it alone and let the profile lock decide.
        return;
    }
    let socket = PathBuf::from(&previous.endpoint);
    let Some(directory) = socket.parent() else {
        return;
    };
    let ours = directory
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("jl-cli-"));
    if !ours {
        return;
    }
    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir(directory);
}

/// Starts the listener and advertises it. Failing to serve the CLI must never
/// stop the app from running, so callers report the error and continue.
pub fn launch(app: AppHandle, preferences: &Path, windowed: bool) -> Result<CliHost, String> {
    let handshake_path = preferences.join("host.json");
    remove_stale_endpoint(&handshake_path);

    #[cfg(unix)]
    let (endpoint, directory) = {
        let directory = create_endpoint_directory()?;
        let socket = directory.join(SOCKET);
        (socket.to_string_lossy().into_owned(), Some(directory))
    };
    #[cfg(windows)]
    let (endpoint, directory) = (
        format!(r"\\.\pipe\jackalope-cli-{}", uuid::Uuid::new_v4().simple()),
        None,
    );

    serve(app, endpoint.clone())?;

    let handshake = Handshake {
        version: VERSION,
        pid: std::process::id(),
        endpoint,
        windowed,
    };
    let encoded = serde_json::to_vec(&handshake).map_err(|e| e.to_string())?;
    super::history::write_atomic(&handshake_path, &encoded)?;

    Ok(CliHost {
        handshake: handshake_path,
        directory,
    })
}

#[cfg(unix)]
fn serve(app: AppHandle, endpoint: String) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    // Bind with std rather than tokio: this runs during setup, outside any
    // reactor, and binding here means the socket is already listening before
    // the handshake advertises it.
    let listener = std::os::unix::net::UnixListener::bind(&endpoint).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    // The private directory already restricts access; this narrows the socket
    // itself to the owner too.
    let _ = std::fs::set_permissions(&endpoint, std::fs::Permissions::from_mode(0o600));
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::UnixListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Jackalope cannot serve the jackalope command: {error}");
                return;
            }
        };
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move { serve_client(stream, app).await });
                }
                Err(error) => {
                    eprintln!("Jackalope stopped accepting CLI connections: {error}");
                    return;
                }
            }
        }
    });
    Ok(())
}

#[cfg(windows)]
fn serve(app: AppHandle, endpoint: String) -> Result<(), String> {
    use tokio::net::windows::named_pipe::ServerOptions;
    // Named pipes are reactor-bound, so unlike the Unix socket the first
    // instance is created inside the runtime rather than here.
    tauri::async_runtime::spawn(async move {
        let mut server = match ServerOptions::new()
            .first_pipe_instance(true)
            .create(&endpoint)
        {
            Ok(server) => server,
            Err(error) => {
                eprintln!("Jackalope cannot serve the jackalope command: {error}");
                return;
            }
        };
        loop {
            if let Err(error) = server.connect().await {
                eprintln!("Jackalope stopped accepting CLI connections: {error}");
                return;
            }
            // Hand the connected instance to the client task and immediately
            // stand up the next one, so a second client never finds no server.
            let next = match ServerOptions::new().create(&endpoint) {
                Ok(next) => next,
                Err(error) => {
                    eprintln!("Jackalope stopped accepting CLI connections: {error}");
                    return;
                }
            };
            let connected = std::mem::replace(&mut server, next);
            let app = app.clone();
            tauri::async_runtime::spawn(async move { serve_client(connected, app).await });
        }
    });
    Ok(())
}

/// One connection: newline-delimited JSON requests, one response per line.
async fn serve_client<S: AsyncRead + AsyncWrite + Unpin>(stream: S, app: AppHandle) {
    let (reader, mut writer) = tokio::io::split(stream);
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => dispatch(request, &app).await,
            Err(error) => Response::error(format!("Unrecognized request: {error}")),
        };
        let Ok(mut encoded) = serde_json::to_vec(&response) else {
            return;
        };
        encoded.push(b'\n');
        if writer.write_all(&encoded).await.is_err() {
            return;
        }
    }
}

async fn dispatch(request: Request, app: &AppHandle) -> Response {
    match handle(request, app).await {
        Ok(response) => response,
        Err(message) => Response::Error { message },
    }
}

/// Resolves the repository containing `path` and the project it belongs to,
/// registering the repository when the workspace has not seen it before.
fn ensure_project(app: &AppHandle, path: &str) -> Result<protocol::Project, String> {
    let root = super::tasks::git(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| format!("{path} is not inside a Git repository."))?;
    let runtime = app.state::<TaskRuntime>();
    let record = super::project_registry::ensure(&runtime, &root)?;
    Ok(protocol::Project {
        id: record.id,
        name: record.name,
        path: record.path,
        accent: record.accent,
    })
}

/// The conversation as turns: each batch of messages, then what the agent
/// produced for it, then anything still waiting to be sent.
fn transcript(session: &LiveSession, runs: &[TaskRun]) -> Vec<protocol::Message> {
    let mut messages = Vec::new();
    let visible: Vec<_> = session
        .messages
        .iter()
        .filter(|message| !message.canceled)
        .collect();
    for (index, message) in visible.iter().enumerate() {
        messages.push(protocol::Message {
            role: "you".into(),
            text: message.text.clone(),
            sent: message.run_id.is_some(),
        });
        // A reply follows the last message its run carried.
        let Some(run_id) = &message.run_id else {
            continue;
        };
        let last_of_batch = visible
            .get(index + 1)
            .is_none_or(|next| next.run_id.as_ref() != Some(run_id));
        if !last_of_batch {
            continue;
        }
        if let Some(run) = runs.iter().find(|run| &run.id == run_id) {
            if !run.result.trim().is_empty() {
                messages.push(protocol::Message {
                    role: "agent".into(),
                    text: run.result.clone(),
                    sent: true,
                });
            }
        }
    }
    messages
}

/// Projects the newest attempt in a conversation into what a terminal renders.
fn session_view(session: &LiveSession, runs: &[TaskRun]) -> protocol::SessionView {
    let run = runs
        .iter()
        .filter(|run| run.live_session_id.as_deref() == Some(session.id.as_str()))
        .max_by(|left, right| left.started_at.cmp(&right.started_at));
    let decision = run
        .and_then(|run| run.routing.as_ref())
        .and_then(|routing| routing.decisions.last());
    protocol::SessionView {
        id: session.id.clone(),
        title: session.title.clone(),
        paused: session.paused,
        error: session.error.clone(),
        messages: transcript(session, runs),
        run_id: run.map(|run| run.id.clone()),
        status: run.map(|run| run.status.clone()),
        agent: run.map(|run| run.agent.clone()),
        account: run.map(|run| run.account.clone()),
        model: run.and_then(|run| run.model.clone()),
        routing: decision.map(|decision| decision.reason.clone()),
        step: run
            .and_then(|run| run.progress.as_ref())
            .map(|progress| progress.label.clone()),
        step_detail: run
            .and_then(|run| run.progress.as_ref())
            .map(|progress| progress.detail.clone()),
        attempt: run
            .and_then(|run| run.progress.as_ref())
            .map(|progress| progress.attempt),
        workspace: run.map(|run| run.workspace.clone()),
        branch: run.map(|run| run.branch.clone()),
        result: run.map(|run| run.result.clone()).unwrap_or_default(),
        questions: run
            .map(|run| {
                run.prompts
                    .iter()
                    .filter(|prompt| prompt.status == "pending")
                    .map(|prompt| protocol::Question {
                        id: prompt.id.clone(),
                        run_id: prompt.run_id.clone(),
                        question: prompt.question.clone(),
                        options: prompt.options.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}

async fn handle(request: Request, app: &AppHandle) -> Result<Response, String> {
    match request {
        Request::Projects => {
            let runtime = app.state::<TaskRuntime>();
            Ok(Response::Projects {
                projects: super::project_registry::list(&runtime)
                    .into_iter()
                    .map(|record| protocol::Project {
                        id: record.id,
                        name: record.name,
                        path: record.path,
                        accent: record.accent,
                    })
                    .collect(),
            })
        }
        Request::EnsureProject { path } => Ok(Response::Project {
            project: ensure_project(app, &path)?,
        }),
        Request::Sessions => {
            let sessions = app.state::<LiveSessions>();
            let snapshot = sessions.snapshot(None)?;
            let mut open: Vec<_> = snapshot
                .sessions
                .iter()
                .filter(|session| !session.closed)
                .map(|session| protocol::SessionSummary {
                    id: session.id.clone(),
                    title: session.title.clone(),
                    project_id: session.request.project_id.clone(),
                    paused: session.paused,
                    pending: session
                        .messages
                        .iter()
                        .filter(|message| !message.canceled && message.run_id.is_none())
                        .count(),
                    error: session.error.clone(),
                    updated_at: session.updated_at.clone(),
                })
                .collect();
            open.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
            Ok(Response::Sessions { sessions: open })
        }
        Request::StartSession {
            project_path,
            text,
            agent,
        } => {
            let project = ensure_project(app, &project_path)?;
            let sessions = app.state::<LiveSessions>();
            let session_id = uuid::Uuid::new_v4().to_string();
            let policy = app.state::<TaskRuntime>().policy()?;
            let default_agent = policy
                .projects
                .get(&project.id)
                .and_then(|project| project.preferred_runner.as_deref())
                .filter(|agent| !agent.is_empty())
                .unwrap_or("auto");
            let request: super::tasks::RunRequest = serde_json::from_value(serde_json::json!({
                "id": format!("cli-{}", uuid::Uuid::new_v4().simple()),
                "projectId": project.id,
                "projectName": project.name,
                "projectPath": project.path,
                "agent": agent.as_deref().filter(|agent| !agent.is_empty()).unwrap_or(default_agent),
                "model": null,
                "prompt": "",
                "isolated": true,
                "previousRunId": null,
            }))
            .map_err(|error| error.to_string())?;
            let first = super::live_sessions::FirstMessage {
                id: uuid::Uuid::new_v4().to_string(),
                text,
            };
            sessions.create_with_limits(
                session_id.clone(),
                // Replaced by one derived from the first message.
                "Terminal session".into(),
                request,
                Some(first),
                super::live_sessions::SessionLimits {
                    max_batches: None,
                    pause_at_estimated_usd: None,
                },
            )?;
            Ok(Response::Started { session_id })
        }
        Request::Send { session_id, text } => {
            let sessions = app.state::<LiveSessions>();
            sessions.send(&session_id, uuid::Uuid::new_v4().to_string(), text, None)?;
            Ok(Response::Ok)
        }
        Request::SessionDetail { session_id } => {
            let sessions = app.state::<LiveSessions>();
            let runtime = app.state::<TaskRuntime>();
            let snapshot = sessions.snapshot(Some(&session_id))?;
            let session = snapshot
                .sessions
                .iter()
                .find(|session| session.id == session_id)
                .ok_or("That conversation is no longer open.")?;
            Ok(Response::Session {
                revision: runtime.revision(),
                session: Box::new(session_view(session, &snapshot.runs)),
            })
        }
        Request::SessionAction { session_id, action } => {
            let sessions = app.state::<LiveSessions>();
            sessions.action(&session_id, &action, None)?;
            Ok(Response::Ok)
        }
        Request::Answer {
            run_id,
            prompt_id,
            text,
        } => {
            let runtime = app.state::<TaskRuntime>();
            runtime.respond_prompt(&run_id, &prompt_id, &text)?;
            Ok(Response::Ok)
        }
        Request::Stop { run_id } => {
            let runtime = app.state::<TaskRuntime>();
            runtime.stop(&run_id)?;
            Ok(Response::Ok)
        }
        Request::Watch { since } => {
            let runtime = app.state::<TaskRuntime>().inner().clone();
            let sessions = app.state::<LiveSessions>().inner().clone();
            let mut tasks = runtime.subscribe();
            let mut conversations = sessions.subscribe();
            let mut projects = super::project_registry::subscribe();
            // Include project preferences so idle terminals receive saved theme changes.
            let revision = |runtime: &TaskRuntime, sessions: &LiveSessions| {
                runtime.revision() + sessions.revision() + super::project_registry::revision()
            };
            let current = revision(&runtime, &sessions);
            if current != since {
                return Ok(Response::Changed { revision: current });
            }
            // Return on a timeout as well, so a quiet workspace still gives the
            // client a chance to notice a dropped connection.
            let _ = tokio::time::timeout(std::time::Duration::from_secs(25), async {
                tokio::select! {
                    _ = tasks.changed() => {}
                    _ = conversations.changed() => {}
                    _ = projects.changed() => {}
                }
            })
            .await;
            Ok(Response::Changed {
                revision: revision(&runtime, &sessions),
            })
        }
        Request::Attached {
            terminal,
            session_id,
        } => {
            if let Ok(mut attached) = attached().lock() {
                match session_id {
                    Some(id) => attached.insert(terminal, id),
                    None => attached.remove(&terminal),
                };
            }
            Ok(Response::Ok)
        }
        Request::Overview => {
            let runtime = app.state::<TaskRuntime>();
            let policy = runtime.policy()?;
            let runners = super::tasks::task_runners(app.state::<TaskRuntime>()).await?;
            let agents = runners
                .into_iter()
                .map(|runner| {
                    let state = if policy.enabled_agents.get(&runner.id) == Some(&false) {
                        "disabled"
                    } else if !runner.available {
                        "missing"
                    } else if runner.signed_in {
                        "ready"
                    } else if runner.detail.starts_with("Sign in ") {
                        "sign-in"
                    } else {
                        // Agents whose sign-in cannot be probed report as installed.
                        "installed"
                    };
                    protocol::AgentStatus {
                        id: runner.id,
                        name: runner.name,
                        state: state.into(),
                        account: runner.account,
                        detail: runner.detail,
                    }
                })
                .collect();
            Ok(Response::Overview {
                agents,
                default_agent: policy.default_meta_agent.clone(),
            })
        }
        Request::CommitPolicy { project_path } => {
            let project = ensure_project(app, &project_path)?;
            commit_policy(super::project_git::project_git_policy(project.path, None).await?)
        }
        Request::SetCommitAttribution {
            project_path,
            attribution,
        } => {
            let project = ensure_project(app, &project_path)?;
            let current =
                super::project_git::project_git_policy(project.path.clone(), None).await?;
            let mut value = serde_json::to_value(&current).map_err(|e| e.to_string())?;
            value["attribution"] = serde_json::Value::String(attribution);
            let policy = serde_json::from_value(value)
                .map_err(|_| "Choose user, coAuthor or agent.".to_string())?;
            commit_policy(super::project_git::project_git_policy(project.path, Some(policy)).await?)
        }
        Request::ShowChanges { path } => {
            use tauri::Emitter;
            let response = show_window(app);
            // The window may still be loading; it asks again once ready.
            let _ = app.emit("jackalope:open-changes", path);
            Ok(response)
        }
        Request::Ping => Ok(Response::Ok),
        Request::ShowWindow => Ok(show_window(app)),
    }
}

fn commit_policy(policy: super::project_git::CommitPolicy) -> Result<Response, String> {
    let value = serde_json::to_value(&policy).map_err(|e| e.to_string())?;
    Ok(Response::CommitPolicy {
        attribution: value["attribution"].as_str().unwrap_or("user").into(),
        name: policy.name,
        email: policy.email,
    })
}

/// Conversations shown in terminals the app started, keyed by terminal.
fn attached() -> &'static std::sync::Mutex<std::collections::HashMap<String, String>> {
    static ATTACHED: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, String>>,
    > = std::sync::OnceLock::new();
    ATTACHED.get_or_init(Default::default)
}

pub(super) fn attached_session(terminal: &str) -> Option<String> {
    attached().lock().ok()?.get(terminal).cloned()
}

fn show_window(app: &AppHandle) -> Response {
    let handle = app.clone();
    // Windows must be built on the main thread; this task is not it.
    match app.run_on_main_thread(move || {
        crate::window_behavior::show_main_window(&handle);
    }) {
        Ok(()) => {
            if let Some(host) = app.try_state::<CliHost>() {
                host.mark_windowed();
            }
            Response::Ok
        }
        Err(error) => Response::error(error.to_string()),
    }
}

impl CliHost {
    /// Records that the host now shows a window, so a later launch raises it
    /// instead of asking whether to start one.
    fn mark_windowed(&self) {
        let Ok(bytes) = std::fs::read(&self.handshake) else {
            return;
        };
        let Ok(mut handshake) = serde_json::from_slice::<Handshake>(&bytes) else {
            return;
        };
        if handshake.windowed {
            return;
        }
        handshake.windowed = true;
        if let Ok(encoded) = serde_json::to_vec(&handshake) {
            let _ = super::history::write_atomic(&self.handshake, &encoded);
        }
    }
}
