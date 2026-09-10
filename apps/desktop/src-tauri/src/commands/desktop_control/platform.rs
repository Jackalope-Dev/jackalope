use super::*;
use std::path::PathBuf;

static RESOURCES: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_directory(path: PathBuf) {
    let _ = RESOURCES.set(path);
}

pub fn supported() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

#[cfg(target_os = "macos")]
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
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command.env("JACKALOPE_DESKTOP_REQUEST", payload.to_string());
    Ok(command)
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
