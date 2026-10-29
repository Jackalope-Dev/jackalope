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

use super::tasks::{TaskRuntime, WorkspaceMode};

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
    /// Whether routine agent requests are approved without asking, escalating
    /// only high-risk ones. Absent means on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<bool>,
    /// Where new work runs: `worktree`, `branch`, `current` or `ask`. Kept as
    /// text so a value from a newer app cannot make the ledger unreadable;
    /// absent or unknown means an isolated worktree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_mode: Option<String>,
    /// Whether Jackalope reflects on work in the background and keeps learned
    /// lessons tidy. Absent means on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub learn_automatically: Option<bool>,
    /// Reported tool calls between background reflections of a running task.
    /// Absent or out of range means the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub learning_cadence: Option<u32>,
    /// Whether learned lessons take part in account lesson sync when it is on
    /// for this desktop. Absent means included.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_lessons: Option<bool>,
    /// Whether finished work is also reflected on by the default agent, which
    /// spends that account's quota. Absent means off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_reflection: Option<bool>,
    /// Whether active learned lessons are mirrored into the project's AGENTS.md
    /// and a Claude Code skill. Absent means off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_lessons: Option<bool>,
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
    /// The command that prepares a fresh workspace before work starts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepare_command: Option<String>,
    /// Untracked files copied into fresh workspaces.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub setup_files: Vec<String>,
}

/// Accepted `learning_cadence` values.
pub const LEARNING_CADENCES: std::ops::RangeInclusive<u32> = 10..=1000;

/// A project's agent-approval and workspace settings, with their defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectSettings {
    pub auto_approve: bool,
    pub workspace_mode: WorkspaceMode,
    pub learn_automatically: bool,
    pub learning_cadence: u32,
    pub sync_lessons: bool,
    pub agent_reflection: bool,
    pub export_lessons: bool,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            auto_approve: true,
            workspace_mode: WorkspaceMode::Worktree,
            learn_automatically: true,
            learning_cadence: super::knowledge::learning::DEFAULT_CADENCE,
            sync_lessons: true,
            agent_reflection: false,
            export_lessons: false,
        }
    }
}

