//! Codex turns through a long-lived `codex app-server` JSON-RPC session, one warm process
//! per live conversation.
//!
//! A turn starts or resumes the conversation's thread by the ID Jackalope saved (the same
//! thread ID `codex exec` reports, so attempts saved by either path continue in the
//! other), then sends the task with this turn's model, reasoning effort and service tier.
//! Codex's notifications become the `codex exec --json` events the attempt record is built
//! from ([`mapping`]), so the transcript and everything reading it stay as they were.
//! Codex runs in its workspace-write or read-only sandbox; with the `on-request` approval
//! policy it asks before going beyond it, and [`approval`] decides those requests through
//! the project's permission settings. A read-only plan session uses the `never` policy and
//! denies any request that still arrives.
//!
//! The process belongs to the attempt running its turn: it is registered in the runtime's
//! process table, so stopping the attempt ends its process tree. A stop first asks Codex to
//! interrupt the turn and gives it [`INTERRUPT_GRACE`] to settle; quitting kills it at
//! once. Between turns a process that finished cleanly is parked in a
//! [`super::warm_session::Pool`]. A follow-up with no matching warm process resumes the
//! thread from disk in a new one, which is also how a conversation continues after a
//! restart.
//!
//! When the app-server cannot run the turn before it starts (an older Codex without these
//! methods, a process that will not start, a setup Codex rejects), the attempt says why
//! and runs the turn with `codex exec` as before.

mod approval;
mod history;
mod mapping;
mod rpc;
#[cfg(test)]
mod tests;

use super::agent_process::{self, AgentProcess};
use super::claude_session::Partials;
use super::*;
use mapping::{Effect, Mapper, TurnEnd};
use rpc::{Connection, Inbound, RpcError};
use serde_json::json;
use std::sync::mpsc;
use std::time::Instant;

pub(in crate::commands) use history::CodexThread;

const INITIALIZE_LIMIT: Duration = Duration::from_secs(30);
/// Starting a thread also starts its MCP connections.
const THREAD_LIMIT: Duration = Duration::from_secs(120);
const TURN_START_LIMIT: Duration = Duration::from_secs(60);
const STEER_LIMIT: Duration = Duration::from_secs(15);
/// How long a stopped turn may take to settle after Codex is asked to interrupt it.
pub(super) const INTERRUPT_GRACE: Duration = Duration::from_secs(5);
/// Thread settings `codex exec` takes as configuration overrides, which a turn sets
/// through the protocol instead.
const PER_TURN: [&str; 4] = [
    "approval_policy",
    "sandbox_mode",
    "model_reasoning_effort",
    "service_tier",
];
/// Codex's refusal to resume a thread its store does not have.
const UNKNOWN_THREAD: &str = "no rollout found";

/// Whether project `project_id`'s Codex turns run in an app-server session.
pub(super) fn enabled(project_id: &str) -> bool {
    #[cfg(test)]
    {
        app_server_projects().lock().unwrap().contains(project_id)
    }
    #[cfg(not(test))]
    {
        let _ = project_id;
        crate::commands::experiments::is(
            crate::commands::experiments::Experiment::CodexTransport,
            "app-server",
        )
    }
}

/// Codex fixtures elsewhere in the suite speak only `codex exec`, so a test opts its
/// project into the app-server.
#[cfg(test)]
fn app_server_projects() -> &'static Mutex<std::collections::HashSet<String>> {
    static PROJECTS: std::sync::OnceLock<Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    PROJECTS.get_or_init(Default::default)
}

#[cfg(test)]
pub(super) fn use_app_server(project_id: &str) {
    app_server_projects()
        .lock()
        .unwrap()
        .insert(project_id.to_string());
}

/// What a turn asks of Codex beyond its launch command.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Settings {
    pub read_only: bool,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub service_tier: Option<String>,
}

