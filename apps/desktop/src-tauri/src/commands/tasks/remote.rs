//! Attempts whose agent CLI runs on the project's computer.
//!
//! Workspace preparation, checks, checkpoints, review and integration stay on
//! this device and are unchanged; only the agent process moves. The local
//! workspace is uploaded, the agent's output is read back by cursor and fed to
//! the same event parsers as a local process, and its changes are applied to
//! the local workspace before [`TaskRuntime::complete_attempt`] runs, so the
//! coordinator → execution guard → runtime lock order is untouched. Bridge
//! calls the agent makes on the computer come back with each read and are
//! forwarded to this device's bridge by [`runs::Session`]'s caller through
//! [`relay::Relay`].
//!
//! Read-only attempts (a plan-mode planner, a swarm round's orchestrator) run
//! there too. They upload to a run folder of their own and bring nothing back:
//! changes they make on the computer anyway are reported and discarded, so this
//! device's copy stays identical to what they read.

use super::*;
use crate::commands::computers::{self, credentials, relay, runner, runs, Computer};

/// How long a run waits for its computer to start; a first image build is slow.
const START_WAIT: Duration = Duration::from_secs(20 * 60);
/// How long a run keeps trying to reach its computer before giving up. The
/// agent there stops after ten minutes without contact, but its changes stay
/// until they are brought back.
const LOST_WINDOW: Duration = Duration::from_secs(30 * 60);
/// Failed reads, about two seconds apart, between reconnection attempts.
const RECONNECT_EVERY: u32 = 5;

/// How a remote run's reading ended.
struct Followed {
    exit: Option<serde_json::Value>,
    quota_stopped: bool,
    lost: bool,
}

impl TaskRuntime {
    /// Whether this project's attempts with `adapter` run on its computer, so
    /// the agent CLI need not be installed on this device.
    pub(in crate::commands) fn runs_remotely(&self, project_id: &str, adapter: &str) -> bool {
        credentials::REMOTE_ADAPTERS.contains(&adapter)
            && runs::project_computer(&self.computers_root(), project_id).is_some()
    }

    /// The computer this attempt's agent runs on, or `None` to run it here.
    /// Read-only planning attempts follow the project like any other.
    pub(super) fn remote_target(
        &self,
        id: &str,
        req: &RunRequest,
        adapter: &str,
    ) -> Option<Computer> {
        let computer = runs::project_computer(&self.computers_root(), &req.project_id)?;
        if !credentials::REMOTE_ADAPTERS.contains(&adapter) {
            self.update(id, |run| {
                activity(
                    run,
                    &format!(
                        "{} cannot run on {} yet, so it runs on this device.",
                        req.agent, computer.name
                    ),
                )
            });
            return None;
        }
        Some(computer)
    }

    /// Records which selected stdio connections start with the run and tells
    /// the agent. Returns the `run_start` request for them.
    #[allow(clippy::too_many_arguments)]
    fn computer_connections(
        &self,
        id: &str,
        adapter: &str,
        computer: &Computer,
        status: Option<&serde_json::Value>,
        relayed: bool,
        connections: Vec<crate::commands::mcp::ComputerConnection>,
        input: &mut String,
    ) -> Option<serde_json::Value> {
        let plan = connection_plan(adapter, &computer.name, status, relayed, &connections)?;
        self.update(id, |run| activity(run, &plan.activity));
        input.push_str(&plan.instructions);
        plan.request
    }

    fn remote_progress(&self, id: &str, label: &str, detail: &str) {
        self.update(id, |run| {
            let mut step = super::preparation::StepProgress::new("agent", label, 1);
            step.detail = detail.into();
            run.progress = Some(step);
        });
    }

