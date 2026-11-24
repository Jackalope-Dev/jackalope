//! Rewinding a conversation or task to an earlier turn ("Edit from here").
//!
//! Before a turn's agent starts in a worktree Jackalope made, the worktree's files are saved
//! as a commit under the hidden ref `refs/jackalope/checkpoints/<task>/<attempt>`. No branch
//! contains it, so merges, pull requests and ordinary pushes never carry it; the task
//! branch's automatic commits (`checkpoint.rs`) are unchanged. Each Claude Code or Codex
//! turn also records where the agent's own conversation stood when it ended (its
//! [`ConversationMark`]).
//!
//! Rewinding to turn K puts the files back as K found them and continues the conversation
//! from the end of the turn before it: Claude Code resumes that session at its last message
//! with `--resume-session-at` and `--fork-session`, and Codex forks that thread after its turn
//! through the app-server. Both leave the original conversation as it was. Rewinding to the
//! first turn starts the next turn as a new conversation. Other agents cannot be rewound,
//! because files restored under an agent that still remembers the later turns would not be a
//! rewind.
//!
//! The files present beforehand are saved first under `refs/jackalope/rewinds/<task>/<id>`
//! (with the staged index as a second parent when it differs), so nothing is lost. Turns a
//! rewind undid stay in history, marked [`Rewound`]. Until the next turn starts, Undo puts the
//! files back from that snapshot and the next turn continues the original conversation.

use super::*;
use crate::commands::{
    integration::{self, ExecutionGuard},
    repo::{self, Policy, Seed},
};
use serde::Deserialize;

#[cfg(test)]
mod tests;

/// The files a turn started from.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TurnCheckpoint {
    pub reference: String,
    pub commit: String,
    pub head: String,
    pub tree: String,
}

/// Where an agent's own conversation stood when a turn ended: Codex's thread and the
/// turn's ID, or Claude Code's session and the last message it wrote.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMark {
    pub session: String,
    pub entry: String,
}

/// A turn a rewind undid. It stays in history.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rewound {
    pub rewind_id: String,
    pub at: String,
}

/// How the turn after a rewind continues the agent's conversation.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RewindResume {
    /// A new conversation: the rewind went back to the first turn.
    New,
    /// Claude Code resumes `session` up to and including message `at`, as a new session.
    Claude { session: String, at: String },
    /// Codex continues `thread`, a fork of the earlier thread made by the rewind.
    Codex { thread: String },
}

/// What a rewind saved before it changed anything.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SafetySnapshot {
    pub reference: String,
    pub commit: String,
    pub head: String,
    pub tree: String,
    /// The staged tree, when it differed from both `HEAD` and the files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<String>,
}

/// A rewind, kept on the attempt that was latest when it was made.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rewind {
    pub id: String,
    pub at: String,
    /// The turn edited from, whose prompt went back to the composer.
    pub turn_run_id: String,
    /// Its position among the turns in effect, from 1.
    pub turn: usize,
    pub rewound_run_ids: Vec<String>,
    pub restored: TurnCheckpoint,
    pub safety: SafetySnapshot,
    pub resume: RewindResume,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undone_at: Option<String>,
    /// A rewind still pending when this one was made, which undoing this one brings back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaces: Option<Box<Rewind>>,
}

/// An attempt's part in rewinds. Attempts saved before rewinds existed have none.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<TurnCheckpoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark: Option<ConversationMark>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rewound: Option<Rewound>,
    /// The rewind made while this attempt was the latest one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applied: Option<Rewind>,
    /// The Claude Code message a launch's resumed session is cut at. Never saved.
    #[serde(skip)]
    pub(super) resume_at: Option<String>,
}

impl RewindState {
    pub fn is_empty(&self) -> bool {
        self.checkpoint.is_none()
            && self.checkpoint_error.is_none()
            && self.mark.is_none()
            && self.rewound.is_none()
            && self.applied.is_none()
    }

    /// The rewind the next turn continues from, until it is undone.
    pub(in crate::commands) fn pending(&self) -> Option<&Rewind> {
        self.applied
            .as_ref()
            .filter(|rewind| rewind.undone_at.is_none())
    }
}

/// What rewinding to a turn would do, for the confirmation.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RewindPreview {
    pub run_id: String,
    pub latest_run_id: String,
    /// The turn's position among the turns in effect, from 1.
    pub turn: usize,
    /// Turns undone: this one and every later one in effect.
    pub undone: usize,
    /// `new`, `claude` or `codex`.
    pub conversation: String,
    /// The turn's whole prompt, for the composer.
    pub prompt: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindOutcome {
    pub rewind: Rewind,
    pub prompt: String,
}

