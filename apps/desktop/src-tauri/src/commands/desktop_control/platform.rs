use super::*;
use std::path::PathBuf;

static RESOURCES: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_directory(path: PathBuf) {
    let _ = RESOURCES.set(path);
}

pub fn supported() -> bool {
    cfg!(any(windows, target_os = "macos"))
        || (cfg!(target_os = "linux")
            && std::env::var_os("DISPLAY").is_some_and(|value| !value.is_empty())
            && std::env::var("XDG_SESSION_TYPE").as_deref() != Ok("wayland")
            && std::env::var_os("WAYLAND_DISPLAY").is_none_or(|value| value.is_empty()))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn command(payload: Value) -> Result<std::process::Command, String> {
    use std::os::unix::process::CommandExt;
    let relative = std::path::Path::new("resources/desktop-control/jackalope-desktop-control");
    let bundled = RESOURCES.get().map(|root| root.join(relative));
    let executable = bundled
        .filter(|path| path.is_file())
        .or_else(|| {
            #[cfg(debug_assertions)]
            {
                let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
                path.is_file().then_some(path)
            }
            #[cfg(not(debug_assertions))]
            None
        })
        .ok_or("The bundled desktop helper is missing. Reinstall Jackalope.")?;
    let mut command = std::process::Command::new(executable);
    command.env_clear().process_group(0);
    for key in [
        "HOME",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "__CF_USER_TEXT_ENCODING",
        "DISPLAY",
        "XAUTHORITY",
        "DBUS_SESSION_BUS_ADDRESS",
        "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE",
        "WAYLAND_DISPLAY",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command.env("JACKALOPE_DESKTOP_REQUEST", payload.to_string());
    #[cfg(target_os = "linux")]
    command.env("GDK_BACKEND", "x11");
    Ok(command)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Readiness {
    pub available: bool,
    pub message: String,
    pub can_request_permissions: bool,
}

pub fn readiness() -> Readiness {
    if !supported() {
        return Readiness { available: false, can_request_permissions: false,
            message: "Native window control is unavailable in this desktop session. On Linux, use an X11 session with accessibility and compositing support. Task browser automation is available separately.".into() };
    }
    #[cfg(windows)]
    return Readiness { available: true, can_request_permissions: false,
        message: "Native window control is available. Each task asks you to choose a window before access begins.".into() };
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let result = super::native(json!({"action":"permissions"}), &AtomicBool::new(false));
        let available = result.as_ref().is_ok_and(|value| {
            if cfg!(target_os = "macos") {
                ["accessibility", "screenRecording", "inputMonitoring"]
                    .iter()
                    .all(|key| value[key] == true)
            } else {
                value["available"] == true
            }
        });
        Readiness {
            available,
            can_request_permissions: cfg!(target_os = "macos") && result.is_ok(),
            message: if available {
                "Native window control is available. Each task asks you to choose a window; click Resume in the native bar to begin.".into()
            } else if let Err(error) = result {
                error
            } else if cfg!(target_os = "macos") {
                "Allow Accessibility, Screen Recording and Input Monitoring for Jackalope in System Settings, then restart the app and refresh this device.".into()
            } else {
                "This desktop is missing the display, input or accessibility services needed for native window control.".into()
            },
        }
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    Readiness {
        available: false,
        can_request_permissions: false,
        message: "Native window control is unavailable on this platform.".into(),
    }
}

#[tauri::command]
pub async fn desktop_control_request_permissions() -> Result<Readiness, String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(|| {
        super::native(
            json!({"action":"request_permissions"}),
            &AtomicBool::new(false),
        )?;
        Ok(readiness())
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    Err("This platform does not use macOS desktop permissions.".into())
}

pub(super) fn lease() -> Result<std::fs::File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    let path = {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        // GUI and terminal launches can have different TMPDIR values on the same desktop.
        PathBuf::from(format!("/tmp/jackalope-desktop-control-{}.lock", unsafe {
            libc::geteuid()
        }))
    };
    #[cfg(not(unix))]
    let path = std::env::temp_dir().join("jackalope-desktop-control.lock");
    let file = options.open(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
            || metadata.nlink() != 1
        {
            return Err("Desktop lease must be a private regular file owned by this user.".into());
        }
    }
    file.try_lock()
        .map_err(|_| "Another Jackalope instance owns desktop control. Release it there first.")?;
    Ok(file)
}

pub(super) fn key(key: &str) -> String {
    if cfg!(target_os = "macos") {
        key.into()
    } else {
        key.replacen("Primary+", "Control+", 1)
    }
}
