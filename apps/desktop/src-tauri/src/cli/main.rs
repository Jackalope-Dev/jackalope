//! The `jackalope` command.
//!
//! A thin client. The profile has exactly one owner — the desktop process
//! holds exclusive locks on it — so this never opens the profile itself; it
//! attaches to the running host, or offers to start one.

mod brand;
mod protocol;
mod ui;

use protocol::{attach, profile_root, Client, Handshake, Project, Request, Response};
use std::io::{BufRead, IsTerminal, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const HELP: &str = "\
jackalope — talk to your agents from the terminal

USAGE
  jackalope                      start a conversation in this repository
  jackalope --continue           resume the latest conversation here
  jackalope ls                   list open conversations
  jackalope attach <id>          resume a conversation by id
  jackalope status               show the running host
  jackalope help                 show this message

OPTIONS
  --open                         start the desktop app if nothing is running
  --background                   start a headless host if nothing is running
  --version                      print the version
";

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let flags: Vec<&str> = arguments
        .iter()
        .map(String::as_str)
        .filter(|argument| argument.starts_with('-'))
        .collect();
    let mut positional = arguments
        .iter()
        .map(String::as_str)
        .filter(|argument| !argument.starts_with('-'));
    let command = positional.next();
    let argument = positional.next();

    if flags.contains(&"--help") || flags.contains(&"-h") || command == Some("help") {
        print!("{HELP}");
        return;
    }
    if flags.contains(&"--version") || flags.contains(&"-V") {
        println!("jackalope {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    let preference = if flags.contains(&"--open") {
        Some(ColdStart::Open)
    } else if flags.contains(&"--background") {
        Some(ColdStart::Background)
    } else {
        None
    };

    let resume = flags.contains(&"--continue") || flags.contains(&"-c");
    if let Err(error) = run(command, argument, preference, resume) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run(
    command: Option<&str>,
    argument: Option<&str>,
    preference: Option<ColdStart>,
    resume: bool,
) -> Result<(), String> {
    match command {
        Some("status") => status(),
        Some("ls" | "sessions") => list(preference),
        Some("attach") => {
            let id = argument.ok_or("Which conversation? Run 'jackalope ls' to see them.")?;
            converse(preference, Some(id.to_string()), false)
        }
        Some(other) => Err(format!(
            "Unknown command '{other}'. Run 'jackalope help' to see what is available."
        )),
        None => converse(preference, None, resume),
    }
}

/// The repository this command was run in. A terminal tool should work where
/// the user already is rather than asking them to pick from a list.
fn project(client: &mut Client) -> Result<Project, String> {
    let here = std::env::current_dir().map_err(|error| error.to_string())?;
    match client.send(&Request::EnsureProject {
        path: here.to_string_lossy().into_owned(),
    })? {
        Response::Project { project } => Ok(project),
        Response::Error { message } => Err(message),
        _ => Err("The host answered unexpectedly.".into()),
    }
}

fn list(preference: Option<ColdStart>) -> Result<(), String> {
    let (_, mut client) = ensure_host(preference)?;
    let Response::Sessions { sessions } = client.send(&Request::Sessions)? else {
        return Err("The host answered unexpectedly.".into());
    };
    if sessions.is_empty() {
        println!("No open conversations.");
        return Ok(());
    }
    for session in sessions {
        let state = if session.paused { "paused" } else { "active" };
        println!("{}  {:<7}  {}", &session.id[..8], state, session.title);
        if let Some(error) = session.error {
            println!("{:10}{error}", "");
        }
    }
    Ok(())
}

fn converse(
    preference: Option<ColdStart>,
    session_id: Option<String>,
    resume: bool,
) -> Result<(), String> {
    if !std::io::stdout().is_terminal() {
        return Err("The conversation needs an interactive terminal.".into());
    }
    let (handshake, mut client) = ensure_host(preference)?;
    let project = project(&mut client)?;
    let session_id = match session_id {
        Some(prefix) => Some(resolve(&mut client, &prefix)?),
        None if resume => Some(
            latest(&mut client, &project)?
                .ok_or("No conversation to continue in this repository.")?,
        ),
        None => None,
    };
    ui::run(handshake, client, project, session_id)
}

/// `ls` prints short ids, so accept any unambiguous prefix.
fn resolve(client: &mut Client, prefix: &str) -> Result<String, String> {
    let Response::Sessions { sessions } = client.send(&Request::Sessions)? else {
        return Err("The host answered unexpectedly.".into());
    };
    let mut matches = sessions
        .into_iter()
        .filter(|session| session.id.starts_with(prefix));
    match (matches.next(), matches.next()) {
        (Some(session), None) => Ok(session.id),
        (None, _) => Err(format!("No open conversation matches '{prefix}'.")),
        (Some(_), Some(_)) => Err(format!(
            "'{prefix}' matches more than one conversation; use more of the id."
        )),
    }
}

/// The most recent conversation in this project, for `--continue`.
fn latest(client: &mut Client, project: &Project) -> Result<Option<String>, String> {
    let Response::Sessions { sessions } = client.send(&Request::Sessions)? else {
        return Err("The host answered unexpectedly.".into());
    };
    Ok(sessions
        .into_iter()
        .find(|session| session.project_id == project.id)
        .map(|session| session.id))
}

fn status() -> Result<(), String> {
    match attach() {
        Some((handshake, _)) => {
            println!("Running    pid {}", handshake.pid);
            println!(
                "Window     {}",
                if handshake.windowed {
                    "open"
                } else {
                    "background"
                }
            );
            println!("Endpoint   {}", handshake.endpoint);
            println!(
                "Profile    {}",
                profile_root()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|| "unknown".into())
            );
            Ok(())
        }
        None => {
            println!("Jackalope is not running.");
            Ok(())
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum ColdStart {
    Open,
    Background,
}

/// Attaches to the running host, starting one when asked to.
fn ensure_host(preference: Option<ColdStart>) -> Result<(Handshake, Client), String> {
    if let Some(found) = attach() {
        return Ok(found);
    }
    let choice = match preference.or_else(remembered_choice) {
        Some(choice) => choice,
        None if !std::io::stdin().is_terminal() => {
            // Nobody is there to answer. Take the quiet default, but do not
            // record it as a preference the user never expressed.
            ColdStart::Background
        }
        None => match ask()? {
            Some(choice) => {
                remember_choice(choice);
                choice
            }
            None => return Err("Cancelled.".into()),
        },
    };
    start_host(choice)?;
    wait_for_host()
}

/// Asks once, on a real terminal. Callers handle the non-interactive case
/// before reaching here.
fn ask() -> Result<Option<ColdStart>, String> {
    println!("Jackalope isn't running.");
    println!();
    println!("  [o] Open the app        launch the desktop window too");
    println!("  [b] Run in background   headless, this terminal only");
    println!("  [c] Cancel");
    println!();
    loop {
        print!("Choice [o/b/c]: ");
        std::io::stdout().flush().map_err(|e| e.to_string())?;
        let mut line = String::new();
        if std::io::stdin()
            .lock()
            .read_line(&mut line)
            .map_err(|e| e.to_string())?
            == 0
        {
            return Ok(None);
        }
        match line.trim().to_ascii_lowercase().as_str() {
            "o" | "open" => return Ok(Some(ColdStart::Open)),
            "b" | "background" | "" => return Ok(Some(ColdStart::Background)),
            "c" | "cancel" => return Ok(None),
            _ => println!("Please answer o, b or c."),
        }
    }
}

fn preferences_path() -> Option<PathBuf> {
    Some(profile_root()?.join("task-runs-v1/preferences/cli.json"))
}

fn remembered_choice() -> Option<ColdStart> {
    let bytes = std::fs::read(preferences_path()?).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    match value.get("coldStart")?.as_str()? {
        "open" => Some(ColdStart::Open),
        "background" => Some(ColdStart::Background),
        _ => None,
    }
}

fn remember_choice(choice: ColdStart) {
    let Some(path) = preferences_path() else {
        return;
    };
    let value = serde_json::json!({
        "coldStart": match choice {
            ColdStart::Open => "open",
            ColdStart::Background => "background",
        }
    });
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(encoded) = serde_json::to_vec_pretty(&value) {
        let _ = std::fs::write(path, encoded);
    }
}

/// The desktop binary sits beside this one, both in the installed bundle and
/// in a development target directory.
fn host_binary() -> Result<PathBuf, String> {
    // Resolve links such as /usr/local/bin/jackalope back to the bundle.
    let executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|error| error.to_string())?;
    let directory = executable
        .parent()
        .ok_or("Could not locate the Jackalope application.")?;
    let name = if cfg!(windows) {
        "jackalope-desktop.exe"
    } else {
        "jackalope-desktop"
    };
    let candidate = directory.join(name);
    if candidate.exists() {
        return Ok(candidate);
    }
    // A copied command (an AppImage install) has no app beside it; the app
    // records how to launch itself each time it runs.
    profile_root()
        .map(|root| root.join("task-runs-v1/preferences/host-launcher"))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(PathBuf::from)
        .filter(|launcher| launcher.exists())
        .ok_or_else(|| {
            "Could not find the Jackalope application. Open it once, or reinstall Jackalope.".into()
        })
}

fn start_host(choice: ColdStart) -> Result<(), String> {
    let mut command = Command::new(host_binary()?);
    if choice == ColdStart::Background {
        command.arg("--headless");
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Jackalope could not start: {error}"))?;
    Ok(())
}

/// The host loads history and takes its locks before it can serve anyone, so
/// give it a bounded moment to advertise itself.
fn wait_for_host() -> Result<(Handshake, Client), String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if let Some(found) = attach() {
            return Ok(found);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err("Jackalope did not finish starting. Open the app to see what happened.".into())
}
