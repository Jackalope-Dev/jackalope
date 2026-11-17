//! Opens the `jackalope` command in the user's own terminal.

use std::path::{Path, PathBuf};

fn command_path() -> Result<PathBuf, String> {
    super::cli_install::bundled_command()
        .ok_or_else(|| "This installation does not include the jackalope command.".into())
}

fn repository(directory: &str) -> Result<PathBuf, String> {
    let directory = dunce::canonicalize(directory)
        .map_err(|_| "That project folder is no longer available.".to_string())?;
    if !directory.is_dir() {
        return Err("That project folder is no longer available.".into());
    }
    Ok(directory)
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::cli_terminal::cli_terminal_open,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// Opens the user's terminal running `jackalope` in `directory`.
#[tauri::command]
pub fn cli_terminal_open(directory: String) -> Result<(), String> {
    let directory = repository(&directory)?;
    let command = command_path()?;
    let mut arguments = Vec::new();
    // A terminal application that is already running will not inherit this
    // process's environment, so an isolated profile is passed explicitly.
    if let Some(profile) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
        arguments.push(format!("--profile={}", profile.to_string_lossy()));
    }
    open_system_terminal(&directory, &command, &arguments)
}

/// Quotes `value` for a POSIX shell.
#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(unix)]
fn shell_script(directory: &Path, command: &Path, arguments: &[String]) -> String {
    let mut line = format!(
        "cd {} && exec {}",
        shell_quote(&directory.to_string_lossy()),
        shell_quote(&command.to_string_lossy())
    );
    for argument in arguments {
        line.push(' ');
        line.push_str(&shell_quote(argument));
    }
    line
}

/// macOS has no default-terminal setting, but it does have a default handler
/// for `.command` files — Terminal, or whatever the user chose instead — so the
/// hand-off goes through one. The script removes itself when it runs.
#[cfg(target_os = "macos")]
fn open_system_terminal(
    directory: &Path,
    command: &Path,
    arguments: &[String],
) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let script = std::env::temp_dir().join(format!(
        "jackalope-{}.command",
        uuid::Uuid::new_v4().simple()
    ));
    let body = format!(
        "#!/bin/sh\nrm -f \"$0\"\nclear\n{}\n",
        shell_script(directory, command, arguments)
    );
    std::fs::write(&script, body).map_err(|error| error.to_string())?;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;
    let opened = std::process::Command::new("/usr/bin/open")
        .arg(&script)
        .status()
        .map_err(|error| error.to_string())?;
    if !opened.success() {
        let _ = std::fs::remove_file(&script);
        return Err("Could not open a terminal.".into());
    }
    Ok(())
}

/// Linux has no single default terminal; try the user's `$TERMINAL`, the
/// Debian alternatives entry, then common emulators.
#[cfg(target_os = "linux")]
fn open_system_terminal(
    directory: &Path,
    command: &Path,
    arguments: &[String],
) -> Result<(), String> {
    let script = shell_script(directory, command, arguments);
    let mut candidates: Vec<String> = std::env::var("TERMINAL").ok().into_iter().collect();
    candidates.extend(
        [
            "x-terminal-emulator",
            "gnome-terminal",
            "kgx",
            "konsole",
            "xfce4-terminal",
            "kitty",
            "alacritty",
            "wezterm",
            "foot",
            "xterm",
        ]
        .map(String::from),
    );
    for candidate in candidates {
        let Some(executable) = super::platform::find_on_path(&candidate) else {
            continue;
        };
        let name = executable
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut process = std::process::Command::new(&executable);
        match name.as_str() {
            "gnome-terminal" | "kgx" => process.args(["--", "sh", "-c", &script]),
            "wezterm" => process.args(["start", "--", "sh", "-c", &script]),
            "foot" => process.args(["sh", "-c", &script]),
            _ => process.args(["-e", "sh", "-c", &script]),
        };
        if process
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err("No terminal application was found. Set $TERMINAL to your terminal and try again.".into())
}

/// Windows Terminal when it is installed, otherwise a console window.
#[cfg(windows)]
fn open_system_terminal(
    directory: &Path,
    command: &Path,
    arguments: &[String],
) -> Result<(), String> {
    let started = if super::platform::find_on_path("wt.exe").is_some() {
        std::process::Command::new("wt.exe")
            .arg("-d")
            .arg(directory)
            .arg(command)
            .args(arguments)
            .spawn()
    } else {
        super::process_control::hidden(&mut std::process::Command::new("cmd.exe"))
            .args(["/C", "start", "Jackalope", "/D"])
            .arg(directory)
            .arg(command)
            .args(arguments)
            .spawn()
    };
    started
        .map(|_| ())
        .map_err(|error| format!("Could not open a terminal: {error}"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn hand_off_script_quotes_every_path_and_argument() {
        let script = shell_script(
            Path::new("/Users/o'brien/my repo"),
            Path::new("/Applications/Jackalope.app/Contents/MacOS/jackalope"),
            &["--profile=/tmp/a b".into(), "attach".into(), "abc".into()],
        );
        assert_eq!(
            script,
            "cd '/Users/o'\\''brien/my repo' && exec '/Applications/Jackalope.app/Contents/MacOS/jackalope' '--profile=/tmp/a b' 'attach' 'abc'"
        );
    }
}
