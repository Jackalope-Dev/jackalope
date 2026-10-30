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

/// Resolves the directory containing `path` and the project it belongs to,
/// registering it when the workspace has not seen it before. A Git repository
/// uses its root. Any other directory is the project itself; creating a
/// repository stays in the terminal command, and only after the user asks.
fn ensure_project(app: &AppHandle, path: &str) -> Result<protocol::Project, String> {
    let root = super::tasks::project_directory(path)?;
    let runtime = app.state::<TaskRuntime>();
    let record = super::project_registry::ensure(&runtime, &root)?;
    // An open window adopts a repository first used from a terminal now,
    // rather than on its next launch. Merging a known project changes nothing.
    {
        use tauri::Emitter;
        let _ = app.emit("jackalope:projects-registered", ());
    }
    Ok(project_summary(&runtime, record))
}

fn project_summary(
    runtime: &TaskRuntime,
    record: super::project_registry::ProjectRecord,
) -> protocol::Project {
    let settings = record.settings();
    let planning = super::planning::session::store_for(runtime).settings(&record.id);
    protocol::Project {
        id: record.id,
        name: record.name,
        path: record.path,
        accent: record.accent,
        auto_approve: Some(settings.auto_approve),
        workspace_mode: Some(settings.workspace_mode.as_str().into()),
        learn_automatically: Some(settings.learn_automatically),
        learning_cadence: Some(settings.learning_cadence),
        sync_lessons: Some(settings.sync_lessons),
        agent_reflection: Some(settings.agent_reflection),
        export_lessons: Some(settings.export_lessons),
        verify_command: record
            .verify_command
            .filter(|command| !command.trim().is_empty()),
        auto_verify: record.auto_verify,
        question_cap: Some(planning.question_cap as u32),
        planner_agent: planning.planner_agent.filter(|agent| !agent.is_empty()),
        preview_command: record
            .preview_command
            .filter(|command| !command.trim().is_empty()),
        review_captures: Some(record.review_captures.unwrap_or(true)),
    }
}

/// A registered project's folder, which knowledge is scoped by.
fn project_path(runtime: &TaskRuntime, project_id: &str) -> Result<String, String> {
    super::project_registry::list(runtime)
        .into_iter()
        .find(|project| project.id == project_id)
        .map(|project| project.path)
        .ok_or_else(|| "That project is not registered.".into())
}

fn learning_summary(entry: &super::knowledge::KnowledgeEntry) -> Option<protocol::Learning> {
    let source = entry.automatic.as_ref()?;
    let state = source.lifecycle.as_ref()?;
    Some(protocol::Learning {
        id: entry.id.clone(),
        title: entry.title.clone(),
        content: entry.content.clone(),
        status: state.status.clone(),
        kind: source.kind.clone(),
        uses: state.deliveries,
        managed: source.managed,
        updated_at: entry.updated_at.clone(),
        archived_reason: state.archived_reason.clone(),
        misses: (state.misses > 0).then_some(state.misses),
        attention: super::knowledge::learning::attention(entry),
    })
}

fn learning_detail(
    runtime: &TaskRuntime,
    project_id: &str,
    entry: &super::knowledge::KnowledgeEntry,
) -> Result<Response, String> {
    let learning = learning_summary(entry).ok_or("That is not a learned lesson.")?;
    let history = runtime
        .knowledge
        .history(project_id, &entry.id, 8)
        .into_iter()
        .map(|record| protocol::LearningEvent {
            at: record.at,
            action: record.action,
            reason: record.reason,
            evidence: record.evidence,
        })
        .collect();
    Ok(Response::Learning { learning, history })
}

