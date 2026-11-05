//! The `agent37` provider: computers on the person's own Agent37 account.
//!
//! The person saves one Agent37 API key. Jackalope builds the computer image
//! from `resources/computer` as a template in their workspace (a cloud build,
//! no registry), creates one instance per computer with auto sleep, and talks
//! to the image's agent through the instance's port URL. Agent37 authenticates
//! that URL with `X-Agent37-Key`, which leaves `Authorization` for the agent's
//! own pairing secret. Instances bill to the person's Agent37 balance; deleting
//! the computer deletes its instance.

use super::{remote, Computer, MachineState, Provider, Transport};
use crate::commands::account_storage;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const API: &str = "https://api.agent37.com";
/// The image's agent port (`start.sh`).
const AGENT_PORT: u16 = 8765;
const BUILD_WAIT: Duration = Duration::from_secs(50 * 60);
const BOOT_WAIT: Duration = Duration::from_secs(5 * 60);

pub(crate) struct Agent37;

#[derive(Default, Serialize, Deserialize)]
struct Instances {
    /// Computer id to Agent37 instance id.
    #[serde(default)]
    instances: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct InstanceSecret {
    token: String,
    vnc_password: String,
}

fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn key_path(root: &Path) -> PathBuf {
    root.join("secrets").join("agent37.bin")
}

fn instances_path(root: &Path) -> PathBuf {
    root.join("agent37.json")
}

fn secret_path(root: &Path, computer: &str) -> PathBuf {
    root.join("secrets").join(format!("agent37-{computer}.bin"))
}

pub(crate) fn key(root: &Path) -> Result<String, String> {
    account_storage::read(&key_path(root))?
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .filter(|key| !key.is_empty())
        .ok_or_else(|| "Add your Agent37 API key in Settings → Computers.".into())
}

pub(crate) fn has_key(root: &Path) -> bool {
    key(root).is_ok()
}

pub(crate) fn validate_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if !key.starts_with("sk_live_")
        || key.len() < 16
        || key.len() > 400
        || key.contains(char::is_whitespace)
    {
        return Err("Agent37 API keys start with sk_live_.".into());
    }
    Ok(())
}

/// Saves the key after Agent37 accepts it, or removes it (`None`) when no
/// computer uses it.
pub(crate) fn set_key(root: &Path, value: Option<&str>) -> Result<(), String> {
    match value.map(str::trim) {
        Some(value) => {
            validate_key(value)?;
            remote::block(request(value, reqwest::Method::GET, "/v1/usage", None))
                .map_err(|error| format!("Agent37 did not accept this key: {error}"))?;
            std::fs::create_dir_all(root.join("secrets")).map_err(|e| e.to_string())?;
            account_storage::write(&key_path(root), value.as_bytes())
        }
        None => {
            if super::list(root)?
                .iter()
                .any(|computer| computer.provider == super::AGENT37)
            {
                return Err("Delete your Agent37 computers before removing the key.".into());
            }
            account_storage::remove(&key_path(root))
        }
    }
}

