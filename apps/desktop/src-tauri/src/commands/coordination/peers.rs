//! Live, read-only visibility into concurrent work in the same project.
//!
//! Each worktree stays single-writer. Peers read each other's latest snapshot
//! (the tree the scope check records about every ten seconds) instead of
//! waiting for integration, and pairwise `merge-tree` reports content conflicts
//! while they are still small. Nothing here writes to a worktree, index or ref:
//! the only objects created are unreferenced synthetic commits for merge-tree.

use super::*;
use crate::commands::git_command::{command, Policy};
use crate::commands::tasks::TaskRun;
use rmcp::schemars;
use serde::Serialize;
use std::path::Path;

const MAX_PEERS: usize = 16;
const MAX_FILES: usize = 200;
const DEFAULT_READ_CHARS: usize = 20_000;
const MAX_READ_CHARS: usize = 60_000;
const MAX_BLOB_BYTES: u64 = 4 * 1024 * 1024;

/// Trees each caller has already seen, so `peers` can flag new progress.
static LAST_READ: Mutex<Option<HashMap<String, HashMap<String, String>>>> = Mutex::new(None);
/// merge-tree results keyed by both synthetic commits; trees are immutable.
static CONFLICTS: Mutex<Option<HashMap<(String, String), Vec<String>>>> = Mutex::new(None);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerFile {
    pub path: String,
    pub status: String,
    pub added: Option<u64>,
    pub removed: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub task_id: String,
    pub run_id: String,
    pub title: String,
    pub agent: String,
    pub status: String,
    pub scopes: Vec<String>,
    pub tree: Option<String>,
    pub files: Vec<PeerFile>,
    pub files_omitted: usize,
    pub conflicts: Vec<String>,
    pub changed_since_last_read: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRun {
    pub task_id: String,
    pub run_id: String,
    pub status: String,
    pub snapshot: bool,
    pub files: usize,
    pub added: u64,
    pub removed: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveConflict {
    pub task_ids: [String; 2],
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveCombination {
    pub runs: Vec<LiveRun>,
    pub conflicts: Vec<LiveConflict>,
    /// False when a snapshot or conflict check is unavailable, so "no conflicts" is unknown.
    pub complete: bool,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PeerReadInput {
    #[schemars(description = "Task ID from peers")]
    #[serde(alias = "task_id")]
    pub task_id: String,
    #[schemars(description = "Repository-relative file path")]
    pub path: String,
    #[schemars(
        description = "Return the peer's diff for this path against its starting commit instead of file content"
    )]
    #[serde(default)]
    pub diff: bool,
    #[schemars(description = "Character offset for long content")]
    #[serde(default)]
    pub offset: usize,
    #[schemars(description = "Characters to return, at most 60000")]
    pub limit: Option<usize>,
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = command(path, args, Policy::Inspection)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Latest attempt per task in this project that has isolated, unintegrated work.
fn candidates<'a>(runs: &'a [TaskRun], view: &QueueView, project_id: &str) -> Vec<&'a TaskRun> {
    let mut latest: Vec<&TaskRun> = Vec::new();
    for run in runs.iter().filter(|r| {
        r.project_id == project_id
            && r.archived_at.is_none()
            && !r.base_head.is_empty()
            && !r.workspace.is_empty()
            && r.workspace != r.project_path
            && (active(&r.status) || ["review", "reviewed"].contains(&r.status.as_str()))
            && !view.merged_run_ids.contains(&r.id)
    }) {
        if runs
            .iter()
            .any(|other| other.task_id == run.task_id && other.started_at > run.started_at)
        {
            continue;
        }
        if view
            .items
            .iter()
            .any(|item| item.id == run.task_id && item.canceled)
        {
            continue;
        }
        latest.push(run);
    }
    latest
}

fn tree_of(view: &QueueView, run: &TaskRun) -> Option<String> {
    view.scope_audits
        .iter()
        .find(|audit| audit.run_id == run.id)
        .and_then(|audit| audit.tree.clone())
}

fn files(run: &TaskRun, tree: &str) -> Result<(Vec<PeerFile>, usize), String> {
    let workspace = Path::new(&run.workspace);
    let statuses = git(
        workspace,
        &[
            "diff",
            "--name-status",
            "--no-renames",
            "-z",
            &run.base_head,
            tree,
            "--",
        ],
    )?;
    let numstat = git(
        workspace,
        &[
            "diff",
            "--numstat",
            "--no-renames",
            "-z",
            &run.base_head,
            tree,
            "--",
        ],
    )?;
    let mut counts = HashMap::new();
    for record in numstat.split('\0').filter(|r| !r.is_empty()) {
        let mut parts = record.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        counts.insert(path.to_string(), (added.parse().ok(), removed.parse().ok()));
    }
    let fields = statuses
        .split('\0')
        .filter(|f| !f.is_empty())
        .collect::<Vec<_>>();
    let mut result = Vec::new();
    for pair in fields.chunks(2) {
        let [status, path] = pair else { continue };
        let (added, removed) = counts.get(*path).copied().unwrap_or((None, None));
        result.push(PeerFile {
            path: (*path).into(),
            status: match *status {
                "A" => "added",
                "D" => "deleted",
                _ => "modified",
            }
            .into(),
            added,
            removed,
        });
    }
    let omitted = result.len().saturating_sub(MAX_FILES);
    result.truncate(MAX_FILES);
    Ok((result, omitted))
}

fn synthetic_commit(workspace: &Path, tree: &str, base: &str) -> Result<String, String> {
    let output = command(
        workspace,
        &[
            "commit-tree",
            tree,
            "-p",
            base,
            "-m",
            "jackalope peer snapshot",
        ],
        Policy::Inspection,
    )
    // Fixed metadata makes repeated checks reuse the same object.
    .env("GIT_AUTHOR_DATE", "2000-01-01T00:00:00Z")
    .env("GIT_COMMITTER_DATE", "2000-01-01T00:00:00Z")
    .env("GIT_AUTHOR_NAME", "Jackalope peers")
    .env("GIT_COMMITTER_NAME", "Jackalope peers")
    .env("GIT_AUTHOR_EMAIL", "peers@jackalope.invalid")
    .env("GIT_COMMITTER_EMAIL", "peers@jackalope.invalid")
    .output()
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

/// Paths Git cannot merge automatically between two snapshots.
fn conflicts(left: (&TaskRun, &str), right: (&TaskRun, &str)) -> Result<Vec<String>, String> {
    let workspace = Path::new(&left.0.workspace);
    let a = synthetic_commit(workspace, left.1, &left.0.base_head)?;
    let b = synthetic_commit(workspace, right.1, &right.0.base_head)?;
    let key = if a <= b {
        (a.clone(), b.clone())
    } else {
        (b.clone(), a.clone())
    };
    if let Some(found) = CONFLICTS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|cache| cache.get(&key).cloned())
    {
        return Ok(found);
    }
    let output = command(
        workspace,
        &["merge-tree", "--write-tree", "--name-only", &a, &b],
        Policy::Inspection,
    )
    .output()
    .map_err(|e| e.to_string())?;
    let paths = match output.status.code() {
        Some(0) => Vec::new(),
        Some(1) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut lines = stdout.lines().skip(1);
            let mut paths = lines
                .by_ref()
                .take_while(|line| !line.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            paths.dedup();
            if paths.is_empty() {
                paths.push("Git reported a conflict without file names.".into());
            }
            paths
        }
        _ => return Err(String::from_utf8_lossy(&output.stderr).trim().into()),
    };
    let mut cache = CONFLICTS.lock().unwrap();
    let cache = cache.get_or_insert_with(HashMap::new);
    if cache.len() > 512 {
        cache.clear();
    }
    cache.insert(key, paths.clone());
    Ok(paths)
}

fn title(view: &QueueView, run: &TaskRun) -> String {
    view.items
        .iter()
        .find(|item| item.id == run.task_id)
        .map(|item| item.title.clone())
        .unwrap_or_else(|| run.prompt.chars().take(80).collect())
}

fn scopes_of(view: &QueueView, run: &TaskRun) -> Vec<String> {
    let Some(item) = view.items.iter().find(|item| item.id == run.task_id) else {
        return vec![];
    };
    let mut scopes = item.scopes.clone();
    for agreement in view.agreements.iter().filter(|a| {
        a.project_id == item.project_id
            && a.task_id == item.id
            && a.kind == "ownership"
            && agreements::live(a)
    }) {
        for path in &agreement.paths {
            if !scopes.contains(path) {
                scopes.push(path.clone());
            }
        }
    }
    scopes
}

/// Every other task's current work, as seen by `caller`.
pub(super) fn peers(view: &QueueView, runs: &[TaskRun], caller: &TaskRun) -> Vec<Peer> {
    let own_tree = tree_of(view, caller);
    let mut seen = LAST_READ.lock().unwrap();
    let seen = seen
        .get_or_insert_with(HashMap::new)
        .entry(caller.id.clone())
        .or_default();
    let mut result = Vec::new();
    for run in candidates(runs, view, &caller.project_id)
        .into_iter()
        .filter(|run| run.task_id != caller.task_id)
        .take(MAX_PEERS)
    {
        let tree = tree_of(view, run);
        let mut peer = Peer {
            task_id: run.task_id.clone(),
            run_id: run.id.clone(),
            title: title(view, run),
            agent: run.agent.clone(),
            status: run.status.clone(),
            scopes: scopes_of(view, run),
            tree: tree.clone(),
            files: vec![],
            files_omitted: 0,
            conflicts: vec![],
            changed_since_last_read: false,
            error: None,
        };
        match &tree {
            None => {
                peer.error =
                    Some("No snapshot yet. Jackalope records one about every ten seconds.".into())
            }
            Some(tree) => {
                peer.changed_since_last_read = seen.get(&run.id) != Some(tree);
                seen.insert(run.id.clone(), tree.clone());
                match files(run, tree) {
                    Ok((files, omitted)) => {
                        peer.files = files;
                        peer.files_omitted = omitted;
                    }
                    Err(error) => peer.error = Some(error),
                }
                if let Some(own) = &own_tree {
                    match conflicts((caller, own), (run, tree)) {
                        Ok(paths) => peer.conflicts = paths,
                        Err(error) => peer.error = Some(error),
                    }
                }
            }
        }
        result.push(peer);
    }
    result
}

fn valid_path(path: &str) -> Result<String, String> {
    let path = path.trim().replace('\\', "/");
    if path.is_empty()
        || path.len() > 500
        || path.starts_with('/')
        || path.contains(':')
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("Use a repository-relative file path without parent traversal.".into());
    }
    Ok(path)
}