fn learned_entry(
    runtime: &TaskRuntime,
    project_id: &str,
    entry_id: &str,
) -> Result<super::knowledge::KnowledgeEntry, String> {
    let path = project_path(runtime, project_id)?;
    runtime
        .knowledge
        .list(project_id, &path)?
        .into_iter()
        .find(|entry| entry.id == entry_id)
        .ok_or_else(|| "That lesson no longer exists.".into())
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
            attempt: None,
            id: Some(message.id.clone()),
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
        let attempts = attempts(run_id, runs);
        let numbered = attempts.len() > 1;
        for (number, run) in (1..).zip(&attempts) {
            if !run.result.trim().is_empty() {
                messages.push(protocol::Message {
                    role: "agent".into(),
                    text: run.result.clone(),
                    sent: true,
                    attempt: numbered.then_some(number),
                    id: None,
                });
            }
        }
    }
    messages
}

/// The run a batch started followed by each retry of it, oldest first.
fn attempts<'a>(run_id: &str, runs: &'a [TaskRun]) -> Vec<&'a TaskRun> {
    let mut chain = Vec::new();
    let mut next = runs.iter().find(|run| run.id == run_id);
    while let Some(run) = next {
        // A malformed history must not loop forever.
        if chain.iter().any(|seen: &&TaskRun| seen.id == run.id) {
            break;
        }
        chain.push(run);
        next = runs
            .iter()
            .filter(|candidate| candidate.retry_of.as_deref() == Some(run.id.as_str()))
            .min_by(|left, right| left.started_at.cmp(&right.started_at));
    }
    chain
}

/// Activity entries a terminal receives, enough to show what work is doing.
const ACTIVITY_TAIL: usize = 12;

/// Projects the newest attempt in a conversation into what a terminal renders.
/// The conversation's most recently started run.
fn latest_run<'a>(session: &LiveSession, runs: &'a [TaskRun]) -> Option<&'a TaskRun> {
    runs.iter()
        .filter(|run| run.live_session_id.as_deref() == Some(session.id.as_str()))
        .max_by(|left, right| left.started_at.cmp(&right.started_at))
}

