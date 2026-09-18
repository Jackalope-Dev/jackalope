use super::{integration, process_control::ProcessTree, tasks::TaskRuntime};
use crate::state::PtySession;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Read,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::State;

const OUTPUT_LIMIT: usize = 256 * 1024;
#[derive(Default)]
struct Output {
    text: String,
    offset: usize,
}
impl Output {
    fn append(&mut self, text: &str) {
        self.text.push_str(text);
        if self.text.len() > OUTPUT_LIMIT {
            let mut trim = self.text.len() - OUTPUT_LIMIT;
            while !self.text.is_char_boundary(trim) {
                trim += 1;
            }
            self.text.drain(..trim);
            self.offset += trim;
        }
    }
}
struct Terminal {
    workspace: std::path::PathBuf,
    generation: String,
    pty: PtySession,
    output: Arc<Mutex<Output>>,
}
impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.pty.stop();
    }
}
static TERMINALS: OnceLock<Mutex<HashMap<String, Terminal>>> = OnceLock::new();
fn terminals() -> &'static Mutex<HashMap<String, Terminal>> {
    TERMINALS.get_or_init(Default::default)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalView {
    generation: String,
    workspace: String,
    running: bool,
    output: String,
    cursor: usize,
    reset: bool,
}
fn running(terminal: &mut Terminal) -> Result<bool, String> {
    if terminal
        .pty
        .child
        .try_wait()
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Ok(true);
    }
    if let Some(tree) = &terminal.pty.tree {
        tree.terminate();
    }
    Ok(false)
}
fn view(terminal: &mut Terminal, cursor: usize, generation: &str) -> Result<TerminalView, String> {
    let running = running(terminal)?;
    let output = terminal.output.lock().map_err(|e| e.to_string())?;
    let end = output.offset + output.text.len();
    let reset = generation != terminal.generation
        || cursor < output.offset
        || cursor > end
        || !output
            .text
            .is_char_boundary(cursor.saturating_sub(output.offset));
    let start = if reset { 0 } else { cursor - output.offset };
    Ok(TerminalView {
        generation: terminal.generation.clone(),
        workspace: terminal.workspace.to_string_lossy().into_owned(),
        running,
        output: output.text[start..].into(),
        cursor: end,
        reset,
    })
}

pub fn ensure_idle(workspace: &str) -> Result<(), String> {
    let path = dunce::canonicalize(workspace).map_err(|e| e.to_string())?;
    for terminal in terminals().lock().map_err(|e| e.to_string())?.values_mut() {
        if terminal.workspace == path && running(terminal)? {
            return Err("Stop the task terminal before running an agent, checks, a preview, merging or removing this workspace.".into());
        }
    }
    Ok(())
}
pub fn close_all() {
    if let Ok(mut sessions) = terminals().lock() {
        sessions.clear();
    }
}

