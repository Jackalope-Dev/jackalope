//! Keeps the `jackalope` command reachable from a terminal.
//!
//! macOS and Linux packages have no install step Jackalope can hook, so the app
//! re-asserts a link to its bundled command on every launch; that also repairs
//! it after an update moves or replaces the bundle. macOS shells leave the link's
//! folder off PATH, so the app also makes it reachable there. Windows installers
//! and the Store package put the command on PATH themselves.

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
    /// The login profile this launch added `~/.local/bin` to. Terminals opened
    /// before that edit do not see it.
    pub profile: Option<String>,
}

#[derive(Default)]
struct Outcome {
    skipped: Option<String>,
    error: Option<String>,
    profile: Option<PathBuf>,
}

static OUTCOME: Mutex<Outcome> = Mutex::new(Outcome {
    skipped: None,
    error: None,
    profile: None,
});

const NAME: &str = if cfg!(windows) {
    "jackalope.exe"
} else {
    "jackalope"
};

/// The command shipped beside this executable. Canonicalized so a launch
/// through a link still finds the real bundle.
pub(super) fn bundled_command() -> Option<PathBuf> {
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
        let outcome = install(&preferences);
        if let Ok(mut stored) = OUTCOME.lock() {
            *stored = outcome;
        }
    });
}

#[cfg(unix)]
fn install(preferences: &Path) -> Outcome {
    let failed = |error: String| Outcome {
        error: Some(error),
        ..Outcome::default()
    };
    if cfg!(debug_assertions) {
        return Outcome {
            skipped: Some("Development builds do not install the jackalope command, so they never replace the one an installed app provides.".into()),
            ..Outcome::default()
        };
    }
    if std::env::var_os("JACKALOPE_PROFILE_DIR").is_some() {
        return Outcome {
            skipped: Some("This app uses an isolated profile; the jackalope command follows the default profile.".into()),
            ..Outcome::default()
        };
    }
    let Some(command) = bundled_command() else {
        return failed("This installation does not include the jackalope command.".into());
    };
    let Some(home) = super::platform::home_dir() else {
        return failed("Could not find your home folder.".into());
    };
    let source = match std::env::var_os("APPIMAGE") {
        // The image's mount point changes on every run, so link to a stable
        // copy of the command instead.
        Some(_) => match copy_out(&command, &home.join(".local/share/jackalope").join(NAME)) {
            Ok(copy) => copy,
            Err(error) => return failed(error),
        },
        None => command,
    };
    if let Err(error) = link(&source, &home.join(".local/bin").join(NAME)) {
        return failed(error);
    }
    #[cfg(target_os = "macos")]
    let profile = match reach_from_terminals(&source, &home, preferences) {
        Ok(profile) => profile,
        Err(error) => return failed(error),
    };
    #[cfg(not(target_os = "macos"))]
    let profile = {
        let _ = preferences;
        None
    };
    Outcome {
        profile,
        ..Outcome::default()
    }
}

#[cfg(windows)]
fn install(_preferences: &Path) -> Outcome {
    Outcome::default()
}

/// Makes the linked command reachable from a new terminal, since macOS shells
/// leave `~/.local/bin` off PATH. Uses /usr/local/bin when it is writable
/// without a password (Homebrew makes it so on Intel Macs), otherwise adds
/// `~/.local/bin` to the login profile. The profile is edited at most once, so a
/// user who removes the line keeps it removed. Returns the profile it edited.
#[cfg(target_os = "macos")]
fn reach_from_terminals(
    source: &Path,
    home: &Path,
    preferences: &Path,
) -> Result<Option<PathBuf>, String> {
    use super::platform::on_login_path;
    // An unknown login PATH leaves things as they are rather than guess.
    if on_login_path(&home.join(".local/bin")) != Some(false) {
        return Ok(None);
    }
    let system = Path::new("/usr/local/bin");
    if system.is_dir() && on_login_path(system) == Some(true) {
        let target = system.join(NAME);
        let resolves_here =
            std::fs::canonicalize(&target).ok() == std::fs::canonicalize(source).ok();
        if resolves_here || link(source, &target).is_ok() {
            return Ok(None);
        }
    }
    let record = preferences.join("cli-login-profile");
    if record.exists() {
        return Ok(None);
    }
    let shell = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"));
    let zdotdir = std::env::var_os("ZDOTDIR").map(PathBuf::from);
    let Some(profile) = login_profile(&shell, home, zdotdir.as_deref()) else {
        return Ok(None);
    };
    add_to_profile(&profile)?;
    super::history::write_atomic(&record, profile.to_string_lossy().as_bytes())?;
    Ok(Some(profile))
}

