//! The runner of an attempt: the execution host that owns its workspace and
//! everything that touches it.
//!
//! This device is the control plane: it assembles the agent's command and
//! prompt, keeps history, approvals and policy, and runs the checks,
//! checkpoint, review and integration after the agent ends
//! ([`TaskRuntime::complete_attempt`]). Between those, an attempt goes through
//! one path, [`TaskRuntime::run_attempt`], whatever runs it:
//!
//! 1. [`AttemptRunner::prepare`] makes the workspace ready on the host;
//! 2. the runner's placement ([`AttemptRunner::access`]) is attached, so the
//!    bridge offers the agent the tools [`computers::runner::TOOLS`] places
//!    where it runs;
//! 3. [`AttemptRunner::start`] starts the agent, [`AttemptRunner::follow`]
//!    feeds its events to the adapter's parser until it ends, stopping it
//!    ([`AttemptRunner::stop`]) on a quota handoff, and
//!    [`AttemptRunner::collect`] brings its result into this device's
//!    workspace.
//!
//! [`local::LocalRunner`] runs the agent CLI on this device in the local
//! worktree as it is. [`remote::RemoteRunner`] runs it on the project's
//! computer, whose runner (`resources/computer/agent.py`) holds an uploaded
//! copy. What each workspace tool did is recorded through [`record`] for
//! both, and the runner's policy callbacks reach
//! [`computers::policy`] over the bridge.
//!
//! [`computers::runner::TOOLS`]: crate::commands::computers::runner::TOOLS
//! [`computers::policy`]: crate::commands::computers::policy

use super::*;
use crate::commands::computers::{
    self, credentials,
    pool::{self, RunHost},
    runs, Computer,
};

pub(super) mod local;
pub(in crate::commands) mod record;
pub(super) mod remote;

/// What the launch assembled for the agent, whatever runs it.
pub(super) struct Launch<'a> {
    pub id: &'a str,
    pub req: &'a RunRequest,
    pub adapter: &'a str,
    pub cmd: Command,
    pub input: String,
    pub workspace: &'a str,
}

/// How an agent's turn ended.
pub(super) struct Outcome {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub quota_stopped: bool,
}

/// Whether a phase left the attempt ready to go on. A stopped attempt has
/// been marked stopped and completes no further.
#[derive(Debug, PartialEq)]
pub(super) enum Step {
    Ready,
    Stopped,
}

/// An execution host for one attempt.
pub(super) trait AttemptRunner {
    /// Where each bridge tool runs for this attempt. Known once
    /// [`AttemptRunner::prepare`] has run.
    fn access(&self) -> &computers::runner::Access;
    /// Makes the workspace ready on the host: this device's worktree as it
    /// is, or a computer's copy, with whatever an earlier run left there
    /// brought back first.
    fn prepare(&mut self, runtime: &TaskRuntime, launch: &mut Launch) -> Result<Step, String>;
    /// Starts the agent with the launch's command and input.
    fn start(&mut self, runtime: &TaskRuntime, launch: &mut Launch) -> Result<Step, String>;
    /// Follows the agent until it ends: its events, a stop or quota handoff
    /// and, on a computer, lost contact and reconnection. `None` means it was
    /// stopped before it ran.
    fn follow(
        &mut self,
        runtime: &TaskRuntime,
        launch: &mut Launch,
    ) -> Result<Option<Outcome>, String>;
    /// Stops the agent where it runs.
    fn stop(&mut self) -> Result<(), String>;
    /// Brings the agent's result into this device's workspace.
    fn collect(&mut self, runtime: &TaskRuntime, launch: &mut Launch, outcome: &Outcome);
}

impl TaskRuntime {
    /// Runs one prepared launch through its runner, then completes the
    /// attempt on this device.
    pub(super) fn run_attempt(
        &self,
        runner: &mut dyn AttemptRunner,
        mut launch: Launch,
    ) -> Result<(), String> {
        if runner.prepare(self, &mut launch)? == Step::Stopped {
            return Ok(());
        }
        let id = launch.id;
        computers::runner::attach(id, runner.access().clone());
        let outcome = self.run_prepared(runner, &mut launch);
        computers::runner::detach(id);
        match outcome? {
            Some(outcome) => self.complete_attempt(
                id,
                launch.req,
                outcome.success,
                outcome.exit_code,
                outcome.quota_stopped,
            ),
            None => Ok(()),
        }
    }

    fn run_prepared(
        &self,
        runner: &mut dyn AttemptRunner,
        launch: &mut Launch,
    ) -> Result<Option<Outcome>, String> {
        if runner.start(self, launch)? == Step::Stopped {
            return Ok(None);
        }
        let Some(outcome) = runner.follow(self, launch)? else {
            return Ok(None);
        };
        runner.collect(self, launch, &outcome);
        Ok(Some(outcome))
    }

    /// Whether routing asked this attempt to stop for a quota handoff.
    pub(super) fn quota_handoff(&self, id: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .runs
            .get(id)
            .is_some_and(|run| run.routing.is_some() && run.quota_failure.is_some())
    }