impl Settings {
    fn sandbox(&self) -> &'static str {
        if self.read_only {
            "read-only"
        } else {
            "workspace-write"
        }
    }

    fn approval_policy(&self) -> &'static str {
        if self.read_only {
            "never"
        } else {
            "on-request"
        }
    }

    /// What a warm process must share with a turn besides its command. Codex keeps a
    /// turn's model, effort and tier for the thread's later turns, so a process whose
    /// turns set one cannot run a turn that wants Codex's configured default.
    fn identity(&self) -> String {
        format!(
            "read-only:{} model:{} effort:{} tier:{}",
            self.read_only,
            self.model.is_some(),
            self.effort.is_some(),
            self.service_tier.is_some()
        )
    }
}

/// The `codex app-server` command for a turn assembled as `codex exec`: the same program,
/// environment and configuration overrides, without exec's own arguments and the settings
/// a turn passes through the protocol.
pub(super) fn app_server_command(exec: &Command, workspace: &str) -> Command {
    let mut cmd = super::command(exec.get_program());
    for (name, value) in exec.get_envs() {
        match value {
            Some(value) => cmd.env(name, value),
            None => cmd.env_remove(name),
        };
    }
    cmd.current_dir(workspace)
        .args(["app-server", "--listen", "stdio://"]);
    let args: Vec<_> = exec.get_args().collect();
    let mut index = 0;
    while index < args.len() {
        match args[index].to_str() {
            Some("-c" | "--config") => {
                if let Some(value) = args.get(index + 1) {
                    let text = value.to_string_lossy();
                    let key = text.split('=').next().unwrap_or_default().trim();
                    // Standard speed is the `default` tier, which needs no feature.
                    let standard = key == "features.fast_mode" && text.ends_with("false");
                    if !PER_TURN.contains(&key) && !standard {
                        cmd.arg("-c").arg(value);
                    }
                }
                index += 2;
            }
            Some("resume" | "--model" | "-m") => index += 2,
            _ => index += 1,
        }
    }
    cmd
}

/// A running `codex app-server` and the thread it continues.
pub(super) struct Session {
    process: Arc<AgentProcess>,
    connection: Arc<Connection>,
    inbound: mpsc::Receiver<Inbound>,
    diagnostics: mpsc::Receiver<String>,
    key: [u8; 32],
    workspace: String,
    thread: Option<String>,
    bridge_token: Option<String>,
    account: Option<PathBuf>,
}

impl Session {
    /// Starts `cmd`. Returns the session and how many tries the launch took.
    fn spawn(
        cmd: &mut Command,
        agent: &str,
        key: [u8; 32],
        workspace: &str,
        bridge_token: Option<String>,
        account: Option<PathBuf>,
    ) -> Result<(Self, u32), String> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let spawned = AgentProcess::spawn(cmd, agent)?;
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (spawned.stdin, spawned.stdout, spawned.stderr)
        else {
            return Err("Codex did not expose its app-server streams.".into());
        };
        let (connection, inbound) = Connection::start(stdin, stdout);
        let (errors, diagnostics) = mpsc::channel();
        std::thread::spawn(move || {
            agent_process::read_diagnostics(stderr, |line| {
                let _ = errors.send(line);
            });
        });
        Ok((
            Self {
                process: spawned.process,
                connection,
                inbound,
                diagnostics,
                key,
                workspace: workspace.to_string(),
                thread: None,
                bridge_token,
                account,
            },
            spawned.attempts,
        ))
    }

    /// Introduces Jackalope to the server.
    fn initialize(&self) -> Result<(), RpcError> {
        self.connection.call(
            "initialize",
            json!({
                "clientInfo": {"name": "jackalope", "title": "Jackalope", "version": env!("CARGO_PKG_VERSION")},
                "capabilities": {"experimentalApi": false, "requestAttestation": false},
            }),
            INITIALIZE_LIMIT,
        )?;
        self.connection.notify("initialized", json!({}))
    }

    fn release_alias(&self) {
        if let Some(token) = &self.bridge_token {
            super::claude_session::release_bridge_token(token);
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.release_alias();
        let _ = self.process.finish();
    }
}