fn window(text: &str, offset: usize, limit: Option<usize>) -> serde_json::Value {
    let limit = limit.unwrap_or(DEFAULT_READ_CHARS).clamp(1, MAX_READ_CHARS);
    let total = text.chars().count();
    let content: String = text.chars().skip(offset).take(limit).collect();
    let end = offset.saturating_add(limit);
    serde_json::json!({
        "content": content,
        "offset": offset,
        "totalChars": total,
        "nextOffset": (end < total).then_some(end),
    })
}

/// A file or diff from another task's latest snapshot. Never touches its worktree.
pub(super) fn read(
    view: &QueueView,
    runs: &[TaskRun],
    caller: &TaskRun,
    input: &PeerReadInput,
) -> Result<serde_json::Value, String> {
    let path = valid_path(&input.path)?;
    let run = candidates(runs, view, &caller.project_id)
        .into_iter()
        .find(|run| run.task_id == input.task_id && run.task_id != caller.task_id)
        .ok_or(
            "That task has no unintegrated isolated work in this project. Use peers for task IDs.",
        )?;
    let tree = tree_of(view, run)
        .ok_or("No snapshot yet. Jackalope records one about every ten seconds.")?;
    let workspace = Path::new(&run.workspace);
    let text = if input.diff {
        git(
            workspace,
            &[
                "diff",
                "--no-renames",
                "--no-color",
                &run.base_head,
                &tree,
                "--",
                &path,
            ],
        )?
    } else {
        let object = format!("{tree}:{path}");
        let kind = git(workspace, &["cat-file", "-t", &object])
            .map_err(|_| "That path does not exist in the peer's snapshot.".to_string())?;
        if kind.trim() != "blob" {
            return Err(
                "That path is a folder. Read individual files from peers' file lists.".into(),
            );
        }
        let size: u64 = git(workspace, &["cat-file", "-s", &object])?
            .trim()
            .parse()
            .unwrap_or(u64::MAX);
        if size > MAX_BLOB_BYTES {
            return Err("That file is too large to read through peers.".into());
        }
        let output = command(
            workspace,
            &["cat-file", "blob", &object],
            Policy::Inspection,
        )
        .output()
        .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err("Could not read that file from the peer's snapshot.".into());
        }
        if output.stdout.contains(&0) {
            return Err("That file is binary.".into());
        }
        String::from_utf8_lossy(&output.stdout).into_owned()
    };
    let mut value = window(&text, input.offset, input.limit);
    value["taskId"] = serde_json::json!(run.task_id);
    value["path"] = serde_json::json!(path);
    value["tree"] = serde_json::json!(tree);
    value["diff"] = serde_json::json!(input.diff);
    Ok(value)
}