/// A checked rewind whose conversation part is ready, to apply under the execution guard.
pub(in crate::commands) struct PreparedRewind {
    preview: RewindPreview,
    task_id: String,
    rewound: Vec<String>,
    checkpoint: TurnCheckpoint,
    resume: RewindResume,
}

impl PreparedRewind {
    pub(in crate::commands) fn task_id(&self) -> &str {
        &self.task_id
    }
}

const CHECKPOINT_IDENTITY: repo::Identity = repo::Identity {
    name: "Jackalope checkpoint",
    email: "checkpoint@jackalope.invalid",
};

fn adapter_of(run: &TaskRun) -> &str {
    run.account_binding
        .as_ref()
        .map_or(run.agent.as_str(), |binding| binding.adapter.as_str())
}

fn on_device(run: &TaskRun) -> bool {
    run.remote.is_none() && run.host.as_ref().is_none_or(|host| host.is_device())
}

fn same_path(a: &str, b: &str) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn plural(count: usize, word: &str) -> String {
    format!("{count} {word}{}", if count == 1 { "" } else { "s" })
}

/// Whether Jackalope saves a checkpoint before `run`'s turn: work in a Git worktree it
/// made, on this device.
fn checkpointed(run: &TaskRun) -> bool {
    !run.non_code
        && run.continues.is_none()
        && !run.workspace.is_empty()
        && !run.branch.is_empty()
        && !same_path(&run.workspace, &run.project_path)
}

/// The attempts of `task_id`, oldest first.
fn attempts<'a>(runs: &'a [TaskRun], task_id: &str) -> Vec<&'a TaskRun> {
    let mut attempts: Vec<_> = runs.iter().filter(|run| run.task_id == task_id).collect();
    attempts.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    attempts
}

/// Checks that `run_id`'s turn can be rewound to, and what that involves. The conversation
/// part is not done yet: a Codex rewind still has to fork its thread.
pub(super) fn plan(
    runs: &[TaskRun],
    run_id: &str,
) -> Result<(RewindPreview, PreparedRewind, Option<TaskRun>), String> {
    let run = runs
        .iter()
        .find(|run| run.id == run_id)
        .ok_or("Attempt not found")?;
    let attempts = attempts(runs, &run.task_id);
    let latest = *attempts.last().ok_or("Attempt not found")?;
    if attempts
        .iter()
        .any(|attempt| attempt.status.is_active() || attempt.finishing)
    {
        return Err("Stop the running turn before rewinding.".into());
    }
    if run.rewind.rewound.is_some() {
        return Err("A rewind already undid this turn. Undo that rewind to bring it back.".into());
    }
    let effect: Vec<&TaskRun> = attempts
        .iter()
        .copied()
        .filter(|attempt| attempt.rewind.rewound.is_none())
        .collect();
    let position = effect
        .iter()
        .position(|attempt| attempt.id == run.id)
        .ok_or("Attempt not found")?;
    let adapter = adapter_of(run);
    if !["claude", "codex"].contains(&adapter) {
        return Err(format!(
            "{} cannot return its conversation to an earlier turn, so Jackalope does not rewind it.",
            crate::commands::agents::name(adapter)
        ));
    }
    let checkpoint = run.rewind.checkpoint.clone().ok_or_else(|| {
        run.rewind.checkpoint_error.clone().map_or_else(
            || "Jackalope saved no copy of the files when this turn started.".to_string(),
            |error| format!("Jackalope could not save the files when this turn started: {error}"),
        )
    })?;
    if run.retry_of.is_some() {
        return Err("This turn retried an earlier one. Rewind to the turn it retried.".into());
    }
    let later = &effect[position..];
    for attempt in later.iter().chain([&latest]) {
        if !on_device(attempt) {
            return Err(
                "Part of this work ran on a computer, so it cannot be rewound here.".into(),
            );
        }
        if attempt.workspace != run.workspace
            || attempt
                .account_binding
                .as_ref()
                .map(|b| (&b.adapter, &b.directory))
                != run
                    .account_binding
                    .as_ref()
                    .map(|b| (&b.adapter, &b.directory))
            || attempt.live_session_id != run.live_session_id
        {
            return Err(
                "Later turns used another workspace, agent or account, so this turn cannot be rewound to."
                    .into(),
            );
        }
    }
    let resume = match position.checked_sub(1).map(|index| effect[index]) {
        None if run.continues.is_some() => return Err(
            "This conversation continues a session from outside Jackalope; rewind to a later turn."
                .into(),
        ),
        None => RewindResume::New,
        Some(previous) => {
            let mark = previous
                .rewind
                .mark
                .as_ref()
                .filter(|mark| previous.session_id.as_deref() == Some(mark.session.as_str()))
                .filter(|_| adapter_of(previous) == adapter && on_device(previous))
                .ok_or(
                    "Jackalope did not record where the agent's conversation stood after the turn before this one.",
                )?;
            match adapter {
                "claude" => RewindResume::Claude {
                    session: mark.session.clone(),
                    at: mark.entry.clone(),
                },
                // Replaced by the fork's thread when the rewind is prepared.
                _ => RewindResume::Codex {
                    thread: mark.session.clone(),
                },
            }
        }
    };
    let preview = RewindPreview {
        run_id: run.id.clone(),
        latest_run_id: latest.id.clone(),
        turn: position + 1,
        undone: later.len(),
        conversation: match resume {
            RewindResume::New => "new",
            RewindResume::Claude { .. } => "claude",
            RewindResume::Codex { .. } => "codex",
        }
        .into(),
        prompt: run.prompt.clone(),
    };
    let previous = position
        .checked_sub(1)
        .map(|index| effect[index].clone())
        .filter(|_| adapter == "codex");
    Ok((
        preview.clone(),
        PreparedRewind {
            preview,
            task_id: run.task_id.clone(),
            rewound: later.iter().map(|attempt| attempt.id.clone()).collect(),
            checkpoint,
            resume,
        },
        previous,
    ))
}

