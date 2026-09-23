use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager, State,
};
use tauri_plugin_autostart::ManagerExt as _;

use crate::commands::tasks::TaskRuntime;

const RECENT_TASKS_LIMIT: usize = 5;
const TASK_MENU_PREFIX: &str = "tray-task:";
#[cfg(target_os = "macos")]
const TRAY_ICON_TEMPLATE: &[u8] = include_bytes!("../icons/tray-icon-template.png");

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopPreferences {
    close_to_tray: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            close_to_tray: true,
        }
    }
}

pub struct WindowBehavior {
    preferences: Mutex<DesktopPreferences>,
    path: PathBuf,
    tray_available: AtomicBool,
    unread_badge: Mutex<Option<u32>>,
}

impl WindowBehavior {
    pub fn load(path: PathBuf) -> Self {
        let preferences = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                eprintln!("Could not read desktop preferences: {error}");
                DesktopPreferences {
                    close_to_tray: false,
                }
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                DesktopPreferences::default()
            }
            Err(error) => {
                eprintln!("Could not read desktop preferences: {error}");
                DesktopPreferences {
                    close_to_tray: false,
                }
            }
        };
        Self {
            preferences: Mutex::new(preferences),
            path,
            tray_available: AtomicBool::new(false),
            unread_badge: Mutex::new(None),
        }
    }

    pub fn should_hide(&self) -> bool {
        self.tray_available.load(Ordering::Relaxed)
            && self
                .preferences
                .lock()
                .map(|p| p.close_to_tray)
                .unwrap_or(false)
    }

    fn badge_count(&self, awaiting_review: usize) -> Option<i64> {
        let count = self
            .unread_badge
            .lock()
            .ok()
            .and_then(|count| *count)
            .map(|count| count as usize)
            .unwrap_or(awaiting_review)
            .min(999);
        (count > 0).then_some(count as i64)
    }

    fn save(&self, close_to_tray: bool) -> Result<(), String> {
        if close_to_tray && !self.tray_available.load(Ordering::Relaxed) {
            return Err(
                "The system tray is unavailable. Closing the window will quit Jackalope.".into(),
            );
        }
        let mut preferences = self.preferences.lock().map_err(|e| e.to_string())?;
        let next = DesktopPreferences { close_to_tray };
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(
            &temporary,
            serde_json::to_vec(&next).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(temporary, &self.path).map_err(|e| e.to_string())?;
        *preferences = next;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    close_to_tray: bool,
    tray_available: bool,
    launch_at_login: bool,
}

#[tauri::command]
pub fn desktop_settings(
    app: AppHandle,
    behavior: State<'_, WindowBehavior>,
) -> Result<DesktopSettings, String> {
    Ok(DesktopSettings {
        close_to_tray: behavior
            .preferences
            .lock()
            .map_err(|e| e.to_string())?
            .close_to_tray,
        tray_available: behavior.tray_available.load(Ordering::Relaxed),
        launch_at_login: app.autolaunch().is_enabled().unwrap_or(false),
    })
}

#[tauri::command]
pub fn desktop_set_close_to_tray(
    enabled: bool,
    behavior: State<'_, WindowBehavior>,
) -> Result<(), String> {
    behavior.save(enabled)
}

#[tauri::command]
pub fn desktop_set_launch_at_login(enabled: bool, app: AppHandle) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|e| e.to_string())
}

/// Raises the main window from the tray, the Dock or a second app launch,
/// building it first when a headless host has none yet.
pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    if let Err(error) = app.state::<crate::MainWindow>().show(app) {
        eprintln!("Jackalope could not open its window: {error}");
    }
}

/// Builds the tray's menu fresh from current task state: Open/New Task/
/// Settings up top, a Recent Tasks submenu, then Quit. Called once at
/// startup and again whenever `task-state-changed` fires, so the submenu
/// and the returned awaiting-review count (used for the dock badge) never
/// go stale while the tray is open.
fn build_tray_menu(app: &AppHandle) -> tauri::Result<(Menu<tauri::Wry>, usize)> {
    let open = MenuItem::with_id(app, "tray-open", "Open Jackalope", true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, "tray-new-task", "New Task", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "tray-settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Jackalope", true, None::<&str>)?;
    let separator_top = PredefinedMenuItem::separator(app)?;
    let separator_bottom = PredefinedMenuItem::separator(app)?;

    let (recent, awaiting_review) = app
        .try_state::<TaskRuntime>()
        .map(|runtime| runtime.tray_summary(RECENT_TASKS_LIMIT))
        .unwrap_or_default();

    let recent_menu = Submenu::new(app, "Recent Tasks", !recent.is_empty())?;
    for task in &recent {
        let item = MenuItem::with_id(
            app,
            format!("{TASK_MENU_PREFIX}{}", task.id),
            &task.label,
            true,
            None::<&str>,
        )?;
        recent_menu.append(&item)?;
    }

    let menu = Menu::with_items(
        app,
        &[
            &open,
            &new_task,
            &settings,
            &separator_top,
            &recent_menu,
            &separator_bottom,
            &quit,
        ],
    )?;
    Ok((menu, awaiting_review))
}

/// Rebuilds the tray menu and dock badge from current task state. Registered
/// against `task-state-changed`; the initial build happens inline in
/// `setup_tray` since the tray doesn't exist yet to attach a menu to.
fn refresh_tray(app: &AppHandle) {
    let Ok((menu, awaiting_review)) = build_tray_menu(app) else {
        return;
    };
    if let Some(tray) = app.tray_by_id("jackalope") {
        let _ = tray.set_menu(Some(menu));
    }
    let _ = refresh_badge(app, awaiting_review);
}

