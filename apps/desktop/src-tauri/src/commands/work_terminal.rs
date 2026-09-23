use super::{integration, process_control::ProcessTree, tasks::TaskRuntime};
use crate::state::PtySession;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
    history: Option<std::path::PathBuf>,
}
impl Terminal {
    fn persist(&self) -> Result<(), String> {
        let Some(path) = &self.history else {
            return Ok(());
        };
        let record = SavedTerminal {
            workspace: self.workspace.to_string_lossy().into_owned(),
            generation: self.generation.clone(),
            output: self.output.lock().map_err(|e| e.to_string())?.text.clone(),
        };
        super::history::write_atomic(
            path,
            &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
        )
    }
}
impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.pty.stop();
        if let Err(error) = self.persist() {
            eprintln!("Terminal output could not be saved: {error}");
        }
    }
}
#[derive(Serialize, Deserialize)]
struct SavedTerminal {
    workspace: String,
    generation: String,
    output: String,
}
fn terminal_id(task: &str, slot: &str) -> Result<String, String> {
    match slot {
        "main" => Ok(task.into()),
        "split" => Ok(format!("{task}::split")),
        _ => Err("Choose the main or split terminal.".into()),
    }
}
fn history_path(runtime: &TaskRuntime, id: &str) -> std::path::PathBuf {
    let name: String = Sha256::digest(id.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    runtime
        .integration_directory()
        .join("terminal-output")
        .join(format!("{name}.json"))
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
pub fn active_count() -> usize {
    terminals()
        .lock()
        .map(|mut terminals| {
            terminals
                .values_mut()
                .filter_map(|terminal| running(terminal).ok())
                .filter(|active| *active)
                .count()
        })
        .unwrap_or(0)
}

#[tauri::command]
pub async fn task_terminal_start(
    id: String,
    shell: Option<String>,
    slot: Option<String>,
    retain_output: Option<bool>,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start_with_shell(
            &runtime,
            &id,
            shell.as_deref().unwrap_or("default"),
            slot.as_deref().unwrap_or("main"),
            retain_output.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
pub(super) fn start(runtime: &TaskRuntime, id: &str) -> Result<(), String> {
    start_with_shell(runtime, id, "default", "main", false)
}
pub(super) fn start_with_shell(
    runtime: &TaskRuntime,
    id: &str,
    shell: &str,
    slot: &str,
    retain_output: bool,
) -> Result<(), String> {
    runtime.access.ensure()?;
    let _guard = integration::execution_guard()?;
    let runs = runtime.integration_runs()?;
    let run = runs
        .iter()
        .find(|run| run.id == id)
        .ok_or("Task not found")?;
    let terminal_id = terminal_id(&run.task_id, slot)?;
    let history = if retain_output {
        let path = history_path(runtime, &terminal_id);
        std::fs::create_dir_all(path.parent().ok_or("Terminal history folder unavailable")?)
            .map_err(|e| e.to_string())?;
        Some(path)
    } else {
        None
    };
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
        if let Some(terminal) = sessions.get_mut(&terminal_id) {
            if running(terminal)? {
                return if terminal.workspace == workspace {
                    Ok(())
                } else {
                    Err("Stop this task's existing terminal before changing its workspace.".into())
                };
            }
        }
    }
    super::previews::ensure_preview_idle(&run.workspace)?;
    super::verification::ensure_idle(&run.workspace)?;
    let mut sessions = terminals().lock().map_err(|e| e.to_string())?;
    let main_id = self::terminal_id(&run.task_id, "main")?;
    let split_id = self::terminal_id(&run.task_id, "split")?;
    for (key, terminal) in sessions.iter_mut() {
        if key != &main_id
            && key != &split_id
            && terminal.workspace == workspace
            && running(terminal)?
        {
            return Err("Stop the other task's terminal before using this workspace.".into());
        }
    }
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
    let mut command = shell_command(shell, &workspace)?;
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
        terminal_id.clone(),
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
            history,
        },
    );
    let task_id = terminal_id;
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
        match running(terminal) {
            Ok(true) => {}
            Ok(false) => {
                if let Err(error) = terminal.persist() {
                    eprintln!("Terminal output could not be saved: {error}");
                }
                break;
            }
            Err(_) => break,
        }
    });
    Ok(())
}

fn shell_command(shell: &str, workspace: &std::path::Path) -> Result<CommandBuilder, String> {
    #[cfg(windows)]
    {
        let mut command = match shell {
            "default" | "powershell" => CommandBuilder::new("powershell.exe"),
            "pwsh" => CommandBuilder::new("pwsh.exe"),
            "cmd" => CommandBuilder::new("cmd.exe"),
            "wsl" => CommandBuilder::new("wsl.exe"),
            _ => return Err("Choose a Windows terminal shell in Desktop settings.".into()),
        };
        match shell {
            "default" => {
                command.args(["-NoLogo", "-NoProfile"]);
            }
            "powershell" | "pwsh" => {
                command.arg("-NoLogo");
            }
            "cmd" => {
                command.arg("/D");
            }
            "wsl" => {
                command.arg("--cd");
                command.arg(workspace);
            }
            _ => {}
        }
        Ok(command)
    }
    #[cfg(not(windows))]
    {
        let _ = workspace;
        let executable = match shell {
            "default" => std::env::var("SHELL")
                .ok()
                .filter(|value| std::path::Path::new(value).is_absolute())
                .unwrap_or_else(|| "/bin/sh".into()),
            "bash" => "/bin/bash".into(),
            "zsh" => "/bin/zsh".into(),
            _ => {
                return Err(
                    "Choose a terminal shell available on this computer in Desktop settings."
                        .into(),
                )
            }
        };
        Ok(CommandBuilder::new(executable))
    }
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
            terminal.persist()?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_terminal_restore(
    id: String,
    slot: Option<String>,
    state: State<'_, TaskRuntime>,
) -> Result<Option<TerminalView>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let key = terminal_id(&id, slot.as_deref().unwrap_or("main"))?;
        let path = history_path(&runtime, &key);
        if !path.exists() {
            return Ok(None);
        }
        let saved: SavedTerminal = serde_json::from_slice(&super::history::read_bounded(
            &path,
            (OUTPUT_LIMIT * 6 + 8192) as u64,
        )?)
        .map_err(|_| "Saved terminal output could not be read.")?;
        if saved.output.len() > OUTPUT_LIMIT {
            return Err("Saved terminal output exceeds its limit.".into());
        }
        let saved_path = dunce::canonicalize(&saved.workspace).map_err(|e| e.to_string())?;
        if !runtime.integration_runs()?.iter().any(|run| {
            run.task_id == id
                && dunce::canonicalize(&run.workspace).ok().as_ref() == Some(&saved_path)
        }) {
            return Err("This terminal's workspace is no longer available in task history.".into());
        }
        Ok(Some(TerminalView {
            generation: saved.generation,
            workspace: saved.workspace,
            running: false,
            cursor: saved.output.len(),
            output: saved.output,
            reset: true,
        }))
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
