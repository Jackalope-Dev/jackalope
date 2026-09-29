//! Finding the host that owns the profile, or starting one.

use crate::connection::Connection;
use crate::prefs;
use crate::protocol::{attach, profile_root};
use std::io::{BufRead, IsTerminal, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ColdStart {
    Open,
    Background,
}

const PREFERENCES: &str = "cli.json";

/// Whether an app owns this profile but is not serving yet. The app holds an
/// exclusive lock on its task history from the moment it starts loading, well
/// before it can answer, so a refused shared lock means "starting". The probe
/// releases immediately, and the app retries its lock briefly, so probing never
/// stops an app from starting.
fn starting() -> bool {
    let Some(path) = profile_root().map(|root| root.join("task-runs-v1/runtime.lock")) else {
        return false;
    };
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    match file.try_lock_shared() {
        Ok(()) => {
            let _ = file.unlock();
            false
        }
        Err(std::fs::TryLockError::WouldBlock) => true,
        Err(_) => false,
    }
}

/// Attaches, waiting for an app that is still starting rather than treating it
/// as absent. When nothing owns the profile this returns at once.
pub fn attach_or_wait() -> Option<Connection> {
    if let Some((handshake, client)) = attach() {
        return Some(Connection::new(handshake, client));
    }
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut told = false;
    while starting() && Instant::now() < deadline {
        if !told {
            eprintln!("Waiting for Jackalope to finish starting…");
            told = true;
        }
        std::thread::sleep(Duration::from_millis(250));
        if let Some((handshake, client)) = attach() {
            return Some(Connection::new(handshake, client));
        }
    }
    None
}

/// Attaches to the running host, starting one when asked to.
pub fn ensure(preference: Option<ColdStart>) -> Result<Connection, String> {
    // A host that is still starting must not be mistaken for none at all, or
    // this would try to start a second one.
    if let Some(found) = attach_or_wait() {
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
    start(choice)?;
    wait()
}

/// Asks once, on a real terminal. Callers handle the non-interactive case
/// before reaching here.
fn ask() -> Result<Option<ColdStart>, String> {
    println!("Jackalope isn't running.");
    println!();
    println!("  [o] Open the app        launch the desktop window too");
    println!("  [b] Run in background   headless, this terminal only (default)");
    println!("  [c] Cancel");
    println!();
    loop {
        print!("Choice [o/B/c]: ");
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

pub fn remembered_choice() -> Option<ColdStart> {
    let value: serde_json::Value = prefs::read_json(PREFERENCES)?;
    match value.get("coldStart")?.as_str()? {
        "open" => Some(ColdStart::Open),
        "background" => Some(ColdStart::Background),
        _ => None,
    }
}

/// Clears the remembered answer so the next cold start asks again.
pub fn forget_choice() {
    prefs::remove(PREFERENCES);
}

pub fn remember_choice(choice: ColdStart) {
    let value = serde_json::json!({
        "coldStart": match choice {
            ColdStart::Open => "open",
            ColdStart::Background => "background",
        }
    });
    let _ = prefs::write_json(PREFERENCES, &value);
}

/// The desktop binary sits beside this one, both in the installed bundle and
/// in a development target directory.
fn binary() -> Result<PathBuf, String> {
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
    prefs::path("host-launcher")
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(PathBuf::from)
        .filter(|launcher| launcher.exists())
        .ok_or_else(|| {
            "Could not find the Jackalope application. Open it once, or reinstall Jackalope.".into()
        })
}

fn start(choice: ColdStart) -> Result<(), String> {
    let mut command = Command::new(binary()?);
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
fn wait() -> Result<Connection, String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if let Some((handshake, client)) = attach() {
            return Ok(Connection::new(handshake, client));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err("Jackalope did not finish starting. Open the app to see what happened.".into())
}