fn refresh_badge(app: &AppHandle, awaiting_review: usize) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_badge_count(app.state::<WindowBehavior>().badge_count(awaiting_review))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn set_unread_badge(app: &AppHandle, count: u32) -> Result<(), String> {
    *app.state::<WindowBehavior>()
        .unread_badge
        .lock()
        .map_err(|error| error.to_string())? = Some(count);
    refresh_badge(app, 0)
}

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let (menu, awaiting_review) = build_tray_menu(app.handle())?;
    let mut tray = TrayIconBuilder::with_id("jackalope")
        .tooltip("Jackalope")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "tray-open" => show_main_window(app),
                "tray-new-task" => {
                    show_main_window(app);
                    let _ = app.emit("jackalope-tray-new-task", ());
                }
                "tray-settings" => {
                    show_main_window(app);
                    let _ = app.emit("jackalope-tray-settings", ());
                }
                "tray-quit" => app.exit(0),
                _ => {
                    if let Some(task_id) = id.strip_prefix(TASK_MENU_PREFIX) {
                        show_main_window(app);
                        let _ = app.emit("jackalope-tray-open-task", task_id.to_string());
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    #[cfg(target_os = "macos")]
    {
        if let Ok(icon) = tauri::image::Image::from_bytes(TRAY_ICON_TEMPLATE) {
            tray = tray.icon(icon);
        }
        tray = tray.icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    let _ = refresh_badge(app.handle(), awaiting_review);
    let app_handle = app.handle().clone();
    app.listen("task-state-changed", move |_event| {
        refresh_tray(&app_handle);
    });

    #[cfg(not(target_os = "linux"))]
    app.state::<WindowBehavior>()
        .tray_available
        .store(true, Ordering::Relaxed);
    #[cfg(target_os = "linux")]
    watch_tray_host(app.handle().clone());
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn setup_app_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{PredefinedMenuItem, Submenu},
        Emitter,
    };
    let menu = Menu::default(app.handle())?;
    if let Some(first) = menu.items()?.first().and_then(|item| item.as_submenu()) {
        first.insert(
            &MenuItem::with_id(app, "app-settings", "Settings…", true, None::<&str>)?,
            2,
        )?;
    }
    let work = Submenu::with_items(
        app,
        "Work",
        true,
        &[
            &MenuItem::with_id(app, "app-new-work", "New Work", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "app-search",
                "Search and Commands…",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "app-show", "Show Jackalope", true, None::<&str>)?,
        ],
    )?;
    menu.insert(&work, 1)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let action = match event.id.as_ref() {
            "app-settings" => "settings",
            "app-new-work" => "newWork",
            "app-search" => "search",
            "app-show" => {
                show_main_window(app);
                return;
            }
            _ => return,
        };
        show_main_window(app);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("desktop-action", action);
        }
    });
    Ok(())
}

#[cfg(target_os = "linux")]
fn watch_tray_host(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let available = tokio::time::timeout(std::time::Duration::from_secs(2), async {
                let connection = zbus::Connection::session().await?;
                let watcher = zbus::Proxy::new(
                    &connection,
                    "org.kde.StatusNotifierWatcher",
                    "/StatusNotifierWatcher",
                    "org.kde.StatusNotifierWatcher",
                )
                .await?;
                watcher
                    .get_property::<bool>("IsStatusNotifierHostRegistered")
                    .await
            })
            .await
            .is_ok_and(|result: zbus::Result<bool>| result.unwrap_or(false));
            let was_available = app
                .state::<WindowBehavior>()
                .tray_available
                .swap(available, Ordering::Relaxed);
            if was_available && !available {
                if let Some(window) = app.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        show_main_window(&app);
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unread_badge_and_clearing_take_precedence_over_tray_refreshes() {
        let behavior = WindowBehavior::load(
            std::env::temp_dir().join(format!("jackalope-badge-{}", uuid::Uuid::new_v4())),
        );
        assert_eq!(behavior.badge_count(3), Some(3));
        *behavior.unread_badge.lock().unwrap() = Some(5);
        assert_eq!(behavior.badge_count(9), Some(5));
        *behavior.unread_badge.lock().unwrap() = Some(0);
        assert_eq!(behavior.badge_count(9), None);
        *behavior.unread_badge.lock().unwrap() = Some(u32::MAX);
        assert_eq!(behavior.badge_count(0), Some(999));
    }

    #[test]
    fn close_behavior_requires_tray_and_persists_opt_out() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-window-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("desktop.json");
        let behavior = WindowBehavior::load(path.clone());
        assert!(!behavior.should_hide());
        assert!(behavior.save(true).is_err());
        behavior.tray_available.store(true, Ordering::Relaxed);
        assert!(behavior.should_hide());
        behavior.save(false).unwrap();
        assert!(!behavior.should_hide());
        let restored = WindowBehavior::load(path.clone());
        restored.tray_available.store(true, Ordering::Relaxed);
        assert!(!restored.should_hide());
        restored.save(true).unwrap();
        assert!(restored.should_hide());
        std::fs::write(&path, "invalid").unwrap();
        let invalid = WindowBehavior::load(path.clone());
        invalid.tray_available.store(true, Ordering::Relaxed);
        assert!(!invalid.should_hide());
        std::fs::remove_file(path).unwrap();
        let reset = WindowBehavior::load(directory.join("desktop.json"));
        reset.tray_available.store(true, Ordering::Relaxed);
        assert!(reset.should_hide());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_save_keeps_previous_behavior() {
        let path = std::env::temp_dir()
            .join(format!("jackalope-missing-{}", uuid::Uuid::new_v4()))
            .join("desktop.json");
        let behavior = WindowBehavior::load(path);
        behavior.tray_available.store(true, Ordering::Relaxed);
        assert!(behavior.save(false).is_err());
        assert!(behavior.should_hide());
    }
}