/// Saves the workspace's files as a commit under `reference`, without touching the
/// checkout, its index or its branch.
fn save_files(
    run: &TaskRun,
    directory: &Path,
    reference: &str,
    message: &str,
) -> Result<(String, integration::IntegrationSource), String> {
    let workspace = Path::new(&run.workspace);
    let source = integration::snapshot(run, directory)?;
    let commit = repo::synthetic_commit(
        workspace,
        &source.tree,
        &[&source.head],
        message,
        CHECKPOINT_IDENTITY,
        Policy::Snapshot,
    )?;
    repo::git(
        workspace,
        &["update-ref", reference, &commit],
        Policy::Isolated,
    )?;
    Ok((commit, source))
}

/// Saves the files `run`'s turn starts from. Call before its agent starts.
pub(super) fn capture(run: &TaskRun, directory: &Path) -> Result<Option<TurnCheckpoint>, String> {
    if !checkpointed(run) {
        return Ok(None);
    }
    let reference = format!("refs/jackalope/checkpoints/{}/{}", run.task_id, run.id);
    let (commit, source) = save_files(
        run,
        directory,
        &reference,
        &format!(
            "Jackalope checkpoint before a turn\n\nJackalope-Run: {}",
            run.id
        ),
    )?;
    Ok(Some(TurnCheckpoint {
        reference,
        commit,
        head: source.head,
        tree: source.tree,
    }))
}

/// The tree the checkout's own index holds, read from a copy of it.
fn index_tree(workspace: &Path, directory: &Path) -> Result<String, String> {
    repo::with_temp_index(
        workspace,
        directory,
        Seed::CurrentIndex,
        Policy::Snapshot,
        |index| index.git(&["write-tree"]),
    )
}

fn safety_snapshot(
    run: &TaskRun,
    directory: &Path,
    reference: &str,
) -> Result<SafetySnapshot, String> {
    let workspace = Path::new(&run.workspace);
    let source = integration::snapshot(run, directory)?;
    let head_tree = repo::git(workspace, &["rev-parse", "HEAD^{tree}"], Policy::Snapshot)?;
    let staged = index_tree(workspace, directory)?;
    let index = (staged != head_tree && staged != source.tree).then_some(staged);
    let mut parents = vec![source.head.clone()];
    if let Some(index) = &index {
        parents.push(repo::synthetic_commit(
            workspace,
            index,
            &[&source.head],
            "Staged files before a rewind",
            CHECKPOINT_IDENTITY,
            Policy::Snapshot,
        )?);
    }
    let parents: Vec<&str> = parents.iter().map(String::as_str).collect();
    let commit = repo::synthetic_commit(
        workspace,
        &source.tree,
        &parents,
        &format!("Files before a rewind\n\nJackalope-Run: {}", run.id),
        CHECKPOINT_IDENTITY,
        Policy::Snapshot,
    )?;
    repo::git(
        workspace,
        &["update-ref", reference, &commit],
        Policy::Isolated,
    )?;
    Ok(SafetySnapshot {
        reference: reference.into(),
        commit,
        head: source.head,
        tree: source.tree,
        index,
    })
}

