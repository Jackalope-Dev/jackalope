use super::*;
use crate::commands::{agent_profiles, process_control::ProcessTree};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

const IDLE: Duration = Duration::from_secs(120);
const MAX_SERVERS: usize = 2;

#[derive(Default)]
pub(super) struct Pool {
    entries: Arc<Mutex<Vec<Arc<Entry>>>>,
    reaper: std::sync::OnceLock<Reaper>,
    unavailable: Mutex<HashMap<[u8; 32], std::time::Instant>>,
    generation: AtomicU64,
}

struct Reaper {
    stop: Option<std::sync::mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Reaper {
    fn drop(&mut self) {
        self.stop.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Entry {
    key: [u8; 32],
    server: Mutex<Option<Server>>,
    busy: AtomicBool,
    used: Mutex<std::time::Instant>,
}

struct Server {
    child: std::process::Child,
    tree: ProcessTree,
    url: String,
    password: String,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(super) struct Lease {
    entry: Arc<Entry>,
    pub reused: bool,
    successful: bool,
    session: String,
}

impl Lease {
    pub fn complete(&mut self) {
        self.successful = true;
    }

    pub fn output(&self, canceled: impl Fn() -> bool) -> Result<String, String> {
        let (url, password) = {
            let guard = self.entry.server.lock().unwrap();
            let server = guard.as_ref().ok_or("The helper server stopped.")?;
            (server.url.clone(), server.password.clone())
        };
        let messages = api(
            &url,
            &password,
            reqwest::Method::GET,
            &format!("/session/{}/message", self.session),
            None,
            canceled,
        )?;
        output_events(&messages, &self.session)
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        if !self.successful {
            self.entry.server.lock().unwrap().take();
        }
        *self.entry.used.lock().unwrap() = std::time::Instant::now();
        self.entry.busy.store(false, Ordering::SeqCst);
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        self.clear();
    }
}

fn identity(cmd: &Command) -> [u8; 32] {
    let mut hash = Sha256::new();
    let mut values: std::collections::BTreeMap<_, _> = std::env::vars_os().collect();
    for (name, value) in cmd.get_envs() {
        if let Some(value) = value {
            values.insert(name.to_owned(), value.to_owned());
        } else {
            values.remove(name);
        }
    }
    let mut add = |value: &std::ffi::OsStr| {
        let bytes = value.as_encoded_bytes();
        hash.update(bytes.len().to_le_bytes());
        hash.update(bytes);
    };
    add(cmd.get_program());
    if let Some(path) = cmd.get_current_dir() {
        add(path.as_os_str());
    }
    for (key, value) in values {
        add(&key);
        add(&value);
    }
    hash.finalize().into()
}

impl Pool {
    pub fn clear(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        for entry in self.entries.lock().unwrap().drain(..) {
            entry.server.lock().unwrap().take();
        }
    }

    pub fn attach(
        &self,
        cmd: &mut Command,
        binding: &agent_profiles::AccountBinding,
        canceled: impl Fn() -> bool,
    ) -> Result<Option<Lease>, String> {
        let generation = self.generation.load(Ordering::SeqCst);
        let interrupted = || canceled() || self.generation.load(Ordering::SeqCst) != generation;
        let lease = self.try_attach(cmd, binding, &interrupted);
        if interrupted() {
            return Err("The helper request was stopped.".into());
        }
        Ok(lease)
    }

    fn try_attach(
        &self,
        cmd: &mut Command,
        binding: &agent_profiles::AccountBinding,
        canceled: impl Fn() -> bool,
    ) -> Option<Lease> {
        // Only managed local helpers have a complete, credential-free provider configuration.
        // Worker MCP tokens and arbitrary account/plugin configuration must never be pooled.
        if agent_profiles::local_model(binding)
            .ok()
            .flatten()
            .is_none()
            || canceled()
        {
            return None;
        }
        let configuration = binding.directory.join("helper-config");
        std::fs::create_dir_all(&configuration).ok()?;
        cmd.env("XDG_CONFIG_HOME", configuration).args(["--pure"]);
        if std::env::var("JACKALOPE_WARM_OPENCODE").is_ok_and(|value| value == "off") {
            return None;
        }
        self.reaper.get_or_init(|| {
            let (stop, receiver) = std::sync::mpsc::channel();
            let entries = self.entries.clone();
            let thread = std::thread::spawn(move || {
                while receiver
                    .recv_timeout(Duration::from_secs(1))
                    .is_err_and(|error| error == std::sync::mpsc::RecvTimeoutError::Timeout)
                {
                    entries.lock().unwrap().retain(|entry| {
                        if entry.busy.load(Ordering::SeqCst) {
                            return true;
                        }
                        let expired = entry.used.lock().unwrap().elapsed() >= IDLE;
                        if expired {
                            entry.server.lock().unwrap().take();
                        }
                        !expired && entry.server.lock().unwrap().is_some()
                    });
                }
            });
            Reaper {
                stop: Some(stop),
                thread: Some(thread),
            }
        });
        let generation = self.generation.load(Ordering::SeqCst);
        let interrupted = || canceled() || self.generation.load(Ordering::SeqCst) != generation;
        let key = identity(cmd);
        if self
            .unavailable
            .lock()
            .unwrap()
            .get(&key)
            .is_some_and(|at| at.elapsed() < Duration::from_secs(600))
        {
            return None;
        }
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|entry| {
            entry.busy.load(Ordering::SeqCst) || entry.server.lock().unwrap().is_some()
        });
        let (entry, reused) = if let Some(entry) = entries
            .iter()
            .find(|entry| entry.key == key && !entry.busy.load(Ordering::SeqCst))
        {
            entry.busy.store(true, Ordering::SeqCst);
            (entry.clone(), true)
        } else {
            if entries.len() >= MAX_SERVERS {
                return None;
            }
            let entry = Arc::new(Entry {
                key,
                server: Mutex::new(None),
                busy: AtomicBool::new(true),
                used: Mutex::new(std::time::Instant::now()),
            });
            entries.push(entry.clone());
            (entry, false)
        };
        drop(entries);
        let mut lease = Lease {
            entry: entry.clone(),
            reused,
            successful: false,
            session: String::new(),
        };
        if !reused {
            let server = match start(cmd, &interrupted) {
                Ok(server) => server,
                Err(_) => {
                    if !interrupted() {
                        let mut unavailable = self.unavailable.lock().unwrap();
                        if unavailable.len() >= 64 {
                            unavailable.clear();
                        }
                        unavailable.insert(key, std::time::Instant::now());
                    }
                    return None;
                }
            };
            *entry.server.lock().unwrap() = Some(server);
        }
        let mut guard = entry.server.lock().unwrap();
        let server = guard.as_mut()?;
        if interrupted() || server.child.try_wait().ok()?.is_some() {
            return None;
        }
        let url = server.url.clone();
        let password = server.password.clone();
        drop(guard);
        let session = api(&url, &password, reqwest::Method::POST, "/session", Some(serde_json::json!({"title":"Jackalope helper","permission":[{"permission":"*","pattern":"*","action":"deny"}]})), &interrupted).ok()?;
        lease.session = session["id"]
            .as_str()
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            })?
            .to_owned();
        cmd.args(["--attach", &url, "--session", &lease.session]);
        if let Some(directory) = cmd.get_current_dir().map(Path::to_path_buf) {
            cmd.arg("--dir").arg(directory);
        }
        cmd.env("OPENCODE_SERVER_PASSWORD", &password)
            .env("OPENCODE_SERVER_USERNAME", "jackalope");
        Some(lease)
    }
}

fn api(
    url: &str,
    password: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    canceled: impl Fn() -> bool,
) -> Result<Value, String> {
    tauri::async_runtime::block_on(async {
        let operation = async {
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(5))
                .build()
                .map_err(|e| e.to_string())?;
            let mut request = client
                .request(method, format!("{url}{path}"))
                .basic_auth("jackalope", Some(password));
            if let Some(body) = body {
                request = request.json(&body);
            }
            let mut response = request
                .send()
                .await
                .map_err(|_| "The helper server did not respond.")?;
            if !response.status().is_success() {
                return Err("The helper server rejected the request.".into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "The helper response was interrupted.")?
            {
                if bytes.len() + chunk.len() > 1_000_000 {
                    return Err("The helper response exceeded its limit.".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            serde_json::from_slice(&bytes).map_err(|_| "The helper response was invalid.".into())
        };
        let interrupted = async {
            while !canceled() {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        };
        tokio::select! { result = operation => result, _ = interrupted => Err("The helper request was stopped.".into()) }
    })
}

fn output_events(messages: &Value, session: &str) -> Result<String, String> {
    let messages = messages.as_array().ok_or("Invalid helper messages.")?;
    let mut events = Vec::new();
    for message in messages {
        let info = &message["info"];
        if info["role"] != "assistant" {
            continue;
        }
        if info["sessionID"] != session {
            return Err("The helper returned a different session.".into());
        }
        if info["time"]["completed"].as_u64().is_none() && info["error"].is_null() {
            return Err("The helper did not finish its response.".into());
        }
        events.push(serde_json::json!({"type":"step_start","sessionID":session}));
        if !info["error"].is_null() {
            events.push(
                serde_json::json!({"type":"error","sessionID":session,"error":info["error"]}),
            );
        }
        for part in message["parts"]
            .as_array()
            .ok_or("Invalid helper message parts.")?
        {
            if part["type"] == "text" {
                events.push(serde_json::json!({"type":"text","sessionID":session,"part":part}));
            }
            if part["type"] == "tool" {
                events.push(serde_json::json!({"type":"error","sessionID":session,"error":{"message":"A tool was requested by a helper with tools disabled."}}));
            }
        }
        if info["error"].is_null()
            || info["tokens"]["input"]
                .as_u64()
                .is_some_and(|count| count > 0)
            || info["tokens"]["output"]
                .as_u64()
                .is_some_and(|count| count > 0)
        {
            events.push(serde_json::json!({"type":"step_finish","sessionID":session,"part":{"id":info["id"],"tokens":info["tokens"],"cost":info["cost"]}}));
        }
    }
    if events.is_empty() {
        return Err("The helper returned no assistant response.".into());
    }
    Ok(events
        .into_iter()
        .map(|event| event.to_string())
        .collect::<Vec<_>>()
        .join("\n"))
}

fn start(source: &Command, canceled: &impl Fn() -> bool) -> Result<Server, String> {
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let password = uuid::Uuid::new_v4().to_string();
    let mut cmd = command(source.get_program());
    for (name, value) in source.get_envs() {
        if let Some(value) = value {
            cmd.env(name, value);
        } else {
            cmd.env_remove(name);
        }
    }
    if let Some(directory) = source.get_current_dir() {
        cmd.current_dir(directory);
    }
    cmd.args([
        "serve",
        "--pure",
        "--hostname",
        "127.0.0.1",
        "--port",
        &port.to_string(),
    ])
    .env("OPENCODE_SERVER_PASSWORD", &password)
    .env("OPENCODE_SERVER_USERNAME", "jackalope")
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    drop(listener);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut server = Server {
        child,
        tree,
        url: format!("http://127.0.0.1:{port}"),
        password,
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(300))
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(8) && !canceled() {
        if server
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            break;
        }
        let ready = tauri::async_runtime::block_on(async {
            let response = client
                .get(format!("{}/global/health", server.url))
                .basic_auth("jackalope", Some(&server.password))
                .send()
                .await
                .ok()?;
            if !response.status().is_success() {
                return None;
            }
            let mut response = response;
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.ok()? {
                if bytes.len() + chunk.len() > 4096 {
                    return None;
                }
                bytes.extend_from_slice(&chunk);
            }
            serde_json::from_slice::<Value>(&bytes)
                .ok()
                .map(|value| value["healthy"] == true)
        });
        if ready == Some(true) {
            return Ok(server);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err("The local OpenCode helper server was not ready.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_helper_output_is_session_bound_complete_and_keeps_usage() {
        let mut messages = serde_json::json!([{"info":{"id":"msg","role":"assistant","sessionID":"session","time":{"completed":1},"tokens":{"input":10,"output":5,"cache":{"read":4,"write":2}},"cost":0},"parts":[{"type":"text","text":"answer"}]}]);
        let events = output_events(&messages, "session").unwrap();
        let mut run = TaskRun::default();
        for event in events.lines() {
            consume_adapter_event(&mut run, event, "opencode");
        }
        assert_eq!(run.result, "answer");
        assert_eq!((run.usage.input, run.usage.output), (16, 5));
        assert!(run.usage.reported);
        assert!(output_events(&messages, "different").is_err());
        messages[0]["info"]["time"] = Value::Null;
        assert!(output_events(&messages, "session").is_err());
        messages[0]["info"]["error"] = serde_json::json!({"message":"failed"});
        messages[0]["info"]["tokens"] = serde_json::json!({"input":0,"output":0});
        let events = output_events(&messages, "session").unwrap();
        let mut run = TaskRun::default();
        for event in events.lines() {
            consume_adapter_event(&mut run, event, "opencode");
        }
        assert_eq!(run.error.as_deref(), Some("failed"));
        assert!(!run.usage.reported);
    }
    #[test]
    fn identity_separates_accounts_directories_and_configuration() {
        let mut a = command("fixture");
        a.current_dir("one").env("XDG_DATA_HOME", "account-a");
        let first = identity(&a);
        a.env("XDG_DATA_HOME", "account-b");
        assert_ne!(first, identity(&a));
        a.env("XDG_DATA_HOME", "account-a")
            .env("OPENCODE_CONFIG_CONTENT", "changed");
        assert_ne!(first, identity(&a));
        let mut b = command("fixture");
        b.current_dir("two").env("XDG_DATA_HOME", "account-a");
        assert_ne!(first, identity(&b));
    }
}

#[cfg(test)]
#[path = "warm_opencode_tests.rs"]
mod protocol_tests;
