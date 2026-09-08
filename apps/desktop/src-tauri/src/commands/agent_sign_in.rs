use super::agent_profiles::{self, AccountBinding};
use super::process_control::ProcessTree;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};
use tauri::State;

mod status;
pub use status::agent_profile_status;

static SIGNING_IN: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(Mutex::default);
const OUTPUT_LIMIT: usize = 65_536;
const SESSION_LIMIT: Duration = Duration::from_secs(600);

pub fn ensure_idle(binding: &AccountBinding) -> Result<(), String> {
    if SIGNING_IN
        .lock()
        .map_err(|_| "Sign-in state unavailable")?
        .contains(&binding.directory)
    {
        return Err("Finish or cancel this account's sign-in before using it.".into());
    }
    Ok(())
}

struct Lease(PathBuf);
impl Lease {
    fn acquire(directory: PathBuf) -> Result<Self, String> {
        if !SIGNING_IN
            .lock()
            .map_err(|_| "Sign-in state unavailable")?
            .insert(directory.clone())
        {
            return Err("Sign-in is already open for this account.".into());
        }
        Ok(Self(directory))
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut paths) = SIGNING_IN.lock() {
            paths.remove(&self.0);
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk {
    sequence: u64,
    data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInView {
    state: String,
    exit_code: Option<u32>,
    chunks: Vec<OutputChunk>,
    truncated: bool,
}

struct Session {
    terminal: Option<crate::state::PtySession>,
    tree: Option<ProcessTree>,
    lease: Option<Lease>,
    state: &'static str,
    exit_code: Option<u32>,
    output: VecDeque<OutputChunk>,
    bytes: usize,
    sequence: u64,
    started: Instant,
    touched: Instant,
}
impl Session {
    fn append(&mut self, data: String) {
        self.sequence += 1;
        self.bytes += data.len();
        self.output.push_back(OutputChunk {
            sequence: self.sequence,
            data,
        });
        while self.bytes > OUTPUT_LIMIT {
            if let Some(chunk) = self.output.pop_front() {
                self.bytes -= chunk.data.len();
            }
        }
    }
    fn stop(&mut self, state: &'static str) {
        if let Some(tree) = self.tree.take() {
            tree.terminate();
        }
        if let Some(mut terminal) = self.terminal.take() {
            let _ = terminal.child.kill();
            let _ = terminal.child.wait();
        }
        self.lease.take();
        self.state = state;
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.stop("cancelled");
    }
}

#[derive(Default)]
pub struct SignInService(Mutex<HashMap<String, Arc<Mutex<Session>>>>);
impl SignInService {
    fn session(&self, id: &str) -> Result<Arc<Mutex<Session>>, String> {
        self.0
            .lock()
            .map_err(|_| "Sign-in state unavailable")?
            .get(id)
            .cloned()
            .ok_or_else(|| "This sign-in session ended. Start sign-in again.".into())
    }
    pub fn stop_all(&self) {
        if let Ok(mut sessions) = self.0.lock() {
            for session in sessions.drain().map(|(_, session)| session) {
                if let Ok(mut session) = session.lock() {
                    session.stop("cancelled");
                }
            }
        }
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(20, 240),
        rows: rows.clamp(6, 100),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn login_command(binding: &AccountBinding, executable: &std::path::Path) -> CommandBuilder {
    let mut command = CommandBuilder::new(executable);
    command.args(agent_profiles::login_args(&binding.adapter));
    command.cwd(&binding.directory);
    command.env("TERM", "xterm-256color");
    // Use the same environment overrides as task execution, including removals.
    let mut environment = std::process::Command::new(executable);
    agent_profiles::apply_binding(&mut environment, binding);
    for (name, value) in environment.get_envs() {
        if let Some(value) = value {
            command.env(name, value);
        } else {
            command.env_remove(name);
        }
    }
    command
}

fn spawn_session(
    binding: AccountBinding,
    executable: PathBuf,
    cols: u16,
    rows: u16,
) -> Result<Arc<Mutex<Session>>, String> {
    let lease = Lease::acquire(binding.directory.clone())?;
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|_| "Could not open the sign-in terminal.")?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|_| "Could not read the sign-in terminal.")?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|_| "Could not write to the sign-in terminal.")?;
    let mut child = pair
        .slave
        .spawn_command(login_command(&binding, &executable))
        .map_err(|_| "Could not start sign-in. Check this agent's installation and try again.")?;
    drop(pair.slave);
    let tree = match child
        .process_id()
        .ok_or("Sign-in process has no identity".into())
        .and_then(ProcessTree::attach_pid)
    {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let session = Arc::new(Mutex::new(Session {
        terminal: Some(crate::state::PtySession {
            writer,
            master: pair.master,
            child,
        }),
        tree: Some(tree),
        lease: Some(lease),
        state: "running",
        exit_code: None,
        output: VecDeque::new(),
        bytes: 0,
        sequence: 0,
        started: Instant::now(),
        touched: Instant::now(),
    }));
    let output = Arc::downgrade(&session);
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0; 4096];
        let mut pending = Vec::new();
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            pending.extend_from_slice(&buffer[..count]);
            let (data, carry) = super::pty::split_valid_utf8_prefix(&pending);
            pending = carry;
            let Some(session) = output.upgrade() else {
                break;
            };
            let Ok(mut session) = session.lock() else {
                break;
            };
            if !data.is_empty() {
                session.append(data);
            }
        }
    });
    let monitor = Arc::downgrade(&session);
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(100));
        let Some(session) = monitor.upgrade() else {
            break;
        };
        let Ok(mut session) = session.lock() else {
            break;
        };
        if session.state != "running" {
            break;
        }
        match session.terminal.as_mut().unwrap().child.try_wait() {
            Ok(Some(status)) => {
                session.exit_code = Some(status.exit_code());
                session.stop("exited");
                break;
            }
            Err(_) => {
                session.stop("failed");
                break;
            }
            Ok(None) => {}
        }
        if session.started.elapsed() >= SESSION_LIMIT
            || session.touched.elapsed() >= Duration::from_secs(30)
        {
            session.stop("timedOut");
            break;
        }
    });
    Ok(session)
}

