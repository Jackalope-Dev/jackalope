//! The runner on this device.
//!
//! The agent CLI runs in the attempt's own worktree, so there is nothing to
//! send or bring back: preparing and collecting leave the workspace as it is.
//! The bridge serves every tool in-process, and the runner reports every
//! workspace capability ([`computers::runner::RunnerCapabilities::device`]).
//! The agent process is owned here: it is registered under the attempt so
//! [`TaskRuntime::stop`] can end its process tree, and a persistent Claude Code
//! session is driven through [`TaskRuntime::run_claude_session`].

use super::super::{
    agent_process::AgentProcess, antigravity, claude_session, gemini, kimi, opencode,
};
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

/// A persistent Claude Code session continues the attempt's conversation.
pub(in crate::commands::tasks) struct Persistent {
    pub settings: claude_session::Settings,
    pub final_check: bool,
}

/// An attempt whose agent CLI runs on this device.
pub(in crate::commands::tasks) struct LocalRunner {
    access: computers::runner::Access,
    /// The agent session a continuation resumes.
    resumed_session: Option<String>,
    selected_model: Option<String>,
    opencode: Option<opencode::Connection>,
    acp_servers: Vec<serde_json::Value>,
    persistent: Option<Persistent>,
    /// Keeps a managed runtime installed from launch until the agent's own
    /// process holds it.
    _lease: Option<crate::commands::managed_runtime::UseGuard>,
    process: Option<Process>,
}

/// The running agent process and its readers.
struct Process {
    process: Arc<AgentProcess>,
    reader: std::thread::JoinHandle<()>,
    diagnostics: std::thread::JoinHandle<()>,
    /// An ACP or server transport's turn completed.
    turn_succeeded: Arc<AtomicBool>,
    usage_probe: Arc<Mutex<Option<(std::time::Instant, bool)>>>,
    /// OpenCode's server transport, whose turn ends without the process.
    server_transport: bool,
}

impl LocalRunner {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::commands::tasks) fn new(
        read_only: bool,
        resumed_session: Option<String>,
        selected_model: Option<String>,
        opencode: Option<opencode::Connection>,
        acp_servers: Vec<serde_json::Value>,
        persistent: Option<Persistent>,
        lease: Option<crate::commands::managed_runtime::UseGuard>,
    ) -> Self {
        Self {
            access: computers::runner::Access::device(read_only),
            resumed_session,
            selected_model,
            opencode,
            acp_servers,
            persistent,
            _lease: lease,
            process: None,
        }
    }
}

impl AttemptRunner for LocalRunner {
    fn access(&self) -> &computers::runner::Access {
        &self.access
    }

    fn prepare(&mut self, _: &TaskRuntime, _: &mut Launch) -> Result<Step, String> {
        Ok(Step::Ready)
    }

