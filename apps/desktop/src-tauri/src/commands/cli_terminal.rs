//! The `jackalope` command inside the app, and the hand-off to the user's own
//! terminal.
//!
//! Conversations live in this process, not in any terminal, so moving one is
//! only a matter of attaching another client and closing the first.

use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const PREFIX: &str = "cli-terminal-";

fn valid_key(key: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(key)
        .map(|_| ())
        .map_err(|_| "Invalid terminal identifier.".into())
}

fn terminal_id(key: &str) -> String {
    format!("cli::{key}")
}

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

/// Opens a window running `jackalope` in `directory`. Each call opens a new
/// window, so several conversations can run side by side.
#[tauri::command]
pub fn cli_terminal_window(app: AppHandle, directory: String) -> Result<(), String> {
    let directory = repository(&directory)?;
    command_path()?;
    let key = uuid::Uuid::new_v4().to_string();
    let query = format!(
        "index.html?cliTerminal={key}&directory={}",
        encode(&directory.to_string_lossy())
    );
    let name = directory
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut builder = WebviewWindowBuilder::new(
        &app,
        format!("{PREFIX}{key}"),
        WebviewUrl::App(query.into()),
    )
    .title(format!("{name} · Terminal · Jackalope"))
    .inner_size(960.0, 640.0)
    .min_inner_size(520.0, 360.0);
    if let Some(profile) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
        builder = builder.data_directory(PathBuf::from(profile).join("webview"));
    }
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

/// Percent-encodes a path for a query string.
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// Starts `jackalope` for the window `key` and returns the terminal id the
/// shared terminal commands use.
#[tauri::command]
pub async fn cli_terminal_start(key: String, directory: String) -> Result<String, String> {
    valid_key(&key)?;
    let directory = repository(&directory)?;
    let mut command = CommandBuilder::new(command_path()?);
    // The command reports its conversation under this key; see `popout`.
    command.env("JACKALOPE_TERMINAL", &key);
    let id = terminal_id(&key);
    let started = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        super::work_terminal::start_command(&started, directory, command)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(id)
}

/// Closes the terminal for window `key`. The conversation keeps running.
#[tauri::command]
pub fn cli_terminal_close(key: String) -> Result<(), String> {
    valid_key(&key)?;
    super::work_terminal::close(&terminal_id(&key));
    Ok(())
}

/// Opens the user's terminal on the conversation the window `key` is showing,
/// then closes the in-app copy so the conversation has one terminal.
#[tauri::command]
pub fn cli_terminal_popout(app: AppHandle, key: String, directory: String) -> Result<(), String> {
    valid_key(&key)?;
    let directory = repository(&directory)?;
    let command = command_path()?;
    let mut arguments = Vec::new();
    // A terminal application that is already running will not inherit this
    // process's environment, so an isolated profile is passed explicitly.
    if let Some(profile) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
        arguments.push(format!("--profile={}", profile.to_string_lossy()));
    }
    if let Some(session) = super::cli_host::attached_session(&key) {
        arguments.push("attach".into());
        arguments.push(session);
    }
    open_system_terminal(&directory, &command, &arguments)?;
    super::work_terminal::close(&terminal_id(&key));
    if let Some(window) = app.get_webview_window(&format!("{PREFIX}{key}")) {
        let _ = window.close();
    }
    Ok(())
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
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let started = if super::platform::find_on_path("wt.exe").is_some() {
        std::process::Command::new("wt.exe")
            .arg("-d")
            .arg(directory)
            .arg(command)
            .args(arguments)
            .spawn()
    } else {
        std::process::Command::new("cmd.exe")
            .args(["/C", "start", "Jackalope", "/D"])
            .arg(directory)
            .arg(command)
            .args(arguments)
            .creation_flags(CREATE_NO_WINDOW)
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

    #[test]
    fn window_queries_encode_paths() {
        assert_eq!(encode("/a b/c&d=é"), "/a%20b/c%26d%3D%C3%A9");
    }
}

/// Ends a window's command when the window goes away, however it was closed.
pub fn window_destroyed(label: &str) {
    if let Some(key) = label.strip_prefix(PREFIX) {
        super::work_terminal::close(&terminal_id(key));
    }
}
