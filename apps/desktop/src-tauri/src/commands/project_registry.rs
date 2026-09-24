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

use super::tasks::TaskRuntime;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    /// The project's theme accent as `#rrggbb`, so a terminal can wear the
    /// same colour as the app. Absent for a repository the app has not opened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
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
                },
                ProjectRecord {
                    id: "personal".into(),
                    name: "Personal".into(),
                    path: "/personal".into(),
                    accent: Some("#aa00ff".into()),
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
        });
        write_ledger(&file, &ledger).unwrap();

        let trailing = format!("{}/", directory.to_string_lossy());
        assert!(same_path(&trailing, &directory.to_string_lossy()));
        assert_eq!(read_ledger(&file).projects.len(), 1);

        std::fs::remove_file(&file).unwrap();
        std::fs::remove_dir(&directory).unwrap();
    }
}