/// Makes the workspace's files `target`. `current` is the tree they must still be, as the
/// safety snapshot saved them; anything else stops the restore before a file changes. The
/// checkout's own index is set to `index`, or to `HEAD` when it is `None`; its branch
/// never moves, so restored files show as changes against it.
fn restore(
    workspace: &Path,
    directory: &Path,
    current: &str,
    target: &str,
    index: Option<&str>,
) -> Result<(), String> {
    repo::git(
        workspace,
        &["cat-file", "-e", &format!("{target}^{{tree}}")],
        Policy::Snapshot,
    )
    .map_err(|_| "The saved files are no longer in this repository.".to_string())?;
    repo::with_temp_index(
        workspace,
        directory,
        Seed::CurrentIndex,
        Policy::Isolated,
        |scratch| {
            scratch.git(&["add", "--all", "--", "."])?;
            if scratch.git(&["write-tree"])? != current {
                return Err(
                    "Files changed while rewinding, so none were restored. Try again.".into(),
                );
            }
            // A two-tree merge from the files as they are moves the working tree to the
            // target: it removes what the target lacks and writes what it has.
            scratch.git(&["read-tree", "-m", "-u", current, target])
        },
    )?;
    let wanted = match index {
        Some(index) => index.to_string(),
        None => repo::git(workspace, &["rev-parse", "HEAD^{tree}"], Policy::Snapshot)?,
    };
    if index_tree(workspace, directory)? != wanted {
        repo::git(workspace, &["read-tree", &wanted], Policy::Isolated)?;
        let _ = repo::git(
            workspace,
            &["update-index", "-q", "--refresh"],
            Policy::Isolated,
        );
    }
    Ok(())
}

/// Refuses while anything else may be using the workspace: an agent, a preview, a check or
/// a task terminal. The lease holds checks and launches off until it is dropped.
fn hold_workspace(
    workspace: &str,
) -> Result<crate::commands::verification::WorkspaceLease, String> {
    crate::commands::previews::ensure_idle(workspace)?;
    crate::commands::verification::ensure_idle(workspace)?;
    crate::commands::verification::reserve_workspace(workspace)
}

impl TaskRuntime {
    /// Saves the files attempt `id` starts from and records the outcome on it. A failure
    /// only means this turn cannot be rewound to; the turn goes on.
    pub(super) fn capture_turn_checkpoint(&self, id: &str) {
        let Some(run) = self.run_snapshot(id) else {
            return;
        };
        if !checkpointed(&run) {
            return;
        }
        let result = crate::commands::integration::execution_guard()
            .and_then(|_guard| capture(&run, &self.integration_directory()));
        self.update(id, |run| match result {
            Ok(checkpoint) => {
                run.rewind.checkpoint = checkpoint;
                run.rewind.checkpoint_error = None;
            }
            Err(error) => run.rewind.checkpoint_error = Some(error),
        });
    }

    /// What rewinding to `run_id`'s turn would do, or why it cannot.
    pub(in crate::commands) fn rewind_preview(
        &self,
        run_id: &str,
    ) -> Result<RewindPreview, String> {
        let runs = self.integration_runs()?;
        let (preview, prepared, _) = plan(&runs, run_id)?;
        self.ensure_rewindable(&prepared)?;
        Ok(preview)
    }

    fn ensure_rewindable(&self, prepared: &PreparedRewind) -> Result<(), String> {
        let applied = integration::applied_run_ids(self)?;
        if prepared.rewound.iter().any(|id| applied.contains(id))
            || applied.contains(&prepared.preview.latest_run_id)
        {
            return Err("This work was merged. Start new work from the updated project.".into());
        }
        Ok(())
    }

