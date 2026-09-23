use super::*;
use std::path::PathBuf;

static RESOURCES: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_directory(path: PathBuf) {
    let _ = RESOURCES.set(path);
}

pub fn supported() -> bool {
    #[cfg(target_os = "linux")]
    if wayland_session() {
        return super::native(json!({"action":"permissions"}), &AtomicBool::new(false))
            .is_ok_and(|value| value["available"] == true && value["protocol"] == 1);
    }
    cfg!(any(windows, target_os = "macos"))
        || (cfg!(target_os = "linux")
            && std::env::var_os("DISPLAY").is_some_and(|value| !value.is_empty())
            && std::env::var("XDG_SESSION_TYPE").as_deref() != Ok("wayland")
            && std::env::var_os("WAYLAND_DISPLAY").is_none_or(|value| value.is_empty()))
}

fn wayland_session() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland")
            || std::env::var_os("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty()))
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
    command.env(
        "GDK_BACKEND",
        if wayland_session() { "wayland" } else { "x11" },
    );
    Ok(command)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Readiness {
    pub available: bool,
    pub message: String,
    pub can_request_permissions: bool,
}

pub fn readiness() -> Readiness {
    if !wayland_session() && !supported() {
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
                value["available"] == true && (!wayland_session() || value["protocol"] == 1)
            }
        });
        Readiness {
            available,
            can_request_permissions: (cfg!(target_os = "macos") && result.is_ok())
                || (cfg!(target_os = "linux")
                    && result
                        .as_ref()
                        .is_ok_and(|value| value["canInstall"] == true)),
            message: if available {
                "Native window control is available. Each task asks you to choose a window; click Resume in the native bar to begin.".into()
            } else if let Err(error) = &result {
                error.clone()
            } else if cfg!(target_os = "macos") {
                "Allow Accessibility, Screen Recording and Input Monitoring for Jackalope in System Settings, then restart the app and refresh this device.".into()
            } else if let Some(message) = result
                .as_ref()
                .ok()
                .and_then(|value| value["message"].as_str())
            {
                message.into()
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
    #[cfg(target_os = "linux")]
    return tauri::async_runtime::spawn_blocking(|| {
        if !wayland_session() || !readiness().can_request_permissions {
            return Err("GNOME 46 Wayland is required for this extension setup.".into());
        }
        install_gnome_extension()?;
        let mut command = std::process::Command::new("gnome-extensions");
        command.args(["enable", "desktop-control@jackalope.dev"]);
        let _ = super::super::process_control::run_cancellable(command, Duration::from_secs(5), || false);
        let current = readiness();
        if current.available {
            Ok(current)
        } else {
            Ok(Readiness { available: false, can_request_permissions: false,
                message: "GNOME extension installed. Sign out and back in, enable Jackalope Window Control in Extensions, then refresh this device. Each task still needs your window choice and Resume.".into() })
        }
    }).await.map_err(|e| e.to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    Err("This platform does not use macOS desktop permissions.".into())
}

#[cfg(target_os = "linux")]
fn install_gnome_extension() -> Result<(), String> {
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .filter(|path| path.is_absolute())
        .ok_or("The user data directory is unavailable.")?;
    let directory = data.join("gnome-shell/extensions/desktop-control@jackalope.dev");
    write_gnome_extension(&directory)
}

#[cfg(target_os = "linux")]
fn write_gnome_extension(directory: &std::path::Path) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if std::fs::symlink_metadata(&directory)
        .is_ok_and(|metadata| !metadata.is_dir() || metadata.file_type().is_symlink())
    {
        return Err("The GNOME extension directory must be a regular directory.".into());
    }
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    for (name, contents) in [
        (
            "metadata.json",
            include_str!(
                "../../../resources/gnome-extension/desktop-control@jackalope.dev/metadata.json"
            ),
        ),
        (
            "guard.js",
            include_str!(
                "../../../resources/gnome-extension/desktop-control@jackalope.dev/guard.js"
            ),
        ),
        (
            "extension.js",
            include_str!(
                "../../../resources/gnome-extension/desktop-control@jackalope.dev/extension.js"
            ),
        ),
    ] {
        let target = directory.join(name);
        if std::fs::symlink_metadata(&target)
            .is_ok_and(|metadata| !metadata.is_file() || metadata.file_type().is_symlink())
        {
            return Err(format!(
                "GNOME extension file {name} is not a regular file."
            ));
        }
        let temporary = directory.join(format!(".jackalope-{}", uuid::Uuid::new_v4()));
        let result = (|| -> std::io::Result<()> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary)?;
            file.write_all(contents.as_bytes())?;
            file.sync_all()?;
            std::fs::rename(&temporary, target)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn lease() -> Result<super::super::file_lock::FileLock, String> {
    #[cfg(unix)]
    let path = PathBuf::from(format!("/tmp/jackalope-desktop-control-{}.lock", unsafe {
        libc::geteuid()
    }));
    #[cfg(not(unix))]
    let path = std::env::temp_dir().join("jackalope-desktop-control.lock");
    open_lease(&path)
}

fn open_lease(path: &std::path::Path) -> Result<super::super::file_lock::FileLock, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
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
    super::super::file_lock::FileLock::try_new(file).map_err(|_| {
        "Another Jackalope instance owns desktop control. Release it there first.".into()
    })
}

pub(super) fn key(key: &str) -> String {
    if cfg!(target_os = "macos") {
        key.into()
    } else {
        key.replacen("Primary+", "Control+", 1)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[cfg(target_os = "linux")]
    #[test]
    fn gnome_install_preserves_other_files_and_rejects_links() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-gnome-install-{}", uuid::Uuid::new_v4()));
        write_gnome_extension(&directory).unwrap();
        let custom = directory.join("custom.txt");
        std::fs::write(&custom, "preserve").unwrap();
        write_gnome_extension(&directory).unwrap();
        assert_eq!(std::fs::read_to_string(&custom).unwrap(), "preserve");
        let metadata: serde_json::Value =
            serde_json::from_slice(&std::fs::read(directory.join("metadata.json")).unwrap())
                .unwrap();
        assert_eq!(metadata["shell-version"], serde_json::json!(["46"]));
        let guard = directory.join("guard.js");
        assert_eq!(
            std::fs::metadata(&guard).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::remove_file(&guard).unwrap();
        symlink(&custom, &guard).unwrap();
        assert!(write_gnome_extension(&directory).is_err());
        assert_eq!(std::fs::read_to_string(&custom).unwrap(), "preserve");
        let link = directory.with_extension("link");
        symlink(&directory, &link).unwrap();
        assert!(write_gnome_extension(&link).is_err());
        std::fs::remove_file(link).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn desktop_lease_rejects_links_and_shared_permissions() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-lease-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("lease");
        let file = open_lease(&path).unwrap();
        assert!(open_lease(&path).is_err());
        let link = directory.join("link");
        symlink(&path, &link).unwrap();
        assert!(open_lease(&link).is_err());
        drop(file);
        let hard = directory.join("hard");
        std::fs::hard_link(&path, &hard).unwrap();
        assert!(open_lease(&hard).is_err());
        std::fs::remove_file(hard).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(open_lease(&path).is_err());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        drop(open_lease(&path).unwrap());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
