//! Serves the `jackalope` command from the process that owns the profile.
//!
//! Only one process may hold a profile — `TaskRuntime` and `Coordinator` each
//! take an exclusive file lock — so the CLI never opens the profile itself. It
//! connects here instead, which also means CLI clients inherit the host's
//! approved-account lease rather than needing their own.

use crate::cli_protocol as protocol;
use crate::cli_protocol::{
    BrowserCommand, ComputerCommand, Handshake, ProjectSettingsPatch, Request, Response, VERSION,
};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use super::live_sessions::LiveSessions;
use super::project_registry::{same_path, NOT_REGISTERED};
use super::tasks::{TaskRun, TaskRuntime};

mod plans;
mod view;

/// Owns the listening endpoint and the handshake file, and removes both on
/// shutdown so a later run never trusts a dead host's advertisement.
pub struct CliHost {
    handshake: PathBuf,
    /// The private directory holding the Unix socket; nothing on Windows,
    /// where the endpoint is a named pipe rather than a filesystem path.
    directory: Option<PathBuf>,
}

impl crate::services::Service for CliHost {
    fn shutdown(&self) {
        CliHost::shutdown(self)
    }
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
pub fn launch(
    app: AppHandle,
    paths: &crate::cli_protocol::ProfilePaths,
    windowed: bool,
) -> Result<CliHost, String> {
    let handshake_path = paths.handshake();
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
    Ok(view::project_summary(&runtime, record))
}

/// A registered project's folder, which knowledge is scoped by.
fn project_path(runtime: &TaskRuntime, project_id: &str) -> Result<String, String> {
    super::project_registry::list(runtime)
        .into_iter()
        .find(|project| project.id == project_id)
        .map(|project| project.path)
        .ok_or_else(|| NOT_REGISTERED.into())
}

fn learning_detail(
    runtime: &TaskRuntime,
    project_id: &str,
    entry: &super::knowledge::KnowledgeEntry,
) -> Result<Response, String> {
    let learning = view::learning_summary(entry).ok_or("That is not a learned lesson.")?;
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

async fn handle(request: Request, app: &AppHandle) -> Result<Response, String> {
    match request {
        Request::Projects => {
            let runtime = app.state::<TaskRuntime>();
            Ok(Response::Projects {
                projects: super::project_registry::list(&runtime)
                    .into_iter()
                    .map(|record| view::project_summary(&runtime, record))
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
                .map(|session| view::session_summary(session, &snapshot.runs))
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
            let request = super::tasks::RunRequest {
                id: format!("cli-{}", uuid::Uuid::new_v4().simple()),
                model: model.filter(|model| !model.trim().is_empty()),
                workspace_mode: Some(
                    super::project_registry::settings(&app.state::<TaskRuntime>(), &project.id)
                        .workspace_mode,
                ),
                ..super::tasks::RunRequest::new(
                    &project.id,
                    &project.name,
                    &project.path,
                    agent
                        .as_deref()
                        .filter(|agent| !agent.is_empty())
                        .unwrap_or(default_agent),
                    String::new(),
                )
            };
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
                session: Box::new(view::session_view(session, &snapshot.runs)),
            })
        }
        Request::SessionAction {
            session_id,
            action,
            message_id,
        } => {
            let sessions = app.state::<LiveSessions>();
            sessions.action(&session_id, action.as_str(), message_id.as_deref())?;
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
        Request::Usage => {
            let records = super::capacity::capacity_snapshot(
                app.state::<super::capacity::CapacityService>(),
                app.state::<TaskRuntime>(),
                Some(true),
            )
            .await?;
            Ok(Response::Usage {
                accounts: records.into_iter().map(view::usage_account).collect(),
            })
        }
        Request::Overview => {
            let runtime = app.state::<TaskRuntime>();
            let policy = runtime.policy()?;
            let runners = super::tasks::task_runners(app.state::<TaskRuntime>()).await?;
            let agents = runners
                .into_iter()
                .map(|runner| view::agent_status(runner, &policy))
                .collect();
            Ok(Response::Overview {
                agents,
                default_agent: policy.default_meta_agent.clone(),
            })
        }
        Request::CommitPolicy { project_path } => {
            let project = ensure_project(app, &project_path)?;
            Ok(view::commit_policy(
                super::project_git::project_git_policy(project.path, None).await?,
            ))
        }
        Request::SetCommitAttribution {
            project_path,
            attribution,
        } => {
            if matches!(attribution, protocol::Attribution::Unknown(_)) {
                return Err("Choose user, coAuthor or agent.".to_string());
            }
            let project = ensure_project(app, &project_path)?;
            let policy = super::project_git::CommitPolicy {
                attribution,
                ..super::project_git::project_git_policy(project.path.clone(), None).await?
            };
            Ok(view::commit_policy(
                super::project_git::project_git_policy(project.path, Some(policy)).await?,
            ))
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
            let runtime = app.state::<TaskRuntime>();
            let record = super::project_registry::set_settings(
                &runtime,
                &project_id,
                &ProjectSettingsPatch {
                    auto_approve,
                    workspace_mode,
                    learn_automatically,
                    learning_cadence,
                    sync_lessons,
                    agent_reflection,
                    export_lessons,
                    review_captures,
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
            // The app adopts registry settings when it merges the registry.
            let _ = app.emit("jackalope:projects-registered", ());
            Ok(Response::Project {
                project: view::project_summary(&runtime, record),
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
                .filter_map(view::learning_summary)
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
            let plan = super::integration::integration_prepare(
                app.state(),
                app.state(),
                app.state(),
                vec![run.id],
                message,
            )
            .await?;
            Ok(Response::Merge {
                plan: view::merge_plan(plan),
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
                plan: view::merge_plan(plan),
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
            super::project_registry::record(&runtime, &project_id).ok_or(NOT_REGISTERED)?;
            let profile = tauri::async_runtime::spawn_blocking(move || {
                let found = profiles::find(&root, "project", &project_id);
                let profile = match action {
                    BrowserCommand::Status => found,
                    BrowserCommand::Open => {
                        let profile =
                            profiles::ensure(&root, "project", &project_id, "Project browser")?;
                        profiles::open_window(&root, &profile, url.as_deref())?;
                        profiles::find(&root, "project", &project_id)
                    }
                    BrowserCommand::Done => {
                        if let Some(profile) = &found {
                            profiles::close_window(&root, &profile.id)?;
                        }
                        profiles::find(&root, "project", &project_id)
                    }
                    BrowserCommand::Unknown(_) => return Err("Use open or done.".to_string()),
                };
                Ok::<_, String>(
                    profile.map(|profile| view::browser_profile(profiles::status(&root, profile))),
                )
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
                None => view::latest_run(&session_id, &runtime.integration_runs()?)
                    .and_then(|run| computers::find(&root, "task", &run.task_id)),
            };
            let Some(computer) = computer else {
                return Ok(Response::Computer { computer: None });
            };
            let status = tauri::async_runtime::spawn_blocking(move || {
                computers::usage::refresh_run_leases(&runtime);
                match action {
                    ComputerCommand::Status => {}
                    ComputerCommand::Start => {
                        computers::start_background(root.clone(), computer.clone())?
                    }
                    ComputerCommand::Stop => computers::stop(&root, &computer)?,
                    ComputerCommand::Unknown(_) => return Err("Use start or stop.".to_string()),
                }
                Ok::<_, String>(computers::status(&root, computer))
            })
            .await
            .map_err(|e| e.to_string())??;
            Ok(Response::Computer {
                computer: Some(view::computer(status)),
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
            let template = super::tasks::RunRequest {
                id: format!("plan-{}", uuid::Uuid::new_v4().simple()),
                ..super::tasks::RunRequest::new(
                    &project.id,
                    &project.name,
                    &project.path,
                    &agent
                        .filter(|agent| !agent.is_empty())
                        .unwrap_or(default_agent),
                    String::new(),
                )
            };
            let coordinator = app
                .state::<super::coordination::Coordinator>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || plans::start(&coordinator, template, goal))
                .await
                .map_err(|error| error.to_string())?
        }
        Request::Plans { project_path } => {
            let project = ensure_project(app, &project_path)?;
            let coordinator = app
                .state::<super::coordination::Coordinator>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || plans::list(&coordinator, &project.id))
                .await
                .map_err(|error| error.to_string())?
        }
        Request::PlanDetail { plan_id } => {
            let coordinator = app
                .state::<super::coordination::Coordinator>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || plans::get(&coordinator, &plan_id))
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
                plans::action(&coordinator, &plan_id, &action, text, revision, hash)
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
fn reviewable_run(app: &AppHandle, session_id: &str) -> Result<TaskRun, String> {
    let snapshot = app.state::<LiveSessions>().snapshot(Some(session_id))?;
    let session = snapshot
        .sessions
        .iter()
        .find(|session| session.id == session_id)
        .ok_or("That conversation is no longer open.")?;
    let run = view::latest_run(session_id, &snapshot.runs)
        .ok_or("This conversation has no work to deliver yet.")?;
    if protocol::working(Some(&run.status)) {
        return Err("Wait for the agent to finish first.".into());
    }
    if !run.status.is_done() {
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
