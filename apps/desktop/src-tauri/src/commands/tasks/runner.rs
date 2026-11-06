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
use crate::commands::computers::{self, credentials, runs, Computer};

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