/// Snapshot sizes and pairwise conflicts for the selected tasks' current work.
pub(super) fn combination(
    view: &QueueView,
    runs: &[TaskRun],
    project_id: &str,
    task_ids: &[String],
) -> LiveCombination {
    let selected = candidates(runs, view, project_id)
        .into_iter()
        .filter(|run| task_ids.is_empty() || task_ids.contains(&run.task_id))
        .take(MAX_PEERS)
        .collect::<Vec<_>>();
    let mut complete = true;
    let mut live = Vec::new();
    let mut trees = Vec::new();
    for run in &selected {
        let tree = tree_of(view, run);
        let (count, added, removed) = match tree.as_deref().map(|tree| files(run, tree)) {
            Some(Ok((files, omitted))) => (
                files.len() + omitted,
                files.iter().filter_map(|f| f.added).sum(),
                files.iter().filter_map(|f| f.removed).sum(),
            ),
            _ => {
                complete = false;
                (0, 0, 0)
            }
        };
        if let Some(tree) = tree {
            trees.push((*run, tree));
        }
        live.push(LiveRun {
            task_id: run.task_id.clone(),
            run_id: run.id.clone(),
            status: run.status.clone(),
            snapshot: count > 0 || trees.iter().any(|(r, _)| r.id == run.id),
            files: count,
            added,
            removed,
        });
    }
    let mut found = Vec::new();
    for (index, (left, left_tree)) in trees.iter().enumerate() {
        for (right, right_tree) in &trees[index + 1..] {
            match conflicts((left, left_tree), (right, right_tree)) {
                Ok(paths) if !paths.is_empty() => found.push(LiveConflict {
                    task_ids: [left.task_id.clone(), right.task_id.clone()],
                    paths,
                }),
                Ok(_) => {}
                Err(_) => complete = false,
            }
        }
    }
    LiveCombination {
        runs: live,
        conflicts: found,
        complete,
    }
}