impl super::warm_session::Warm for Session {
    fn conversation(&self) -> Option<&str> {
        self.thread.as_deref()
    }

    fn key(&self) -> &[u8; 32] {
        &self.key
    }

    fn workspace(&self) -> &str {
        &self.workspace
    }

    fn account(&self) -> Option<&Path> {
        self.account.as_deref()
    }

    fn alive(&self) -> bool {
        self.process.alive()
    }
}

/// The turn an attempt is running, which a steer or stop reaches.
struct Live {
    connection: Arc<Connection>,
    thread: String,
    turn: String,
}

/// Warm Codex sessions and the turns running in them.
#[derive(Default)]
pub(super) struct Sessions {
    pool: super::warm_session::Pool<Session>,
    live: Mutex<HashMap<String, Live>>,
}

impl Sessions {
    pub(super) fn clear(&self) {
        self.pool.clear();
    }

    pub(super) fn invalidate_account(&self, directory: &Path) {
        self.pool.invalidate_account(directory);
    }

    /// Asks Codex to interrupt attempt `id`'s turn. False when it runs none.
    pub(super) fn interrupt(&self, id: &str) -> bool {
        let live = self.live.lock().unwrap();
        let Some(live) = live.get(id) else {
            return false;
        };
        live.connection
            .send(
                "turn/interrupt",
                json!({"threadId": live.thread, "turnId": live.turn}),
            )
            .is_ok()
    }

    #[cfg(test)]
    pub(super) fn warm(&self) -> usize {
        self.pool.warm()
    }
}

/// Ends `process` if it is still attempt `id`'s once an interrupted turn has had its
/// grace period, in case the turn never settles.
pub(super) fn terminate_later(runtime: &TaskRuntime, id: &str, process: Arc<AgentProcess>) {
    let (runtime, id) = (runtime.clone(), id.to_string());
    std::thread::spawn(move || {
        std::thread::sleep(INTERRUPT_GRACE + Duration::from_secs(2));
        let current = runtime.inner.lock().unwrap().processes.get(&id).cloned();
        if current.is_some_and(|current| Arc::ptr_eq(&current, &process)) {
            process.terminate();
        }
    });
}

pub(super) struct Launch<'a> {
    pub id: &'a str,
    pub request: &'a RunRequest,
    /// The turn as `codex exec` would run it.
    pub exec: &'a Command,
    pub input: &'a str,
    pub workspace: &'a str,
    pub previous_session: Option<&'a str>,
    pub settings: &'a Settings,
}

pub(super) enum Outcome {
    Ran {
        success: bool,
        exit_code: Option<i32>,
        quota_stopped: bool,
    },
    /// The attempt was stopped before the turn launched and has been marked stopped.
    Stopped,
    /// The app-server could not run this turn; it has not started, and the reason says why.
    Unavailable(String),
}

/// Why a thread could not be opened.
enum Setup {
    Unavailable(String),
    /// Codex no longer has the thread the turn continues.
    Refused(String),
}

