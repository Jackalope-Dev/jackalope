use notify_debouncer_mini::{new_debouncer_opt, notify::RecursiveMode, DebounceEventResult};
use std::{collections::BTreeMap, path::Path, sync::Mutex, time::Duration};
use tauri::Emitter;

type Watcher = notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;
static ACTIVE: Mutex<BTreeMap<String, Watcher>> = Mutex::new(BTreeMap::new());

fn relevant(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        !relative.components().any(|part| {
            matches!(
                part.as_os_str().to_str(),
                Some(
                    ".git"
                        | ".worktrees"
                        | "node_modules"
                        | "target"
                        | "vendor"
                        | "dist"
                        | "build"
                        | "coverage"
                        | "output"
                        | ".next"
                        | ".venv"
                        | "__pycache__"
                )
            )
        })
    })
}

fn start_watch(root: &Path, on_change: impl Fn(bool) + Send + 'static) -> Result<Watcher, String> {
    let watched_root = root.to_path_buf();
    let config = notify_debouncer_mini::Config::default()
        .with_timeout(Duration::from_millis(300))
        .with_notify_config(
            notify_debouncer_mini::notify::Config::default().with_follow_symlinks(false),
        );
    let mut watcher: Watcher = new_debouncer_opt(config, move |result: DebounceEventResult| {
        let unavailable = result.is_err();
        if unavailable
            || result.is_ok_and(|events| {
                events
                    .iter()
                    .any(|event| relevant(&watched_root, &event.path))
            })
        {
            on_change(unavailable);
        }
    })
    .map_err(|_| "Live change detection is unavailable. Refresh the map manually.")?;
    watcher
        .watcher()
        .watch(root, RecursiveMode::Recursive)
        .map_err(|_| "Live change detection is unavailable. Refresh the map manually.")?;
    Ok(watcher)
}

#[tauri::command]
pub async fn codebase_watch(app: tauri::AppHandle, repo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = dunce::canonicalize(repo_path).map_err(|_| "Project folder is unavailable.")?;
        if !root.is_dir() {
            return Err("Choose a project directory.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let event_id = id.clone();
        let watcher = start_watch(&root, move |unavailable| {
            let _ = app.emit(
                "codebase-changed",
                serde_json::json!({"id":event_id,"unavailable":unavailable}),
            );
        })?;
        let mut active = ACTIVE.lock().map_err(|_| "Codebase watcher unavailable.")?;
        if active.len() >= 4 {
            return Err(
                "Too many codebase views are watching files. Refresh the map manually.".into(),
            );
        }
        active.insert(id.clone(), watcher);
        Ok(id)
    })
    .await
    .map_err(|_| "Codebase watcher could not start.".to_string())?
}

#[tauri::command]
pub async fn codebase_unwatch(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut active = ACTIVE.lock().map_err(|_| "Codebase watcher unavailable.")?;
        let previous = active.remove(&id);
        drop(active);
        drop(previous);
        Ok(())
    })
    .await
    .map_err(|_| "Codebase watcher could not stop.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_changes_are_debounced_and_generated_files_are_ignored() {
        let root = std::env::temp_dir().join(format!("jackalope-watch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("target")).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let watcher = start_watch(&root, move |unavailable| {
            let _ = tx.send(unavailable);
        })
        .unwrap();
        std::fs::write(root.join("target/ignored.js"), "generated").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(700)).is_err());
        for revision in 0..20 {
            std::fs::write(
                root.join("source.ts"),
                format!("export const revision = {revision};"),
            )
            .unwrap();
        }
        assert!(!rx.recv_timeout(Duration::from_secs(5)).unwrap());
        std::fs::rename(root.join("source.ts"), root.join("renamed.ts")).unwrap();
        assert!(!rx.recv_timeout(Duration::from_secs(5)).unwrap());
        std::fs::remove_file(root.join("renamed.ts")).unwrap();
        assert!(!rx.recv_timeout(Duration::from_secs(5)).unwrap());
        drop(watcher);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn source_changes_include_renames_and_ignore_generated_directories() {
        let root = Path::new("project");
        assert!(relevant(root, Path::new("project/src/new.ts")));
        assert!(relevant(root, Path::new("project/.gitignore")));
        assert!(!relevant(
            root,
            Path::new("project/node_modules/a/index.js")
        ));
        assert!(!relevant(
            root,
            Path::new("project/apps/desktop/target/debug/test.exe")
        ));
        assert!(!relevant(root, Path::new("other/src/new.ts")));
    }
}
