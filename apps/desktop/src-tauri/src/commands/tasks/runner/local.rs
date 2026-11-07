//! The runner on this device.
//!
//! The agent CLI runs in the attempt's own worktree, so there is nothing to
//! send or bring back: preparing and collecting leave the workspace as it is.
//! The bridge serves every tool in-process, and the runner reports every
//! workspace capability ([`computers::runner::RunnerCapabilities::device`]).
//! The agent process is owned here: it is registered under the attempt so
//! [`TaskRuntime::stop`] can end its process tree, and a persistent Claude Code
//! session is driven through [`TaskRuntime::run_claude_session`].

use super::super::{antigravity, claude_session, gemini, kimi, opencode};
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
    /// Keeps a managed runtime in use while its agent runs.
    lease: Option<crate::commands::managed_runtime::UseGuard>,
    process: Option<Process>,
}

/// The running agent process and its readers.
struct Process {
    child: Arc<Mutex<std::process::Child>>,
    tree: crate::commands::process_control::ProcessTree,
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
            lease,
            process: None,
        }
    }
}

impl AttemptRunner for LocalRunner {
    fn access(&self) -> &computers::runner::Access {
        &self.access
    }

    /// The worktree is used as it is.
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
        let cmd = &mut launch.cmd;
        cmd.current_dir(workspace)
            .stdin(Stdio::piped())
            .stdout(if self.opencode.is_some() {
                Stdio::null()
            } else {
                Stdio::piped()
            })
            .stderr(Stdio::piped());
        // The check and the spawn hold the runtime lock together, so no other
        // attempt can take the workspace in between.
        let mut inner = runtime.inner.lock().unwrap();
        if inner.canceled.contains(id) {
            drop(inner);
            runtime.mark_stopped(id);
            return Ok(Step::Stopped);
        }
        if workspace_in_use(&inner, id, workspace) {
            return Err(WORKSPACE_IN_USE.into());
        }
        let launched = std::time::Instant::now();
        if let Some(connection) = &mut self.opencode {
            connection.release_port();
        }
        let spawned = super::super::runtime::spawn_agent(cmd, &req.agent);
        let spawn_elapsed = launched.elapsed();
        let (mut child, spawn_attempts) = spawned?;
        let tree = match crate::commands::process_control::ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let mut stdin = child.stdin.take().ok_or("Missing agent input")?;
        let stdout = child.stdout.take();
        if stdout.is_none() && self.opencode.is_none() {
            tree.terminate();
            let _ = child.kill();
            let _ = child.wait();
            return Err("Missing agent output".into());
        }
        let stderr = child.stderr.take().ok_or("Missing agent diagnostics")?;
        let process = Arc::new(Mutex::new(child));
        inner.processes.insert(id.into(), process.clone());
        drop(inner);
        runtime.update_checked(id, |r| {
            r.efficiency.timing("processSpawn", spawn_elapsed);
            r.process_contained = cfg!(windows);
            if r.status == "starting" {
                r.status = "running".into();
            }
            // The agent is live now; its own activity replaces the startup step.
            r.progress = None;
            if spawn_attempts > 1 {
                activity(
                    r,
                    &format!("The agent process started after {spawn_attempts} attempts."),
                );
            }
        })?;
        let opencode_connection = self.opencode.take();
        let server_transport = opencode_connection.is_some();
        let input = std::mem::take(&mut launch.input);
        let input_result =
            if adapter == "grok" || adapter == "kimi" || adapter == "acp" || server_transport {
                Ok(())
            } else {
                stdin.write_all(input.as_bytes())
            };
        let mut acp_input = (adapter == "kimi" || adapter == "acp").then_some(stdin);
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
            if output_adapter == "kimi" || output_adapter == "acp" {
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
            if let Err(error) = crate::commands::process_control::bounded_lines(
                BufReader::new(stdout),
                1_000_000,
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
                        if output_adapter == "antigravity" { r.error.get_or_insert("Antigravity returned an oversized protocol event; the result could not be fully verified.".into()); }
                        if output_adapter == "gemini" { r.error.get_or_insert("Gemini CLI returned an oversized protocol event; the result could not be fully verified.".into()); }
                    }
                    else if output_adapter == "antigravity" { stream.consume(r, &line); }
                    else if output_adapter == "gemini" { gemini_stream.consume(r, &line); }
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
            if output_adapter == "antigravity" {
                runtime.update(&event_id, |run| stream.finish(run));
            }
            if output_adapter == "gemini" {
                runtime.update(&event_id, |run| gemini_stream.finish(run));
            }
        });
        let diagnostics_runtime = runtime.clone();
        let event_id = id.to_string();
        let diagnostics_adapter = adapter.to_string();
        let diagnostics = std::thread::spawn(move || {
            let runtime = diagnostics_runtime;
            let _ = crate::commands::process_control::bounded_lines(
                BufReader::new(stderr),
                6000,
                |mut line, truncated| {
                    if truncated {
                        line.push_str(" [truncated]");
                    }
                    let _ = runtime.update_output(&event_id, |r| {
                        if diagnostics_adapter == "antigravity"
                            && antigravity::permission_denied(&line)
                        {
                            antigravity::mark_permission_denied(r);
                        }
                        r.diagnostics.push(line);
                    });
                },
            );
        });
        self.process = Some(Process {
            child: process,
            tree,
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
                context_by_hook: persistent.settings.hooks.context,
                runner_lease: self.lease.take(),
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
        let (child, server_transport) = (process.child.clone(), process.server_transport);
        let started = std::time::Instant::now();
        let mut timed_out = false;
        let mut quota_stopped = false;
        let exit = loop {
            if let Some(exit) = child
                .lock()
                .unwrap()
                .try_wait()
                .map_err(|e| e.to_string())?
            {
                break exit;
            }
            let process = self.process.as_ref().unwrap();
            if (adapter == "kimi" || adapter == "acp" || server_transport)
                && process.reader.is_finished()
            {
                process.tree.terminate();
                let mut child = child.lock().unwrap();
                let _ = child.kill();
                break child.wait().map_err(|error| error.to_string())?;
            }
            let probe = *process.usage_probe.lock().unwrap();
            if let Some((began, after_turn)) = probe {
                if began.elapsed() > Duration::from_secs(15) {
                    if !after_turn {
                        runtime.update(id, |run| run.error = Some("Kimi's usage command timed out before the task started. Update the CLI and retry.".into()));
                    }
                    self.stop()?;
                }
            }
            if (matches!(adapter, "antigravity" | "kimi" | "acp" | "gemini") || server_transport)
                && !timed_out
                && started.elapsed() > antigravity::TIMEOUT
            {
                timed_out = true;
                runtime.update(id, |run| run.error = Some(format!("{adapter} exceeded the 30-minute attempt limit. Inspect the saved work and continue the task.")));
                self.stop()?;
            }
            std::thread::sleep(Duration::from_millis(100));
            if !quota_stopped && runtime.quota_handoff(id) {
                quota_stopped = true;
                self.stop()?;
            }
        };
        let process = self.process.take().unwrap();
        process.tree.terminate();
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
        let success = if adapter == "kimi" || adapter == "acp" || server_transport {
            process.turn_succeeded.load(Ordering::SeqCst) && !timed_out
        } else {
            exit.success()
        };
        if adapter == "grok" {
            let _ = std::fs::remove_file(runtime.directory.join(format!("{id}.prompt")));
        }
        runtime.inner.lock().unwrap().processes.remove(id);
        Ok(Some(Outcome {
            success,
            exit_code: exit.code(),
            quota_stopped,
        }))
    }

    /// Ends the agent's process tree.
    fn stop(&mut self) -> Result<(), String> {
        if let Some(process) = &self.process {
            process.tree.terminate();
            let _ = process.child.lock().unwrap().kill();
        }
        Ok(())
    }

    /// The agent edited the worktree itself.
    fn collect(&mut self, _: &TaskRuntime, _: &mut Launch, _: &Outcome) {}
}
