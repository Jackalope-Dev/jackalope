use super::{history, integration, tasks::TaskRuntime, verification};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bookmark {
    workspace: String,
    tree: String,
    viewed_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewProgress {
    tree: String,
    diff: String,
    files: Vec<String>,
    viewed_at: Option<String>,
    note: String,
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = super::git_command::command(path, args, super::git_command::Policy::Inspection)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("The previous review snapshot is unavailable. Review all changes and save a new position.".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into())
}

pub(super) fn progress(
    runtime: &TaskRuntime,
    id: &str,
    seen_tree: Option<&str>,
) -> Result<ReviewProgress, String> {
    let _guard = integration::execution_guard()?;
    let runs = runtime.integration_runs()?;
    let run = runs
        .iter()
        .find(|run| run.id == id)
        .ok_or("Task not found")?;
    if run.task_id.is_empty()
        || !run
            .task_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("This task has an unsupported history identifier.".into());
    }
    if run.workspace.is_empty()
        || runs.iter().any(|other| {
            other.workspace == run.workspace
                && (["starting", "running", "stopping", "interrupted"]
                    .contains(&other.status.as_str())
                    || other.finishing)
        })
    {
        return Err(
            "Finish work and resolve interrupted ownership before saving a review position.".into(),
        );
    }
    verification::ensure_idle(&run.workspace)?;
    let directory = runtime.integration_directory().join("review-progress");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let source = integration::snapshot(run, &directory)?;
    let path = directory.join(format!("{}.json", run.task_id));
    if let Some(seen) = seen_tree {
        if seen != source.tree {
            return Err(
                "Files changed after you opened this review. Refresh before marking them seen."
                    .into(),
            );
        }
        let bookmark = Bookmark {
            workspace: run.workspace.clone(),
            tree: source.tree.clone(),
            viewed_at: chrono::Utc::now().to_rfc3339(),
        };
        history::write_atomic(
            &path,
            &serde_json::to_vec(&bookmark).map_err(|e| e.to_string())?,
        )?;
    }
    let bookmark: Option<Bookmark> = if path.exists() {
        Some(
            serde_json::from_slice(&history::read_bounded(&path, 16_384)?)
                .map_err(|e| format!("Review position could not be read: {e}"))?,
        )
    } else {
        None
    };
    let bookmark = bookmark.filter(|bookmark| bookmark.workspace == run.workspace);
    let workspace = Path::new(&run.workspace);
    let available = bookmark.as_ref().filter(|bookmark| {
        git(workspace, &["cat-file", "-t", &bookmark.tree]).is_ok_and(|kind| kind.trim() == "tree")
    });
    let base = available.map_or(run.base_head.as_str(), |bookmark| bookmark.tree.as_str());
    let diff = git(
        workspace,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            base,
            &source.tree,
            "--",
        ],
    )?;
    let files = git(
        workspace,
        &["diff", "--name-only", "-z", base, &source.tree, "--"],
    )?;
    let mut note = match (available, bookmark.as_ref()) {
        (Some(_), _) => "Changes since your saved review position. Checks and acceptance still apply to the complete current result.",
        (None, Some(_)) => "Your previous review snapshot is no longer available. Showing all current changes; save a new review position after reading them.",
        (None, None) => "All current changes. Mark them seen to compare your next iteration. This does not accept or integrate the result.",
    }.to_string();
    if diff.chars().count() > 120_000 {
        note.push_str(" Preview is truncated; inspect the full workspace before accepting.");
    }
    Ok(ReviewProgress {
        tree: source.tree,
        files: files
            .split('\0')
            .filter(|file| !file.is_empty())
            .map(String::from)
            .collect(),
        diff: diff.chars().take(120_000).collect(),
        viewed_at: available.map(|bookmark| bookmark.viewed_at.clone()),
        note,
    })
}

#[tauri::command]
pub async fn task_review_progress(
    state: State<'_, TaskRuntime>,
    id: String,
    seen_tree: Option<String>,
) -> Result<ReviewProgress, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || progress(&runtime, &id, seen_tree.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}
