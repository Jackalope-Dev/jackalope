//! A native mirror of the workspace's project list.
//!
//! The desktop UI owns projects and their preferences in its own store; this
//! keeps just enough of that list — identity, name, path and accent — where other
//! processes can read it. Without it the `jackalope` command could not learn
//! the project id the UI uses for a repository, and work started from a
//! terminal would look unattached in project-scoped views.
//!
//! The UI writes through on every change and merges this back on load, so a
//! repository registered from a terminal appears in the app too.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::State;

pub use crate::cli_protocol::{ProjectSettings, ProjectSettingsPatch};

use super::tasks::TaskRuntime;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    /// The project's theme accent as `#rrggbb`, so a terminal can wear the
    /// same colour as the app. Absent for a repository the app has not opened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    /// Approval, workspace, learning and review-screenshot settings; absent
    /// values take the defaults in `ProjectSettings`.
    #[serde(flatten)]
    pub settings: ProjectSettingsPatch,
    /// Whether Claude Code tasks load the person's own Claude Code settings, plugins,
    /// hooks and MCP servers. `false` limits them to the project's settings and the
    /// connections Jackalope supplies. Absent follows the evaluation default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personal_claude_setup: Option<bool>,
    /// A fast command Claude Code sessions run after each file edit, with `{file}`
    /// replaced by the edited path. Used only by the edit-check evaluation hook.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_check: Option<String>,
    /// The project's saved check, mirrored from the app so a terminal approving
    /// a plan uses the same check the app would. Absent when none is saved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify_command: Option<String>,
    /// Whether finished work runs the saved check automatically. Absent means off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_verify: Option<bool>,
    /// Project instructions from Project settings, given to every task agent at
    /// launch. Absent when none are saved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// The command that prepares a fresh workspace before work starts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepare_command: Option<String>,
    /// Untracked files copied into fresh workspaces.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub setup_files: Vec<String>,
    /// The project's preview command, with `{port}` for the local port.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_command: Option<String>,
    /// Preview paths always captured for review, such as `/`. Empty means `/`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub review_pages: Vec<String>,
    /// `desktop` and/or `narrow`. Empty means desktop only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub review_viewports: Vec<String>,
    /// User-facing features whose pages review screenshots prefer when work
    /// changes their source files. Unreadable entries are dropped on load.
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "super::previews::features::lenient"
    )]
    pub feature_map: Vec<super::previews::features::Feature>,
}

#[derive(Default, Serialize, Deserialize)]
struct Ledger {
    #[serde(default)]
    projects: Vec<ProjectRecord>,
}

/// Serializes readers and writers inside this process. Both the UI and CLI
/// clients are served here, so a process-wide lock is the whole story.
fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn changes() -> &'static tokio::sync::watch::Sender<u64> {
    static CHANGES: OnceLock<tokio::sync::watch::Sender<u64>> = OnceLock::new();
    CHANGES.get_or_init(|| tokio::sync::watch::channel(0).0)
}

pub fn revision() -> u64 {
    *changes().borrow()
}

pub fn subscribe() -> tokio::sync::watch::Receiver<u64> {
    changes().subscribe()
}

fn path(runtime: &TaskRuntime) -> PathBuf {
    runtime.preferences_directory().join("projects.json")
}

fn read_ledger(path: &Path) -> Ledger {
    // A missing or unreadable mirror is not an error: it is rebuilt from the
    // UI's own store on its next write.
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_ledger(path: &Path, ledger: &Ledger) -> Result<(), String> {
    if read_ledger(path).projects == ledger.projects {
        return Ok(());
    }
    let encoded = serde_json::to_vec(ledger).map_err(|error| error.to_string())?;
    super::history::write_atomic(path, &encoded)?;
    changes().send_modify(|revision| *revision = revision.wrapping_add(1));
    Ok(())
}

/// Whether two spellings name the same folder: resolved through links when
/// it exists, with `\` and `/` and letter case alike on Windows, ignoring a
/// trailing separator.
pub fn same_path(left: &str, right: &str) -> bool {
    let normal = |value: &str| {
        let path = dunce::canonicalize(value)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|_| value.to_string());
        let path = if cfg!(windows) {
            path.replace('\\', "/").to_lowercase()
        } else {
            path
        };
        path.trim_end_matches('/').to_string()
    };
    normal(left) == normal(right)
}

