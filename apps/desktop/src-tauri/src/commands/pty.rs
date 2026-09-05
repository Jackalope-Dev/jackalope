use crate::state::{AppState, PtySession};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize)]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyExitEvent {
    pub session_id: String,
    pub exit_code: Option<u32>,
}

/// Spawns `program` inside a real pseudo-terminal and streams its combined
/// stdout/stderr back to the frontend as `agent-pty-output` events (each
/// carrying `session_id` so one listener can demux many concurrent agents),
/// followed by a single `agent-pty-exit` event when the process ends.
///
/// Reading happens on a plain OS thread (portable-pty's reader is blocking
/// I/O, not `tokio`-aware), so this command returns immediately with the
/// session id rather than waiting for the process to finish.
#[tauri::command]
pub async fn pty_spawn(
    program: String,
    args: Vec<String>,
    working_dir: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to allocate a pty: {e}"))?;

    let mut cmd = CommandBuilder::new(&program);
    cmd.args(&args);
    cmd.cwd(&working_dir);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn '{program}' in pty: {e}"))?;
    // The slave end belongs to the child process now; drop our copy so
    // reading the master side actually reaches EOF once the child exits.
    drop(pair.slave);

    let pid = child
        .process_id()
        .map(|p| p.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let session_id = format!("{program}-{pid}");

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take pty writer: {e}"))?;

    {
        let mut sessions = state.pty_sessions.lock().map_err(|_| "pty session lock poisoned")?;
        sessions.insert(
            session_id.clone(),
            PtySession {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    let event_session_id = session_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit(
                        "agent-pty-output",
                        PtyOutputEvent {
                            session_id: event_session_id.clone(),
                            chunk,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app.emit(
            "agent-pty-exit",
            PtyExitEvent {
                session_id: event_session_id.clone(),
                exit_code: None,
            },
        );
    });

    Ok(session_id)
}

/// Writes raw bytes (e.g. a command plus `\n`) to a running pty session's stdin.
#[tauri::command]
pub async fn pty_write(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock().map_err(|_| "pty session lock poisoned")?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No active pty session '{session_id}'"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to pty '{session_id}': {e}"))
}

/// Resizes a running pty session — call this when the frontend terminal
/// component's viewport dimensions change.
#[tauri::command]
pub async fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.pty_sessions.lock().map_err(|_| "pty session lock poisoned")?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("No active pty session '{session_id}'"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize pty '{session_id}': {e}"))
}

/// Kills a running pty session's child process and drops its session state.
#[tauri::command]
pub async fn pty_kill(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock().map_err(|_| "pty session lock poisoned")?;
    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| format!("No active pty session '{session_id}'"))?;
    session
        .child
        .kill()
        .map_err(|e| format!("Failed to kill pty session '{session_id}': {e}"))
}

#[cfg(test)]
mod tests {
    //! Exercises the same portable-pty APIs `pty_spawn` uses (openpty,
    //! CommandBuilder, spawn_command, try_clone_reader) directly, without
    //! going through Tauri's command/State/AppHandle plumbing — proves the
    //! pty mechanics themselves work on this machine's backend (ConPTY on
    //! Windows), independent of whether anything calls the command yet.
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;
    use std::time::{Duration, Instant};

    #[test]
    fn spawns_a_real_process_in_a_pty_and_reads_its_output() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("failed to allocate a pty");

        #[cfg(windows)]
        let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(windows)]
        cmd.args(["/C", "echo hello-from-pty"]);

        #[cfg(not(windows))]
        let mut cmd = CommandBuilder::new("/bin/sh");
        #[cfg(not(windows))]
        cmd.args(["-c", "echo hello-from-pty"]);

        let mut child = pair.slave.spawn_command(cmd).expect("failed to spawn command in pty");
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().expect("failed to clone pty reader");

        // Read with a bounded wait instead of blocking forever, so a
        // regression here fails the test instead of hanging CI/an agent.
        let mut output = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut buf = [0u8; 4096];
        while Instant::now() < deadline {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => output.extend_from_slice(&buf[..n]),
                Err(_) => break,
            }
            if String::from_utf8_lossy(&output).contains("hello-from-pty") {
                break;
            }
        }

        let text = String::from_utf8_lossy(&output);
        assert!(
            text.contains("hello-from-pty"),
            "expected pty output to contain the echoed string, got: {text:?}"
        );

        let _ = child.kill();
    }
}