#[tauri::command]
pub async fn task_terminal_start(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || start(&runtime, &id))
        .await
        .map_err(|e| e.to_string())?
}
pub(super) fn start(runtime: &TaskRuntime, id: &str) -> Result<(), String> {
    runtime.access.ensure()?;
    let _guard = integration::execution_guard()?;
    let runs = runtime.integration_runs()?;
    let run = runs
        .iter()
        .find(|run| run.id == id)
        .ok_or("Task not found")?;
    let workspace = dunce::canonicalize(&run.workspace).map_err(|e| e.to_string())?;
    if runs.iter().any(|other| {
        dunce::canonicalize(&other.workspace).ok().as_ref() == Some(&workspace)
            && (["starting", "running", "stopping", "interrupted"].contains(&other.status.as_str())
                || other.finishing)
    }) {
        return Err(
            "Finish active work and resolve interrupted ownership before opening a task terminal."
                .into(),
        );
    }
    {
        let mut sessions = terminals().lock().map_err(|e| e.to_string())?;
        if let Some(terminal) = sessions.get_mut(&run.task_id) {
            if running(terminal)? {
                return if terminal.workspace == workspace {
                    Ok(())
                } else {
                    Err("Stop this task's existing terminal before changing its workspace.".into())
                };
            }
        }
    }
    super::previews::ensure_idle(&run.workspace)?;
    super::verification::ensure_idle(&run.workspace)?;
    let mut sessions = terminals().lock().map_err(|e| e.to_string())?;
    let exited: Vec<_> = sessions
        .iter_mut()
        .filter_map(|(id, terminal)| matches!(running(terminal), Ok(false)).then_some(id.clone()))
        .collect();
    if sessions.len() >= 8 {
        for id in exited {
            sessions.remove(&id);
        }
    }
    if sessions.len() >= 8 {
        return Err("Stop a task terminal before opening another (limit eight).".into());
    }
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 90,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let mut command = {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        c.arg("-NoProfile");
        c
    };
    #[cfg(not(windows))]
    let mut command = CommandBuilder::new(
        std::env::var("SHELL")
            .ok()
            .filter(|s| std::path::Path::new(s).is_absolute())
            .unwrap_or_else(|| "/bin/sh".into()),
    );
    command.cwd(&workspace);
    command.env("TERM", "xterm-256color");
    command.env_remove("JACKALOPE_BRIDGE_TOKEN");
    command.env_remove("JACKALOPE_BRIDGE_URL");
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let tree = match child
        .process_id()
        .ok_or("Terminal process has no identity".into())
        .and_then(ProcessTree::attach_pid)
    {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let output = Arc::new(Mutex::new(Output::default()));
    sessions.insert(
        run.task_id.clone(),
        Terminal {
            workspace,
            generation: uuid::Uuid::new_v4().to_string(),
            pty: PtySession {
                writer,
                master: pair.master,
                child,
                tree: Some(tree),
            },
            output: output.clone(),
        },
    );
    let task_id = run.task_id.clone();
    let monitor_generation = sessions[&task_id].generation.clone();
    drop(sessions);
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    pending.extend_from_slice(&buffer[..count]);
                    let (text, carry) = super::pty::split_valid_utf8_prefix(&pending);
                    if let Ok(mut output) = output.lock() {
                        output.append(&text);
                    }
                    pending = carry;
                }
            }
        }
        if let Ok(mut output) = output.lock() {
            output.append(&String::from_utf8_lossy(&pending));
        }
    });
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let Ok(mut sessions) = terminals().lock() else {
            break;
        };
        let Some(terminal) = sessions.get_mut(&task_id) else {
            break;
        };
        if terminal.generation != monitor_generation {
            break;
        }
        if !matches!(running(terminal), Ok(true)) {
            break;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn task_terminal_status(
    id: String,
    cursor: usize,
    generation: String,
) -> Result<Option<TerminalView>, String> {
    terminals()
        .lock()
        .map_err(|e| e.to_string())?
        .get_mut(&id)
        .map(|terminal| view(terminal, cursor, &generation))
        .transpose()
}
#[tauri::command]
pub fn task_terminal_write(id: String, generation: String, input: String) -> Result<(), String> {
    if input.len() > 65536 {
        return Err("Terminal input is too large".into());
    }
    let mut sessions = terminals().lock().map_err(|e| e.to_string())?;
    let terminal = sessions.get_mut(&id).ok_or("Terminal not found")?;
    ensure_generation(terminal, &generation)?;
    if !running(terminal)? {
        return Err("Terminal has stopped".into());
    }
    terminal
        .pty
        .writer
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn task_terminal_resize(
    id: String,
    generation: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = terminals().lock().map_err(|e| e.to_string())?;
    let terminal = sessions.get(&id).ok_or("Terminal not found")?;
    ensure_generation(terminal, &generation)?;
    terminal
        .pty
        .master
        .resize(PtySize {
            rows: rows.clamp(2, 300),
            cols: cols.clamp(10, 500),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}
fn ensure_generation(terminal: &Terminal, generation: &str) -> Result<(), String> {
    if terminal.generation != generation {
        return Err(
            "The terminal changed in another window. Reconnect before using its controls.".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn task_terminal_stop(id: String, generation: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = integration::execution_guard()?;
        if let Some(terminal) = terminals().lock().map_err(|e| e.to_string())?.get_mut(&id) {
            ensure_generation(terminal, &generation)?;
            terminal.pty.stop().map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replay_is_bounded_at_utf8_boundaries() {
        let mut output = Output::default();
        output.append(&"😀".repeat(OUTPUT_LIMIT));
        assert!(output.text.len() <= OUTPUT_LIMIT);
        assert_eq!(output.offset + output.text.len(), OUTPUT_LIMIT * 4);
        output.append("next");
        assert!(output.text.ends_with("next"));
    }
}
