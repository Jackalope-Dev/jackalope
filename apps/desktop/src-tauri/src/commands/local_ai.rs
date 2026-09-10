use super::{agent_profiles, process_control, tasks};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, State};

mod check;
mod hardware;
mod install;
#[cfg(test)]
mod tests;

const ENDPOINT: &str = "http://127.0.0.1:11434";
pub(super) const PROVIDER: &str = "jackalope-local";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub id: &'static str,
    pub name: &'static str,
    pub download_bytes: u64,
    pub recommended_memory_gb: u64,
    pub description: &'static str,
}

fn models() -> Vec<LocalModel> {
    vec![
        LocalModel {
            id: "qwen3.5:4b",
            name: "Qwen 3.5 · 4B",
            download_bytes: 3_400_000_000,
            recommended_memory_gb: 16,
            description: "Try focused edits and explanations. Review its work carefully.",
        },
        LocalModel {
            id: "qwen3.5:9b",
            name: "Qwen 3.5 · 9B",
            download_bytes: 6_600_000_000,
            recommended_memory_gb: 24,
            description: "More room for reasoning on a capable computer. A GPU is recommended.",
        },
        LocalModel {
            id: "qwen3-coder:30b",
            name: "Qwen3 Coder · 30B",
            download_bytes: 19_000_000_000,
            recommended_memory_gb: 48,
            description:
                "A coding specialist for high-memory machines. GPU memory matters for speed.",
        },
    ]
}

fn model(id: &str) -> Result<LocalModel, String> {
    models()
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| "Choose a model from the local setup catalog.".into())
}

fn winget() -> Result<std::path::PathBuf, String> {
    let path = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .ok_or("Windows Package Manager is unavailable.")?
        .join("Microsoft/WindowsApps/winget.exe");
    if !path.is_file() {
        return Err("Install with the official download, then check again.".into());
    }
    Ok(path)
}

fn inference_model(id: &str) -> String {
    format!("jackalope-{}", id.replace(':', "-"))
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub message: String,
    pub completed: u64,
    pub total: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub model: String,
    pub digest: String,
    pub inference_digest: String,
    pub elapsed_ms: u64,
    pub checked_at: String,
}

#[derive(Default)]
pub struct LocalAi {
    busy: Arc<AtomicBool>,
    canceled: Arc<AtomicBool>,
    verified: Mutex<Option<Verification>>,
}

struct Operation(Arc<AtomicBool>);
impl Drop for Operation {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl LocalAi {
    fn begin(&self) -> Result<Operation, String> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(
                "A local setup operation is already running. Wait or stop it first.".into(),
            );
        }
        self.canceled.store(false, Ordering::SeqCst);
        Ok(Operation(self.busy.clone()))
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())
}

async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(format!(
            "Ollama returned HTTP {}. Check that it is running and retry.",
            response.status()
        ));
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 1_000_000 {
            return Err("Ollama returned too much data.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Ollama returned an invalid response.".into())
}

async fn tags() -> Result<Value, String> {
    response_json(
        client()?
            .get(format!("{ENDPOINT}/api/tags"))
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|_| "Start Ollama, then check again.".to_string())?,
    )
    .await
}

fn digest(tags: &Value, model: &str) -> Option<String> {
    tags["models"].as_array()?.iter().find(|entry| {
        entry["name"]
            .as_str()
            .is_some_and(|name| name == model || name.strip_suffix(":latest") == Some(model))
    })?["digest"]
        .as_str()
        .map(str::to_owned)
}

