//! `!command` lines: run in the user's shell beside the conversation, with
//! output streamed into the terminal as it arrives. They run as the user, in
//! the conversation's workspace, and never reach an agent.

use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Lines kept per run; older output scrolls away like a terminal's.
const KEPT_LINES: usize = 2000;

pub enum Update {
    Line {
        run: usize,
        text: String,
        error: bool,
    },
    Exit {
        run: usize,
        outcome: Result<i32, String>,
    },
}

pub struct Run {
    pub command: String,
    pub directory: String,
    pub output: Vec<(String, bool)>,
    /// Lines dropped from the front once `KEPT_LINES` is reached.
    pub dropped: usize,
    pub started: Instant,
    /// Exit code (or why it could not run) and how long it took.
    pub finished: Option<(Result<i32, String>, Duration)>,
    child: Arc<Mutex<Option<Child>>>,
}

impl Run {
    pub fn running(&self) -> bool {
        self.finished.is_none()
    }

    pub fn push(&mut self, text: String, error: bool) {
        self.output.push((text, error));
        if self.output.len() > KEPT_LINES {
            let excess = self.output.len() - KEPT_LINES;
            self.output.drain(..excess);
            self.dropped += excess;
        }
    }

    /// Asks the process to stop. Output and the exit arrive as usual.
    pub fn interrupt(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                // The shell's own children share its process group; stopping
                // only the shell would leave them holding the output open.
                #[cfg(unix)]
                let _ = Command::new("kill")
                    .args(["-TERM", "--", &format!("-{}", child.id())])
                    .stderr(Stdio::null())
                    .status();
                #[cfg(windows)]
                let _ = Command::new("taskkill")
                    .args(["/T", "/F", "/PID", &child.id().to_string()])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
                let _ = child.kill();
            }
        }
    }
}

/// Starts `command` in `directory` and reports through `send`, which is
/// called from background threads.
pub fn start(
    run: usize,
    command: &str,
    directory: &str,
    send: impl Fn(Update) + Send + Sync + 'static,
) -> Run {
    let send = Arc::new(send);
    let slot = Arc::new(Mutex::new(None));
    let mut process = shell_command(command);
    process
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Nothing here can answer a prompt, and pagers would wait forever.
        .env("PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut process, 0);
    match process.spawn() {
        Ok(mut child) => {
            let readers: Vec<_> = [
                child
                    .stdout
                    .take()
                    .map(|out| Box::new(out) as Box<dyn Read + Send>),
                child
                    .stderr
                    .take()
                    .map(|err| Box::new(err) as Box<dyn Read + Send>),
            ]
            .into_iter()
            .enumerate()
            .filter_map(|(index, stream)| {
                let stream = stream?;
                let send = send.clone();
                Some(std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream);
                    let mut bytes = Vec::new();
                    while reader
                        .read_until(b'\n', &mut bytes)
                        .is_ok_and(|read| read > 0)
                    {
                        let text = clean(&String::from_utf8_lossy(&bytes));
                        bytes.clear();
                        send(Update::Line {
                            run,
                            text,
                            error: index == 1,
                        });
                    }
                }))
            })
            .collect();
            *slot.lock().unwrap_or_else(|poison| poison.into_inner()) = Some(child);
            let waiter = slot.clone();
            std::thread::spawn(move || {
                // Poll rather than block in `wait`, so `interrupt` can take the lock.
                let outcome = loop {
                    let status = {
                        let mut child = waiter.lock().unwrap_or_else(|poison| poison.into_inner());
                        match child.as_mut().map(Child::try_wait) {
                            Some(Ok(Some(status))) => Some(Ok(status.code().unwrap_or(-1))),
                            Some(Ok(None)) => None,
                            Some(Err(error)) => Some(Err(error.to_string())),
                            None => Some(Err("The command was lost.".into())),
                        }
                    };
                    if let Some(outcome) = status {
                        break outcome;
                    }
                    std::thread::sleep(Duration::from_millis(40));
                };
                // Let the last output land before the exit is reported.
                for reader in readers {
                    let _ = reader.join();
                }
                send(Update::Exit { run, outcome });
            });
        }
        Err(error) => send(Update::Exit {
            run,
            outcome: Err(format!("Could not start the shell: {error}")),
        }),
    }
    Run {
        command: command.to_string(),
        directory: directory.to_string(),
        output: Vec::new(),
        dropped: 0,
        started: Instant::now(),
        finished: None,
        child: slot,
    }
}

/// The user's shell running `command`: `$SHELL -c` on Unix, `%COMSPEC% /C`
/// on Windows. cmd parses its own command line, so the command is passed
/// through unquoted exactly as typed.
fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        let mut process = Command::new(shell);
        process
            .args(["/D", "/S", "/C"])
            .raw_arg(format!("\"{command}\""));
        process
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| "/bin/sh".into());
        let mut process = Command::new(shell);
        process.args(["-c", command]);
        process
    }
}

/// One line of output as the terminal would finally show it: escape
/// sequences removed, and a carriage return keeping only what was drawn last,
/// so progress bars settle to their final state.
pub fn clean(raw: &str) -> String {
    let raw = raw.trim_end_matches(['\n', '\r']);
    let raw = raw.rsplit('\r').next().unwrap_or("");
    let mut out = String::with_capacity(raw.len());
    let mut characters = raw.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\u{1b}' => match characters.next() {
                // CSI: parameters, then one final byte in @–~.
                Some('[') => {
                    for next in characters.by_ref() {
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                }
                // OSC: until BEL or ST.
                Some(']') => {
                    while let Some(next) = characters.next() {
                        if next == '\u{7}' {
                            break;
                        }
                        if next == '\u{1b}' && characters.peek() == Some(&'\\') {
                            characters.next();
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\t' => out.push_str("    "),
            character if character.is_control() => {}
            character => out.push(character),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_is_cleaned_to_what_a_terminal_would_show() {
        assert_eq!(clean("\u{1b}[1;32mok\u{1b}[0m\n"), "ok");
        assert_eq!(clean("10%\r50%\r100% done\r\n"), "100% done");
        assert_eq!(
            clean("\u{1b}]8;;https://x\u{7}link\u{1b}]8;;\u{1b}\\"),
            "link"
        );
        assert_eq!(clean("a\tb"), "a    b");
    }

    #[test]
    fn a_command_streams_output_and_reports_its_exit() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let sender = Mutex::new(sender);
        let directory = std::env::temp_dir();
        let command = if cfg!(windows) {
            "echo one && echo two 1>&2 && exit 3"
        } else {
            "echo one; echo two >&2; exit 3"
        };
        let _run = start(7, command, &directory.to_string_lossy(), move |update| {
            let _ = sender.lock().unwrap().send(update);
        });
        let mut lines = Vec::new();
        let outcome = loop {
            match receiver.recv_timeout(Duration::from_secs(10)).unwrap() {
                Update::Line { run, text, error } => {
                    assert_eq!(run, 7);
                    lines.push((text.trim().to_string(), error));
                }
                Update::Exit { outcome, .. } => break outcome,
            }
        };
        assert!(lines.contains(&("one".into(), false)));
        assert!(lines.contains(&("two".into(), true)));
        assert_eq!(outcome, Ok(3));
    }
}
