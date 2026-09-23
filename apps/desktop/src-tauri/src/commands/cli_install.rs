//! Keeps the `jackalope` command reachable from a terminal.
//!
//! macOS and Linux packages have no install step Jackalope can hook, so the app
//! re-asserts a link to its bundled command on every launch; that also repairs
//! it after an update moves or replaces the bundle. Windows installers and the
//! Store package put the command on PATH themselves.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandStatus {
    /// The path a terminal runs for `jackalope`, when one points at this app.
    pub command: Option<String>,
    /// Whether that command's directory is on the login-shell PATH. `None`
    /// when the PATH could not be determined.
    pub on_path: Option<bool>,
    /// Why nothing was installed automatically.
    pub skipped: Option<String>,
    pub error: Option<String>,
    /// macOS can also link the command into /usr/local/bin, which is on the
    /// default PATH, after an administrator prompt.
    pub system_available: bool,
}

static OUTCOME: Mutex<(Option<String>, Option<String>)> = Mutex::new((None, None));

const NAME: &str = if cfg!(windows) {
    "jackalope.exe"
} else {
    "jackalope"
};

/// The command shipped beside this executable. Canonicalized so a launch
/// through a link still finds the real bundle.
fn bundled_command() -> Option<PathBuf> {
    let executable = std::fs::canonicalize(std::env::current_exe().ok()?).ok()?;
    let command = executable.parent()?.join(NAME);
    command.is_file().then_some(command)
}

/// Records how the command should start this app when nothing is running. An
/// AppImage runs from a temporary mount, so the command cannot find the app
/// beside itself and must launch the image instead.
fn write_launcher(preferences: &Path) {
    let launcher = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::fs::canonicalize(std::env::current_exe().ok()?).ok());
    if let Some(launcher) = launcher {
        let _ = super::history::write_atomic(
            &preferences.join("host-launcher"),
            launcher.to_string_lossy().as_bytes(),
        );
    }
}

pub fn launch(preferences: PathBuf) {
    std::thread::spawn(move || {
        write_launcher(&preferences);
        let outcome = install();
        if let Ok(mut stored) = OUTCOME.lock() {
            *stored = outcome;
        }
    });
}

/// Returns `(skipped, error)`.
#[cfg(unix)]
fn install() -> (Option<String>, Option<String>) {
    if cfg!(debug_assertions) {
        return (
            Some("Development builds do not install the jackalope command, so they never replace the one an installed app provides.".into()),
            None,
        );
    }
    if std::env::var_os("JACKALOPE_PROFILE_DIR").is_some() {
        return (
            Some("This app uses an isolated profile; the jackalope command follows the default profile.".into()),
            None,
        );
    }
    let Some(command) = bundled_command() else {
        return (
            None,
            Some("This installation does not include the jackalope command.".into()),
        );
    };
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return (None, Some("Could not find your home folder.".into()));
    };
    let source = match std::env::var_os("APPIMAGE") {
        // The image's mount point changes on every run, so link to a stable
        // copy of the command instead.
        Some(_) => match copy_out(&command, &home.join(".local/share/jackalope").join(NAME)) {
            Ok(copy) => copy,
            Err(error) => return (None, Some(error)),
        },
        None => command,
    };
    match link(&source, &home.join(".local/bin").join(NAME)) {
        Ok(()) => (None, None),
        Err(error) => (None, Some(error)),
    }
}

#[cfg(windows)]
fn install() -> (Option<String>, Option<String>) {
    (None, None)
}

#[cfg(unix)]
fn copy_out(command: &Path, destination: &Path) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;
    let bytes = std::fs::read(command).map_err(|error| error.to_string())?;
    if std::fs::read(destination).ok().as_deref() != Some(bytes.as_slice()) {
        std::fs::create_dir_all(destination.parent().ok_or("Invalid command folder.")?)
            .map_err(|error| error.to_string())?;
        super::history::write_atomic(destination, &bytes)?;
        std::fs::set_permissions(destination, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }
    Ok(destination.to_path_buf())
}