impl TaskRuntime {
    /// Runs one Codex turn in a warm or newly started app-server.
    pub(super) fn run_codex_session(&self, launch: Launch) -> Result<Outcome, String> {
        let Launch {
            id,
            request,
            exec,
            input,
            workspace,
            previous_session,
            settings,
        } = launch;
        let mut cmd = app_server_command(exec, workspace);
        let key = super::warm_session::identity(&cmd, &settings.identity());
        let warm = previous_session
            .and_then(|thread| self.codex_sessions.pool.take(thread, &key, workspace));
        let bridge_token = request
            .coordination
            .as_ref()
            .map(|context| context.token.clone());
        let account = request
            .account_binding
            .as_ref()
            .map(|binding| binding.directory.clone());
        let started = Instant::now();
        let claimed = self.register_process(id, Some(workspace), || match warm {
            Some(session) => Ok((Some(session.process.clone()), Ok((session, "reused", 1)))),
            None => {
                let transport = if previous_session.is_some() {
                    "resumed"
                } else {
                    "started"
                };
                match Session::spawn(
                    &mut cmd,
                    &request.agent,
                    key,
                    workspace,
                    bridge_token.clone(),
                    account,
                ) {
                    Ok((session, attempts)) => Ok((
                        Some(session.process.clone()),
                        Ok((session, transport, attempts)),
                    )),
                    Err(error) => Ok((None, Err(error))),
                }
            }
        })?;
        let Some(claimed) = claimed else {
            self.mark_stopped(id);
            return Ok(Outcome::Stopped);
        };
        let (session, transport, attempts) = match claimed {
            Ok(claimed) => claimed,
            Err(error) => return Ok(Outcome::Unavailable(error)),
        };
        self.process_started(id, started.elapsed(), attempts, |run| {
            run.efficiency.codex_transport = Some(transport.into());
        })?;
        if let (Some(own), Some(current)) = (&session.bridge_token, &bridge_token) {
            super::claude_session::alias_bridge_token(own, current);
        }
        let thread = match &session.thread {
            Some(thread) if transport == "reused" => Ok(thread.clone()),
            _ => self.open_thread(&session, workspace, previous_session, settings),
        };
        let thread = match thread {
            Ok(thread) => thread,
            Err(setup) => {
                self.settle_diagnostics(id, &session);
                self.unregister_process(id);
                return Ok(match setup {
                    Setup::Unavailable(reason) => Outcome::Unavailable(reason),
                    Setup::Refused(refusal) => {
                        self.update(id, |run| {
                            super::resume::refused(run, &refusal);
                            run.error = Some(format!(
                                "Codex no longer has this task's earlier conversation: {refusal}"
                            ));
                        });
                        Outcome::Ran {
                            success: false,
                            exit_code: None,
                            quota_stopped: false,
                        }
                    }
                });
            }
        };
        let mut watch = super::resume::Watch::new("codex", previous_session);
        let event = json!({"type": "thread.started", "thread_id": thread}).to_string();
        self.update_output(id, |run| {
            consume_adapter_event(run, &event, "codex");
            watch.observe(run);
        })?;
        let mut turn_params = json!({
            "threadId": thread,
            "input": [{"type": "text", "text": input, "text_elements": []}],
        });
        for (name, value) in [
            ("model", &settings.model),
            ("effort", &settings.effort),
            ("serviceTier", &settings.service_tier),
        ] {
            if let Some(value) = value {
                turn_params[name] = json!(value);
            }
        }
        let turn = match session
            .connection
            .call("turn/start", turn_params, TURN_START_LIMIT)
        {
            Ok(response) => response["turn"]["id"].as_str().map(str::to_string),
            Err(error) => {
                self.settle_diagnostics(id, &session);
                self.unregister_process(id);
                return Ok(Outcome::Unavailable(format!(
                    "Codex did not start the turn: {error}"
                )));
            }
        };
        let Some(turn) = turn else {
            self.unregister_process(id);
            return Ok(Outcome::Unavailable(
                "Codex started the turn without an ID.".into(),
            ));
        };
        self.codex_sessions.live.lock().unwrap().insert(
            id.to_string(),
            Live {
                connection: session.connection.clone(),
                thread: thread.clone(),
                turn: turn.clone(),
            },
        );
        self.update(id, |run| run.steerable = true);
        let mut state = TurnState {
            mapper: Mapper::new(&turn),
            partials: Partials::new(started),
            watch,
            ended: None,
            closed: false,
        };
        let quota_stopped = self.drive_codex_turn(id, &session, settings, &mut state);
        self.codex_sessions.live.lock().unwrap().remove(id);
        self.update(id, |run| run.steerable = false);
        state.partials.complete(self, id);
        session.release_alias();
        if state.closed {
            std::thread::sleep(Duration::from_millis(200));
        }
        self.settle_diagnostics(id, &session);
        self.unregister_process(id);
        let exit_code = if state.closed || !session.process.alive() {
            session
                .process
                .finish()
                .ok()
                .and_then(|status| status.code())
        } else {
            None
        };
        let canceled = self.inner.lock().unwrap().canceled.contains(id);
        let success = state.ended == Some(TurnEnd::Completed) && !state.closed;
        if !canceled && !quota_stopped {
            let unfinished = match &state.ended {
                None => Some("Codex's app-server exited before the turn finished.".to_string()),
                Some(TurnEnd::Interrupted) => {
                    Some("Codex stopped the turn before it finished.".to_string())
                }
                _ => None,
            };
            if let Some(unfinished) = unfinished {
                let last = self
                    .run_snapshot(id)
                    .and_then(|run| run.diagnostics.last().cloned())
                    .map(|line| format!(" {line}"))
                    .unwrap_or_default();
                self.update(id, |run| {
                    run.error.get_or_insert(format!("{unfinished}{last}"));
                });
            }
        }
        // A turn the person stopped leaves the thread idle and the process ready.
        let reusable = if canceled {
            state.ended == Some(TurnEnd::Interrupted)
        } else {
            success && !quota_stopped
        };
        if reusable && !state.closed && session.process.alive() {
            let mut session = session;
            session.thread = Some(thread);
            self.codex_sessions.pool.park(session);
        }
        Ok(Outcome::Ran {
            success,
            exit_code,
            quota_stopped,
        })
    }

