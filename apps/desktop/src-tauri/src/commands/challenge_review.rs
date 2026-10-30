//! Challenge reviews: a reviewer tries to break a finished result and reports only
//! findings it proved by running something. The reviewer works in its own worktree,
//! started from a commit of the author's files, so it never touches the author's
//! workspace. A finding's command can be run again on request in a disposable copy of
//! the reviewer's workspace.

use super::{
    coordination::Coordinator,
    git_command::{command as git_command, Policy},
    integration,
    process_control::CommandResult,
    tasks::{RunRequest, TaskRun, TaskRuntime, WorkspaceMode},
    verification,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

/// The snapshot a Challenge reviewer started from.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeSource {
    /// The attempt under review.
    pub run_id: String,
    /// The author's file tree when the review started.
    #[serde(default)]
    pub tree: String,
    /// The commit the reviewer's worktree started from.
    #[serde(default)]
    pub base: String,
}

/// Result of running a finding's command again.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeRerun {
    pub command: String,
    /// The project setup command's result, when the project has one.
    pub preparation: Option<CommandResult>,
    /// Absent when setup failed and the command did not run.
    pub result: Option<CommandResult>,
}

const ACTIVE: [&str; 4] = ["starting", "running", "stopping", "interrupted"];
const COMMAND_LIMIT: usize = 2_000;

fn excerpt(text: &str, limit: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= limit {
        return text.to_string();
    }
    format!("{}…", text.chars().take(limit).collect::<String>())
}

/// The reviewer's instructions. The intent is the author's request plus its result.
pub(super) fn brief(author: &TaskRun, base: &str) -> String {
    let result = if author.result.trim().is_empty() {
        "(The author did not leave a result summary.)".to_string()
    } else {
        excerpt(&author.result, 4_000)
    };
    format!(
        r#"Challenge review: try to break the change below. Only findings you prove by running something against the real code count.

Your workspace is an isolated copy of the author's files at the reviewed snapshot (commit {base}); `git diff HEAD~1` shows the change. Keep any tests or repro scripts you write in this workspace. Never open or edit the author's workspace, and do not commit, merge or fix the change.

Intent
Original request:
{request}

Author's result:
{result}

Prove each finding with a run: a failing test, a repro script, or a command whose output shows behavior the intent rules out. Leave out anything you did not run, including style, naming, structure and risks that need a future change to matter. No findings is a valid result.

Report each proven finding with one record_validation_step call: step is a short title, status is "failed", and finding has command (the exact command, run from your workspace root), output (what it printed, the lines that show the failure), expected (the output the intent requires) and breaks (why the printed output breaks the intent).

End your reply with the same findings as a JSON array in a fenced block tagged jackalope-findings, each item with title, command, output, expected and breaks. Use an empty array when nothing was proven:

```jackalope-findings
[]
```"#,
        request = excerpt(&author.prompt, 6_000),
    )
}

/// Whether `command` is one the reviewer reported, through the tool or its reply.
fn reported(run: &TaskRun, command: &str) -> bool {
    let command = command.trim();
    !command.is_empty()
        && (run.validation_steps.iter().any(|step| {
            step.finding
                .as_ref()
                .is_some_and(|finding| finding.command.trim() == command)
        }) || findings_block(&run.result)
            .and_then(|block| serde_json::from_str::<Vec<serde_json::Value>>(block).ok())
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item["command"].as_str().map(str::trim) == Some(command))
            }))
}