#[tauri::command]
pub async fn local_ai_inspect() -> Result<Value, String> {
    let hardware = tauri::async_runtime::spawn_blocking(hardware::inspect)
        .await
        .map_err(|e| e.to_string())?;
    let found = tags().await;
    let installed: Vec<_> = found
        .as_ref()
        .ok()
        .and_then(|t| t["models"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|m| m["name"].as_str().map(str::to_owned))
        .take(512)
        .collect();
    Ok(
        json!({"hardware":hardware,"models":models(),"installedModels":installed,"ollamaOnline":found.is_ok(),
        "opencodeInstalled":tasks::executable("opencode").is_ok(),"canInstall":cfg!(windows) && winget().is_ok(),
        "runtimeDiskBytes":4_000_000_000u64,"catalogCheckedAt":"2026-09-10","endpoint":ENDPOINT}),
    )
}

#[tauri::command]
pub fn local_ai_cancel(service: State<'_, LocalAi>) {
    service.canceled.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn local_ai_install(
    tool: String,
    progress: Channel<Progress>,
    service: State<'_, LocalAi>,
) -> Result<(), String> {
    let package = match tool.as_str() {
        "ollama" => "Ollama.Ollama",
        "opencode" => "SST.opencode",
        _ => return Err("Unknown setup component.".into()),
    };
    if !cfg!(windows) {
        return Err("Use the official installer on this platform, then check again.".into());
    }
    let _operation = service.begin()?;
    let canceled = service.canceled.clone();
    let executable = winget()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(executable);
        command.args(["install", "--id", package, "--exact", "--source", "winget", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]);
        let output = Mutex::new(install::Output::new(if tool == "ollama" { "Ollama" } else { "OpenCode" }));
        let closed = canceled.clone();
        let result = process_control::run_cancellable_with_output(command, Duration::from_secs(1200), || canceled.load(Ordering::SeqCst), move |bytes, stderr| {
            if let Ok(mut output) = output.lock() {
                for event in output.consume(bytes, stderr) {
                    if progress.send(event).is_err() { closed.store(true, Ordering::SeqCst); }
                }
            }
        })?;
        if canceled.load(Ordering::SeqCst) { return Err("Stopped waiting for installation. Windows may still be finishing it; check again before retrying.".into()); }
        if result.timed_out { return Err("Installation timed out after 20 minutes. Check Windows for an approval prompt, then check installed tools before retrying.".into()); }
        if !result.success { return Err(format!("Installation did not complete (code {}). Check Windows for an approval prompt or use the official installer, then check again.", result.exit_code.map(|code| format!("0x{:08X}", code as u32)).unwrap_or_else(|| "unavailable".into()))); }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[derive(Default)]
struct DownloadProgress(BTreeMap<String, (u64, u64)>);
impl DownloadProgress {
    fn consume(&mut self, value: &Value) -> Result<Progress, String> {
        if value.get("error").is_some() {
            return Err("Ollama could not download the model. Check its connection and free disk space, then retry.".into());
        }
        if let (Some(digest), Some(total)) = (value["digest"].as_str(), value["total"].as_u64()) {
            if self.0.len() >= 4096 && !self.0.contains_key(digest) {
                return Err("Ollama returned too many download layers.".into());
            }
            self.0.insert(
                digest.to_owned(),
                (value["completed"].as_u64().unwrap_or(0).min(total), total),
            );
        }
        let completed = self.0.values().fold(0u64, |sum, v| sum.saturating_add(v.0));
        let total = self.0.values().fold(0u64, |sum, v| sum.saturating_add(v.1));
        Ok(Progress {
            phase: "download".into(),
            message: value["status"]
                .as_str()
                .unwrap_or("Downloading model")
                .chars()
                .take(160)
                .collect(),
            completed,
            total: (total > 0).then_some(total),
        })
    }
}

fn download_event(
    line: &[u8],
    totals: &mut DownloadProgress,
) -> Result<Option<(Progress, bool)>, String> {
    if line.len() > 16_384 {
        return Err("Invalid download progress.".into());
    }
    if line.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(line).map_err(|_| "Invalid download progress.")?;
    if !value.is_object() {
        return Err("Invalid download progress.".into());
    }
    Ok(Some((
        totals.consume(&value)?,
        value["status"] == "success",
    )))
}

#[tauri::command]
pub async fn local_ai_pull(
    model_id: String,
    progress: Channel<Progress>,
    service: State<'_, LocalAi>,
) -> Result<(), String> {
    model(&model_id)?;
    let _operation = service.begin()?;
    *service.verified.lock().map_err(|e| e.to_string())? = None;
    let canceled = service.canceled.clone();
    let work = async {
        let mut response = client()?
            .post(format!("{ENDPOINT}/api/pull"))
            .json(&json!({"model":model_id,"stream":true}))
            .send()
            .await
            .map_err(|_| "Could not reach Ollama.".to_string())?;
        if !response.status().is_success() {
            return Err("Ollama rejected the download. Update Ollama and retry.".into());
        }
        let mut pending = Vec::new();
        let mut totals = DownloadProgress::default();
        let mut success = false;
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            pending.extend_from_slice(&chunk);
            while let Some(end) = pending.iter().position(|b| *b == b'\n') {
                let line: Vec<_> = pending.drain(..=end).collect();
                if let Some((event, complete)) = download_event(&line, &mut totals)? {
                    success |= complete;
                    progress.send(event).map_err(|_| {
                        "Setup closed. Reopen it to resume the download.".to_string()
                    })?;
                }
            }
            if pending.len() > 16_384 {
                return Err("Invalid download progress.".into());
            }
        }
        if let Some((event, complete)) = download_event(&pending, &mut totals)? {
            success |= complete;
            progress
                .send(event)
                .map_err(|_| "Setup closed. Reopen it to resume the download.".to_string())?;
        }
        if !success || digest(&tags().await?, &model_id).is_none() {
            return Err("The download ended before Ollama confirmed it. Retry to resume.".into());
        }
        Ok(())
    };
    tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(7200), work) => result.map_err(|_| "Download timed out. Retry to resume.".to_string())?,
        _ = wait_canceled(canceled) => Err("Download stopped. Completed layers are kept by Ollama for retry.".into()),
    }
}

