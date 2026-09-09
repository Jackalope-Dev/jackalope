use super::tasks::TaskRuntime;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, State};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub enabled: bool,
    pub level: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStatus {
    supported: bool,
    enabled: bool,
    error: Option<String>,
}

pub struct Notifications {
    path: PathBuf,
    preferences: Mutex<Preferences>,
    error: Mutex<Option<String>>,
    pending_open: Mutex<Option<String>>,
    alive: AtomicBool,
}

#[derive(Clone)]
pub struct Snapshot {
    pub id: String,
    pub task_id: String,
    pub project_id: String,
    pub started_at: String,
    pub status: String,
    pub questions: Vec<String>,
}

#[derive(Clone)]
struct Notice {
    key: String,
    run_id: String,
    title: &'static str,
    attention: bool,
}

fn notices(runs: &[Snapshot]) -> Vec<Notice> {
    let mut latest = HashMap::<(&str, &str), &Snapshot>::new();
    for run in runs {
        let value = latest.entry((&run.project_id, &run.task_id)).or_insert(run);
        if run.started_at > value.started_at {
            *value = run;
        }
    }
    latest
        .values()
        .flat_map(|run| {
            if ["starting", "running", "stopping"].contains(&run.status.as_str()) {
                return run
                    .questions
                    .iter()
                    .map(|id| Notice {
                        key: format!("{}:question:{id}", run.id),
                        run_id: run.id.clone(),
                        title: "Your answer is needed",
                        attention: true,
                    })
                    .collect::<Vec<_>>();
            }
            let title = match run.status.as_str() {
                "failed" => "A task needs attention",
                "interrupted" => "A task was interrupted",
                "review" => "A task is ready for review",
                _ => return vec![],
            };
            vec![Notice {
                key: format!("{}:{}", run.id, run.status),
                run_id: run.id.clone(),
                title,
                attention: run.status != "review",
            }]
        })
        .collect()
}

fn permitted(preferences: &Preferences, notice: &Notice, focused: bool) -> bool {
    preferences.enabled
        && !focused
        && (preferences.level == "all"
            || (preferences.level == "failures-only" && notice.attention))
}

impl Notifications {
    pub fn load(path: PathBuf) -> Self {
        let (preferences, error) = if path.exists() {
            match super::history::read_bounded(&path, 8192).and_then(|bytes| {
                serde_json::from_slice(&bytes).map_err(|_| {
                    "Notification preferences could not be read; notifications are paused."
                        .to_string()
                })
            }) {
                Ok(preferences) => (preferences, None),
                Err(error) => (Preferences::default(), Some(error)),
            }
        } else {
            (Preferences::default(), None)
        };
        Self {
            path,
            preferences: Mutex::new(preferences),
            error: Mutex::new(error),
            pending_open: Mutex::new(None),
            alive: AtomicBool::new(true),
        }
    }

    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::Relaxed);
    }

    fn status(&self) -> NotificationStatus {
        NotificationStatus {
            supported: cfg!(windows),
            enabled: self.preferences.lock().unwrap().enabled,
            error: self.error.lock().unwrap().clone(),
        }
    }
}

pub fn launch(app: tauri::AppHandle) {
    let initial = app.state::<TaskRuntime>().notification_snapshot();
    tauri::async_runtime::spawn(async move {
        let mut seen: HashSet<String> = notices(&initial)
            .into_iter()
            .map(|notice| notice.key)
            .collect();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let service = app.state::<Notifications>();
            if !service.alive.load(Ordering::Relaxed) {
                break;
            }
            let current = notices(&app.state::<TaskRuntime>().notification_snapshot());
            let focused = app.get_webview_window("main").is_some_and(|window| {
                window.is_focused().unwrap_or(false) && window.is_visible().unwrap_or(false)
            });
            let preferences = service.preferences.lock().unwrap().clone();
            for notice in &current {
                if seen.insert(notice.key.clone()) && permitted(&preferences, notice, focused) {
                    let app = app.clone();
                    let notice = notice.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        if let Err(error) = show(&app, notice.title, Some(notice.run_id)) {
                            *app.state::<Notifications>().error.lock().unwrap() = Some(error);
                            let _ = app.emit("jackalope-notification-status", ());
                        }
                    })
                    .await;
                }
            }
            // Resolved questions cannot become pending again; retired attempts never replay.
            if seen.len() > 4000 {
                seen = current.into_iter().map(|notice| notice.key).collect();
            }
        }
    });
}