    fn start(&mut self, runtime: &TaskRuntime, launch: &mut Launch) -> Result<Step, String> {
        // A persistent session starts or continues its process when followed.
        if self.persistent.is_some() {
            return Ok(Step::Ready);
        }
        let (id, req, adapter, workspace) =
            (launch.id, launch.req, launch.adapter, launch.workspace);
        let spec = crate::commands::agents::find(adapter).ok_or("Unsupported agent")?;
        let cmd = &mut launch.cmd;
        cmd.current_dir(workspace)
            .stdin(Stdio::piped())
            .stdout(if self.opencode.is_some() {
                Stdio::null()
            } else {
                Stdio::piped()
            })
            .stderr(Stdio::piped());
        let launched = std::time::Instant::now();
        let opencode = &mut self.opencode;
        let server = opencode.is_some();
        let Some(spawned) = runtime.register_process(id, Some(workspace), || {
            if let Some(connection) = opencode {
                connection.release_port();
            }
            let spawned = AgentProcess::spawn(cmd, &req.agent)?;
            if spawned.stdin.is_none() {
                return Err("Missing agent input".into());
            }
            if spawned.stdout.is_none() && !server {
                return Err("Missing agent output".into());
            }
            if spawned.stderr.is_none() {
                return Err("Missing agent diagnostics".into());
            }
            Ok((Some(spawned.process.clone()), spawned))
        })?
        else {
            runtime.mark_stopped(id);
            return Ok(Step::Stopped);
        };
        let process = spawned.process;
        let (mut stdin, stdout, stderr) = (
            spawned.stdin.unwrap(),
            spawned.stdout,
            spawned.stderr.unwrap(),
        );
        runtime.process_started(id, spawned.elapsed, spawned.attempts, |_| {})?;
        let opencode_connection = self.opencode.take();
        let server_transport = opencode_connection.is_some();
        let input = std::mem::take(&mut launch.input);
        let input_result = if spec.prompt != Prompt::Stdin || server_transport {
            Ok(())
        } else {
            stdin.write_all(input.as_bytes())
        };
        let protocol = spec.protocol;
        let mut acp_input = (protocol == Protocol::Acp).then_some(stdin);
        if let Err(error) = input_result {
            let _ = runtime.stop(id);
            return Err(format!("Could not deliver task: {error}"));
        }
        let reader_runtime = runtime.clone();
        let event_id = id.to_string();
        let output_adapter = adapter.to_string();
        let resumed_session = self.resumed_session.clone();
        let turn_succeeded = Arc::new(AtomicBool::new(false));
        let reader_success = turn_succeeded.clone();
        let usage_probe = Arc::new(Mutex::new(None));
        let reader_probe = usage_probe.clone();
        let acp_workspace = workspace.to_string();
        let task_effort = req.effort;
        let selected_model = self.selected_model.clone();
        let acp_servers = std::mem::take(&mut self.acp_servers);
        let reader = std::thread::spawn(move || {
            let runtime = reader_runtime;
            if let Some(connection) = opencode_connection {
                match connection.drive(
                    &runtime,
                    &event_id,
                    &acp_workspace,
                    resumed_session.as_deref(),
                    selected_model.as_deref(),
                    task_effort,
                    &input,
                    launched,
                ) {
                    Ok(()) => reader_success.store(true, Ordering::SeqCst),
                    Err(error) => runtime.update(&event_id, |run| {
                        run.error.get_or_insert(error);
                    }),
                }
                return;
            }
            let stdout = stdout.unwrap();
            if protocol == Protocol::Acp {
                let result = kimi::drive_with_servers(
                    BufReader::new(stdout),
                    &mut acp_input.take().unwrap(),
                    &acp_workspace,
                    resumed_session.as_deref(),
                    selected_model.as_deref(),
                    &input,
                    &acp_servers,
                    |update| {
                        if update["sessionUpdate"] == "jackalope_usage_probe" {
                            *reader_probe.lock().unwrap() = (update["active"] == true)
                                .then(|| (std::time::Instant::now(), update["afterTurn"] == true));
                        } else {
                            let _ = runtime.update_output(&event_id, |run| {
                                if matches!(
                                    update["sessionUpdate"].as_str(),
                                    Some("agent_message_chunk" | "tool_call")
                                ) {
                                    run.efficiency.first_activity(launched.elapsed());
                                }
                                kimi::consume(run, update);
                            });
                        }
                    },
                    |params| kimi::permission(&runtime, &event_id, params),
                );
                match result {
                    Ok(()) => reader_success.store(true, Ordering::SeqCst),
                    Err(error) => runtime.update(&event_id, |run| {
                        run.error.get_or_insert(error);
                    }),
                }
                return;
            }
            let mut gemini_stream = gemini::Stream::new(resumed_session.clone());
            let mut stream = antigravity::Stream::new(resumed_session);
            let mut partials = claude_session::Partials::new(launched);
            if let Err(error) = super::super::agent_process::read_lines(
                stdout,
                |line, truncated| {
                    if output_adapter == "claude"
                        && !truncated
                        && partials.consume(&runtime, &event_id, &line)
                    {
                        return;
                    }
                    let _ = runtime.update_output(&event_id, |r| {
                    if !truncated && super::super::efficiency::useful_event(&line, &output_adapter) {
                        r.efficiency.first_activity(launched.elapsed());
                    }
                    if truncated {
                        activity(r, "An oversized agent event was omitted. Inspect the agent session for full output.");
                        if matches!(protocol, Protocol::Antigravity | Protocol::Gemini) { r.error.get_or_insert(format!("{} returned an oversized protocol event; the result could not be fully verified.", spec.name)); }
                    }
                    else if protocol == Protocol::Antigravity { stream.consume(r, &line); }
                    else if protocol == Protocol::Gemini { gemini_stream.consume(r, &line); }
                    else { consume_adapter_event(r, &line, &output_adapter); }
                });
                },
            ) {
                let _ = runtime.update_output(&event_id, |r| {
                    r.error = Some(format!("Agent output could not be read: {error}"))
                });
            }
            if output_adapter == "claude" {
                partials.complete(&runtime, &event_id);
            }
            if protocol == Protocol::Antigravity {
                runtime.update(&event_id, |run| stream.finish(run));
            }
            if protocol == Protocol::Gemini {
                runtime.update(&event_id, |run| gemini_stream.finish(run));
            }
        });
        let diagnostics_runtime = runtime.clone();
        let event_id = id.to_string();
        let diagnostics_adapter = adapter.to_string();
        let diagnostics = std::thread::spawn(move || {
            let runtime = diagnostics_runtime;
            super::super::agent_process::read_diagnostics(stderr, |line| {
                let _ = runtime.update_output(&event_id, |r| {
                    if diagnostics_adapter == "antigravity" && antigravity::permission_denied(&line)
                    {
                        antigravity::mark_permission_denied(r);
                    }
                    r.diagnostics.push(line);
                });
            });
        });
        self.process = Some(Process {
            process,
            reader,
            diagnostics,
            turn_succeeded,
            usage_probe,
            server_transport,
        });
        Ok(Step::Ready)
    }