    fn remote_stopped(&self, id: &str) {
        self.update(id, |r| {
            r.status = "stopped".into();
            r.ended_at = Some(Utc::now().to_rfc3339());
        });
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn run_remote(
        &self,
        id: &str,
        req: &RunRequest,
        adapter: &str,
        cmd: Command,
        mut input: String,
        workspace: &str,
        computer: Computer,
        connections: Vec<crate::commands::mcp::ComputerConnection>,
    ) -> Result<(), String> {
        let root = self.computers_root();
        let bridge = req.coordination.as_ref();
        let read_only = crate::commands::planning::read_only(id);
        // Checks the sign-in before waiting for the computer.
        runs::translate(adapter, &cmd, &root, bridge.map(|b| b.endpoint.as_str()))?;
        {
            let inner = self.inner.lock().unwrap();
            if inner.canceled.contains(id) {
                drop(inner);
                self.remote_stopped(id);
                return Ok(());
            }
            if inner.runs.values().any(|r| {
                r.id != id
                    && r.workspace == workspace
                    && ["starting", "running", "stopping"].contains(&r.status.as_str())
            }) {
                return Err(
                    "Another attempt is using this workspace. Stop it or wait before continuing."
                        .into(),
                );
            }
        }
        self.update_checked(id, |run| {
            run.remote = Some(RemoteExecution {
                computer_id: computer.id.clone(),
                computer_name: computer.name.clone(),
            })
        })?;
        self.remote_progress(id, &format!("Starting {}", computer.name), "");
        computers::ready_within(&root, &computer, START_WAIT)?;
        computers::usage::note(&root, &computer.id);
        let mut session = runs::Session::open(&root, &computer, workspace)?;
        if read_only {
            session.name = runs::read_only_run_name(workspace);
        }
        // An agent from before the relay answers no status and gets no bridge.
        let status = session.status()?;
        if let Some(status) = status.as_ref().filter(|status| status["exists"] == true) {
            self.recover_remote(id, &mut session, status, workspace, &computer, read_only);
        }
        let relayed = bridge.filter(|_| status.is_some());
        // A runner with artifacts receives large bridge answers whole, so
        // on-demand results need no preview.
        let large_answers = session.capabilities.has(computers::runner::ARTIFACTS);
        let brokered = if large_answers {
            self.mcp_broker.set_result_limit(id, None)
        } else {
            self.mcp_broker.has_attempt(id)
        };
        if relayed.is_some() && brokered {
            input.push_str(&if large_answers {
                "\nAnswers from on-demand tools reach this computer in full, up to 1 MB as on the person's device; select output with output.jsonPointers, output.rows or output.maxChars when you need less.\n".to_string()
            } else {
                format!("\nAn answer from on-demand tools can reach this computer only up to about {} KB: select output with output.jsonPointers, output.rows or output.maxChars, and page captured results with read_tool_result.\n", crate::commands::mcp_broker::REMOTE_RESULT_LIMIT / 1024)
            });
        }
        let (argv, mut env) =
            runs::translate(adapter, &cmd, &root, relayed.map(|b| b.endpoint.as_str()))?;
        let secrets = crate::commands::project_secrets::environment(
            &self.project_secrets_root(),
            &req.project_id,
            crate::commands::project_secrets::Place::Computer,
        )
        .map_err(|error| format!("Project secrets could not be read: {error}"))?;
        if !secrets.is_empty() {
            let names: Vec<&str> = secrets.iter().map(|(name, _)| name.as_str()).collect();
            self.update(id, |run| {
                activity(
                    run,
                    &format!(
                        "Project secrets for the agent on {}: {}.",
                        computer.name,
                        names.join(", ")
                    ),
                )
            });
        }
        runs::add_secrets(&mut env, secrets);
        // Where each tool runs follows the runner's capabilities; desktop
        // control acts on the computer itself.
        let capabilities = runner::RunnerCapabilities::from_status(status.as_ref());
        let access = relay::Access {
            devtools: computers::provider(&computer.provider)
                .ok()
                .and_then(|provider| provider.devtools(&root, &computer))
                .is_some(),
            runner: capabilities,
            read_only,
        };
        let local = relayed
            .and_then(|_| access.local_request(req.verify_command.as_deref()))
            .map(without_disabled_tools);
        if relayed.is_some() {
            input.push_str(&access.instructions());
        } else if bridge.is_some() {
            input.push_str("\nJackalope's tools are not available on this computer, whose image predates them. Ignore instructions that mention them.\n");
        }
        let connections = self.computer_connections(
            id,
            adapter,
            &computer,
            status.as_ref(),
            relayed.is_some(),
            connections,
            &mut input,
        );
        let launched = std::time::Instant::now();
        let label = format!("Sending files to {}", computer.name);
        let progress = |sent: u64, total: u64| {
            self.remote_progress(
                id,
                &label,
                &format!("{} of {}", megabytes(sent), megabytes(total)),
            );
        };
        let bundled = runs::uses_git_sync(&session.capabilities)
            && self.send_bundle(
                id,
                &mut session,
                workspace,
                &req.setup_files,
                &computer,
                &progress,
            );
        if !bundled {
            session.upload(Path::new(workspace), &req.setup_files, &progress)?;
        }
        self.update(id, |run| {
            run.efficiency.timing("remoteUpload", launched.elapsed());
        });
        if self.inner.lock().unwrap().canceled.contains(id) {
            session.remove();
            session.shutdown();
            self.remote_stopped(id);
            return Ok(());
        }
        let mut parts = serde_json::Map::new();
        if let Some(connections) = connections {
            parts.insert("mcp".into(), connections);
        }
        if let Some(local) = local.clone() {
            parts.insert("local".into(), local);
        }
        runner::attach(id, access.clone());
        let started = session.start(&argv, &env, &input, relayed.is_some(), &parts);
        if started.is_err() {
            runner::detach(id);
        }
        let started = started?;
        let immediate = started.exit;
        if relayed.is_some() {
            let placement = placement_activity(
                &access,
                &computer.name,
                local.as_ref(),
                started.local_tools.as_deref(),
            );
            self.update(id, |run| activity(run, &placement));
        }
        for (name, reason) in &started.unavailable {
            self.update(id, |run| {
                activity(
                    run,
                    &format!("{name} could not start on {}: {reason}", computer.name),
                )
            });
        }
        self.update_checked(id, |r| {
            if r.status == "starting" {
                r.status = "running".into();
            }
            r.progress = None;
            activity(
                r,
                &if relayed.is_some() {
                    format!(
                        "The agent runs on {} (beta). {}{}",
                        computer.name,
                        if !access.tool_unavailable("browser_navigate") {
                            "Desktop control and the browser tools act on that computer."
                        } else {
                            "Desktop control acts on that computer; the browser tools are not available there."
                        },
                        if read_only {
                            " The attempt is read-only, so nothing comes back from it."
                        } else {
                            ""
                        }
                    )
                } else {
                    format!(
                        "The agent runs on {} (beta) without Jackalope's tools. Update its image to use them.",
                        computer.name
                    )
                },
            );
        })?;
        let mut relay = relayed.map(|b| {
            relay::Relay::new(&b.endpoint, &b.token, access).with_answer_limit(if large_answers {
                relay::LARGE_ANSWER_LIMIT
            } else {
                relay::ANSWER_LIMIT
            })
        });
        let followed = match immediate {
            Some(exit) => Followed {
                exit: Some(exit),
                quota_stopped: false,
                lost: false,
            },
            None => self.follow_remote(id, adapter, &mut session, &computer, launched, &mut relay),
        };
        runner::detach(id);
        let exit = followed.exit.as_ref();
        let code = exit
            .and_then(|exit| exit["code"].as_i64())
            .map(|c| c as i32);
        let ended_cleanly =
            exit.is_some_and(|exit| exit["reason"].is_null() && exit["error"].is_null());
        if let Some(error) = exit.and_then(|exit| exit["error"].as_str()) {
            let error = error.to_string();
            self.update(id, |run| {
                run.error.get_or_insert(format!(
                    "The agent could not start on {}: {error}",
                    computer.name
                ));
            });
        }
        match exit.and_then(|exit| exit["reason"].as_str()) {
            Some("timeout") => self.update(id, |run| {
                run.error.get_or_insert("The agent exceeded the six-hour limit on its computer. Inspect the saved work and continue the task.".into());
            }),
            Some("orphaned" | "interrupted") => self.update(id, |run| {
                run.error.get_or_insert(format!(
                    "The agent on {} stopped before finishing because contact was lost or the computer restarted. The changes it made are brought back; continue the task to finish.",
                    computer.name
                ));
            }),
            _ => {}
        }
        if !followed.lost && read_only {
            self.refuse_changes(id, &mut session, &computer);
            session.remove();
        } else if !followed.lost {
            self.remote_progress(
                id,
                &format!("Bringing changes back from {}", computer.name),
                "",
            );
            if self.bring_back(id, &mut session, workspace, &computer, false) {
                session.remove();
            }
        }
        session.shutdown();
        self.update(id, |run| run.progress = None);
        let success = ended_cleanly && code == Some(0) && !followed.lost;
        self.complete_attempt(id, req, success, code, followed.quota_stopped)
    }

    /// Sends the workspace as a Git bundle of only what the computer lacks.
    /// Returns false, with the reason in the activity, when it must go as
    /// files instead; a failed bundle never fails the attempt.
    fn send_bundle(
        &self,
        id: &str,
        session: &mut runs::Session,
        workspace: &str,
        setup: &[String],
        computer: &Computer,
        progress: &dyn Fn(u64, u64),
    ) -> bool {
        let line = match session.sync_upload(Path::new(workspace), setup, progress) {
            Ok(computers::sync::Sent::Bundle { bytes, delta }) => {
                self.update(id, |run| {
                    activity(
                        run,
                        &format!(
                            "Sent the workspace to {} as a {} Git bundle, {}.",
                            computer.name,
                            megabytes(bytes),
                            if delta {
                                "with only what changed since its last copy"
                            } else {
                                "with the repository's history"
                            }
                        ),
                    )
                });
                return true;
            }
            Ok(computers::sync::Sent::Archive(reason)) => format!(
                "The workspace goes to {} as files because {reason}.",
                computer.name
            ),
            Err(error) => format!(
                "The workspace could not go to {} as a Git bundle ({error}), so it goes as files.",
                computer.name
            ),
        };
        session.synced = false;
        self.update(id, |run| activity(run, &line));
        false
    }

    /// Collects the run's changes and applies them to the local workspace.
    /// A patch that does not apply is saved beside the attempt's history, with
    /// the agent's saved output in a folder beside it. Returns whether the
    /// run's files on the computer may be removed.
    fn bring_back(
        &self,
        id: &str,
        session: &mut runs::Session,
        workspace: &str,
        computer: &Computer,
        earlier: bool,
    ) -> bool {
        let source = if earlier {
            format!("an earlier run on {} that lost contact", computer.name)
        } else {
            computer.name.clone()
        };
        let collected = match session.collect_changes(Path::new(workspace)) {
            Ok(collected) => collected,
            Err(error) => {
                let message =
                    format!("The agent's changes could not be collected from {source}: {error}");
                self.update(id, |run| {
                    if earlier {
                        activity(run, &message);
                    } else {
                        run.error.get_or_insert(message.clone());
                    }
                });
                return false;
            }
        };
        let patch = &collected.patch;
        let files = patch_files(patch);
        let kind = if earlier { "recovered" } else { "remote" };
        if let Err(error) = runs::apply(Path::new(workspace), patch) {
            let saved = self.directory.join(format!("{id}.{kind}.patch"));
            let kept = std::fs::write(&saved, patch).is_ok();
            let output = self.directory.join(format!("{id}.{kind}.artifacts"));
            let output_kept = !collected.artifacts.is_empty()
                && session
                    .fetch_artifacts(&output, &collected.artifacts)
                    .is_ok();
            let message = format!(
                "The agent's changes from {source} could not be applied to the workspace: {error}{}{}",
                if kept {
                    format!(" They are saved at {}.", saved.display())
                } else {
                    String::new()
                },
                if output_kept {
                    format!(" Its saved output is at {}.", output.display())
                } else {
                    String::new()
                }
            );
            self.update(id, |run| {
                if earlier {
                    activity(run, &message);
                } else {
                    run.error.get_or_insert(message.clone());
                }
            });
            return kept;
        }
        // Saved output arrives once the changes applied, so a failure leaves
        // the workspace as it was.
        if !collected.artifacts.is_empty() || collected.truncated {
            let line = match session.fetch_artifacts(Path::new(workspace), &collected.artifacts) {
                Ok(written) if collected.truncated => format!(
                    "Brought back {written} saved output file(s) from {source}; it listed only part of the output under {}.",
                    computers::sync::ARTIFACT_FOLDER
                ),
                Ok(0) => String::new(),
                Ok(written) => format!(
                    "Brought back {written} saved output file{} from {source} under {}.",
                    if written == 1 { "" } else { "s" },
                    computers::sync::ARTIFACT_FOLDER
                ),
                Err(error) => {
                    format!("The agent's saved output from {source} could not be brought back: {error}")
                }
            };
            if !line.is_empty() {
                self.update(id, |run| activity(run, &line));
            }
        }
        if files > 0 {
            self.update(id, |run| {
                activity(
                    run,
                    &format!(
                        "Brought back changes to {files} file{} from {source}.",
                        if files == 1 { "" } else { "s" },
                    ),
                )
            });
        }
        // Captures arrive in the patch from a tar upload and as artifacts from
        // a bundle.
        let mut shots = computers::policy::patch_screenshots(patch);
        for artifact in &collected.artifacts {
            if artifact
                .path
                .starts_with(".jackalope/artifacts/screenshots/")
                && !shots.contains(&artifact.path)
            {
                shots.push(artifact.path.clone());
            }
        }
        super::runner::record::register_screenshots(self, id, workspace, shots);
        true
    }

    /// A read-only attempt applies nothing to the workspace. Changes it made
    /// on the computer anyway are reported, then removed with its run.
    fn refuse_changes(&self, id: &str, session: &mut runs::Session, computer: &Computer) {
        // Its screenshots are discarded with its run.
        super::runner::record::take_screenshots(id);
        let files = session.collect().map_or(0, |patch| patch_files(&patch));
        if files > 0 {
            self.update(id, |run| {
                activity(
                    run,
                    &format!(
                        "This read-only attempt changed {files} file{} on {}. They were discarded, not brought back.",
                        if files == 1 { "" } else { "s" },
                        computer.name
                    ),
                )
            });
        }
    }

    /// Brings back what an earlier run of this workspace left on the computer,
    /// for example after Jackalope lost contact or restarted, before the
    /// workspace is uploaded again over it. An earlier read-only run brings
    /// nothing back.
    fn recover_remote(
        &self,
        id: &str,
        session: &mut runs::Session,
        status: &serde_json::Value,
        workspace: &str,
        computer: &Computer,
        read_only: bool,
    ) {
        if status["started"] == true && status["exit"].is_null() {
            let _ = session.stop();
            let deadline = std::time::Instant::now() + Duration::from_secs(20);
            while std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(500));
                if session
                    .status()
                    .ok()
                    .flatten()
                    .is_some_and(|status| !status["exit"].is_null())
                {
                    break;
                }
            }
        }
        if status["started"] != true
            || read_only
            || self.bring_back(id, session, workspace, computer, true)
        {
            session.remove();
        }
    }

    /// Reads the run until it ends, feeding output to the adapter's parser,
    /// relaying bridge calls and stop and quota decisions. Contact that is lost
    /// is retried, reconnecting every few failed reads, for [`LOST_WINDOW`].
    fn follow_remote(
        &self,
        id: &str,
        adapter: &str,
        session: &mut runs::Session,
        computer: &Computer,
        launched: std::time::Instant,
        relay: &mut Option<relay::Relay>,
    ) -> Followed {
        let root = self.computers_root();
        let mut out = 0u64;
        let mut err = 0u64;
        let mut stdout = runs::Lines::new(1_000_000);
        let mut stderr = runs::Lines::new(6000);
        let mut partials = super::claude_session::Partials::new(launched);
        let mut stop_sent = false;
        let mut quota_stopped = false;
        let mut failures = 0u32;
        let mut lost_since: Option<std::time::Instant> = None;
        let mut reclaim = false;
        let mut last_note = std::time::Instant::now();
        let exit = loop {
            let (canceled, quota) = {
                let inner = self.inner.lock().unwrap();
                (
                    inner.canceled.contains(id),
                    inner
                        .runs
                        .get(id)
                        .is_some_and(|run| run.routing.is_some() && run.quota_failure.is_some()),
                )
            };
            if (canceled || quota) && !stop_sent {
                quota_stopped = quota && !canceled;
                stop_sent = session.stop().is_ok();
            }
            if last_note.elapsed() > Duration::from_secs(60) {
                computers::usage::note(&root, &computer.id);
                last_note = std::time::Instant::now();
            }
            if let Some(relay) = relay.as_mut() {
                for answer in relay.answers() {
                    let sent = lost_since.is_none() && session.answer(&answer).is_ok();
                    relay.delivered(answer, sent);
                }
            }
            match session.read(&mut out, &mut err, reclaim) {
                Ok(page) => {
                    failures = 0;
                    reclaim = false;
                    if lost_since.take().is_some() {
                        self.update(id, |run| {
                            activity(run, &format!("Contact with {} is back.", computer.name))
                        });
                    }
                    if let Some(relay) = relay.as_mut() {
                        relay.accept(&page.bridge);
                    }
                    for (line, truncated) in stdout.push(&page.stdout) {
                        self.remote_event(id, adapter, &mut partials, launched, line, truncated);
                    }
                    for (line, truncated) in stderr.push(&page.stderr) {
                        self.remote_diagnostic(id, line, truncated);
                    }
                    if page.exit.is_some() {
                        break page.exit;
                    }
                }
                Err(error) => {
                    failures += 1;
                    reclaim = true;
                    let since = *lost_since.get_or_insert_with(std::time::Instant::now);
                    if failures == 3 {
                        self.update(id, |run| {
                            activity(
                                run,
                                &format!(
                                    "Lost contact with {}: {error}. Retrying for up to 30 minutes.",
                                    computer.name
                                ),
                            )
                        });
                    }
                    let gave_up = since.elapsed() > LOST_WINDOW
                        || (canceled && since.elapsed() > Duration::from_secs(30));
                    if gave_up {
                        self.update(id, |run| {
                            run.error.get_or_insert(format!(
                                "Lost contact with {}: {error}. The agent there stops on its own after ten minutes; its changes stay there and come back when this task is continued.",
                                computer.name
                            ));
                        });
                        return Followed {
                            exit: None,
                            quota_stopped,
                            lost: true,
                        };
                    }
                    if failures % RECONNECT_EVERY == 0 {
                        let _ = session.reconnect(&root, computer);
                    }
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        };
        if let Some((line, truncated)) = stdout.finish() {
            self.remote_event(id, adapter, &mut partials, launched, line, truncated);
        }
        if let Some((line, truncated)) = stderr.finish() {
            self.remote_diagnostic(id, line, truncated);
        }
        if adapter == "claude" {
            partials.complete(self, id);
        }
        Followed {
            exit,
            quota_stopped,
            lost: false,
        }
    }

    fn remote_event(
        &self,
        id: &str,
        adapter: &str,
        partials: &mut super::claude_session::Partials,
        launched: std::time::Instant,
        line: String,
        truncated: bool,
    ) {
        if adapter == "claude" && !truncated && partials.consume(self, id, &line) {
            return;
        }
        let _ = self.update_output(id, |r| {
            if !truncated && super::efficiency::useful_event(&line, adapter) {
                r.efficiency.first_activity(launched.elapsed());
            }
            if truncated {
                activity(
                    r,
                    "An oversized agent event was omitted. Inspect the agent session for full output.",
                );
            } else {
                consume_adapter_event(r, &line, adapter);
            }
        });
    }

    fn remote_diagnostic(&self, id: &str, mut line: String, truncated: bool) {
        if truncated {
            line.push_str(" [truncated]");
        }
        let _ = self.update_output(id, |r| r.diagnostics.push(line));
    }
}

/// What happens to the selected stdio connections of a run on a computer.
struct ConnectionPlan {
    /// The `run_start` request, when they start with the run.
    request: Option<serde_json::Value>,
    /// The activity line, naming connections but never their values.
    activity: String,
    instructions: String,
}

/// Connections start with the run when the computer's agent supports them
/// and, for Claude Code (which runs there without its permission prompt),
/// when the bridge relay can carry each tool's approval to this device.
fn connection_plan(
    adapter: &str,
    computer: &str,
    status: Option<&serde_json::Value>,
    relayed: bool,
    connections: &[crate::commands::mcp::ComputerConnection],
) -> Option<ConnectionPlan> {
    if connections.is_empty() {
        return None;
    }
    let names = connections
        .iter()
        .map(|connection| connection.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let missing = if !runs::runs_connections(status) {
        Some(format!(
            "the image of {computer} predates connections that run on it; update the image"
        ))
    } else if adapter == "claude" && !relayed {
        Some("Jackalope approves their tools for Claude Code through its bridge, which this attempt does not have".to_string())
    } else {
        None
    };
    Some(match missing {
        Some(reason) => ConnectionPlan {
            request: None,
            activity: format!("Connections not available on {computer}: {names} ({reason})."),
            instructions: format!("\nThese selected connections are not available to you on this computer: {names}. Do not look for their tools.\n"),
        },
        None => ConnectionPlan {
            request: Some(runs::connections_request(adapter, connections)),
            activity: format!("Connections that run on {computer}, in the agent's workspace: {names}. Their commands and environment go with the run like project secrets."),
            instructions: format!(
                "\nThese selected connections run as MCP servers on this computer, in the workspace you edit: {names}. Use their tools directly.{}\n",
                if adapter == "claude" {
                    " Jackalope approves each of their tool calls the way it approves tools on the person's device."
                } else {
                    ""
                }
            ),
        },
    })
}

/// Leaves tools whose experiment is off out of the runner's `local` request,
/// as this device leaves them out of the tool list.
fn without_disabled_tools(mut local: serde_json::Value) -> serde_json::Value {
    if !crate::commands::experiments::is("JACKALOPE_CONTEXT_READ", "on") {
        if let Some(tools) = local["tools"].as_array_mut() {
            tools.retain(|tool| tool != "read_context");
        }
    }
    local
}

/// The activity line recording where the run's tools execute: the runner's
/// protocol and capabilities, what it serves, and what it could not.
fn placement_activity(
    access: &relay::Access,
    computer: &str,
    local: Option<&serde_json::Value>,
    served: Option<&[String]>,
) -> String {
    let served = served.unwrap_or_default();
    let names: Vec<&str> = served.iter().map(String::as_str).collect();
    let mut text = access.activity(computer, &names);
    let missing: Vec<&str> = local
        .and_then(|local| local["tools"].as_array())
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .filter(|tool| !names.contains(tool))
        .collect();
    if !missing.is_empty() {
        text.push_str(&format!(
            " {computer} could not run {}; update its image.",
            missing.join(", ")
        ));
    }
    if access.runner.protocol >= runner::CAPABILITIES_PROTOCOL {
        let capabilities: Vec<&str> = access.runner.names().collect();
        text.push_str(&format!(
            " Runner protocol {} ({}).",
            access.runner.protocol,
            if capabilities.is_empty() {
                "no capabilities".to_string()
            } else {
                capabilities.join(", ")
            }
        ));
    }
    text
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_000_000.0)
}

/// Files a Git patch touches.
fn patch_files(patch: &[u8]) -> usize {
    patch
        .split(|byte| *byte == b'\n')
        .filter(|line| line.starts_with(b"diff --git "))
        .count()
}

#[cfg(test)]
mod tests {
    use crate::commands::mcp::ComputerConnection;
    use serde_json::json;

    fn linear() -> ComputerConnection {
        ComputerConnection {
            key: "linear".into(),
            name: "Linear".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@linear/mcp".into()],
            env: vec![("LINEAR_API_KEY".into(), "lin-secret-value".into())],
        }
    }

    #[test]
    fn connections_start_only_where_the_computer_and_approvals_allow() {
        let connections = [linear()];
        let current = json!({"exists": false, "runs": 3});
        assert!(super::connection_plan("claude", "Box", Some(&current), true, &[]).is_none());

        let plan =
            super::connection_plan("claude", "Box", Some(&current), true, &connections).unwrap();
        let request = plan.request.unwrap();
        assert_eq!(request["config"], "claude");
        assert_eq!(request["approve"], true);
        assert_eq!(request["servers"][0]["key"], "linear");
        assert_eq!(request["servers"][0]["command"], "npx");
        // The value travels only in the run request, the channel secrets use.
        assert_eq!(
            request["servers"][0]["env"]["LINEAR_API_KEY"],
            "lin-secret-value"
        );
        for text in [&plan.activity, &plan.instructions] {
            assert!(text.contains("Linear"), "{text}");
            assert!(!text.contains("lin-secret-value") && !text.contains("LINEAR_API_KEY"));
        }
        assert!(plan
            .instructions
            .contains("approves each of their tool calls"));

        let codex =
            super::connection_plan("codex", "Box", Some(&current), false, &connections).unwrap();
        assert_eq!(codex.request.unwrap()["approve"], false);
        assert!(!codex.instructions.contains("approves"));

        let unapproved =
            super::connection_plan("claude", "Box", Some(&current), false, &connections).unwrap();
        assert!(unapproved.request.is_none());
        assert!(unapproved.activity.contains("through its bridge"));
        assert!(unapproved.instructions.contains("not available"));

        for status in [None, Some(json!({"exists": false}))] {
            let old = super::connection_plan("codex", "Box", status.as_ref(), true, &connections)
                .unwrap();
            assert!(old.request.is_none());
            assert!(
                old.activity.contains("update the image"),
                "{}",
                old.activity
            );
            assert!(!old.activity.contains("lin-secret-value"));
        }
    }

    #[test]
    fn activity_records_where_tools_run_and_what_the_runner_dropped() {
        use crate::commands::computers::runner::RunnerCapabilities;
        let current = crate::commands::computers::relay::Access {
            runner: RunnerCapabilities::from_status(Some(&json!({
                "runs": 4,
                "capabilities": ["local-bridge", "browser", "workspace-tools", "policy-callbacks"],
            }))),
            devtools: false,
            read_only: false,
        };
        let local = current.local_request(Some("pnpm test")).unwrap();
        let served = vec![
            "computer_verify".to_string(),
            "verification_output".to_string(),
        ];
        let text = super::placement_activity(&current, "Box", Some(&local), Some(&served));
        assert!(
            text.contains("Run on Box: computer_verify, verification_output."),
            "{text}"
        );
        assert!(
            text.contains("could not run read_context, browser_navigate"),
            "{text}"
        );
        assert!(
            text.contains(
                "Runner protocol 4 (browser, local-bridge, policy-callbacks, workspace-tools)."
            ),
            "{text}"
        );
        let older = crate::commands::computers::relay::Access {
            runner: RunnerCapabilities::from_status(Some(&json!({"runs": 3}))),
            ..current
        };
        let text = super::placement_activity(&older, "Box", None, None);
        assert!(
            text.contains("reach this device") && text.contains("Not available there"),
            "{text}"
        );
        assert!(!text.contains("Runner protocol"), "{text}");
    }

    #[test]
    fn counts_patch_files() {
        assert_eq!(super::patch_files(b""), 0);
        assert_eq!(
            super::patch_files(b"diff --git a/x b/x\n+1\ndiff --git a/y b/y\n"),
            2
        );
    }
}