fn session_view(session: &LiveSession, runs: &[TaskRun]) -> protocol::SessionView {
    let run = latest_run(session, runs);
    let decision = run
        .and_then(|run| run.routing.as_ref())
        .and_then(|routing| routing.decisions.last());
    let run_error = run
        .filter(|run| !["review", "reviewed", "running", "starting"].contains(&run.status.as_str()))
        .and_then(|run| {
            protocol::present(run.error.as_deref())
                .or(protocol::present(run.verification_error.as_deref()))
                .or(run.quota_failure.as_ref().map(|q| q.message.as_str()))
        });
    let error = protocol::present(session.error.as_deref())
        .or(run_error)
        .map(str::to_string);
    protocol::SessionView {
        id: session.id.clone(),
        title: session.title.clone(),
        paused: session.paused,
        error,
        messages: transcript(session, runs),
        run_id: run.map(|run| run.id.clone()),
        merged: run.is_some_and(|run| session.integrated_run_id.as_deref() == Some(&run.id)),
        draft: session.draft.text.clone(),
        draft_revision: session.draft.revision,
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
        // Streamed text stands in for the output until the message completes.
        result: run
            .map(|run| {
                if run.result.is_empty() {
                    run.streaming.clone()
                } else {
                    run.result.clone()
                }
            })
            .unwrap_or_default(),
        activity: run
            .map(|run| {
                let skip = run.activity.len().saturating_sub(ACTIVITY_TAIL);
                run.activity[skip..].to_vec()
            })
            .unwrap_or_default(),
        partial: run
            .filter(|run| run.result.is_empty() && protocol::working(Some(&run.status)))
            .map(|run| run.streaming.clone())
            .unwrap_or_default(),
        review_screenshots: run
            .and_then(|run| run.review_captures.as_ref())
            .map(|captures| captures.image_count() as u32)
            .filter(|count| *count > 0),
        questions: run
            .map(|run| {
                run.prompts
                    .iter()
                    .filter(|prompt| prompt.status == "pending")
                    .map(super::planning::cli::question)
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
                    .map(|record| project_summary(&runtime, record))
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
                    error: protocol::present(session.error.as_deref()).map(str::to_string),
                    updated_at: session.updated_at.clone(),
                    status: latest_run(session, &snapshot.runs).map(|run| run.status.clone()),
                    asking: latest_run(session, &snapshot.runs).is_some_and(|run| {
                        run.prompts.iter().any(|prompt| prompt.status == "pending")
                    }),
                })
                .collect();
            open.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
            Ok(Response::Sessions { sessions: open })
        }
        Request::StartSession {
            project_path,
            text,
            agent,
            model,
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
                "model": model.filter(|model| !model.trim().is_empty()),
                "prompt": "",
                "isolated": true,
                "workspaceMode": super::project_registry::settings(&app.state::<TaskRuntime>(), &project.id).workspace_mode,
                "previousRunId": null,
            }))
            .map_err(|error| error.to_string())?;
            let first = super::live_sessions::FirstMessage {
                id: uuid::Uuid::new_v4().to_string(),
                text,
                origin: None,
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
        Request::Send {
            session_id,
            text,
            draft_revision,
        } => {
            let sessions = app.state::<LiveSessions>();
            sessions.send(
                &session_id,
                uuid::Uuid::new_v4().to_string(),
                text,
                draft_revision,
            )?;
            Ok(Response::Ok)
        }
        Request::Draft {
            session_id,
            text,
            revision,
        } => {
            let sessions = app.state::<LiveSessions>();
            let draft = sessions.draft(&session_id, text, revision)?;
            Ok(Response::Draft {
                revision: draft.revision,
            })
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
        Request::SessionAction {
            session_id,
            action,
            message_id,
        } => {
            let sessions = app.state::<LiveSessions>();
            sessions.action(&session_id, &action, message_id.as_deref())?;
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
            let mut plans = super::planning::store::subscribe();
            // Include project preferences so idle terminals receive saved theme
            // changes, and plans so a plan decided in the app reaches the panel.
            let revision = |runtime: &TaskRuntime, sessions: &LiveSessions| {
                runtime.revision()
                    + sessions.revision()
                    + super::project_registry::revision()
                    + super::planning::store::revision()
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
                    _ = plans.changed() => {}
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
        Request::Usage => {
            let records = super::capacity::capacity_snapshot(
                app.state::<super::capacity::CapacityService>(),
                app.state::<TaskRuntime>(),
                Some(true),
            )
            .await?;
            Ok(Response::Usage {
                accounts: records
                    .into_iter()
                    .map(|record| protocol::UsageAccount {
                        agent: record.agent,
                        account: record.account,
                        status: record.status,
                        detail: record.detail,
                        observed_at: record.observed_at,
                        windows: record
                            .windows
                            .into_iter()
                            .map(|window| protocol::UsageWindow {
                                name: if window.pool_name.is_empty() {
                                    window.window
                                } else {
                                    format!("{} · {}", window.pool_name, window.window)
                                },
                                used_percent: window.used_percent,
                                resets_at: window.resets_at,
                            })
                            .collect(),
                    })
                    .collect(),
            })
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
                    let options = policy.runner_options.get(&runner.id);
                    protocol::AgentStatus {
                        models: options
                            .map(|options| {
                                options
                                    .models
                                    .iter()
                                    .map(|model| model.trim().to_string())
                                    .filter(|model| !model.is_empty())
                                    .collect()
                            })
                            .unwrap_or_default(),
                        default_model: options
                            .map(|options| options.default_model.clone())
                            .unwrap_or_default(),
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
        Request::SetAccent { project_id, accent } => {
            use tauri::Emitter;
            let runtime = app.state::<TaskRuntime>();
            super::project_registry::set_accent(&runtime, &project_id, &accent)?;
            // The app owns theme preferences; it applies this and mirrors back.
            let _ = app.emit(
                "jackalope:set-accent",
                serde_json::json!({ "projectId": project_id, "accent": accent }),
            );
            Ok(Response::Ok)
        }
        Request::SetProjectSettings {
            project_id,
            auto_approve,
            workspace_mode,
            learn_automatically,
            learning_cadence,
            sync_lessons,
            agent_reflection,
            export_lessons,
            question_cap,
            planner_agent,
            review_captures,
        } => {
            use tauri::Emitter;
            let mode = workspace_mode
                .as_deref()
                .map(|mode| {
                    super::tasks::WorkspaceMode::parse(mode)
                        .ok_or("Choose worktree, branch, current or ask.")
                })
                .transpose()?;
            let runtime = app.state::<TaskRuntime>();
            let record = super::project_registry::set_settings(
                &runtime,
                &project_id,
                auto_approve,
                mode,
                super::project_registry::LearningSettings {
                    automatic: learn_automatically,
                    cadence: learning_cadence,
                    sync: sync_lessons,
                    agent: agent_reflection,
                    export: export_lessons,
                },
            )?;
            if question_cap.is_some() || planner_agent.is_some() {
                let store = super::planning::session::store_for(&runtime);
                let mut planning = store.settings(&project_id);
                if let Some(cap) = question_cap {
                    planning.question_cap = cap as usize;
                }
                if let Some(agent) = planner_agent {
                    let agent = agent.trim().to_string();
                    if agent.is_empty() || planning.planner_agent.as_deref() != Some(&agent) {
                        // A planning model belongs to the planning agent.
                        planning.planner_model = None;
                    }
                    planning.planner_agent = Some(agent).filter(|agent| !agent.is_empty());
                }
                store.save_settings(&project_id, planning)?;
            }
            let record = match review_captures {
                Some(enabled) => {
                    super::project_registry::set_review_captures(&runtime, &project_id, enabled)?
                }
                None => record,
            };
            // The app adopts registry settings when it merges the registry.
            let _ = app.emit("jackalope:projects-registered", ());
            Ok(Response::Project {
                project: project_summary(&runtime, record),
            })
        }
        Request::SessionLearn { session_id } => {
            let sessions = app.state::<LiveSessions>();
            let runtime = app.state::<TaskRuntime>();
            let result =
                super::live_sessions::learn_from_session(&sessions, &runtime, &session_id)?;
            Ok(Response::Learned {
                count: result.count,
                lessons: result.lessons,
                message: result.message,
            })
        }
        Request::Sharpen {
            text,
            project_id,
            project_name,
        } => {
            let helper = app.state::<super::helper::Helper>().inner().clone();
            let text = tauri::async_runtime::spawn_blocking(move || {
                helper.sharpen(
                    &text,
                    None,
                    project_id,
                    project_name,
                    &std::sync::atomic::AtomicBool::new(false),
                )
            })
            .await
            .map_err(|error| error.to_string())??;
            Ok(Response::Sharpened { text })
        }
        Request::Learnings { project_id } => {
            let runtime = app.state::<TaskRuntime>();
            let path = project_path(&runtime, &project_id)?;
            let mut learnings: Vec<_> = runtime
                .knowledge
                .list(&project_id, &path)?
                .iter()
                .filter_map(learning_summary)
                .collect();
            // Available lessons first, most used first.
            learnings.sort_by(|a, b| {
                (a.status == "archived")
                    .cmp(&(b.status == "archived"))
                    .then(b.uses.cmp(&a.uses))
                    .then(b.updated_at.cmp(&a.updated_at))
            });
            Ok(Response::Learnings { learnings })
        }
        Request::Learning {
            project_id,
            entry_id,
        } => {
            let runtime = app.state::<TaskRuntime>();
            let entry = learned_entry(&runtime, &project_id, &entry_id)?;
            learning_detail(&runtime, &project_id, &entry)
        }
        Request::SetLearningArchived {
            project_id,
            entry_id,
            archived,
        } => {
            let runtime = app.state::<TaskRuntime>();
            let entry = learned_entry(&runtime, &project_id, &entry_id)?;
            let saved = runtime
                .knowledge
                .set_archived(&entry.id, entry.revision, archived)?;
            learning_detail(&runtime, &project_id, &saved)
        }
        Request::MergePrepare {
            session_id,
            message,
        } => {
            let run = reviewable_run(app, &session_id)?;
            if let Some(reason) = in_place_delivery(&run, &session_id) {
                return Err(reason);
            }
            let plan = super::integration::integration_prepare(
                app.state(),
                app.state(),
                app.state(),
                vec![run.id],
                message,
            )
            .await?;
            Ok(Response::Merge {
                plan: merge_plan(plan),
            })
        }
        Request::MergeApply { plan_id, cleanup } => {
            let plan = super::integration::integration_apply(
                app.state(),
                app.state(),
                app.state(),
                plan_id,
                Some(cleanup),
            )
            .await?;
            Ok(Response::Merge {
                plan: merge_plan(plan),
            })
        }
        Request::PullRequest {
            session_id,
            title,
            body,
            draft,
        } => {
            let run = reviewable_run(app, &session_id)?;
            let changes = super::commit_review::git_working_changes(
                run.project_path.clone(),
                run.workspace.clone(),
            )
            .await?;
            if !changes.files.is_empty() {
                super::commit_review::git_commit_changes(
                    run.project_path.clone(),
                    run.workspace.clone(),
                    changes.files.into_iter().map(|file| file.path).collect(),
                    title.trim().to_string(),
                    String::new(),
                    vec![run.agent.clone()],
                )
                .await
                .map_err(|failure| failure.message().to_string())?;
            }
            super::commit_review::git_push_changes(run.project_path.clone(), run.workspace.clone())
                .await?;
            let url =
                super::delivery::task_pull_request_create(run.id, title, body, draft, app.state())
                    .await?;
            Ok(Response::PullRequest { url })
        }
        Request::BrowserProfile {
            project_id,
            action,
            url,
        } => {
            use super::browser_profiles as profiles;
            let runtime = app.state::<TaskRuntime>();
            let root = runtime.browser_profiles_root();
            super::project_registry::record(&runtime, &project_id)
                .ok_or("That project is not registered.")?;
            let profile = tauri::async_runtime::spawn_blocking(move || {
                let found = profiles::find(&root, "project", &project_id);
                let profile = match action.as_str() {
                    "" => found,
                    "open" => {
                        let profile =
                            profiles::ensure(&root, "project", &project_id, "Project browser")?;
                        profiles::open_window(&root, &profile, url.as_deref())?;
                        profiles::find(&root, "project", &project_id)
                    }
                    "done" => {
                        if let Some(profile) = &found {
                            profiles::close_window(&root, &profile.id)?;
                        }
                        profiles::find(&root, "project", &project_id)
                    }
                    _ => return Err("Use open or done.".to_string()),
                };
                Ok::<_, String>(profile.map(|profile| {
                    let status = profiles::status(&root, profile);
                    protocol::BrowserProfileView {
                        name: status.profile.name,
                        sites: status.profile.signed_in_sites,
                        size_bytes: status.size_bytes,
                        last_used_at: status.profile.last_used_at,
                        in_use: status.in_use,
                        window_open: status.window_open,
                    }
                }))
            })
            .await
            .map_err(|e| e.to_string())??;
            Ok(Response::BrowserProfile { profile })
        }
        Request::Computer { session_id, action } => {
            use super::computers;
            let runtime = app.state::<TaskRuntime>().inner().clone();
            let root = runtime.computers_root();
            let sessions = app.state::<LiveSessions>();
            let computer = match sessions.persona(&session_id) {
                Some(persona) => computers::find(&root, "bot", &persona.bot_id),
                None => runtime
                    .integration_runs()?
                    .into_iter()
                    .filter(|run| run.live_session_id.as_deref() == Some(session_id.as_str()))
                    .max_by(|left, right| left.started_at.cmp(&right.started_at))
                    .and_then(|run| computers::find(&root, "task", &run.task_id)),
            };
            let Some(computer) = computer else {
                return Ok(Response::Computer { computer: None });
            };
            let status = tauri::async_runtime::spawn_blocking(move || {
                computers::usage::refresh_run_leases(&runtime);
                match action.as_str() {
                    "" => {}
                    "start" => computers::start_background(root.clone(), computer.clone())?,
                    "stop" => computers::stop(&root, &computer)?,
                    _ => return Err("Use start or stop.".to_string()),
                }
                Ok::<_, String>(computers::status(&root, computer))
            })
            .await
            .map_err(|e| e.to_string())??;
            Ok(Response::Computer {
                computer: Some(protocol::ComputerView {
                    name: status.computer.name,
                    provider: status.computer.provider,
                    state: status.state,
                    phase: status.phase,
                    error: status.error,
                    usage: status.usage,
                    stopped_idle: status.stopped_idle,
                }),
            })
        }
        Request::PlanStart {
            project_path,
            goal,
            agent,
        } => {
            let project = ensure_project(app, &project_path)?;
            let runtime = app.state::<TaskRuntime>();
            let policy = runtime.policy()?;
            let default_agent = policy
                .projects
                .get(&project.id)
                .and_then(|project| project.preferred_runner.clone())
                .filter(|agent| !agent.is_empty())
                .unwrap_or_else(|| policy.default_meta_agent.clone());
            let template: super::tasks::RunRequest = serde_json::from_value(serde_json::json!({
                "id": format!("plan-{}", uuid::Uuid::new_v4().simple()),
                "projectId": project.id,
                "projectName": project.name,
                "projectPath": project.path,
                "agent": agent.filter(|agent| !agent.is_empty()).unwrap_or(default_agent),
                "model": null,
                "prompt": "",
                "isolated": true,
                "previousRunId": null,
            }))
            .map_err(|error| error.to_string())?;
            let coordinator = app
                .state::<super::coordination::Coordinator>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || {
                super::planning::cli::start(&coordinator, template, goal)
            })
            .await
            .map_err(|error| error.to_string())?
        }
        Request::Plans { project_path } => {
            let project = ensure_project(app, &project_path)?;
            let coordinator = app
                .state::<super::coordination::Coordinator>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || {
                super::planning::cli::list(&coordinator, &project.id)
            })
            .await
            .map_err(|error| error.to_string())?
        }
        Request::PlanDetail { plan_id } => {
            let coordinator = app
                .state::<super::coordination::Coordinator>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || {
                super::planning::cli::get(&coordinator, &plan_id)
            })
            .await
            .map_err(|error| error.to_string())?
        }
        Request::PlanAction {
            plan_id,
            action,
            text,
            revision,
            hash,
        } => {
            let coordinator = app
                .state::<super::coordination::Coordinator>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || {
                super::planning::cli::action(&coordinator, &plan_id, &action, text, revision, hash)
            })
            .await
            .map_err(|error| error.to_string())?
        }
        Request::Ping => Ok(Response::Ok),
        Request::ShowWindow => Ok(show_window(app)),
    }
}