pub fn list(runtime: &TaskRuntime) -> Vec<ProjectRecord> {
    let _guard = lock().lock();
    read_ledger(&path(runtime)).projects
}

/// Replaces the mirror with the UI's current list. The UI is the owner of
/// project identity, so its view wins wholesale.
pub fn save(runtime: &TaskRuntime, projects: Vec<ProjectRecord>) -> Result<(), String> {
    let _guard = lock().lock();
    write_ledger(&path(runtime), &Ledger { projects })
}

pub const NOT_REGISTERED: &str = "That project is not registered.";

/// Changes one project's record and saves the registry, returning the saved
/// record.
pub fn update(
    runtime: &TaskRuntime,
    project_id: &str,
    change: impl FnOnce(&mut ProjectRecord),
) -> Result<ProjectRecord, String> {
    let _guard = lock().lock();
    let file = path(runtime);
    let mut ledger = read_ledger(&file);
    let record = ledger
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or(NOT_REGISTERED)?;
    change(record);
    let updated = record.clone();
    write_ledger(&file, &ledger)?;
    Ok(updated)
}

/// Records a terminal's accent choice so other terminals follow it before the
/// app mirrors its own theme back.
pub fn set_accent(runtime: &TaskRuntime, project_id: &str, accent: &str) -> Result<(), String> {
    let valid = accent.len() == 7
        && accent.starts_with('#')
        && accent[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if !valid {
        return Err("Use a six-digit hex color such as #8b5cf6.".into());
    }
    update(runtime, project_id, |record| {
        record.accent = Some(accent.to_ascii_lowercase())
    })
    .map(|_| ())
}

/// The settings for a project, or the defaults for one the app has not saved.
pub fn settings(runtime: &TaskRuntime, project_id: &str) -> ProjectSettings {
    list(runtime)
        .into_iter()
        .find(|project| project.id == project_id)
        .map(|project| project.settings.resolve())
        .unwrap_or_default()
}

pub fn auto_approve(runtime: &TaskRuntime, project_id: &str) -> bool {
    settings(runtime, project_id).auto_approve
}

pub fn record(runtime: &TaskRuntime, project_id: &str) -> Option<ProjectRecord> {
    list(runtime)
        .into_iter()
        .find(|project| project.id == project_id)
}

pub fn personal_claude_setup(runtime: &TaskRuntime, project_id: &str) -> Option<bool> {
    record(runtime, project_id).and_then(|project| project.personal_claude_setup)
}

pub fn edit_check(runtime: &TaskRuntime, project_id: &str) -> Option<String> {
    record(runtime, project_id)
        .and_then(|project| project.edit_check)
        .map(|command| command.trim().to_string())
        .filter(|command| !command.is_empty() && command.len() <= 4000)
}

/// Records a terminal's change to a project's settings. The app adopts the
/// saved values when it next merges the registry.
pub fn set_settings(
    runtime: &TaskRuntime,
    project_id: &str,
    change: &ProjectSettingsPatch,
) -> Result<ProjectRecord, String> {
    change.validate()?;
    update(runtime, project_id, |record| record.settings.apply(change))
}

/// Returns the record for a repository, creating one when it is not known yet.
/// Used when work starts from a terminal in a repository the app has never
/// opened; the UI merges the new entry on its next load.
pub fn ensure(runtime: &TaskRuntime, project_path: &str) -> Result<ProjectRecord, String> {
    let _guard = lock().lock();
    let file = path(runtime);
    let mut ledger = read_ledger(&file);
    if let Some(existing) = ledger
        .projects
        .iter()
        .find(|project| same_path(&project.path, project_path))
    {
        return Ok(existing.clone());
    }
    let name = Path::new(project_path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| project_path.to_string());
    let record = ProjectRecord {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: project_path.to_string(),
        ..Default::default()
    };
    ledger.projects.push(record.clone());
    write_ledger(&file, &ledger)?;
    Ok(record)
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::project_registry::project_registry_list,
            commands::project_registry::project_registry_save,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub fn project_registry_list(state: State<'_, TaskRuntime>) -> Result<Vec<ProjectRecord>, String> {
    Ok(list(&state))
}

#[tauri::command]
pub fn project_registry_save(
    projects: Vec<ProjectRecord>,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    save(&state, projects)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli_protocol::WorkspaceMode;

    #[test]
    fn saved_project_accent_notifies_clients_and_preserves_other_projects() {
        let directory = std::env::temp_dir().join(format!("jl-colours-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("projects.json");
        let mut ledger = Ledger {
            projects: vec![
                ProjectRecord {
                    id: "work".into(),
                    name: "Work".into(),
                    path: "/work".into(),
                    accent: Some("#00aa88".into()),
                    verify_command: Some("pnpm test".into()),
                    auto_verify: Some(true),
                    setup_files: vec![".env".into()],
                    ..Default::default()
                },
                ProjectRecord {
                    id: "personal".into(),
                    name: "Personal".into(),
                    path: "/personal".into(),
                    accent: Some("#aa00ff".into()),
                    settings: ProjectSettingsPatch {
                        auto_approve: Some(false),
                        workspace_mode: Some("current".into()),
                        learn_automatically: Some(false),
                        learning_cadence: Some(5),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            ],
        };
        let mut updates = subscribe();
        write_ledger(&file, &ledger).unwrap();
        assert!(updates.has_changed().unwrap());
        updates.borrow_and_update();
        ledger.projects[0].accent = Some("#112233".into());
        write_ledger(&file, &ledger).unwrap();
        assert!(updates.has_changed().unwrap());
        assert_eq!(read_ledger(&file).projects, ledger.projects);
        let legacy: ProjectRecord =
            serde_json::from_str(r#"{"id":"old","name":"Old","path":"/old"}"#).unwrap();
        assert_eq!(legacy.accent, None);
        assert_eq!(legacy.verify_command, None);
        assert!(legacy.setup_files.is_empty());
        assert_eq!(legacy.settings.resolve(), ProjectSettings::default());
        assert!(legacy.settings.resolve().learn_automatically);
        assert_eq!(
            legacy.settings.resolve().learning_cadence,
            crate::cli_protocol::DEFAULT_LEARNING_CADENCE
        );
        let future: ProjectRecord = serde_json::from_str(
            r#"{"id":"new","name":"New","path":"/new","workspaceMode":"cloud","autoApprove":false}"#,
        )
        .unwrap();
        assert_eq!(
            future.settings.resolve().workspace_mode,
            WorkspaceMode::Worktree
        );
        assert!(!future.settings.resolve().auto_approve);
        assert_eq!(
            ledger.projects[1].settings.resolve().workspace_mode,
            WorkspaceMode::Current
        );
        assert!(!ledger.projects[1].settings.resolve().learn_automatically);
        assert_eq!(
            ledger.projects[1].settings.resolve().learning_cadence,
            crate::cli_protocol::DEFAULT_LEARNING_CADENCE,
            "an out-of-range cadence reads as the default"
        );
    }

    #[test]
    fn paths_match_across_separators_and_a_trailing_slash() {
        assert!(same_path("/repo/app/", "/repo/app"));
        assert!(!same_path("/repo/app/.worktrees/task", "/repo/app"));
        #[cfg(windows)]
        assert!(same_path(r"C:\Repo\App", "c:/repo/app"));
    }

    #[test]
    fn a_repository_keeps_one_record_across_path_spellings() {
        let directory = std::env::temp_dir().join(format!("jl-reg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("projects.json");

        let mut ledger = read_ledger(&file);
        assert!(ledger.projects.is_empty());
        ledger.projects.push(ProjectRecord {
            id: "known".into(),
            name: "repo".into(),
            path: directory.to_string_lossy().into_owned(),
            ..Default::default()
        });
        write_ledger(&file, &ledger).unwrap();

        let trailing = format!("{}/", directory.to_string_lossy());
        assert!(same_path(&trailing, &directory.to_string_lossy()));
        assert_eq!(read_ledger(&file).projects.len(), 1);

        std::fs::remove_file(&file).unwrap();
        std::fs::remove_dir(&directory).unwrap();
    }
}
