use super::agent_process::AgentProcess;
use super::opencode::{valid_id, Endpoint, HELPER_STARTUP};
use super::*;
use crate::commands::agent_profiles;
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
    account_revisions: Mutex<HashMap<PathBuf, u64>>,
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
    account: PathBuf,
    key: [u8; 32],
    server: Mutex<Option<Server>>,
    busy: AtomicBool,
    used: Mutex<std::time::Instant>,
}

struct Server {
    process: Arc<AgentProcess>,
    endpoint: Endpoint,
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
        let endpoint = {
            let guard = self.entry.server.lock().unwrap();
            let server = guard.as_ref().ok_or("The helper server stopped.")?;
            server.endpoint.clone()
        };
        let messages = api(
            &endpoint,
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
    fn account_revision(&self, directory: &Path) -> u64 {
        self.account_revisions
            .lock()
            .unwrap()
            .get(directory)
            .copied()
            .unwrap_or(0)
    }

    pub fn invalidate_account(&self, directory: &Path) {
        let mut revisions = self.account_revisions.lock().unwrap();
        *revisions.entry(directory.to_owned()).or_default() += 1;
        drop(revisions);
        self.entries.lock().unwrap().retain(|entry| {
            if entry.account != directory {
                return true;
            }
            entry.server.lock().unwrap().take();
            false
        });
    }

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
        let revision = self.account_revision(&binding.directory);
        let interrupted = || {
            canceled()
                || self.generation.load(Ordering::SeqCst) != generation
                || self.account_revision(&binding.directory) != revision
        };
        if binding.profile_id.is_some()
            && crate::commands::experiments::is(
                crate::commands::experiments::Experiment::WarmApiHelpers,
                "on",
            )
        {
            agent_profiles::apply_binding(cmd, binding)?;
        }
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
        let local = agent_profiles::local_model(binding)
            .ok()
            .flatten()
            .is_some();
        if canceled() || (!local && !configure_api_helper(cmd, binding)) {
            return None;
        }
        let configuration = binding.directory.join("helper-config");
        std::fs::create_dir_all(&configuration).ok()?;
        cmd.env("XDG_CONFIG_HOME", configuration).args(["--pure"]);
        if crate::commands::experiments::is(
            crate::commands::experiments::Experiment::WarmOpencode,
            "off",
        ) {
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
                account: binding.directory.clone(),
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
        if interrupted() || server.process.try_wait().ok()?.is_some() {
            return None;
        }
        let endpoint = server.endpoint.clone();
        drop(guard);
        let session = api(&endpoint, reqwest::Method::POST, "/session", Some(serde_json::json!({"title":"Jackalope helper","permission":[{"permission":"*","pattern":"*","action":"deny"}]})), &interrupted).ok()?;
        lease.session = session["id"]
            .as_str()
            .and_then(|id| valid_id(id).ok())?
            .to_owned();
        cmd.args(["--attach", &endpoint.url, "--session", &lease.session]);
        if let Some(directory) = cmd.get_current_dir().map(Path::to_path_buf) {
            cmd.arg("--dir").arg(directory);
        }
        endpoint.authorize(cmd);
        Some(lease)
    }
}

fn configure_api_helper(cmd: &mut Command, binding: &agent_profiles::AccountBinding) -> bool {
    if !crate::commands::experiments::is(
        crate::commands::experiments::Experiment::WarmApiHelpers,
        "on",
    ) {
        return false;
    }
    let Some(provider) = agent_profiles::api_provider(binding).ok().flatten() else {
        return false;
    };
    let configuration = cmd
        .get_envs()
        .find(|(key, _)| *key == "OPENCODE_CONFIG_CONTENT")
        .and_then(|(_, value)| value)
        .and_then(|value| value.to_str())
        .and_then(|value| serde_json::from_str::<Value>(value).ok());
    let Some(configuration) = configuration else {
        return false;
    };
    if configuration["permission"] != "deny"
        || configuration["mcp"]
            .as_object()
            .is_some_and(|mcp| !mcp.is_empty())
    {
        return false;
    }
    let args: Vec<_> = cmd
        .get_args()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();
    let Some(model) = args
        .windows(2)
        .find(|pair| pair[0] == "--model")
        .map(|pair| pair[1].clone())
    else {
        return false;
    };
    if !model.starts_with(&format!("{provider}/")) {
        return false;
    }
    cmd.env("OPENCODE_CONFIG_CONTENT", serde_json::json!({
        "enabled_providers":[provider],"model":model,"small_model":model,"share":"disabled",
        "permission":"deny","agent":{"build":{"permission":"deny","tools":{"*":false}}},"mcp":{},"plugin":[]
    }).to_string())
        .env("OPENCODE_DISABLE_PROJECT_CONFIG", "true")
        .env_remove("OPENCODE_CONFIG").env_remove("OPENCODE_CONFIG_DIR")
        .env_remove("JACKALOPE_BRIDGE_TOKEN");
    true
}

fn api(
    endpoint: &Endpoint,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    canceled: impl Fn() -> bool,
) -> Result<Value, String> {
    tauri::async_runtime::block_on(async {
        let operation = async {
            let client = crate::commands::http::direct_client(Duration::from_secs(5))?;
            let mut request = endpoint.request(&client, method, endpoint.url(path));
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
            let bytes = crate::commands::http::read_bounded(&mut response, 1_000_000)
                .await
                .map_err(|error| match error {
                    crate::commands::http::BodyError::Interrupted => {
                        "The helper response was interrupted."
                    }
                    crate::commands::http::BodyError::TooLarge => {
                        "The helper response exceeded its limit."
                    }
                })?;
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
    let (listener, endpoint) = Endpoint::reserve()?;
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
    endpoint.serve(&mut cmd, &["--pure"]);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    drop(listener);
    let server = Server {
        process: AgentProcess::spawn(&mut cmd, "opencode")?.process,
        endpoint,
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(300))
        .timeout(HELPER_STARTUP.probe())
        .build()
        .map_err(|e| e.to_string())?;
    let exited = || !matches!(server.process.try_wait(), Ok(None));
    if tauri::async_runtime::block_on(server.endpoint.wait_ready(
        &client,
        None,
        &HELPER_STARTUP,
        || canceled() || exited(),
    )) {
        return Ok(server);
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