    /// Marks an attempt stopped before its agent ran.
    pub(super) fn mark_stopped(&self, id: &str) {
        self.update(id, |r| {
            r.status = "stopped".into();
            r.ended_at = Some(Utc::now().to_rfc3339());
        });
    }

    /// Whether attempt `id` of this project, with `adapter`, runs on a
    /// computer, so the agent CLI need not be installed on this device.
    pub(in crate::commands) fn runs_remotely(
        &self,
        id: &str,
        project_id: &str,
        adapter: &str,
    ) -> bool {
        credentials::REMOTE_ADAPTERS.contains(&adapter)
            && match pool::peek(id) {
                Some(host) => !host.is_device(),
                None => self.project_target(id, project_id).is_some(),
            }
    }

    /// The project's computer for an attempt the capacity pool did not place:
    /// every attempt of a project with a computer runs there, except read-only
    /// planning attempts of a project whose swarms run only on this device.
    fn project_target(&self, id: &str, project_id: &str) -> Option<Computer> {
        let root = self.computers_root();
        runs::project_computer(&root, project_id).filter(|_| {
            !(crate::commands::planning::read_only(id)
                && pool::settings(&root, project_id).swarm_hosts == Some(pool::SwarmHosts::Device))
        })
    }

    /// The computer this attempt's agent runs on, or `None` to run it here,
    /// with the host recorded on the attempt. The host the capacity pool
    /// chose at dispatch comes first; a continuation stays on its earlier
    /// attempt's host, where its session and anything left behind are; any
    /// other attempt follows the project's computer, as read-only planners
    /// and orchestrators always have. A computer that is gone fails the
    /// attempt as a lost host.
    pub(super) fn placed_target(
        &self,
        id: &str,
        req: &RunRequest,
        adapter: &str,
        previous: Option<&TaskRun>,
    ) -> Result<Option<Computer>, String> {
        let root = self.computers_root();
        let current = self.run_snapshot(id).and_then(|run| run.host);
        let host = current.clone().or_else(|| {
            previous
                .and_then(|old| old.host.clone())
                .map(|old| RunHost {
                    reason: format!("Continues on {}, where the earlier attempt ran.", old.name),
                    id: old.id,
                    name: old.name,
                    ..Default::default()
                })
        });
        let computer = match &host {
            Some(host) if host.is_device() => None,
            Some(host) => {
                let found = computers::list(&root)
                    .ok()
                    .and_then(|list| list.into_iter().find(|c| c.id == host.id))
                    .filter(runs::supports_runs);
                match found {
                    Some(computer) => Some(computer),
                    None => {
                        let reason = format!("{} is no longer available to run agents.", host.name);
                        self.record_host(id, host.clone());
                        self.host_lost(id, &host.id, &host.name, &reason);
                        return Err(reason);
                    }
                }
            }
            None => self.project_target(id, &req.project_id),
        };
        let mut host = host.unwrap_or_else(|| match &computer {
            Some(computer) => RunHost {
                id: computer.id.clone(),
                name: computer.name.clone(),
                reason: format!("The project's agents run on {}.", computer.name),
                ..Default::default()
            },
            None => RunHost::device("Runs on this device.".into()),
        });
        let computer = match computer {
            Some(computer) if !credentials::REMOTE_ADAPTERS.contains(&adapter) => {
                host = RunHost::device(format!(
                    "{} cannot run on {} yet, so it runs on this device.",
                    req.agent, computer.name
                ));
                None
            }
            other => other,
        };
        if current.as_ref().map(|old| (&old.id, &old.reason)) != Some((&host.id, &host.reason)) {
            self.record_host(id, host);
        }
        Ok(computer)
    }

    /// Saves where the attempt runs and says why in its activity.
    fn record_host(&self, id: &str, host: RunHost) {
        let line = host_activity(&host);
        self.update(id, |run| {
            run.host = Some(host);
            activity(run, &line);
        });
    }

    /// Records that the attempt's host was lost, on the attempt and in the
    /// pool's health, and returns `reason` for the attempt's error.
    pub(super) fn host_lost(&self, id: &str, host_id: &str, name: &str, reason: &str) -> String {
        pool::lost(host_id, reason);
        self.update(id, |run| {
            let host = run.host.get_or_insert_with(|| RunHost {
                id: host_id.into(),
                name: name.into(),
                ..Default::default()
            });
            host.lost = Some(reason.chars().take(500).collect());
        });
        reason.into()
    }
}

/// The activity line naming an attempt's host and why it runs there.
pub(super) fn host_activity(host: &RunHost) -> String {
    format!("Placement: {}", host.reason)
}

/// Whether another active attempt is using `workspace`. Only one writer
/// owns a workspace at a time.
pub(super) fn workspace_in_use(inner: &Inner, id: &str, workspace: &str) -> bool {
    inner.runs.values().any(|r| {
        r.id != id
            && r.workspace == workspace
            && ["starting", "running", "stopping"].contains(&r.status.as_str())
    })
}

pub(super) const WORKSPACE_IN_USE: &str =
    "Another attempt is using this workspace. Stop it or wait before continuing.";

#[cfg(test)]
mod tests;
