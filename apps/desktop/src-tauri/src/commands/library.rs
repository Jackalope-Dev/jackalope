//! Files Jackalope work left behind for the Library page: each workspace's saved
//! agent output under `.jackalope/artifacts/` and each project's pasted prompt
//! images under `.jackalope/attachments/`. Screenshots are listed from run
//! records instead. The folders come from recorded runs, never from the caller,
//! and previews and opens stay inside them.

use super::tasks::{TaskRun, TaskRuntime};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

const ATTACHMENTS: &str = ".jackalope/attachments";
/// Enough for a gallery; the newest files are kept when there are more.
const MAX_FILES: usize = 2000;
const MAX_DEPTH: usize = 4;
const IMAGE_TYPES: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
/// Documents the default app may open. Agents write these folders, so anything that
/// could run when opened (scripts, apps, installers) is only shown in the file manager.
const OPENABLE_TYPES: [&str; 14] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "txt", "md", "json", "csv", "log", "html",
    "htm",
];

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::library::library_files,
            commands::library::library_file_preview,
            commands::library::library_file_open,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub path: String,
    pub name: String,
    /// `output` for saved agent output, `attachment` for a pasted prompt image.
    pub source: &'static str,
    pub project_id: String,
    /// The newest attempt that worked in the file's workspace; absent for attachments.
    pub run_id: Option<String>,
    pub size: u64,
    /// Unix milliseconds.
    pub modified: u64,
}

/// A folder the Library lists, and who it belongs to.
#[derive(Debug, Clone, PartialEq)]
struct Root {
    folder: PathBuf,
    source: &'static str,
    project_id: String,
    run_id: Option<String>,
}

/// One root per workspace output folder, owned by the newest attempt there, and one
/// attachment folder per project.
fn roots(runs: &[TaskRun]) -> Vec<Root> {
    let mut outputs: BTreeMap<String, &TaskRun> = BTreeMap::new();
    let mut projects: BTreeMap<String, String> = BTreeMap::new();
    for run in runs {
        if !run.project_path.is_empty() {
            projects.insert(run.project_path.clone(), run.project_id.clone());
        }
        if run.workspace.is_empty() {
            continue;
        }
        let newest = outputs
            .get(&run.workspace)
            .is_none_or(|known| run.started_at > known.started_at);
        if newest {
            outputs.insert(run.workspace.clone(), run);
        }
    }
    let output = super::artifacts::FOLDER.trim_end_matches('/');
    outputs
        .into_values()
        .map(|run| Root {
            folder: Path::new(&run.workspace).join(output),
            source: "output",
            project_id: run.project_id.clone(),
            run_id: Some(run.id.clone()),
        })
        .chain(projects.into_iter().map(|(path, project_id)| Root {
            folder: Path::new(&path).join(ATTACHMENTS),
            source: "attachment",
            project_id,
            run_id: None,
        }))
        .collect()
}

fn list(roots: &[Root]) -> Vec<LibraryFile> {
    let screenshots = Path::new(super::artifacts::screenshot_folder())
        .file_name()
        .map(|name| name.to_os_string());
    let mut files = Vec::new();
    for root in roots {
        let mut pending = vec![(root.folder.clone(), 0)];
        while let Some((folder, depth)) = pending.pop() {
            let Ok(entries) = std::fs::read_dir(&folder) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                let name = entry.file_name();
                if name.to_string_lossy().starts_with('.') || kind.is_symlink() {
                    continue;
                }
                if kind.is_dir() {
                    // Screenshots are listed from the run records that describe them.
                    let evidence = depth == 0 && Some(&name) == screenshots.as_ref();
                    if depth < MAX_DEPTH && !evidence {
                        pending.push((entry.path(), depth + 1));
                    }
                    continue;
                }
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |since| since.as_millis() as u64);
                files.push(LibraryFile {
                    path: entry.path().to_string_lossy().into_owned(),
                    name: name.to_string_lossy().into_owned(),
                    source: root.source,
                    project_id: root.project_id.clone(),
                    run_id: root.run_id.clone(),
                    size: metadata.len(),
                    modified,
                });
            }
        }
    }
    files.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.path.cmp(&b.path)));
    files.truncate(MAX_FILES);
    files
}

