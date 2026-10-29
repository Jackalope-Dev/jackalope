//! The `remote-machine` provider: a machine the person runs anywhere (a cloud
//! VM, a home server) that serves the bot computer agent over HTTPS behind
//! their own proxy, authenticated with a pairing secret. Jackalope never
//! creates, starts or deletes the machine itself; deleting the computer only
//! forgets the pairing. The secret is kept in protected storage.

use super::{Computer, MachineState, Provider, Transport};
use crate::commands::account_storage;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Mutex, OnceLock},
    time::Duration,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub id: String,
    pub name: String,
    /// Base address of the agent, such as https://computer.example.com.
    pub url: String,
    /// Optional noVNC page the operator publishes for watching the machine.
    #[serde(default)]
    pub viewer_url: Option<String>,
    pub created_at: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Machines {
    #[serde(default)]
    machines: Vec<Machine>,
}

#[derive(Serialize, Deserialize)]
struct MachineSecret {
    token: String,
}

fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn path(root: &Path) -> PathBuf {
    root.join("machines.json")
}

fn secret_path(root: &Path, id: &str) -> PathBuf {
    root.join("machines").join(format!("{id}.bin"))
}

fn read(root: &Path) -> Result<Machines, String> {
    let path = path(root);
    if !path.exists() {
        return Ok(Machines::default());
    }
    let bytes = crate::commands::history::read_bounded(&path, 1_000_000)?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "Saved cloud machines could not be read. The file was left unchanged.".into())
}

fn write(root: &Path, machines: &Machines) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(machines).map_err(|e| e.to_string())?;
    crate::commands::history::write_atomic(&path(root), &bytes)
}

pub(crate) fn machines(root: &Path) -> Result<Vec<Machine>, String> {
    let _guard = lock().lock().map_err(|e| e.to_string())?;
    Ok(read(root)?.machines)
}

pub(crate) fn machine(root: &Path, id: &str) -> Result<Machine, String> {
    machines(root)?
        .into_iter()
        .find(|machine| machine.id == id)
        .ok_or_else(|| {
            "That cloud machine is no longer paired. Pair it again in Settings → Computers.".into()
        })
}

