use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

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
}

#[tauri::command]
pub fn desktop_settings(behavior: State<'_, WindowBehavior>) -> Result<DesktopSettings, String> {
    Ok(DesktopSettings {
        close_to_tray: behavior
            .preferences
            .lock()
            .map_err(|e| e.to_string())?
            .close_to_tray,
        tray_available: behavior.tray_available.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub fn desktop_set_close_to_tray(
    enabled: bool,
    behavior: State<'_, WindowBehavior>,
) -> Result<(), String> {
    behavior.save(enabled)
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray-open", "Open Jackalope", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Jackalope", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("jackalope")
        .tooltip("Jackalope")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-open" => show_main_window(app),
            "tray-quit" => app.exit(0),
            _ => {}
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
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.state::<WindowBehavior>()
        .tray_available
        .store(true, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