/// The conversation's newest attempt when it has finished and kept its own
/// worktree, which is what merging and pull requests act on.
/// Why merging does not apply to work that ran in the project checkout
/// itself (the "new branch" and "current branch" workspace modes), and what
/// to do instead. `None` for work in its own worktree.
fn in_place_delivery(run: &TaskRun, session_id: &str) -> Option<String> {
    let same = |a: &str, b: &str| match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    };
    if !same(&run.workspace, &run.project_path) {
        return None;
    }
    let short: String = session_id.chars().take(8).collect();
    Some(if run.branch.starts_with("jackalope/") {
        format!(
            "This work is on its own branch, {}, in your checkout, so there is no worktree to merge. Open a pull request with `jackalope pr {short}`, or merge the branch with Git.",
            run.branch
        )
    } else {
        format!(
            "This work ran directly on {} in your checkout, so its changes are already there. Review and commit them as usual.",
            run.branch
        )
    })
}

fn reviewable_run(app: &AppHandle, session_id: &str) -> Result<TaskRun, String> {
    let snapshot = app.state::<LiveSessions>().snapshot(Some(session_id))?;
    let session = snapshot
        .sessions
        .iter()
        .find(|session| session.id == session_id)
        .ok_or("That conversation is no longer open.")?;
    let run = snapshot
        .runs
        .iter()
        .filter(|run| run.live_session_id.as_deref() == Some(session_id))
        .max_by(|left, right| left.started_at.cmp(&right.started_at))
        .ok_or("This conversation has no work to deliver yet.")?;
    if protocol::working(Some(&run.status)) {
        return Err("Wait for the agent to finish first.".into());
    }
    if !["review", "reviewed"].contains(&run.status.as_str()) {
        return Err("The latest attempt did not finish, so there is nothing to deliver.".into());
    }
    if session.integrated_run_id.as_deref() == Some(run.id.as_str()) {
        return Err("This work is already merged.".into());
    }
    if run.workspace.is_empty() || same_path(&run.workspace, &run.project_path) {
        return Err(
            "This conversation edited the project folder directly, so its changes are already there."
                .into(),
        );
    }
    Ok(run.clone())
}