fn read_instances(root: &Path) -> Instances {
    std::fs::read(instances_path(root))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn instance(root: &Path, computer: &Computer) -> Option<String> {
    let _guard = lock().lock().ok()?;
    read_instances(root).instances.get(&computer.id).cloned()
}

fn remember(root: &Path, computer: &Computer, id: Option<&str>) -> Result<(), String> {
    let _guard = lock().lock().map_err(|e| e.to_string())?;
    let mut saved = read_instances(root);
    match id {
        Some(id) => saved.instances.insert(computer.id.clone(), id.into()),
        None => saved.instances.remove(&computer.id),
    };
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    crate::commands::history::write_atomic(
        &instances_path(root),
        &serde_json::to_vec_pretty(&saved).map_err(|e| e.to_string())?,
    )
}

fn secret(root: &Path, computer: &Computer) -> Result<InstanceSecret, String> {
    let path = secret_path(root, &computer.id);
    if let Some(bytes) = account_storage::read(&path)? {
        if let Ok(secret) = serde_json::from_slice(&bytes) {
            return Ok(secret);
        }
    }
    let secret = InstanceSecret {
        token: format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        ),
        vnc_password: uuid::Uuid::new_v4().simple().to_string()[..8].to_string(),
    };
    std::fs::create_dir_all(root.join("secrets")).map_err(|e| e.to_string())?;
    account_storage::write(
        &path,
        &serde_json::to_vec(&secret).map_err(|e| e.to_string())?,
    )?;
    Ok(secret)
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

/// One management API call. `Ok(None)` is a 404.
async fn request(
    key: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Option<Value>, String> {
    let mut call = client(Duration::from_secs(120))?
        .request(method, format!("{API}{path}"))
        .bearer_auth(key);
    if let Some(body) = body {
        call = call.json(&body);
    }
    let response = call
        .send()
        .await
        .map_err(|e| format!("Agent37 did not answer: {}", e.without_url()))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(api_error(status.as_u16(), &body));
    }
    Ok(Some(body))
}

fn api_error(status: u16, body: &Value) -> String {
    let code = body["error"]["code"]
        .as_str()
        .or_else(|| body["code"].as_str())
        .unwrap_or("");
    let message = body["error"]["message"]
        .as_str()
        .or_else(|| body["message"].as_str())
        .unwrap_or("");
    match code {
        "insufficient_balance" => {
            "Your Agent37 balance is too low to start a computer. Top up at agent37.com.".into()
        }
        "instance_limit_reached" => {
            "Your Agent37 account has reached its limit of running computers.".into()
        }
        _ if status == 401 || status == 403 => {
            "Agent37 refused the API key. Save a new one in Settings → Computers.".into()
        }
        _ => {
            let detail: String = if message.is_empty() { code } else { message }
                .chars()
                .take(300)
                .collect();
            format!(
                "Agent37 returned {status}{}",
                if detail.is_empty() {
                    String::new()
                } else {
                    format!(": {detail}")
                }
            )
        }
    }
}

fn call(
    key: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Option<Value>, String> {
    remote::block(request(key, method, path, body))
}

/// The template name for the bundled image definition, so a changed image
/// builds a new template instead of reusing a stale one.
pub(crate) fn template_name(directory: &Path) -> Result<String, String> {
    Ok(super::docker::image_tag(directory)?.replace(':', "-"))
}

/// A gzipped tar of the image's build context.
pub(crate) fn build_context(directory: &Path) -> Result<Vec<u8>, String> {
    let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    let mut builder = tar::Builder::new(encoder);
    for name in super::docker::IMAGE_FILES {
        let bytes = std::fs::read(directory.join(name))
            .map_err(|_| "The bot computer image definition is incomplete. Reinstall Jackalope.")?;
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(if name.ends_with(".sh") { 0o755 } else { 0o644 });
        header.set_entry_type(tar::EntryType::Regular);
        builder
            .append_data(&mut header, name, bytes.as_slice())
            .map_err(|e| e.to_string())?;
    }
    let mut encoder = builder.into_inner().map_err(|e| e.to_string())?;
    encoder.flush().map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())
}

/// Builds the computer template in the person's workspace unless it exists.
fn ensure_template(key: &str, progress: &dyn Fn(&str)) -> Result<String, String> {
    static BUILDING: Mutex<()> = Mutex::new(());
    let _building = BUILDING.lock().map_err(|e| e.to_string())?;
    let directory = super::image_directory()?;
    let name = template_name(&directory)?;
    if call(
        key,
        reqwest::Method::GET,
        &format!("/v1/templates/{name}"),
        None,
    )?
    .is_some()
    {
        return Ok(name);
    }
    progress("Building the computer image on Agent37 (first use takes several minutes)");
    let context = build_context(&directory)?;
    let build = call(
        key,
        reqwest::Method::POST,
        "/v1/template-builds",
        Some(
            json!({"name": name, "size_bytes": context.len(), "default_port": AGENT_PORT,
            "description": "Jackalope bot computer"}),
        ),
    )?
    .ok_or("Agent37 could not start the image build.")?;
    let id = build["id"]
        .as_str()
        .ok_or("Agent37 did not return a build.")?
        .to_string();
    let upload = build["upload_url"]
        .as_str()
        .ok_or("Agent37 did not return an upload address.")?
        .to_string();
    remote::block(async {
        let response = client(Duration::from_secs(300))?
            .put(upload)
            .header("Content-Type", "application/gzip")
            .body(context)
            .send()
            .await
            .map_err(|e| {
                format!(
                    "The image could not be uploaded to Agent37: {}",
                    e.without_url()
                )
            })?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "Agent37 refused the image upload ({}).",
                response.status()
            ))
        }
    })?;
    call(
        key,
        reqwest::Method::POST,
        &format!("/v1/template-builds/{id}/start"),
        Some(json!({})),
    )?;
    let deadline = Instant::now() + BUILD_WAIT;
    loop {
        let state = call(
            key,
            reqwest::Method::GET,
            &format!("/v1/template-builds/{id}"),
            None,
        )?
        .ok_or("The Agent37 image build disappeared.")?;
        match state["status"].as_str().unwrap_or("") {
            "succeeded" => return Ok(name),
            "failed" => {
                let reason = state["error"]["message"]
                    .as_str()
                    .or_else(|| state["error"]["code"].as_str())
                    .unwrap_or("no reason given");
                return Err(format!("The Agent37 image build failed: {reason}"));
            }
            "ingesting" => progress("Publishing the computer image on Agent37"),
            _ => {}
        }
        if Instant::now() >= deadline {
            return Err("The Agent37 image build is taking too long. Try again later.".into());
        }
        std::thread::sleep(Duration::from_secs(5));
    }
}