/// The reply's jackalope-findings block, the fallback for agents without the tool.
fn findings_block(reply: &str) -> Option<&str> {
    let start = reply.rfind("```jackalope-findings")?;
    let body = &reply[start + "```jackalope-findings".len()..];
    Some(&body[..body.find("```").unwrap_or(body.len())])
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command(path, args, Policy::Isolated)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Starts one Challenge reviewer for a finished attempt. `request` carries the reviewer's
/// agent, account and project settings; its prompt and workspace are replaced here.
pub(super) fn start(
    coordinator: &Coordinator,
    runtime: &TaskRuntime,
    mut request: RunRequest,
    source_run_id: &str,
) -> Result<String, String> {
    // Lock order: the execution guard is released before the coordinator lock is taken.
    let source = {
        let _guard = integration::execution_guard()?;
        let runs = runtime.integration_runs()?;
        let author = runs
            .iter()
            .find(|run| run.id == source_run_id)
            .ok_or("The result to challenge no longer exists.")?;
        if runs
            .iter()
            .any(|run| run.workspace == author.workspace && ACTIVE.contains(&run.status.as_str()))
        {
            return Err("Wait for this work to finish before challenging it.".into());
        }
        if author.workspace.is_empty() {
            return Err("This result has no workspace to challenge.".into());
        }
        let directory = runtime.integration_directory();
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let (tree, base) =
            integration::snapshot_commit(author, &directory, "Jackalope challenge snapshot")?;
        request.prompt = brief(author, &base);
        request.project_id = author.project_id.clone();
        request.project_name = author.project_name.clone();
        request.project_path = author.project_path.clone();
        request.target_branch = author.target_branch.clone();
        ChallengeSource {
            run_id: author.id.clone(),
            tree,
            base,
        }
    };
    request.isolated = true;
    request.workspace_mode = Some(WorkspaceMode::Worktree);
    request.previous_run_id = None;
    request.retry_of = None;
    request.auto_verify = false;
    request.dependency_snapshot = integration::DependencySnapshot {
        base: source.base.clone(),
        ..Default::default()
    };
    let id = coordinator.start_manual(request)?;
    runtime.update_checked(&id, |run| run.challenge_of = Some(source))?;
    Ok(id)
}

/// Removes a disposable worktree however the rerun ends.
struct Disposable {
    project: PathBuf,
    path: PathBuf,
}

impl Drop for Disposable {
    fn drop(&mut self) {
        let path = self.path.to_string_lossy().into_owned();
        let _ = git(&self.project, &["worktree", "remove", "--force", &path]);
        let _ = std::fs::remove_dir_all(&self.path);
        let _ = git(&self.project, &["worktree", "prune"]);
    }
}

pub(super) fn rerun(
    runtime: &TaskRuntime,
    id: &str,
    command: &str,
) -> Result<ChallengeRerun, String> {
    let command = command.trim();
    if command.is_empty() || command.chars().count() > COMMAND_LIMIT || command.contains('\0') {
        return Err("This finding has no command that can run again.".into());
    }
    let guard = integration::execution_guard()?;
    let runs = runtime.integration_runs()?;
    let run = runs
        .iter()
        .find(|run| run.id == id)
        .ok_or("The reviewer's attempt no longer exists.")?;
    if run.challenge_of.is_none() {
        return Err("Only Challenge findings can run again.".into());
    }
    if !reported(run, command) {
        return Err("Run again only runs a command the reviewer reported.".into());
    }
    if runs
        .iter()
        .any(|other| other.workspace == run.workspace && ACTIVE.contains(&other.status.as_str()))
    {
        return Err("Wait for the reviewer to finish before running its findings again.".into());
    }
    if run.workspace.is_empty() || !Path::new(&run.workspace).is_dir() {
        return Err(
            "The reviewer's workspace was removed, so its findings cannot run again.".into(),
        );
    }
    let directory = runtime.integration_directory();
    std::fs::create_dir_all(directory.join("challenge")).map_err(|e| e.to_string())?;
    // The reviewer's files are the reviewed snapshot plus its repro scripts.
    let (_, commit) = integration::snapshot_commit(run, &directory, "Jackalope challenge rerun")?;
    let project = std::fs::canonicalize(&run.project_path).map_err(|e| e.to_string())?;
    let path = directory
        .join("challenge")
        .join(uuid::Uuid::new_v4().simple().to_string());
    let workspace = path.to_string_lossy().into_owned();
    git(
        &project,
        &["worktree", "add", "--detach", &workspace, &commit],
    )?;
    let disposable = Disposable { project, path };
    let lease = verification::reserve_workspace(&workspace)?;
    drop(guard);
    super::workspace_setup::copy_files(&run.project_path, &workspace, &run.setup_files)?;
    let preparation = run
        .prepare_command
        .as_deref()
        .filter(|setup| !setup.trim().is_empty())
        .map(|setup| verification::run_disposable(setup, &workspace, true))
        .transpose()?;
    let result = if preparation.as_ref().map_or(true, |setup| setup.success) {
        Some(verification::run_disposable(command, &workspace, false)?)
    } else {
        None
    };
    drop(lease);
    {
        let _guard = integration::execution_guard();
        drop(disposable);
    }
    Ok(ChallengeRerun {
        command: command.to_string(),
        preparation,
        result,
    })
}

#[tauri::command]
pub async fn task_start_challenge(
    request: RunRequest,
    source_run_id: String,
    coordinator: State<'_, Coordinator>,
    runtime: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let coordinator = coordinator.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start(&coordinator, &runtime, request, &source_run_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The reviewer's full reply, which summaries omit, for reading its findings block.
#[tauri::command]
pub fn task_challenge_reply(id: String, runtime: State<'_, TaskRuntime>) -> Result<String, String> {
    let run = runtime
        .run_snapshot(&id)
        .ok_or("The reviewer's attempt no longer exists.")?;
    if run.challenge_of.is_none() {
        return Err("This attempt is not a Challenge reviewer.".into());
    }
    Ok(run.result)
}

#[tauri::command]
pub async fn task_challenge_rerun(
    id: String,
    command: String,
    runtime: State<'_, TaskRuntime>,
) -> Result<ChallengeRerun, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || rerun(&runtime, &id, &command))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::harness::{ChallengeFinding, ValidationStep};

    fn author() -> TaskRun {
        TaskRun {
            id: "author".into(),
            prompt: "Reject empty names when saving a profile.".into(),
            result: "Saving now trims the name and refuses blank input.".into(),
            ..Default::default()
        }
    }

    #[test]
    fn brief_states_the_intent_and_requires_proof() {
        let text = brief(&author(), "abc123");
        for expected in [
            "Reject empty names when saving a profile.",
            "Saving now trims the name and refuses blank input.",
            "commit abc123",
            "Never open or edit the author's workspace",
            "Leave out anything you did not run",
            "record_validation_step",
            "```jackalope-findings",
        ] {
            assert!(text.contains(expected), "brief is missing {expected:?}");
        }
        let silent = TaskRun {
            result: " ".into(),
            ..author()
        };
        assert!(brief(&silent, "abc").contains("did not leave a result summary"));
    }

    #[test]
    fn only_reported_commands_can_run_again() {
        let mut run = author();
        run.validation_steps.push(ValidationStep {
            id: "1".into(),
            step: "Blank name saves".into(),
            status: "failed".into(),
            notes: None,
            evidence: vec![],
            timestamp: "now".into(),
            requirements: vec![],
            finding: Some(ChallengeFinding {
                command: "node repro.mjs".into(),
                output: "saved".into(),
                ..Default::default()
            }),
        });
        run.result =
            "Done.\n```jackalope-findings\n[{\"command\":\"pnpm test profile\"}]\n```".into();
        assert!(reported(&run, " node repro.mjs "));
        assert!(reported(&run, "pnpm test profile"));
        assert!(!reported(&run, "rm -rf ."));
        assert!(!reported(&run, ""));
        run.result = "I ran rm -rf . earlier".into();
        assert!(!reported(&run, "rm -rf ."));
    }

    #[test]
    fn saved_steps_without_findings_still_load() {
        let step: ValidationStep = serde_json::from_value(serde_json::json!({
            "id": "1", "step": "Check", "status": "passed", "evidence": [], "timestamp": "now"
        }))
        .unwrap();
        assert!(step.finding.is_none());
        assert!(serde_json::to_value(&step)
            .unwrap()
            .get("finding")
            .is_none());
        let run: TaskRun = serde_json::from_value(serde_json::json!({
            "id": "1", "taskId": "1", "projectId": "p", "projectName": "p", "projectPath": "/p",
            "workspace": "/p", "branch": "", "baseHead": "", "agent": "codex", "account": "",
            "model": null, "prompt": "x", "status": "review", "startedAt": "now", "endedAt": null,
            "sessionId": null, "result": "", "activity": [], "error": null,
            "persistenceError": null, "exitCode": null,
            "usage": {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false,"estimatedCostUsd":null}
        }))
        .unwrap();
        assert!(run.challenge_of.is_none());
        assert!(serde_json::to_value(&run)
            .unwrap()
            .get("challengeOf")
            .is_none());
    }
}
