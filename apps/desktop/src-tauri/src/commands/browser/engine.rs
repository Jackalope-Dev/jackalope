use super::{check_canceled, Slot};
use crate::commands::process_control::ProcessTree;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

static RESOURCES: OnceLock<PathBuf> = OnceLock::new();
const RESPONSE_LIMIT: usize = 2_000_000;
pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

pub fn set_resource_directory(path: PathBuf) {
    let _ = RESOURCES.set(path);
}

fn executable() -> Result<PathBuf, String> {
    let name = if cfg!(windows) {
        "agent-browser.exe"
    } else {
        "agent-browser"
    };
    let relative = PathBuf::from("resources/agent-browser").join(name);
    if let Some(root) = RESOURCES.get() {
        let path = root.join(&relative);
        if path.is_file() {
            return Ok(path);
        }
    }
    #[cfg(debug_assertions)]
    {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("The bundled browser tool is missing. Reinstall Jackalope.".into())
}

pub struct Engine {
    pub directory: PathBuf,
    pub media: std::sync::Mutex<(String, bool)>,
    child: Child,
    tree: Arc<ProcessTree>,
    canceled: Arc<std::sync::atomic::AtomicBool>,
}

impl Engine {
    pub fn start(slot: Arc<Slot>) -> Result<Self, String> {
        check_canceled(&slot.canceled)?;
        let browser = crate::commands::harness::find_browser_executable()
            .ok_or("Install Edge or Chrome to use browser verification.")?;
        let directory = std::env::temp_dir().join(format!("jl-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        let result = Self::spawn(slot, directory.clone(), browser);
        if result.is_err() {
            let _ = std::fs::remove_dir_all(directory);
        }
        result
    }

    fn spawn(slot: Arc<Slot>, directory: PathBuf, browser: PathBuf) -> Result<Self, String> {
        let mut command = Command::new(executable()?);
        command
            .env_clear()
            .current_dir(&directory)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for key in [
            "SystemRoot",
            "WINDIR",
            "PATH",
            "PATHEXT",
            "COMSPEC",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "LOCALAPPDATA",
            "APPDATA",
            "USERPROFILE",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XDG_RUNTIME_DIR",
            "LANG",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command
            .env("HOME", &directory)
            .env("TMP", &directory)
            .env("TEMP", &directory)
            .env("TMPDIR", &directory)
            .env("AGENT_BROWSER_DAEMON", "1")
            .env("AGENT_BROWSER_SESSION", "task")
            .env("AGENT_BROWSER_SOCKET_DIR", &directory)
            .env("AGENT_BROWSER_DEFAULT_TIMEOUT", "15000")
            .env("AGENT_BROWSER_IDLE_TIMEOUT_MS", "0");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Could not start browser tool: {e}"))?;
        let tree = match ProcessTree::attach(&child) {
            Ok(tree) => Arc::new(tree),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        // Publish containment before launch so Stop can interrupt startup or a blocked browser call.
        *slot.tree.lock().map_err(|e| e.to_string())? = Some(tree.clone());
        let mut engine = Self {
            media: std::sync::Mutex::new(("no-preference".into(), false)),
            directory,
            child,
            tree,
            canceled: slot.canceled.clone(),
        };
        let start = Instant::now();
        loop {
            check_canceled(&engine.canceled)?;
            if engine
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                return Err("The browser tool exited during startup.".into());
            }
            if engine.connect().is_ok() {
                break;
            }
            if start.elapsed() > Duration::from_secs(10) {
                return Err("The browser tool did not become ready.".into());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        engine.call(json!({"action":"stream_disable"}))?;
        engine.call(
            json!({"action":"launch", "headless":true, "executablePath":browser,
            "webmcp":false, "hideScrollbars":false}),
        )?;
        engine.call(json!({"action":"viewport", "width":1280, "height":800}))?;
        Ok(engine)
    }

    #[cfg(windows)]
    fn connect(&self) -> Result<std::net::TcpStream, String> {
        let port: u16 = std::fs::read_to_string(self.directory.join("task.port"))
            .map_err(|e| e.to_string())?
            .trim()
            .parse()
            .map_err(|_| "Invalid browser port")?;
        let stream = std::net::TcpStream::connect_timeout(
            &([127, 0, 0, 1], port).into(),
            Duration::from_millis(200),
        )
        .map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        Ok(stream)
    }

    #[cfg(unix)]
    fn connect(&self) -> Result<std::os::unix::net::UnixStream, String> {
        let stream = std::os::unix::net::UnixStream::connect(self.directory.join("task.sock"))
            .map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        Ok(stream)
    }

    pub fn call(&self, mut request: Value) -> Result<Value, String> {
        check_canceled(&self.canceled)?;
        let id = uuid::Uuid::new_v4().to_string();
        request["id"] = json!(id);
        let mut stream = self.connect()?;
        let mut payload = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        payload.push(b'\n');
        stream.write_all(&payload).map_err(|e| e.to_string())?;
        let start = Instant::now();
        let mut output = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            check_canceled(&self.canceled)?;
            if start.elapsed() > COMMAND_TIMEOUT {
                self.tree.terminate();
                return Err("The browser stopped responding and was closed. Continue the task to retry with a fresh browser.".into());
            }
            match stream.read(&mut buffer) {
                Ok(0) => return Err("The task browser closed unexpectedly. Continue the task to start a fresh browser.".into()),
                Ok(count) => {
                    output.extend_from_slice(&buffer[..count]);
                    if output.len() > RESPONSE_LIMIT { return Err("Browser output is too large. Scope the snapshot to a CSS selector.".into()); }
                    if let Some(end) = output.iter().position(|b| *b == b'\n') {
                        let response: Value = serde_json::from_slice(&output[..end]).map_err(|_| "Invalid browser response")?;
                        if response["id"].as_str() != Some(&id) { return Err("Mismatched browser response".into()); }
                        if response["success"] != true {
                            let error: String = response["error"].as_str().unwrap_or("Browser action failed").chars().take(2000).collect();
                            return Err(error);
                        }
                        let mut data = response["data"].clone();
                        if let Some(object) = data.as_object_mut() { object.remove("lifecycle"); }
                        return Ok(data);
                    }
                }
                Err(error) if matches!(error.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => {}
                Err(error) => return Err(format!("Browser connection failed: {error}")),
            }
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
        for _ in 0..20 {
            if !self.directory.exists() || std::fs::remove_dir_all(&self.directory).is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