pub(in crate::commands) async fn bridge_peers(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let caller = service.authorized_run(&headers)?;
    let view = service
        .view()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let runs = service
        .runtime
        .integration_runs()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let peers = tauri::async_runtime::spawn_blocking(move || peers(&view, &runs, &caller))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({
        "peers": peers,
        "note": "Snapshots refresh about every ten seconds. Read peers' files to build against their interfaces; edit only your own paths and use agreement or message to change shared contracts. conflicts lists files Git cannot merge with your current work.",
    })))
}

pub(in crate::commands) async fn bridge_peer_read(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Json(input): Json<PeerReadInput>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let caller = service
        .authorized_run(&headers)
        .map_err(|status| (status, "Unauthorized".into()))?;
    let view = service
        .view()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let runs = service
        .runtime
        .integration_runs()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    tauri::async_runtime::spawn_blocking(move || read(&view, &runs, &caller, &input))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Json)
        .map_err(|error| (StatusCode::BAD_REQUEST, error))
}

#[tauri::command]
pub async fn coordination_live_combination(
    project_id: String,
    task_ids: Vec<String>,
    state: State<'_, Coordinator>,
) -> Result<LiveCombination, String> {
    if task_ids.len() > MAX_PEERS {
        return Err("Choose at most sixteen tasks.".into());
    }
    let view = state.view()?;
    let runs = state.runtime.integration_runs()?;
    tauri::async_runtime::spawn_blocking(move || combination(&view, &runs, &project_id, &task_ids))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("jackalope-peers-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        run_git(&root, &["init", "--initial-branch=main"]);
        std::fs::write(root.join("shared.txt"), "one\ntwo\nthree\n").unwrap();
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "base"]);
        root
    }

    fn run_git(path: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .current_dir(path)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().into()
    }

    /// A worktree with `files` written over the base, returned as a run and its tree.
    fn attempt(root: &Path, name: &str, files: &[(&str, &str)]) -> (TaskRun, String) {
        let workspace = root.with_file_name(format!(
            "{}-{name}",
            root.file_name().unwrap().to_string_lossy()
        ));
        run_git(
            root,
            &["worktree", "add", "-b", name, workspace.to_str().unwrap()],
        );
        for (path, text) in files {
            let target = workspace.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, text).unwrap();
        }
        let base = run_git(&workspace, &["rev-parse", "HEAD"]);
        let index = std::env::temp_dir().join(format!("jackalope-peer-{}.index", Uuid::new_v4()));
        let staged = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(&workspace)
                .args(args)
                .env("GIT_INDEX_FILE", &index)
                .output()
                .unwrap();
            assert!(output.status.success());
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        staged(&["read-tree", "HEAD"]);
        staged(&["add", "--all", "--", "."]);
        let tree = staged(&["write-tree"]);
        let mut run: TaskRun = serde_json::from_value(serde_json::json!({})).unwrap_or_default();
        run.id = format!("run-{name}");
        run.task_id = format!("task-{name}");
        run.project_id = "project".into();
        run.project_path = root.to_string_lossy().into();
        run.workspace = workspace.to_string_lossy().into();
        run.base_head = base;
        run.status = "running".into();
        run.agent = "codex".into();
        run.started_at = "2026-10-01T00:00:00Z".into();
        (run, tree)
    }

    fn view(runs: &[(TaskRun, String)]) -> QueueView {
        let mut view: QueueView = Default::default();
        for (run, tree) in runs {
            view.scope_audits
                .push(super::super::scope_audit::ScopeAudit {
                    project_id: run.project_id.clone(),
                    task_id: run.task_id.clone(),
                    run_id: run.id.clone(),
                    tree: Some(tree.clone()),
                    outside: vec![],
                    overlaps: vec![],
                    error: None,
                    accepted_tree: None,
                });
        }
        view
    }

    #[test]
    fn peers_see_each_others_live_work_and_new_progress() {
        let root = repo();
        let api = attempt(
            &root,
            "api",
            &[("src/api.ts", "export type User = { id: string };\n")],
        );
        let ui = attempt(
            &root,
            "ui",
            &[("src/ui.ts", "import type { User } from './api';\n")],
        );
        let snapshots = vec![api.clone(), ui.clone()];
        let runs = snapshots
            .iter()
            .map(|(run, _)| run.clone())
            .collect::<Vec<_>>();
        let view = view(&snapshots);

        let seen = peers(&view, &runs, &ui.0);
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].task_id, "task-api");
        assert_eq!(seen[0].files[0].path, "src/api.ts");
        assert_eq!(seen[0].files[0].status, "added");
        assert_eq!(seen[0].files[0].added, Some(1));
        assert!(seen[0].conflicts.is_empty());
        assert!(seen[0].changed_since_last_read);
        assert!(!peers(&view, &runs, &ui.0)[0].changed_since_last_read);

        let file = read(
            &view,
            &runs,
            &ui.0,
            &PeerReadInput {
                task_id: "task-api".into(),
                path: "src/api.ts".into(),
                diff: false,
                offset: 0,
                limit: None,
            },
        )
        .unwrap();
        assert_eq!(file["content"], "export type User = { id: string };\n");
        let diff = read(
            &view,
            &runs,
            &ui.0,
            &PeerReadInput {
                task_id: "task-api".into(),
                path: "src/api.ts".into(),
                diff: true,
                offset: 0,
                limit: None,
            },
        )
        .unwrap();
        assert!(diff["content"]
            .as_str()
            .unwrap()
            .contains("+export type User"));
        for path in ["../outside", "/etc/passwd", "a//b", "C:/x"] {
            assert!(read(
                &view,
                &runs,
                &ui.0,
                &PeerReadInput {
                    task_id: "task-api".into(),
                    path: path.into(),
                    diff: false,
                    offset: 0,
                    limit: None,
                },
            )
            .is_err());
        }
        // A task cannot read itself through peers.
        assert!(read(
            &view,
            &runs,
            &ui.0,
            &PeerReadInput {
                task_id: "task-ui".into(),
                path: "src/ui.ts".into(),
                diff: false,
                offset: 0,
                limit: None,
            },
        )
        .is_err());
    }

    #[test]
    fn combination_separates_clean_overlaps_from_real_conflicts() {
        let root = repo();
        let top = attempt(&root, "top", &[("shared.txt", "ONE\ntwo\nthree\n")]);
        let bottom = attempt(&root, "bottom", &[("shared.txt", "one\ntwo\nTHREE\n")]);
        let clash = attempt(&root, "clash", &[("shared.txt", "uno\ntwo\nthree\n")]);
        let snapshots = vec![top.clone(), bottom.clone(), clash.clone()];
        let runs = snapshots
            .iter()
            .map(|(run, _)| run.clone())
            .collect::<Vec<_>>();
        let view = view(&snapshots);

        let live = combination(&view, &runs, "project", &[]);
        assert!(live.complete);
        assert_eq!(live.runs.len(), 3);
        assert!(live.runs.iter().all(|run| run.files == 1));
        // Different lines of one file merge; the same line conflicts.
        assert_eq!(live.conflicts.len(), 1);
        assert_eq!(
            live.conflicts[0].task_ids,
            ["task-top".to_string(), "task-clash".to_string()]
        );
        assert_eq!(live.conflicts[0].paths, vec!["shared.txt".to_string()]);

        let only = combination(
            &view,
            &runs,
            "project",
            &["task-top".into(), "task-bottom".into()],
        );
        assert!(only.conflicts.is_empty());
        assert_eq!(
            peers(&view, &runs, &clash.0)[0].conflicts,
            vec!["shared.txt".to_string()]
        );
    }

    #[test]
    fn integrated_canceled_and_shared_checkout_work_is_not_a_peer() {
        let root = repo();
        let done = attempt(&root, "done", &[("a.txt", "a")]);
        let caller = attempt(&root, "caller", &[("b.txt", "b")]);
        let mut shared = attempt(&root, "shared", &[("c.txt", "c")]);
        shared.0.workspace = shared.0.project_path.clone();
        let snapshots = vec![done.clone(), caller.clone(), shared.clone()];
        let runs = snapshots
            .iter()
            .map(|(run, _)| run.clone())
            .collect::<Vec<_>>();
        let mut view = view(&snapshots);
        view.merged_run_ids.push(done.0.id.clone());
        assert!(peers(&view, &runs, &caller.0).is_empty());
    }
}