fn same_path(left: &str, right: &str) -> bool {
    let normal = |path: &str| {
        let path = path.replace('\\', "/");
        let path = path.trim_end_matches('/');
        if cfg!(windows) {
            path.to_lowercase()
        } else {
            path.to_string()
        }
    };
    normal(left) == normal(right)
}

fn merge_plan(plan: super::integration::IntegrationPlan) -> protocol::MergePlan {
    protocol::MergePlan {
        cleanup: plan
            .commit_policy
            .as_ref()
            .is_some_and(|policy| policy.cleanup_after_merge),
        cleanup_errors: plan
            .cleanup_results
            .iter()
            .filter_map(|result| {
                result
                    .error
                    .as_ref()
                    .map(|error| format!("{}: {error}", result.workspace))
            })
            .collect(),
        id: plan.id,
        status: plan.status,
        target_branch: plan.target_branch,
        files: plan.files,
        conflicts: plan.conflicts,
        commit_message: plan.commit_message,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, retry_of: Option<&str>, started_at: &str) -> TaskRun {
        TaskRun {
            id: id.into(),
            retry_of: retry_of.map(String::from),
            started_at: started_at.into(),
            ..TaskRun::default()
        }
    }

    #[test]
    fn a_batch_lists_its_run_and_every_retry_in_order() {
        let runs = [
            run("b", Some("a"), "2"),
            run("a", None, "1"),
            run("other", None, "0"),
            run("c", Some("b"), "3"),
        ];
        let ids: Vec<&str> = attempts("a", &runs)
            .iter()
            .map(|run| run.id.as_str())
            .collect();
        assert_eq!(ids, ["a", "b", "c"]);
        assert!(attempts("missing", &runs).is_empty());
        // A cycle in stored history ends rather than looping.
        let looped = [run("x", Some("y"), "1"), run("y", Some("x"), "2")];
        assert_eq!(attempts("x", &looped).len(), 2);
    }

    #[test]
    fn work_in_the_project_folder_is_the_project_itself() {
        assert!(same_path("/repo/app/", "/repo/app"));
        assert!(!same_path("/repo/app/.worktrees/task", "/repo/app"));
        #[cfg(windows)]
        assert!(same_path(r"C:\Repo\App", "c:/repo/app"));
    }
}