    fn follow(
        &mut self,
        runtime: &TaskRuntime,
        launch: &mut Launch,
    ) -> Result<Option<Outcome>, String> {
        let (id, adapter) = (launch.id, launch.adapter);
        let spec = crate::commands::agents::find(adapter).ok_or("Unsupported agent")?;
        if let Some(persistent) = self.persistent.take() {
            let outcome = runtime.run_claude_session(claude_session::Launch {
                id,
                request: launch.req,
                cmd: std::mem::replace(&mut launch.cmd, Command::new("")),
                input: std::mem::take(&mut launch.input),
                workspace: launch.workspace.to_string(),
                previous_session: self.resumed_session.clone(),
                settings: persistent.settings,
                final_check: persistent.final_check,
            })?;
            return Ok(outcome.map(|outcome| Outcome {
                success: outcome.success,
                exit_code: outcome.exit_code,
                quota_stopped: outcome.quota_stopped,
            }));
        }
        let Some(process) = self.process.as_ref() else {
            return Err("The agent did not start.".into());
        };
        let (child, server_transport) = (process.process.clone(), process.server_transport);
        let started = std::time::Instant::now();
        let mut timed_out = false;
        let mut quota_stopped = false;
        let exit = loop {
            if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                break exit;
            }
            let process = self.process.as_ref().unwrap();
            if (spec.protocol == Protocol::Acp || server_transport) && process.reader.is_finished()
            {
                break child.finish().map_err(|error| error.to_string())?;
            }
            let probe = *process.usage_probe.lock().unwrap();
            if let Some((began, after_turn)) = probe {
                if began.elapsed() > Duration::from_secs(15) {
                    if !after_turn {
                        runtime.update(id, |run| run.error = Some(format!("{}'s usage command timed out before the task started. Update the CLI and retry.", spec.short_name)));
                    }
                    self.stop()?;
                }
            }
            if (spec.attempt_limit || server_transport)
                && !timed_out
                && started.elapsed() > crate::commands::agents::ATTEMPT_LIMIT
            {
                timed_out = true;
                let minutes = crate::commands::agents::ATTEMPT_LIMIT.as_secs() / 60;
                runtime.update(id, |run| run.error = Some(format!("{} exceeded the {minutes}-minute attempt limit. Inspect the saved work and continue the task.", spec.name)));
                self.stop()?;
            }
            std::thread::sleep(Duration::from_millis(100));
            if !quota_stopped && runtime.quota_handoff(id) {
                quota_stopped = true;
                self.stop()?;
            }
        };
        let process = self.process.take().unwrap();
        process.process.terminate();
        let _ = process.reader.join();
        let _ = process.diagnostics.join();
        if adapter == "gemini" && !exit.success() {
            runtime.update(id, |run| {
                for line in run.diagnostics.clone() {
                    gemini::diagnostic(run, &line);
                }
            });
        }
        // ACP completion is the turn receipt; its persistent server is stopped by the owner.
        let success = if spec.protocol == Protocol::Acp || server_transport {
            process.turn_succeeded.load(Ordering::SeqCst) && !timed_out
        } else {
            exit.success()
        };
        if spec.prompt == Prompt::File {
            let _ = std::fs::remove_file(runtime.directory.join(format!("{id}.prompt")));
        }
        runtime.unregister_process(id);
        Ok(Some(Outcome {
            success,
            exit_code: exit.code(),
            quota_stopped,
        }))
    }

    fn stop(&mut self) -> Result<(), String> {
        if let Some(process) = &self.process {
            process.process.terminate();
        }
        Ok(())
    }

    fn collect(&mut self, _: &TaskRuntime, _: &mut Launch, _: &Outcome) {}
}