fn agent_url(instance: &str) -> String {
    format!("https://{instance}-{AGENT_PORT}.agent37.app")
}

/// Seconds without traffic before Agent37 sleeps the instance, from the
/// computer's idle stop (0, never, turns auto sleep off).
pub(crate) fn idle_seconds(minutes: u32) -> Option<u32> {
    (minutes > 0).then(|| (minutes * 60).clamp(300, 86_400))
}

pub(crate) fn create_body(
    computer: &Computer,
    template: &str,
    token: &str,
    vnc_password: &str,
) -> Value {
    let name: String = computer
        .name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .take(40)
        .collect();
    let mut body = json!({
        "template": template,
        "name": format!("jackalope-{}", name.trim_matches('-')),
        "env": {
            "JACKALOPE_COMPUTER_TOKEN": token,
            "JACKALOPE_VNC_PASSWORD": vnc_password,
        },
    });
    match idle_seconds(computer.settings.idle_stop_minutes) {
        Some(seconds) => {
            body["auto_sleep"] = json!(true);
            body["idle_timeout_seconds"] = json!(seconds);
        }
        None => body["auto_sleep"] = json!(false),
    }
    body
}

fn status(key: &str, instance: &str) -> Result<Option<String>, String> {
    Ok(call(
        key,
        reqwest::Method::GET,
        &format!("/v1/instances/{instance}"),
        None,
    )?
    .map(|body| body["status"].as_str().unwrap_or("").to_string()))
}

pub(crate) fn state_for(status: Option<&str>) -> MachineState {
    match status {
        None => MachineState::Missing,
        Some("running") => MachineState::Running,
        Some(_) => MachineState::Stopped,
    }
}

impl Provider for Agent37 {
    fn available(&self, root: &Path, _: &Computer) -> Result<(), String> {
        key(root).map(|_| ())
    }

    fn state(&self, root: &Path, computer: &Computer) -> Result<MachineState, String> {
        let Some(id) = instance(root, computer) else {
            return Ok(MachineState::Missing);
        };
        Ok(state_for(status(&key(root)?, &id)?.as_deref()))
    }