/// Points `target` at `source`. Only a link — ours or anyone's — is replaced;
/// a real file there belongs to the user and is left alone.
#[cfg(unix)]
fn link(source: &Path, target: &Path) -> Result<(), String> {
    if let Ok(existing) = std::fs::symlink_metadata(target) {
        if !existing.file_type().is_symlink() {
            return Err(format!(
                "{} already exists and is not managed by Jackalope, so it was left unchanged.",
                target.display()
            ));
        }
        if std::fs::read_link(target).ok().as_deref() == Some(source) {
            return Ok(());
        }
    }
    let directory = target.parent().ok_or("Invalid command folder.")?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    // Build the link beside the target and rename it into place, so a
    // terminal never finds the command missing mid-update.
    let staged = directory.join(format!(".jackalope-{}", uuid::Uuid::new_v4().simple()));
    std::os::unix::fs::symlink(source, &staged).map_err(|error| error.to_string())?;
    std::fs::rename(&staged, target).map_err(|error| {
        let _ = std::fs::remove_file(&staged);
        error.to_string()
    })
}

/// Where a terminal finds this app's command, checked fresh each time so the
/// answer reflects links added or removed outside the app.
fn inspect() -> CommandStatus {
    let mut status = CommandStatus {
        system_available: cfg!(target_os = "macos"),
        ..CommandStatus::default()
    };
    let Some(command) = bundled_command() else {
        return status;
    };
    #[cfg(unix)]
    {
        let ours = |candidate: &Path| {
            std::fs::canonicalize(candidate).is_ok_and(|resolved| {
                resolved == command
                    || resolved.parent().and_then(Path::file_name)
                        == Some(std::ffi::OsStr::new("jackalope"))
            })
        };
        let mut candidates = Vec::new();
        if cfg!(target_os = "macos") {
            candidates.push(PathBuf::from("/usr/local/bin"));
        }
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(PathBuf::from(home).join(".local/bin"));
        }
        for directory in candidates {
            let candidate = directory.join(NAME);
            if ours(&candidate) {
                status.on_path = super::platform::on_login_path(&directory);
                status.command = Some(candidate.to_string_lossy().into_owned());
                break;
            }
        }
    }
    #[cfg(windows)]
    {
        let directory = command.parent().map(Path::to_path_buf);
        status.on_path = Some(
            cfg!(feature = "store")
                || directory.is_some_and(|directory| {
                    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                        .any(|entry| entry == directory)
                }),
        );
        status.command = Some(command.to_string_lossy().into_owned());
    }
    status
}

#[tauri::command]
pub fn cli_install_status() -> CommandStatus {
    let mut status = inspect();
    if let Ok(stored) = OUTCOME.lock() {
        status.skipped = stored.0.clone();
        status.error = stored.1.clone();
    }
    status
}

/// Quotes `value` as an AppleScript string literal.
#[cfg(target_os = "macos")]
fn applescript_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Links the command into /usr/local/bin behind macOS's administrator prompt,
/// the same arrangement editors use for their shell commands.
#[tauri::command]
pub async fn cli_install_system() -> Result<CommandStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let command =
            bundled_command().ok_or("This installation does not include the jackalope command.")?;
        let script = format!(
            "do shell script \"mkdir -p /usr/local/bin && ln -sfn \" & quoted form of {} & \" /usr/local/bin/jackalope\" with administrator privileges",
            applescript_string(&command.to_string_lossy())
        );
        let succeeded = tauri::async_runtime::spawn_blocking(move || {
            std::process::Command::new("/usr/bin/osascript")
                .args(["-e", &script])
                .status()
                .is_ok_and(|status| status.success())
        })
        .await
        .map_err(|error| error.to_string())?;
        if !succeeded {
            return Err("The jackalope command was not installed.".into());
        }
        Ok(cli_install_status())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Installing into a system folder is only offered on macOS.".into())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn links_replace_links_but_never_real_files() {
        let directory = std::env::temp_dir().join(format!("jl-link-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let first = directory.join("first");
        let second = directory.join("second");
        std::fs::write(&first, b"1").unwrap();
        std::fs::write(&second, b"2").unwrap();
        let target = directory.join("bin/jackalope");

        link(&first, &target).unwrap();
        assert_eq!(std::fs::read_link(&target).unwrap(), first);
        link(&second, &target).unwrap();
        assert_eq!(std::fs::read_link(&target).unwrap(), second);

        std::fs::remove_file(&target).unwrap();
        std::fs::write(&target, b"user's own").unwrap();
        assert!(link(&first, &target).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"user's own");

        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn applescript_strings_cannot_break_out_of_their_quotes() {
        assert_eq!(
            applescript_string(r#"/Apps/My "Tools"\Jackalope.app"#),
            r#""/Apps/My \"Tools\"\\Jackalope.app""#
        );
    }
}