    /// Checks a rewind to `run_id` and does its conversation part: a Codex rewind forks the
    /// thread, which leaves the original as it was. Takes no lock beyond the fork's own
    /// reservation, so call it before the execution guard.
    pub(in crate::commands) fn prepare_rewind(
        &self,
        run_id: &str,
        latest_run_id: &str,
    ) -> Result<PreparedRewind, String> {
        let runs = self.integration_runs()?;
        let (_, mut prepared, previous) = plan(&runs, run_id)?;
        if prepared.preview.latest_run_id != latest_run_id {
            return Err("Newer work arrived. Review it before rewinding.".into());
        }
        self.ensure_rewindable(&prepared)?;
        if let (RewindResume::Codex { .. }, Some(previous)) = (&prepared.resume, previous) {
            let mark = previous.rewind.mark.clone().ok_or("Attempt not found")?;
            let forked = self.fork_codex_thread_after(&previous.id, &mark.entry)?;
            prepared.resume = RewindResume::Codex {
                thread: forked.thread_id,
            };
        }
        Ok(prepared)
    }

    /// Restores the files of a prepared rewind and records it. The caller holds the
    /// coordinator state and passes the execution guard it took.
    pub(in crate::commands) fn apply_rewind(
        &self,
        _guard: &ExecutionGuard,
        prepared: PreparedRewind,
    ) -> Result<RewindOutcome, String> {
        // Rechecked under the guard: no turn can start between this check and the restore.
        let runs = self.integration_runs()?;
        let (preview, current, _) = plan(&runs, &prepared.preview.run_id)?;
        if preview.latest_run_id != prepared.preview.latest_run_id
            || current.rewound != prepared.rewound
            || current.checkpoint != prepared.checkpoint
        {
            return Err(
                "This work changed while rewinding. Nothing was changed; try again.".into(),
            );
        }
        let latest = runs
            .iter()
            .find(|run| run.id == preview.latest_run_id)
            .cloned()
            .ok_or("Attempt not found")?;
        let _lease = hold_workspace(&latest.workspace)?;
        let id = uuid::Uuid::new_v4().to_string();
        let directory = self.integration_directory();
        let safety = safety_snapshot(
            &latest,
            &directory,
            &format!("refs/jackalope/rewinds/{}/{id}", prepared.task_id),
        )?;
        restore(
            Path::new(&latest.workspace),
            &directory,
            &safety.tree,
            &prepared.checkpoint.tree,
            None,
        )?;
        let at = Utc::now().to_rfc3339();
        let rewind = Rewind {
            id: id.clone(),
            at: at.clone(),
            turn_run_id: preview.run_id.clone(),
            turn: preview.turn,
            rewound_run_ids: prepared.rewound.clone(),
            restored: prepared.checkpoint.clone(),
            safety: safety.clone(),
            resume: prepared.resume.clone(),
            undone_at: None,
            replaces: latest.rewind.pending().cloned().map(Box::new),
        };
        let saved = (|| {
            for run_id in &prepared.rewound {
                self.update_checked(run_id, |run| {
                    run.rewind.rewound = Some(Rewound {
                        rewind_id: id.clone(),
                        at: at.clone(),
                    })
                })?;
            }
            self.update_checked(&latest.id, |run| {
                run.rewind.applied = Some(rewind.clone());
                activity(
                    run,
                    &format!(
                        "Rewound to turn {}: {} undone and files restored to how that turn found them. The files before the rewind are saved in Git at {}.",
                        preview.turn,
                        plural(preview.undone, "turn"),
                        safety.reference
                    ),
                );
            })
        })();
        saved.map_err(|error| {
            format!(
                "Files were restored, but the rewind could not be saved: {error}. The files before it are in Git at {}.",
                safety.reference
            )
        })?;
        let prompt = runs
            .iter()
            .find(|run| run.id == preview.run_id)
            .map(|run| run.prompt.clone())
            .unwrap_or_default();
        Ok(RewindOutcome { rewind, prompt })
    }