/// `path` when it is a regular file inside one of the Library's folders.
fn confined(roots: &[Root], path: &str) -> Result<PathBuf, String> {
    let file = dunce::canonicalize(path).map_err(|_| "This file is no longer available")?;
    let inside = roots
        .iter()
        .any(|root| dunce::canonicalize(&root.folder).is_ok_and(|folder| file.starts_with(folder)));
    if !inside || !file.is_file() {
        return Err("Only files in Jackalope's output and attachment folders can be opened".into());
    }
    Ok(file)
}

#[tauri::command]
pub async fn library_files(state: State<'_, TaskRuntime>) -> Result<Vec<LibraryFile>, String> {
    let runs = state.inner().integration_runs()?;
    tauri::async_runtime::spawn_blocking(move || list(&roots(&runs)))
        .await
        .map_err(|e| e.to_string())
}

/// An image's bytes for a thumbnail, up to the screenshot preview limit.
#[tauri::command]
pub async fn library_file_preview(
    path: String,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<u8>, String> {
    let runs = state.inner().integration_runs()?;
    tauri::async_runtime::spawn_blocking(move || {
        let file = confined(&roots(&runs), &path)?;
        let extension = file
            .extension()
            .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if !IMAGE_TYPES.contains(&extension.as_str()) {
            return Err("Only images can be previewed".into());
        }
        match super::platform::read_capped(&file, super::artifacts::screenshot_limit()) {
            Ok(Some(bytes)) => Ok(bytes),
            Ok(None) => Err("This file is no longer available".into()),
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                Err("This image is too large to preview".into())
            }
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens a document or image with the system's default app.
#[tauri::command]
pub async fn library_file_open(
    app: AppHandle,
    path: String,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let file = confined(&roots(&state.inner().integration_runs()?), &path)?;
    let extension = file
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !OPENABLE_TYPES.contains(&extension.as_str()) {
        return Err("Only documents and images open from the Library. Show it in the file manager instead.".into());
    }
    app.opener()
        .open_path(file.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Could not open this file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, project: &Path, workspace: &Path, started_at: &str) -> TaskRun {
        TaskRun {
            id: id.into(),
            project_id: "project".into(),
            project_path: project.to_string_lossy().into_owned(),
            workspace: workspace.to_string_lossy().into_owned(),
            started_at: started_at.into(),
            ..Default::default()
        }
    }

    #[test]
    fn lists_output_and_attachments_but_not_screenshots_and_confines_paths() {
        let base = std::env::temp_dir().join(format!("jackalope-library-{}", uuid::Uuid::new_v4()));
        let project = base.join("project");
        let worktree = project.join(".worktrees/task");
        let output = worktree.join(".jackalope/artifacts");
        std::fs::create_dir_all(output.join("screenshots")).unwrap();
        std::fs::create_dir_all(output.join("charts")).unwrap();
        std::fs::create_dir_all(project.join(ATTACHMENTS)).unwrap();
        std::fs::write(output.join("report.html"), "<p>").unwrap();
        std::fs::write(output.join("charts/usage.png"), "png").unwrap();
        std::fs::write(output.join(".hidden"), "x").unwrap();
        std::fs::write(output.join("screenshots/capture.png"), "png").unwrap();
        std::fs::write(project.join(ATTACHMENTS).join("pasted.png"), "png").unwrap();
        std::fs::write(base.join("private.png"), "png").unwrap();

        let runs = [
            run("old", &project, &worktree, "2026-01-01T00:00:00Z"),
            run("new", &project, &worktree, "2026-02-01T00:00:00Z"),
        ];
        let roots = roots(&runs);
        let files = list(&roots);
        let mut names: Vec<_> = files
            .iter()
            .map(|file| (file.name.as_str(), file.source, file.run_id.as_deref()))
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                ("pasted.png", "attachment", None),
                ("report.html", "output", Some("new")),
                ("usage.png", "output", Some("new")),
            ]
        );

        assert!(confined(&roots, &output.join("report.html").to_string_lossy()).is_ok());
        assert!(confined(&roots, &base.join("private.png").to_string_lossy()).is_err());
        assert!(confined(
            &roots,
            &output.join("../../../../private.png").to_string_lossy()
        )
        .is_err());
        assert!(confined(&roots, &output.join("charts").to_string_lossy()).is_err());
        std::fs::remove_dir_all(&base).unwrap();
        assert!(list(&roots).is_empty());
    }
}