    fn start(
        &self,
        root: &Path,
        computer: &Computer,
        progress: &dyn Fn(&str),
    ) -> Result<(), String> {
        let key = key(root)?;
        let secret = secret(root, computer)?;
        let mut id = instance(root, computer);
        let current = match &id {
            Some(existing) => status(&key, existing)?,
            None => None,
        };
        if current.is_none() {
            let template = ensure_template(&key, progress)?;
            progress("Creating the computer on Agent37");
            let body = create_body(computer, &template, &secret.token, &secret.vnc_password);
            let created = call(&key, reqwest::Method::POST, "/v1/instances", Some(body))?
                .ok_or("Agent37 could not create the computer.")?;
            let created = created["id"]
                .as_str()
                .ok_or("Agent37 did not return the computer.")?;
            remember(root, computer, Some(created))?;
            id = Some(created.to_string());
        } else if current.as_deref() != Some("running") {
            progress("Waking the computer on Agent37");
            call(
                &key,
                reqwest::Method::POST,
                &format!("/v1/instances/{}/start", id.as_deref().unwrap()),
                None,
            )?;
        }
        let id = id.unwrap();
        let deadline = Instant::now() + BOOT_WAIT;
        progress("Waiting for the computer's agent");
        loop {
            let running = status(&key, &id)?.as_deref() == Some("running");
            if running
                && remote::block(remote::hello_with(
                    &agent_url(&id),
                    &secret.token,
                    &[("X-Agent37-Key", key.clone())],
                ))
                .is_ok()
            {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("The Agent37 computer started but its agent did not answer.".into());
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    }

    fn stop(&self, root: &Path, computer: &Computer) -> Result<(), String> {
        let Some(id) = instance(root, computer) else {
            return Ok(());
        };
        call(
            &key(root)?,
            reqwest::Method::POST,
            &format!("/v1/instances/{id}/stop"),
            None,
        )
        .map(|_| ())
    }

    fn delete(&self, root: &Path, computer: &Computer) -> Result<(), String> {
        if let Some(id) = instance(root, computer) {
            call(
                &key(root)?,
                reqwest::Method::DELETE,
                &format!("/v1/instances/{id}"),
                None,
            )?;
        }
        remember(root, computer, None)?;
        let _ = account_storage::remove(&secret_path(root, &computer.id));
        Ok(())
    }

    fn transport(&self, root: &Path, computer: &Computer) -> Result<Box<dyn Transport>, String> {
        let id = instance(root, computer).ok_or("This Agent37 computer has not started yet.")?;
        let secret = secret(root, computer)?;
        Ok(remote::http(
            agent_url(&id),
            secret.token,
            vec![("X-Agent37-Key", key(root)?)],
        ))
    }

    fn viewer(&self, _: &Path, _: &Computer, _: bool) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn devtools(&self, _: &Path, _: &Computer) -> Option<String> {
        None
    }
}

/// This month's Agent37 spend in US dollars, for the account and per computer.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent37Usage {
    pub total: f64,
    pub computers: BTreeMap<String, f64>,
}

pub(crate) fn usage(root: &Path) -> Result<Agent37Usage, String> {
    let key = key(root)?;
    let from = chrono::Utc::now().format("%Y-%m-01").to_string();
    let body = call(
        &key,
        reqwest::Method::GET,
        &format!("/v1/usage?from={from}"),
        None,
    )?
    .unwrap_or(Value::Null);
    let instances = {
        let _guard = lock().lock().map_err(|e| e.to_string())?;
        read_instances(root).instances
    };
    let mut computers = BTreeMap::new();
    for entry in body["instances"].as_array().into_iter().flatten() {
        let Some(id) = entry["id"].as_str() else {
            continue;
        };
        if let Some((computer, _)) = instances.iter().find(|(_, instance)| *instance == id) {
            computers.insert(computer.clone(), micros(&entry["total_micros"]));
        }
    }
    Ok(Agent37Usage {
        total: micros(&body["total_micros"]),
        computers,
    })
}

fn micros(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0) / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_checked_before_saving() {
        assert!(validate_key("sk_live_abcdefghijkl").is_ok());
        assert!(validate_key("sk_test_abcdefghijkl").is_err());
        assert!(validate_key("sk_live_ab cd efghijkl").is_err());
    }

    #[test]
    fn idle_stop_maps_to_auto_sleep() {
        assert_eq!(idle_seconds(0), None);
        assert_eq!(idle_seconds(1), Some(300));
        assert_eq!(idle_seconds(10), Some(600));
        assert_eq!(idle_seconds(100_000), Some(86_400));
    }

    #[test]
    fn instances_are_created_from_the_template_with_the_agent_secret() {
        let mut computer = Computer {
            id: "c1".into(),
            name: "Web App agents".into(),
            owner_kind: "project".into(),
            owner_id: "p".into(),
            provider: super::super::AGENT37.into(),
            machine_id: None,
            decisions: String::new(),
            created_at: String::new(),
            last_used_at: None,
            settings: Default::default(),
        };
        let body = create_body(&computer, "jackalope-computer-abc", "t", "v");
        assert_eq!(body["template"], "jackalope-computer-abc");
        assert_eq!(body["name"], "jackalope-web-app-agents");
        assert_eq!(body["env"]["JACKALOPE_COMPUTER_TOKEN"], "t");
        assert_eq!(body["auto_sleep"], true);
        computer.settings.idle_stop_minutes = 0;
        let body = create_body(&computer, "t", "t", "v");
        assert_eq!(body["auto_sleep"], false);
        assert!(body.get("idle_timeout_seconds").is_none());
    }

    #[test]
    fn states_and_errors_read_plainly() {
        assert_eq!(state_for(None), MachineState::Missing);
        assert_eq!(state_for(Some("running")), MachineState::Running);
        assert_eq!(state_for(Some("sleeping")), MachineState::Stopped);
        assert!(
            api_error(402, &json!({"error":{"code":"insufficient_balance"}})).contains("Top up")
        );
        assert!(api_error(401, &json!({})).contains("refused the API key"));
        assert_eq!(
            api_error(500, &json!({"error":{"message":"boom"}})),
            "Agent37 returned 500: boom"
        );
    }

    #[test]
    fn template_follows_the_image_definition() {
        let directory = super::super::image_directory().unwrap();
        let name = template_name(&directory).unwrap();
        assert!(name.starts_with("jackalope-computer-"));
        assert!(name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
        let context = build_context(&directory).unwrap();
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(context.as_slice()));
        let names: Vec<String> = archive
            .entries()
            .unwrap()
            .map(|entry| {
                entry
                    .unwrap()
                    .path()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, ["Dockerfile", "start.sh", "agent.py"]);
    }
}