#[tauri::command]
pub fn agent_profile_sign_in(
    runtime: State<'_, super::tasks::TaskRuntime>,
    service: State<'_, SignInService>,
    agent: String,
    id: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    runtime.access.ensure()?;
    let _guard = super::integration::execution_guard()?;
    let binding = agent_profiles::bind_account(&runtime.profiles_root(), &agent, Some(&id))?;
    if runtime.integration_runs()?.iter().any(|run| {
        ["starting", "running", "stopping"].contains(&run.status.as_str())
            && run
                .account_binding
                .as_ref()
                .is_some_and(|b| b.directory == binding.directory)
    }) {
        return Err("Stop tasks using this account before signing in again.".into());
    }
    let executable = super::tasks::executable(&agent)?;
    std::fs::create_dir_all(&binding.directory)
        .map_err(|_| "Could not prepare this account's sign-in folder.")?;
    let mut sessions = service.0.lock().map_err(|_| "Sign-in state unavailable")?;
    sessions.retain(|_, session| {
        session
            .lock()
            .is_ok_and(|s| s.touched.elapsed() < SESSION_LIMIT)
    });
    if sessions.len() >= 4 {
        return Err("Close another sign-in panel before opening a new one.".into());
    }
    let session = spawn_session(binding, executable, cols.unwrap_or(80), rows.unwrap_or(16))?;
    let session_id = uuid::Uuid::new_v4().to_string();
    sessions.insert(session_id.clone(), session);
    Ok(session_id)
}

#[tauri::command]
pub fn agent_profile_sign_in_poll(
    service: State<'_, SignInService>,
    session_id: String,
    after: u64,
) -> Result<SignInView, String> {
    let session = service.session(&session_id)?;
    let mut session = session.lock().map_err(|_| "Sign-in state unavailable")?;
    session.touched = Instant::now();
    Ok(SignInView {
        state: session.state.into(),
        exit_code: session.exit_code,
        chunks: session
            .output
            .iter()
            .filter(|chunk| chunk.sequence > after)
            .cloned()
            .collect(),
        truncated: session
            .output
            .front()
            .is_some_and(|chunk| chunk.sequence > after.saturating_add(1)),
    })
}

#[tauri::command]
pub fn agent_profile_sign_in_input(
    service: State<'_, SignInService>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    if data.len() > 16_384 {
        return Err("Paste less than 16 KB at a time.".into());
    }
    let session = service.session(&session_id)?;
    let mut session = session.lock().map_err(|_| "Sign-in state unavailable")?;
    session
        .terminal
        .as_mut()
        .ok_or("Sign-in has ended.")?
        .writer
        .write_all(data.as_bytes())
        .map_err(|_| "Could not send input. Retry sign-in.".into())
}

#[tauri::command]
pub fn agent_profile_sign_in_resize(
    service: State<'_, SignInService>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = service.session(&session_id)?;
    let session = session.lock().map_err(|_| "Sign-in state unavailable")?;
    if let Some(terminal) = &session.terminal {
        terminal
            .master
            .resize(size(cols, rows))
            .map_err(|_| "Could not resize sign-in.".to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn agent_profile_sign_in_stop(
    service: State<'_, SignInService>,
    session_id: String,
) -> Result<(), String> {
    let session = service
        .0
        .lock()
        .map_err(|_| "Sign-in state unavailable")?
        .remove(&session_id);
    if let Some(session) = session {
        session
            .lock()
            .map_err(|_| "Sign-in state unavailable")?
            .stop("cancelled");
    }
    Ok(())
}