async fn wait_canceled(canceled: Arc<AtomicBool>) {
    while !canceled.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub(super) fn config(model_id: &str) -> Value {
    json!({"$schema":"https://opencode.ai/config.json", "model":format!("{PROVIDER}/{model_id}"),
        "small_model":format!("{PROVIDER}/{model_id}"),"enabled_providers":[PROVIDER],"share":"disabled",
        "provider":{PROVIDER:{"npm":"@ai-sdk/openai-compatible","name":"Local Ollama","options":{"baseURL":format!("{ENDPOINT}/v1")},
        "models":{model_id:{"id":inference_model(model_id),"name":model_id,"tool_call":true,"limit":{"context":65536,"output":8192}}}}}})
}

#[tauri::command]
pub async fn local_ai_verify(
    model_id: String,
    progress: Channel<Progress>,
    service: State<'_, LocalAi>,
    runtime: State<'_, tasks::TaskRuntime>,
) -> Result<Verification, String> {
    model(&model_id)?;
    runtime.access.ensure()?;
    let _operation = service.begin()?;
    *service.verified.lock().map_err(|e| e.to_string())? = None;
    let expected_digest =
        digest(&tags().await?, &model_id).ok_or("Download this model before checking it.")?;
    let prepare = async {
        response_json(client()?.post(format!("{ENDPOINT}/api/create")).json(&json!({"model":inference_model(&model_id),"from":model_id,"parameters":{"num_ctx":65536},"stream":false})).timeout(Duration::from_secs(60)).send().await.map_err(|_| "Could not prepare the model's coding context.".to_string())?).await
    };
    let prepare = tokio::select! {
        result = prepare => result?,
        _ = wait_canceled(service.canceled.clone()) => return Err("Local check stopped.".into()),
    };
    if prepare["status"] != "success" {
        return Err(
            "Ollama could not prepare a 64K coding context. Update Ollama and retry.".into(),
        );
    }
    let expected_inference_digest = digest(&tags().await?, &inference_model(&model_id))
        .ok_or("The prepared model is missing. Retry the check.")?;
    let executable = tasks::executable("opencode")?;
    let canceled = service.canceled.clone();
    let checks_root = runtime.profiles_root().join("local-checks");
    let checked_model = model_id.clone();
    let elapsed_ms = tauri::async_runtime::spawn_blocking(move || {
        let directory = check::Directory::create(&checks_root)?;
        let root = directory.path();
        let workspace = root.join("work");
        std::fs::create_dir(&workspace).map_err(|e| e.to_string())?;
        let mut configuration = config(&checked_model);
        configuration["permission"] = json!({"*":"deny","read":"allow","edit":"allow","write":"allow","list":"allow","glob":"allow"});
        let marker = uuid::Uuid::new_v4().to_string();
        let mut session: Option<String> = None;
        let start = std::time::Instant::now();
        for (index, prompt) in [format!("Create LOCAL_CHECK.txt in the current directory containing exactly {marker}. Use a file editing tool. Do not run commands. Reply briefly when done."),
            "Continue this same session. Read LOCAL_CHECK.txt and copy its exact content into LOCAL_RESUME.txt using a file editing tool. Do not run commands.".into()].iter().enumerate() {
            if canceled.load(Ordering::SeqCst) { return Err("Local check stopped.".to_string()); }
            progress.send(Progress { phase: "verify".into(), message: if index == 0 { "Checking a real file edit in a disposable folder…" } else { "Checking the same session can continue…" }.into(), ..Default::default() }).map_err(|_| "Setup closed.".to_string())?;
            let mut command = Command::new(&executable);
            command.current_dir(&workspace).args(["run","--format","json","--model", &format!("{PROVIDER}/{checked_model}")]);
            if let Some(id) = &session { command.args(["--session", id]); }
            command.arg(prompt).env("OPENCODE_CONFIG_CONTENT", configuration.to_string())
                .env("OPENCODE_DISABLE_PROJECT_CONFIG", "true")
                .env_remove("OPENCODE_CONFIG").env_remove("OPENCODE_CONFIG_DIR")
                .env("XDG_DATA_HOME", root.join("data")).env("XDG_CONFIG_HOME", root.join("config"))
                .env("XDG_STATE_HOME", root.join("state")).env("XDG_CACHE_HOME", root.join("cache"));
            let result = process_control::run_cancellable(command, Duration::from_secs(300), || canceled.load(Ordering::SeqCst))?;
            if !result.success || result.truncated || canceled.load(Ordering::SeqCst) { return Err("The local agent check did not finish. Check memory, update OpenCode/Ollama, or try another model.".into()); }
            let mut saw_tool = false;
            for line in result.stdout.lines() {
                if let Ok(event) = serde_json::from_str::<Value>(line) {
                    if event["type"] == "error" { return Err("OpenCode reported an error during the local check.".into()); }
                    saw_tool |= event["type"] == "tool_use";
                    if let Some(id) = event["sessionID"].as_str() {
                        if session.as_ref().is_some_and(|old| old != id) { return Err("OpenCode changed sessions during continuation.".into()); }
                        session = Some(id.to_owned());
                    }
                }
            }
            let file = workspace.join(if index == 0 { "LOCAL_CHECK.txt" } else { "LOCAL_RESUME.txt" });
            if session.is_none() || !saw_tool || super::history::read_bounded(&file, 256).ok().is_none_or(|content| String::from_utf8_lossy(&content).trim() != marker) {
                return Err("The model did not complete the file/tool check. Try another model; nothing has been connected.".into());
            }
        }
        Ok(start.elapsed().as_millis() as u64)
    }).await.map_err(|e| e.to_string())??;
    let installed = tags().await?;
    if digest(&installed, &model_id).as_deref() != Some(&expected_digest)
        || digest(&installed, &inference_model(&model_id)).as_deref()
            != Some(&expected_inference_digest)
    {
        return Err("The installed model changed. Check it again before connecting.".into());
    }
    if service.canceled.load(Ordering::SeqCst) {
        return Err("Local check stopped.".into());
    }
    let verified = Verification {
        model: model_id,
        digest: expected_digest,
        inference_digest: expected_inference_digest,
        elapsed_ms,
        checked_at: chrono::Utc::now().to_rfc3339(),
    };
    *service.verified.lock().map_err(|e| e.to_string())? = Some(verified.clone());
    Ok(verified)
}

#[tauri::command]
pub async fn local_ai_connect(
    model_id: String,
    service: State<'_, LocalAi>,
    runtime: State<'_, tasks::TaskRuntime>,
) -> Result<agent_profiles::AgentProfile, String> {
    model(&model_id)?;
    runtime.access.ensure()?;
    let _operation = service.begin()?;
    let verified = service
        .verified
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .filter(|v| v.model == model_id)
        .ok_or("Check this model before connecting it.")?;
    let installed = tags().await?;
    if digest(&installed, &model_id).as_deref() != Some(&verified.digest)
        || digest(&installed, &inference_model(&model_id)).as_deref()
            != Some(&verified.inference_digest)
    {
        return Err("The installed model changed. Check it again.".into());
    }
    if service.canceled.load(Ordering::SeqCst) {
        return Err("Connection stopped. Reopen setup to try again.".into());
    }
    agent_profiles::create_local(&runtime.profiles_root(), &verified)
}
