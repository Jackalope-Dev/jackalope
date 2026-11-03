//! Reviews of a finished result by another agent. An agent review reads the change
//! and returns suggested fixes; a Challenge tries to break it and reports only findings
//! it proved by running something. Either reviewer works in its own worktree, started
//! from a commit of the author's files, so it never touches the author's workspace. A
//! Challenge finding's command can be run again on request in a disposable copy of the
//! reviewer's workspace.

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
    /// Reviewers saved before agent reviews existed are Challenges.
    #[serde(default)]
    pub kind: ReviewKind,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewKind {
    #[default]
    Challenge,
    /// Reads the change and suggests fixes without running checks.
    Review,
}

/// Result of running a finding's command again.
#[derive(Clone, Debug, Serialize, Deserialize)]
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

/// What the author recorded as proof, so the reviewer does not call a recorded check
/// unbacked. Empty when nothing was recorded.
fn author_evidence(author: &TaskRun) -> String {
    let mut lines = Vec::new();
    if let Some(goal) = author.understanding.as_ref().map(|u| u.goal.trim()) {
        if !goal.is_empty() {
            lines.push(format!("Goal: {goal}"));
        }
    }
    for step in &author.validation_steps {
        let notes = step.notes.as_deref().map(str::trim).unwrap_or_default();
        let evidence = if step.evidence.is_empty() {
            String::new()
        } else {
            format!(" Evidence: {}", step.evidence.join(", "))
        };
        lines.push(format!(
            "- Check ({}): {}. {notes}{evidence}",
            step.status, step.step
        ));
    }
    for entry in &author.decisions {
        lines.push(format!(
            "- Decision ({}): {}. Result: {}",
            entry.phase, entry.decision, entry.result
        ));
    }
    for shot in &author.screenshots {
        lines.push(format!("- Screenshot: {}", shot.file_path));
    }
    if lines.is_empty() {
        return String::new();
    }
    format!(
        "\nAuthor's recorded evidence (verify it rather than trusting it; do not report a claim as unbacked when it is listed here):\n{}\n",
        excerpt(&lines.join("\n"), 6_000)
    )
}

/// Instructions for an agent review: read the change and plan fixes, without running it.
pub(super) fn review_brief(author: &TaskRun, base: &str) -> String {
    let result = if author.result.trim().is_empty() {
        "(The author did not leave a result summary.)".to_string()
    } else {
        excerpt(&author.result, 4_000)
    };
    format!(
        r#"Review the change below and suggest fixes the author can apply. This is a quick read-only review: read the diff and the code around it, and do not build, install, run tests or start servers.

Your workspace is an isolated copy of the author's files at the reviewed snapshot (commit {base}); `git diff HEAD~1` shows the change. Do not edit files, commit, or open the author's workspace.

Intent
Original request:
{request}

Author's result:
{result}
{evidence}
Look for real problems: bugs, missed requirements, regressions, security issues, broken edge cases and clearly risky or confusing code. Skip style preferences and anything you are not confident about. No findings is a valid result.

For each finding, give the file and line, what is wrong, and a short, concrete fix plan the author can follow without asking you.

End your reply with a fenced block tagged jackalope-review holding JSON in this shape, with an empty findings array when you found nothing:

```jackalope-review
{{"summary": "One or two sentences on the change and its overall state.",
  "findings": [{{"severity": "high", "title": "Short title", "file": "src/example.ts", "line": 42, "problem": "What is wrong and why it matters.", "fix": "The steps to fix it."}}]}}
```

severity is high (breaks the intent or loses data), medium (a real bug or gap in some cases) or low (worth fixing, not blocking)."#,
        request = excerpt(&author.prompt, 6_000),
        evidence = author_evidence(author),
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

/// Starts one reviewer for a finished attempt. `request` carries the reviewer's agent,
/// account and project settings; its prompt and workspace are replaced here.
pub(super) fn start(
    coordinator: &Coordinator,
    runtime: &TaskRuntime,
    mut request: RunRequest,
    source_run_id: &str,
    kind: ReviewKind,
) -> Result<String, String> {
    // Lock order: the execution guard is released before the coordinator lock is taken.
    let source = {
        let _guard = integration::execution_guard()?;
        let runs = runtime.integration_runs()?;
        let author = runs
            .iter()
            .find(|run| run.id == source_run_id)
            .ok_or("The result to review no longer exists.")?;
        if runs
            .iter()
            .any(|run| run.workspace == author.workspace && ACTIVE.contains(&run.status.as_str()))
        {
            return Err("Wait for this work to finish before reviewing it.".into());
        }
        if author.workspace.is_empty() {
            return Err("This result has no workspace to review.".into());
        }
        let directory = runtime.integration_directory();
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let (tree, base) =
            integration::snapshot_commit(author, &directory, "Jackalope review snapshot")?;
        request.prompt = match kind {
            ReviewKind::Challenge => brief(author, &base),
            ReviewKind::Review => review_brief(author, &base),
        };
        request.project_id = author.project_id.clone();
        request.project_name = author.project_name.clone();
        request.project_path = author.project_path.clone();
        request.target_branch = author.target_branch.clone();
        ChallengeSource {
            run_id: author.id.clone(),
            tree,
            base,
            kind,
        }
    };
    if kind == ReviewKind::Review {
        // Reading the change needs no installed dependencies, so the review starts at once.
        request.prepare_command = None;
    }
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
    let rerun = ChallengeRerun {
        command: command.to_string(),
        preparation,
        result,
    };
    save_rerun(runtime, id, &rerun)?;
    Ok(rerun)
}

/// Where a reviewer's latest Run again results are kept, one per command, so they
/// survive a reload. Ids come from the runtime, which only issues UUID-style ids.
fn reruns_path(runtime: &TaskRuntime, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Unknown reviewer attempt.".into());
    }
    Ok(runtime
        .integration_directory()
        .join("challenge-reruns")
        .join(format!("{id}.json")))
}

fn load_reruns(runtime: &TaskRuntime, id: &str) -> Result<Vec<ChallengeRerun>, String> {
    match std::fs::read(reruns_path(runtime, id)?) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(error) => Err(error.to_string()),
    }
}