/// Normalizes the agent address: HTTPS, or HTTP only to this device (for an
/// SSH tunnel). No credentials, query or fragment.
pub(crate) fn normalize_url(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|_| "Enter the machine's address, such as https://computer.example.com.")?;
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && local) {
        return Err(
            "Use an https:// address. Plain http is accepted only for 127.0.0.1 tunnels.".into(),
        );
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.host_str().is_none()
    {
        return Err("Enter only the address, without a user name, query or fragment.".into());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

pub(crate) fn validate_secret(secret: &str) -> Result<(), String> {
    let secret = secret.trim();
    if secret.chars().count() < 32 || secret.len() > 512 || secret.chars().any(char::is_whitespace)
    {
        return Err("The pairing secret is the 32 or more character JACKALOPE_COMPUTER_TOKEN set on the machine.".into());
    }
    Ok(())
}

pub(crate) fn token(root: &Path, id: &str) -> Result<String, String> {
    let bytes = account_storage::read(&secret_path(root, id))?
        .ok_or("This machine's pairing secret is missing. Pair it again.")?;
    serde_json::from_slice::<MachineSecret>(&bytes)
        .map(|secret| secret.token)
        .map_err(|_| "This machine's pairing secret could not be read. Pair it again.".into())
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

/// Health of a paired machine, as Settings → Computers shows it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineHealth {
    pub reachable: bool,
    pub screen: Option<[u32; 2]>,
    pub message: Option<String>,
}

async fn hello(url: &str, token: &str) -> Result<Value, String> {
    let response = client(Duration::from_secs(15))?
        .get(format!("{url}/v1/health"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("The machine did not answer: {}", e.without_url()))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("The machine refused the pairing secret.".into());
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| "The address answered, but not as a Jackalope computer.".to_string())?;
    if !status.is_success() || body["ok"] != true || body["result"]["protocol"] != 1 {
        return Err("The address answered, but not as a Jackalope computer.".into());
    }
    Ok(body["result"].clone())
}

pub(crate) async fn health(url: &str, token: &str) -> MachineHealth {
    match hello(url, token).await {
        Ok(result) => MachineHealth {
            reachable: true,
            screen: serde_json::from_value(result["screen"].clone()).ok(),
            message: None,
        },
        Err(message) => MachineHealth {
            reachable: false,
            screen: None,
            message: Some(message),
        },
    }
}

pub(crate) async fn add(
    root: &Path,
    name: &str,
    url: &str,
    secret: &str,
    viewer_url: Option<String>,
) -> Result<Machine, String> {
    let url = normalize_url(url)?;
    validate_secret(secret)?;
    let viewer_url = viewer_url
        .filter(|viewer| !viewer.trim().is_empty())
        .map(|viewer| normalize_url(&viewer))
        .transpose()?;
    hello(&url, secret.trim()).await?;
    let name: String = name.trim().chars().take(80).collect();
    let machine = Machine {
        id: uuid::Uuid::new_v4().simple().to_string(),
        name: if name.is_empty() {
            "Cloud machine".into()
        } else {
            name
        },
        url,
        viewer_url,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    std::fs::create_dir_all(root.join("machines")).map_err(|e| e.to_string())?;
    account_storage::write(
        &secret_path(root, &machine.id),
        &serde_json::to_vec(&MachineSecret {
            token: secret.trim().into(),
        })
        .map_err(|e| e.to_string())?,
    )?;
    let _guard = lock().lock().map_err(|e| e.to_string())?;
    let mut saved = read(root)?;
    saved.machines.push(machine.clone());
    write(root, &saved)?;
    Ok(machine)
}

pub(crate) fn remove(root: &Path, id: &str) -> Result<(), String> {
    if super::list(root)?
        .iter()
        .any(|computer| computer.machine_id.as_deref() == Some(id))
    {
        return Err("A bot uses this machine. Delete that bot's computer first.".into());
    }
    let _guard = lock().lock().map_err(|e| e.to_string())?;
    let mut saved = read(root)?;
    saved.machines.retain(|machine| machine.id != id);
    write(root, &saved)?;
    let _ = account_storage::remove(&secret_path(root, id));
    Ok(())
}

pub(crate) struct RemoteMachine;

fn paired(root: &Path, computer: &Computer) -> Result<(Machine, String), String> {
    let id = computer
        .machine_id
        .as_deref()
        .ok_or("This computer has no paired machine.")?;
    let machine = machine(root, id)?;
    let token = token(root, id)?;
    Ok((machine, token))
}

fn block<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::handle().block_on(future)
}

impl Provider for RemoteMachine {
    fn available(&self, root: &Path, computer: &Computer) -> Result<(), String> {
        paired(root, computer).map(|_| ())
    }

    fn state(&self, root: &Path, computer: &Computer) -> Result<MachineState, String> {
        let (machine, token) = paired(root, computer)?;
        Ok(match block(hello(&machine.url, &token)) {
            Ok(_) => MachineState::Running,
            Err(_) => MachineState::Stopped,
        })
    }

    fn start(
        &self,
        root: &Path,
        computer: &Computer,
        progress: &dyn Fn(&str),
    ) -> Result<(), String> {
        let (machine, token) = paired(root, computer)?;
        progress("Connecting to the machine");
        block(hello(&machine.url, &token))
            .map(|_| ())
            .map_err(|error| {
                format!("{error} Start the machine and its agent where it runs, then try again.")
            })
    }

    fn stop(&self, _: &Path, _: &Computer) -> Result<(), String> {
        Err("Stop a cloud machine where it runs. Jackalope only disconnects from it.".into())
    }

    fn delete(&self, _: &Path, _: &Computer) -> Result<(), String> {
        Ok(())
    }

    fn transport(&self, root: &Path, computer: &Computer) -> Result<Box<dyn Transport>, String> {
        let (machine, token) = paired(root, computer)?;
        Ok(Box::new(Http {
            url: machine.url,
            token,
            next: 0,
        }))
    }

    fn viewer(&self, root: &Path, computer: &Computer, _: bool) -> Result<Option<String>, String> {
        Ok(paired(root, computer)?.0.viewer_url)
    }

    fn devtools(&self, _: &Path, _: &Computer) -> Option<String> {
        None
    }
}

struct Http {
    url: String,
    token: String,
    next: u64,
}

impl Transport for Http {
    fn call(
        &mut self,
        payload: &Value,
        timeout: Duration,
        canceled: &AtomicBool,
    ) -> Result<Value, String> {
        if canceled.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("The computer request was canceled.".into());
        }
        self.next += 1;
        let mut request = payload.clone();
        request["id"] = json!(self.next);
        let url = format!("{}/v1/call", self.url);
        let token = self.token.clone();
        let body: Value = block(async move {
            let response = client(timeout)?
                .post(url)
                .bearer_auth(token)
                .json(&request)
                .send()
                .await
                .map_err(|e| {
                    format!(
                        "The machine did not answer; an action may have occurred, so inspect it before retrying: {}",
                        e.without_url()
                    )
                })?;
            if !response.status().is_success() {
                return Err(format!(
                    "The machine refused the request ({}).",
                    response.status()
                ));
            }
            response
                .json::<Value>()
                .await
                .map_err(|_| "The machine returned an invalid response.".to_string())
        })?;
        if body["ok"] == true {
            Ok(body["result"].clone())
        } else {
            Err(body["error"]
                .as_str()
                .unwrap_or("The computer failed.")
                .chars()
                .take(1200)
                .collect())
        }
    }
}