impl ProjectRecord {
    pub fn settings(&self) -> ProjectSettings {
        ProjectSettings {
            auto_approve: self.auto_approve.unwrap_or(true),
            workspace_mode: self
                .workspace_mode
                .as_deref()
                .and_then(WorkspaceMode::parse)
                .unwrap_or_default(),
            learn_automatically: self.learn_automatically.unwrap_or(true),
            learning_cadence: self
                .learning_cadence
                .filter(|cadence| LEARNING_CADENCES.contains(cadence))
                .unwrap_or(super::knowledge::learning::DEFAULT_CADENCE),
            sync_lessons: self.sync_lessons.unwrap_or(true),
            agent_reflection: self.agent_reflection.unwrap_or(false),
            export_lessons: self.export_lessons.unwrap_or(false),
        }
    }
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

/// Compares paths the way the UI does, so the same repository is not recorded
/// twice under different spellings.
fn same_path(left: &str, right: &str) -> bool {
    let canonical = |value: &str| {
        dunce::canonicalize(value)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|_| value.trim_end_matches(['/', '\\']).to_string())
    };
    let (left, right) = (canonical(left), canonical(right));
    if cfg!(windows) {
        left.eq_ignore_ascii_case(&right)
    } else {
        left == right
    }
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

/// Records a terminal's accent choice so other terminals follow it before the
/// app mirrors its own theme back.
pub fn set_accent(runtime: &TaskRuntime, project_id: &str, accent: &str) -> Result<(), String> {
    let valid = accent.len() == 7
        && accent.starts_with('#')
        && accent[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if !valid {
        return Err("Use a six-digit hex color such as #8b5cf6.".into());
    }
    let _guard = lock().lock();
    let file = path(runtime);
    let mut ledger = read_ledger(&file);
    let record = ledger
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or("That project is not registered.")?;
    record.accent = Some(accent.to_ascii_lowercase());
    write_ledger(&file, &ledger)
}

/// The settings for a project, or the defaults for one the app has not saved.
pub fn settings(runtime: &TaskRuntime, project_id: &str) -> ProjectSettings {
    list(runtime)
        .into_iter()
        .find(|project| project.id == project_id)
        .map(|project| project.settings())
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

/// Learning changes a terminal can make; `None` keeps the saved value.
#[derive(Debug, Clone, Copy, Default)]
pub struct LearningSettings {
    pub automatic: Option<bool>,
    pub cadence: Option<u32>,
    pub sync: Option<bool>,
    pub agent: Option<bool>,
    pub export: Option<bool>,
}

/// Records a terminal's change to a project's settings. The app adopts the
/// saved values when it next merges the registry.
pub fn set_settings(
    runtime: &TaskRuntime,
    project_id: &str,
    auto_approve: Option<bool>,
    workspace_mode: Option<WorkspaceMode>,
    learning: LearningSettings,
) -> Result<ProjectRecord, String> {
    if let Some(cadence) = learning.cadence {
        if !LEARNING_CADENCES.contains(&cadence) {
            return Err(format!(
                "Choose a learning cadence from {} to {} tool calls.",
                LEARNING_CADENCES.start(),
                LEARNING_CADENCES.end()
            ));
        }
    }
    let _guard = lock().lock();
    let file = path(runtime);
    let mut ledger = read_ledger(&file);
    let record = ledger
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or("That project is not registered.")?;
    if let Some(auto_approve) = auto_approve {
        record.auto_approve = Some(auto_approve);
    }
    if let Some(mode) = workspace_mode {
        record.workspace_mode = Some(mode.as_str().into());
    }
    if let Some(automatic) = learning.automatic {
        record.learn_automatically = Some(automatic);
    }
    if let Some(cadence) = learning.cadence {
        record.learning_cadence = Some(cadence);
    }
    if let Some(sync) = learning.sync {
        record.sync_lessons = Some(sync);
    }
    if let Some(agent) = learning.agent {
        record.agent_reflection = Some(agent);
    }
    if let Some(export) = learning.export {
        record.export_lessons = Some(export);
    }
    let updated = record.clone();
    write_ledger(&file, &ledger)?;
    Ok(updated)
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
        accent: None,
        auto_approve: None,
        workspace_mode: None,
        learn_automatically: None,
        learning_cadence: None,
        sync_lessons: None,
        agent_reflection: None,
        export_lessons: None,
        personal_claude_setup: None,
        edit_check: None,
        verify_command: None,
        auto_verify: None,
        prepare_command: None,
        setup_files: Vec::new(),
    };
    ledger.projects.push(record.clone());
    write_ledger(&file, &ledger)?;
    Ok(record)
}

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
                    auto_approve: None,
                    workspace_mode: None,
                    learn_automatically: None,
                    learning_cadence: None,
                    sync_lessons: None,
                    agent_reflection: None,
                    export_lessons: None,
                    personal_claude_setup: None,
                    edit_check: None,
                    verify_command: Some("pnpm test".into()),
                    auto_verify: Some(true),
                    prepare_command: None,
                    setup_files: vec![".env".into()],
                },
                ProjectRecord {
                    id: "personal".into(),
                    name: "Personal".into(),
                    path: "/personal".into(),
                    accent: Some("#aa00ff".into()),
                    auto_approve: Some(false),
                    workspace_mode: Some("current".into()),
                    learn_automatically: Some(false),
                    learning_cadence: Some(5),
                    sync_lessons: None,
                    agent_reflection: None,
                    export_lessons: None,
                    personal_claude_setup: None,
                    edit_check: None,
                    verify_command: None,
                    auto_verify: None,
                    prepare_command: None,
                    setup_files: Vec::new(),
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
        assert_eq!(legacy.settings(), ProjectSettings::default());
        assert!(legacy.settings().learn_automatically);
        assert_eq!(legacy.settings().learning_cadence, 50);
        let future: ProjectRecord = serde_json::from_str(
            r#"{"id":"new","name":"New","path":"/new","workspaceMode":"cloud","autoApprove":false}"#,
        )
        .unwrap();
        assert_eq!(future.settings().workspace_mode, WorkspaceMode::Worktree);
        assert!(!future.settings().auto_approve);
        assert_eq!(
            ledger.projects[1].settings().workspace_mode,
            WorkspaceMode::Current
        );
        assert!(!ledger.projects[1].settings().learn_automatically);
        assert_eq!(
            ledger.projects[1].settings().learning_cadence,
            50,
            "an out-of-range cadence reads as the default"
        );
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
            accent: None,
            auto_approve: None,
            workspace_mode: None,
            learn_automatically: None,
            learning_cadence: None,
            sync_lessons: None,
            agent_reflection: None,
            export_lessons: None,
            personal_claude_setup: None,
            edit_check: None,
            verify_command: None,
            auto_verify: None,
            prepare_command: None,
            setup_files: Vec::new(),
        });
        write_ledger(&file, &ledger).unwrap();

        let trailing = format!("{}/", directory.to_string_lossy());
        assert!(same_path(&trailing, &directory.to_string_lossy()));
        assert_eq!(read_ledger(&file).projects.len(), 1);

        std::fs::remove_file(&file).unwrap();
        std::fs::remove_dir(&directory).unwrap();
    }
}