fn save_rerun(runtime: &TaskRuntime, id: &str, rerun: &ChallengeRerun) -> Result<(), String> {
    let path = reruns_path(runtime, id)?;
    let mut saved = load_reruns(runtime, id)?;
    saved.retain(|other| other.command != rerun.command);
    saved.push(rerun.clone());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec(&saved).map_err(|e| e.to_string())?;
    super::history::write_atomic(&path, &bytes)
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
        start(
            &coordinator,
            &runtime,
            request,
            &source_run_id,
            ReviewKind::Challenge,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_start_agent_review(
    request: RunRequest,
    source_run_id: String,
    coordinator: State<'_, Coordinator>,
    runtime: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let coordinator = coordinator.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start(
            &coordinator,
            &runtime,
            request,
            &source_run_id,
            ReviewKind::Review,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The latest Run again result for each of this reviewer's finding commands.
#[tauri::command]
pub fn task_challenge_reruns(
    id: String,
    runtime: State<'_, TaskRuntime>,
) -> Result<Vec<ChallengeRerun>, String> {
    load_reruns(runtime.inner(), &id)
}

/// The reviewer's full reply, which summaries omit, for reading its findings block.
#[tauri::command]
pub fn task_challenge_reply(id: String, runtime: State<'_, TaskRuntime>) -> Result<String, String> {
    let run = runtime
        .run_snapshot(&id)
        .ok_or("The reviewer's attempt no longer exists.")?;
    if run.challenge_of.is_none() {
        return Err("This attempt is not a reviewer.".into());
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
    fn review_brief_is_read_only_and_asks_for_fix_plans() {
        let text = review_brief(&author(), "abc123");
        for expected in [
            "Reject empty names when saving a profile.",
            "Saving now trims the name and refuses blank input.",
            "commit abc123",
            "do not build, install, run tests",
            "Do not edit files",
            "```jackalope-review",
            "\"fix\"",
        ] {
            assert!(text.contains(expected), "brief is missing {expected:?}");
        }
        assert!(!text.contains("recorded evidence"));
        let mut proven = author();
        proven.validation_steps.push(ValidationStep {
            id: "1".into(),
            step: "Paired the simulator with a dev host".into(),
            status: "passed".into(),
            notes: None,
            evidence: vec!["/tmp/pair.png".into()],
            timestamp: "now".into(),
            requirements: vec![],
            finding: None,
            safety_fact: None,
        });
        let text = review_brief(&proven, "abc123");
        assert!(text.contains("recorded evidence"));
        assert!(text.contains("- Check (passed): Paired the simulator with a dev host."));
        assert!(text.contains("Evidence: /tmp/pair.png"));
        let source: ChallengeSource =
            serde_json::from_value(serde_json::json!({"runId": "a", "tree": "t", "base": "b"}))
                .unwrap();
        assert_eq!(source.kind, ReviewKind::Challenge);
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
            safety_fact: None,
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

    #[test]
    fn run_again_results_survive_reload_latest_per_command() {
        let root = std::env::temp_dir().join(format!("jackalope-reruns-{}", uuid::Uuid::new_v4()));
        let runtime = TaskRuntime::new(root.join("history")).unwrap();
        let result = |code| CommandResult {
            exit_code: Some(code),
            success: code == 0,
            timed_out: false,
            stalled: false,
            stdout: format!("exit {code}"),
            stderr: String::new(),
            truncated: false,
            duration_ms: 5,
        };
        let rerun = |command: &str, code| ChallengeRerun {
            command: command.into(),
            preparation: None,
            result: Some(result(code)),
        };
        assert!(load_reruns(&runtime, "reviewer-1").unwrap().is_empty());
        save_rerun(&runtime, "reviewer-1", &rerun("node a.js", 1)).unwrap();
        save_rerun(&runtime, "reviewer-1", &rerun("node b.js", 1)).unwrap();
        save_rerun(&runtime, "reviewer-1", &rerun("node a.js", 0)).unwrap();
        let saved = load_reruns(&runtime, "reviewer-1").unwrap();
        assert_eq!(saved.len(), 2);
        let a = saved
            .iter()
            .find(|entry| entry.command == "node a.js")
            .unwrap();
        assert_eq!(a.result.as_ref().unwrap().exit_code, Some(0));
        assert!(load_reruns(&runtime, "../escape").is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