#[cfg(windows)]
fn notification_icon(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("notification-logo.png");
    let bytes = include_bytes!("../../icons/128x128.png");
    if std::fs::read(&path).ok().as_deref() != Some(bytes.as_slice()) {
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(dunce::simplified(&path).to_path_buf())
}

#[cfg(windows)]
fn show(app: &tauri::AppHandle, title: &str, run_id: Option<String>) -> Result<(), String> {
    use tauri_winrt_notification::{IconCrop, Toast};
    let packaged_id = application_id();
    let id = if let Some(id) = packaged_id.as_deref() {
        id
    } else if cfg!(debug_assertions) {
        Toast::POWERSHELL_APP_ID
    } else {
        &app.config().identifier
    };
    let handle = app.clone();
    let mut toast = Toast::new(id);
    if let Ok(icon) = notification_icon(app) {
        toast = toast.icon(&icon, IconCrop::Square, "Jackalope");
    }
    toast.title("Jackalope").text1(title)
        .text2("Open Jackalope to view this task. Prompts and project names stay private.")
        .sound(None)
        .on_activated(move |_| {
            *handle.state::<Notifications>().pending_open.lock().unwrap() = run_id.clone();
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = handle.emit("jackalope-notification-open", ());
            Ok(())
        }).show().map_err(|_| "Windows could not deliver the notification. Check system notification settings and the installed app identity. In-app notices remain available.".into())
}

#[cfg(windows)]
fn application_id() -> Option<String> {
    use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentApplicationUserModelId;
    let mut length = 0;
    // Packaged builds use their registered AUMID, not the unpackaged Tauri identifier.
    unsafe {
        GetCurrentApplicationUserModelId(&mut length, std::ptr::null_mut());
        if length == 0 || length > 4096 {
            return None;
        }
        let mut buffer = vec![0u16; length as usize];
        if GetCurrentApplicationUserModelId(&mut length, buffer.as_mut_ptr()) != 0 {
            return None;
        }
        String::from_utf16(&buffer[..length.saturating_sub(1) as usize]).ok()
    }
}

#[cfg(not(windows))]
fn show(_: &tauri::AppHandle, _: &str, _: Option<String>) -> Result<(), String> {
    Err(
        "OS notifications are currently supported on Windows. In-app notices remain available."
            .into(),
    )
}

#[tauri::command]
pub fn notification_status(service: State<'_, Notifications>) -> NotificationStatus {
    service.status()
}

#[tauri::command]
pub fn notification_configure(
    preferences: Preferences,
    service: State<'_, Notifications>,
) -> Result<NotificationStatus, String> {
    if !["all", "failures-only", "none"].contains(&preferences.level.as_str()) {
        return Err("Choose a valid notification preference.".into());
    }
    let mut saved = service.preferences.lock().map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&preferences).map_err(|e| e.to_string())?;
    super::history::write_atomic(&service.path, &bytes)?;
    *saved = preferences;
    drop(saved);
    *service.error.lock().unwrap() = None;
    Ok(service.status())
}

#[tauri::command]
pub async fn notification_test(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || show(&app, "Task notifications are ready", None))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn notification_take_open(service: State<'_, Notifications>) -> Option<String> {
    service.pending_open.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(id: &str, status: &str) -> Snapshot {
        Snapshot {
            id: id.into(),
            task_id: "task".into(),
            project_id: "project".into(),
            started_at: id.into(),
            status: status.into(),
            questions: vec![],
        }
    }
    #[test]
    fn latest_attempt_and_question_identity_drive_attention() {
        let mut active = run("2", "running");
        active.questions = vec!["a".into(), "b".into()];
        let current = notices(&[run("1", "failed"), active]);
        assert_eq!(current.len(), 2);
        assert!(current.iter().all(|n| n.run_id == "2"));
        assert_ne!(current[0].key, current[1].key);
        assert!(notices(&[run("2", "running")]).is_empty());
    }
    #[test]
    fn quiet_focus_and_attention_preferences_are_respected() {
        let review = notices(&[run("1", "review")]).remove(0);
        let failure = notices(&[run("1", "failed")]).remove(0);
        let mut preferences = Preferences {
            enabled: true,
            level: "failures-only".into(),
        };
        assert!(!permitted(&preferences, &review, false));
        assert!(permitted(&preferences, &failure, false));
        assert!(!permitted(&preferences, &failure, true));
        preferences.level = "none".into();
        assert!(!permitted(&preferences, &failure, false));
        preferences.level = "all".into();
        preferences.enabled = false;
        assert!(!permitted(&preferences, &review, false));
    }
}