    fn open_thread(
        &self,
        session: &Session,
        workspace: &str,
        previous: Option<&str>,
        settings: &Settings,
    ) -> Result<String, Setup> {
        session.initialize().map_err(|error| {
            Setup::Unavailable(format!("Codex's app-server did not start: {error}"))
        })?;
        let mut params = json!({
            "cwd": workspace,
            "approvalPolicy": settings.approval_policy(),
            "sandbox": settings.sandbox(),
        });
        if let Some(model) = &settings.model {
            params["model"] = json!(model);
        }
        let (method, response) = match previous {
            Some(thread) => {
                params["threadId"] = json!(thread);
                params["excludeTurns"] = json!(true);
                (
                    "thread/resume",
                    session
                        .connection
                        .call("thread/resume", params, THREAD_LIMIT),
                )
            }
            None => (
                "thread/start",
                session
                    .connection
                    .call("thread/start", params, THREAD_LIMIT),
            ),
        };
        let response = response.map_err(|error| {
            if method == "thread/resume" && error.message.contains(UNKNOWN_THREAD) {
                Setup::Refused(error.to_string())
            } else if error.missing_method() {
                Setup::Unavailable(format!(
                    "This Codex version's app-server does not support {method} ({error})"
                ))
            } else {
                Setup::Unavailable(format!(
                    "Codex could not open the conversation ({method}): {error}"
                ))
            }
        })?;
        response["thread"]["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| Setup::Unavailable(format!("Codex answered {method} without a thread.")))
    }

    /// Follows the turn until it ends or the process does. Returns whether a quota handoff
    /// stopped it.
    fn drive_codex_turn(
        &self,
        id: &str,
        session: &Session,
        settings: &Settings,
        state: &mut TurnState,
    ) -> bool {
        let mut quota_stopped = false;
        let mut stop_deadline: Option<Instant> = None;
        while state.ended.is_none() {
            while let Ok(line) = session.diagnostics.try_recv() {
                let _ = self.update_output(id, |run| run.diagnostics.push(line));
            }
            match session.inbound.recv_timeout(Duration::from_millis(100)) {
                Ok(Inbound::Notification { method, params }) => {
                    self.apply_codex(id, state, &method, &params)
                }
                Ok(Inbound::Request {
                    id: request,
                    method,
                    params,
                }) => {
                    let runtime = self.clone();
                    let connection = session.connection.clone();
                    let run_id = id.to_string();
                    let files = state.mapper.files.clone();
                    let read_only = settings.read_only;
                    std::thread::spawn(move || {
                        let paths = files
                            .lock()
                            .unwrap()
                            .get(params["itemId"].as_str().unwrap_or_default())
                            .cloned()
                            .unwrap_or_default();
                        if approval::subject(&method, &params, &paths).is_none() {
                            connection.reject(&request, "Jackalope does not handle this request.");
                            return;
                        }
                        let reply = approval::answer(
                            &runtime, &run_id, read_only, &method, &params, &paths,
                        );
                        connection.respond(&request, reply);
                    });
                }
                Ok(Inbound::Oversized) => {
                    let _ = self.update_output(id, |run| {
                        activity(run, "An oversized agent event was omitted. Inspect the agent session for full output.")
                    });
                }
                Ok(Inbound::Closed) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    state.closed = true;
                    return quota_stopped;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if !quota_stopped && self.quota_handoff(id) {
                quota_stopped = true;
                session.process.terminate();
            }
            if self.inner.lock().unwrap().canceled.contains(id) {
                let deadline =
                    *stop_deadline.get_or_insert_with(|| Instant::now() + INTERRUPT_GRACE);
                if Instant::now() >= deadline {
                    session.process.terminate();
                }
            }
        }
        quota_stopped
    }

    fn apply_codex(&self, id: &str, state: &mut TurnState, method: &str, params: &Value) {
        for effect in state.mapper.map(method, params) {
            match effect {
                Effect::Event(event) => {
                    if event["type"] == "item.completed" && event["item"]["type"] == "agent_message"
                    {
                        state.partials.complete(self, id);
                    }
                    let line = event.to_string();
                    let started = state.partials.started();
                    let watch = &mut state.watch;
                    let _ = self.update_output(id, |run| {
                        if super::efficiency::useful_event(&line, "codex") {
                            run.efficiency.first_activity(started.elapsed());
                        }
                        consume_adapter_event(run, &line, "codex");
                        watch.observe(run);
                    });
                }
                Effect::Activity(text) => {
                    let _ = self.update_output(id, |run| activity(run, &text));
                }
                Effect::Diagnostic(text) => {
                    let _ = self.update_output(id, |run| run.diagnostics.push(text));
                }
                Effect::Delta(text) => state.partials.delta(self, id, &text),
                Effect::MessageStart => state.partials.message_start(),
                Effect::Usage(usage) => self.update(id, |run| {
                    run.usage = Usage {
                        input: usage.input,
                        output: usage.output,
                        cache_read: usage.cached,
                        reported: true,
                        ..Usage::default()
                    }
                }),
                Effect::Ended(end) => state.ended = Some(end),
            }
        }
    }

    fn settle_diagnostics(&self, id: &str, session: &Session) {
        while let Ok(line) = session.diagnostics.try_recv() {
            let _ = self.update_output(id, |run| run.diagnostics.push(line));
        }
    }

    /// Adds `text` to the turn attempt `id` is running in Codex, as Codex's turn/steer
    /// does: the agent reads it before its next step, in the same turn. Fails when the
    /// attempt is not running a Codex turn that takes messages, with Codex's reason.
    pub(in crate::commands) fn steer(&self, id: &str, text: &str) -> Result<(), String> {
        let (connection, thread, turn) = {
            let live = self.codex_sessions.live.lock().unwrap();
            let live = live
                .get(id)
                .ok_or("This turn is not running in a Codex session that takes messages.")?;
            (
                live.connection.clone(),
                live.thread.clone(),
                live.turn.clone(),
            )
        };
        connection
            .call(
                "turn/steer",
                json!({
                    "threadId": thread,
                    "expectedTurnId": turn,
                    "input": [{"type": "text", "text": text, "text_elements": []}],
                }),
                STEER_LIMIT,
            )
            .map_err(|error| error.to_string())?;
        self.update(id, |run| {
            activity(run, "Sent a new message into the running turn.")
        });
        Ok(())
    }
}

struct TurnState {
    mapper: Mapper,
    partials: Partials,
    watch: super::resume::Watch,
    ended: Option<TurnEnd>,
    closed: bool,
}