    /// Undoes the rewind kept on `run_id`, which must still be the latest attempt: the files
    /// return from its safety snapshot and the next turn continues the original conversation.
    /// The files the undo replaces are saved first, like a rewind's.
    pub(in crate::commands) fn undo_rewind(
        &self,
        _guard: &ExecutionGuard,
        run_id: &str,
    ) -> Result<(), String> {
        let runs = self.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == run_id)
            .ok_or("Attempt not found")?;
        let rewind = run
            .rewind
            .pending()
            .cloned()
            .ok_or("There is no rewind to undo here.")?;
        let attempts = attempts(&runs, &run.task_id);
        if attempts.last().map(|latest| latest.id.as_str()) != Some(run_id) {
            return Err(format!(
                "A turn ran after the rewind, so it cannot be undone. The files from before it are saved in Git at {}.",
                rewind.safety.reference
            ));
        }
        if attempts
            .iter()
            .any(|attempt| attempt.status.is_active() || attempt.finishing)
        {
            return Err("Stop the running turn before undoing the rewind.".into());
        }
        let _lease = hold_workspace(&run.workspace)?;
        let directory = self.integration_directory();
        let before = safety_snapshot(
            run,
            &directory,
            &format!("refs/jackalope/rewinds/{}/{}-undo", run.task_id, rewind.id),
        )?;
        let workspace = Path::new(&run.workspace);
        let head = repo::git(workspace, &["rev-parse", "HEAD"], Policy::Snapshot)?;
        let index = rewind
            .safety
            .index
            .as_deref()
            .filter(|_| head == rewind.safety.head);
        restore(
            workspace,
            &directory,
            &before.tree,
            &rewind.safety.tree,
            index,
        )?;
        let at = Utc::now().to_rfc3339();
        for id in &rewind.rewound_run_ids {
            self.update_checked(id, |attempt| {
                if attempt
                    .rewind
                    .rewound
                    .as_ref()
                    .is_some_and(|rewound| rewound.rewind_id == rewind.id)
                {
                    attempt.rewind.rewound = None;
                }
            })?;
        }
        self.update_checked(run_id, |run| {
            run.rewind.applied = match rewind.replaces.clone() {
                Some(earlier) => Some(*earlier),
                None => Some(Rewind {
                    undone_at: Some(at.clone()),
                    ..rewind.clone()
                }),
            };
            activity(
                run,
                &format!(
                    "Undid the rewind to turn {}: files and conversation are as they were before it. The files the undo replaced are saved in Git at {}.",
                    rewind.turn, before.reference
                ),
            );
        })
    }

    /// The attempt the next turn resumes, after the rewind kept on `previous` if there is
    /// one: its session replaced by the rewound conversation, or none for a new one.
    pub(super) fn rewound_resume(&self, id: &str, previous: TaskRun) -> Option<TaskRun> {
        let Some(rewind) = previous.rewind.pending().cloned() else {
            return Some(previous);
        };
        let mut resumed = previous;
        let note = match &rewind.resume {
            RewindResume::New => {
                self.update(id, |run| {
                    activity(run, &format!("Continues from the rewind to turn {}, as a new conversation: the agent does not see the turns that were undone.", rewind.turn))
                });
                return None;
            }
            RewindResume::Claude { session, at } => {
                resumed.session_id = Some(session.clone());
                resumed.rewind.resume_at = Some(at.clone());
                "Claude Code resumes its conversation as it was before that turn"
            }
            RewindResume::Codex { thread } => {
                resumed.session_id = Some(thread.clone());
                "Codex continues a copy of its conversation as it was before that turn"
            }
        };
        self.update(id, |run| {
            activity(
                run,
                &format!("Continues from the rewind to turn {}: {note}.", rewind.turn),
            )
        });
        Some(resumed)
    }
}

#[tauri::command]
pub async fn task_rewind_preview(
    run_id: String,
    runtime: State<'_, TaskRuntime>,
) -> Result<RewindPreview, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.rewind_preview(&run_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_rewind(
    run_id: String,
    latest_run_id: String,
    runtime: State<'_, TaskRuntime>,
    coordinator: State<'_, crate::commands::coordination::Coordinator>,
    sessions: State<'_, crate::commands::live_sessions::LiveSessions>,
) -> Result<RewindOutcome, String> {
    let runtime = runtime.inner().clone();
    let coordinator = coordinator.inner().clone();
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let session = runtime
            .run_snapshot(&run_id)
            .ok_or("Attempt not found")?
            .live_session_id;
        match session {
            Some(session) => sessions.rewind(&session, &run_id, &latest_run_id),
            None => coordinator.rewind(runtime.prepare_rewind(&run_id, &latest_run_id)?),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_rewind_undo(
    run_id: String,
    runtime: State<'_, TaskRuntime>,
    coordinator: State<'_, crate::commands::coordination::Coordinator>,
    sessions: State<'_, crate::commands::live_sessions::LiveSessions>,
) -> Result<(), String> {
    let runtime = runtime.inner().clone();
    let coordinator = coordinator.inner().clone();
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let session = runtime
            .run_snapshot(&run_id)
            .ok_or("Attempt not found")?
            .live_session_id;
        match session {
            Some(session) => sessions.undo_rewind(&session, &run_id),
            None => coordinator.undo_rewind(&run_id),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