/// Heads the lines `add_to_profile` appends, and tells it the edit is present.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const PROFILE_MARKER: &str = "# Added by Jackalope so terminals can run `jackalope`";

/// The profile a new login shell of `shell` reads, for the shells that read a
/// predictable one. bash reads only the first of these that exists, so creating
/// .bash_profile would hide an existing .profile.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn login_profile(shell: &Path, home: &Path, zdotdir: Option<&Path>) -> Option<PathBuf> {
    match shell.file_name()?.to_str()? {
        "zsh" => Some(zdotdir.unwrap_or(home).join(".zprofile")),
        "bash" => Some(
            [".bash_profile", ".bash_login", ".profile"]
                .iter()
                .map(|name| home.join(name))
                .find(|path| path.exists())
                .unwrap_or_else(|| home.join(".bash_profile")),
        ),
        _ => None,
    }
}

/// Appends `~/.local/bin` to PATH in `profile` unless Jackalope already did.
/// Appending keeps a profile that a dotfile manager links as a link.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn add_to_profile(profile: &Path) -> Result<(), String> {
    use std::io::Write;
    let existing = match std::fs::read_to_string(profile) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Could not read {}: {error}", profile.display())),
    };
    if existing.contains(PROFILE_MARKER) {
        return Ok(());
    }
    let gap = match existing.as_str() {
        "" => "",
        text if text.ends_with('\n') => "\n",
        _ => "\n\n",
    };
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(profile)
        .and_then(|mut file| {
            write!(
                file,
                "{gap}{PROFILE_MARKER}\nexport PATH=\"$HOME/.local/bin:$PATH\"\n"
            )
        })
        .map_err(|error| {
            format!(
                "Could not add the jackalope command to {}: {error}",
                profile.display()
            )
        })
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
        if let Some(home) = super::platform::home_dir() {
            candidates.push(home.join(".local/bin"));
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

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::cli_install::cli_install_status,
            commands::cli_install::cli_install_system,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub fn cli_install_status() -> CommandStatus {
    let mut status = inspect();
    if let Ok(stored) = OUTCOME.lock() {
        status.skipped = stored.skipped.clone();
        status.error = stored.error.clone();
        if let Some(profile) = &stored.profile {
            // The login PATH was read before the edit; new terminals see it.
            status.on_path = Some(true);
            status.profile = Some(profile.to_string_lossy().into_owned());
        }
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

    #[test]
    fn login_profiles_follow_the_shell_and_never_hide_an_existing_one() {
        let home = std::env::temp_dir().join(format!("jl-home-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).unwrap();
        let zsh = Path::new("/bin/zsh");
        let bash = Path::new("/bin/bash");
        assert_eq!(
            login_profile(zsh, &home, None),
            Some(home.join(".zprofile"))
        );
        assert_eq!(
            login_profile(zsh, &home, Some(Path::new("/z"))),
            Some(PathBuf::from("/z/.zprofile"))
        );
        assert_eq!(
            login_profile(bash, &home, None),
            Some(home.join(".bash_profile"))
        );
        std::fs::write(home.join(".profile"), "").unwrap();
        assert_eq!(
            login_profile(bash, &home, None),
            Some(home.join(".profile"))
        );
        assert_eq!(
            login_profile(Path::new("/opt/homebrew/bin/fish"), &home, None),
            None
        );
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn profile_edits_append_once_and_keep_existing_lines() {
        let home = std::env::temp_dir().join(format!("jl-profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).unwrap();
        let profile = home.join(".zprofile");
        std::fs::write(&profile, "eval \"$(brew shellenv)\"").unwrap();
        add_to_profile(&profile).unwrap();
        add_to_profile(&profile).unwrap();
        assert_eq!(
            std::fs::read_to_string(&profile).unwrap(),
            format!(
                "eval \"$(brew shellenv)\"\n\n{PROFILE_MARKER}\nexport PATH=\"$HOME/.local/bin:$PATH\"\n"
            )
        );
        let fresh = home.join(".bash_profile");
        add_to_profile(&fresh).unwrap();
        assert!(std::fs::read_to_string(&fresh)
            .unwrap()
            .starts_with(PROFILE_MARKER));
        std::fs::remove_dir_all(&home).unwrap();
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
