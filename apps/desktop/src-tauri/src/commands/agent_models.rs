use super::{agent_profiles, capacity::client::Client, tasks::TaskRuntime};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::{io::AsyncReadExt, process::Command, sync::Mutex, time::timeout};

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    id: String,
    name: String,
    is_default: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    models: Vec<AgentModel>,
    source: String,
    account: Option<String>,
    checked_at: String,
    detail: String,
}

#[derive(Default)]
pub struct ModelCatalogService(Mutex<HashMap<String, (Instant, ModelCatalog)>>);

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 160
        && !id.starts_with('-')
        && !id.chars().any(char::is_whitespace)
        && !id.chars().any(char::is_control)
}

fn parse_models(value: &Value) -> Vec<AgentModel> {
    let mut models = Vec::new();
    for entry in value.as_array().into_iter().flatten().take(512) {
        if entry["hidden"].as_bool() == Some(true) {
            continue;
        }
        let Some(id) = entry["model"]
            .as_str()
            .or_else(|| entry["value"].as_str())
            .or_else(|| entry["id"].as_str())
        else {
            continue;
        };
        if !valid_id(id) || models.iter().any(|model: &AgentModel| model.id == id) {
            continue;
        }
        let name = entry["displayName"]
            .as_str()
            .or_else(|| entry["display_name"].as_str())
            .or_else(|| entry["name"].as_str())
            .unwrap_or(id);
        models.push(AgentModel {
            id: id.into(),
            name: name.chars().filter(|c| !c.is_control()).take(160).collect(),
            is_default: entry["isDefault"].as_bool().unwrap_or(false),
        });
    }
    models
}

async fn read_catalog(
    adapter: &str,
    executable: &Path,
    binding: &agent_profiles::AccountBinding,
) -> Result<Vec<AgentModel>, String> {
    if adapter == "opencode" {
        let mut command = Command::new(executable);
        command
            .args(["models"])
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        agent_profiles::apply_binding(command.as_std_mut(), binding)?;
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|_| "Could not start the model reader")?;
        let mut output = child
            .stdout
            .take()
            .ok_or("Model output unavailable")?
            .take(1_048_577);
        let result = timeout(Duration::from_secs(20), async {
            let mut bytes = Vec::new();
            output
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| "Could not read the model list")?;
            if bytes.len() > 1_048_576 {
                return Err("Model output exceeded the response limit".into());
            }
            if !child
                .wait()
                .await
                .map_err(|_| "Could not wait for the model reader")?
                .success()
            {
                return Err(
                    "The CLI could not list models. Check its sign-in and provider settings."
                        .into(),
                );
            }
            let values: Vec<Value> = String::from_utf8_lossy(&bytes)
                .lines()
                .map(str::trim)
                .filter(|id| valid_id(id) && id.contains('/'))
                .take(512)
                .map(|id| json!({"id":id}))
                .collect();
            Ok(parse_models(&Value::Array(values)))
        })
        .await
        .unwrap_or_else(|_| Err("Model discovery timed out.".into()));
        let _ = child.start_kill();
        let _ = timeout(Duration::from_secs(2), child.wait()).await;
        return result;
    }
    let args: &[&str] = if adapter == "codex" {
        &["app-server", "--listen", "stdio://"]
    } else {
        &[
            "--print",
            "--verbose",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--no-session-persistence",
            "--safe-mode",
            "--strict-mcp-config",
        ]
    };
    let mut client = Client::spawn_executable(binding, executable, args)?;
    let result = timeout(Duration::from_secs(20), async {
        if adapter == "claude" {
            let response = client.request(json!({"type":"control_request","request_id":"models-init","request":{"subtype":"initialize","hooks":{}}})).await?;
            return Ok(parse_models(&response["models"]));
        }
        client.request(json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"jackalope","version":env!("CARGO_PKG_VERSION")}}})).await?;
        client.notify(json!({"method":"initialized","params":{}})).await?;
        let mut cursor: Option<String> = None;
        let mut models = Vec::new();
        for id in 1..=8 {
            let response = client.request(json!({"id":id,"method":"model/list","params":{"limit":100,"cursor":cursor,"includeHidden":false}})).await?;
            for model in parse_models(&response["data"]) {
                if !models.iter().any(|existing: &AgentModel| existing.id == model.id) {models.push(model);}
            }
            let next = response["nextCursor"].as_str().map(str::to_string);
            if next.is_none() || next == cursor {break;}
            cursor = next;
        }
        Ok(models)
    }).await.unwrap_or_else(|_| Err("Model discovery timed out. Check the CLI sign-in and connection.".into()));
    client.close().await;
    result
}

#[tauri::command]
pub async fn agent_models(
    runtime: State<'_, TaskRuntime>,
    service: State<'_, ModelCatalogService>,
    agent: String,
    refresh: Option<bool>,
) -> Result<ModelCatalog, String> {
    let mut policy = runtime.policy()?;
    policy.enabled_agents.clear();
    let (adapter, executable) = policy.resolve(&agent)?;
    if !["codex", "claude", "opencode"].contains(&adapter.as_str()) {
        return Ok(ModelCatalog {models: vec![], source: adapter, account: None, checked_at: chrono::Utc::now().to_rfc3339(), detail: "This CLI does not expose a supported model catalog to Jackalope. You can enter model IDs manually.".into()});
    }
    let binding = agent_profiles::bind_account(&runtime.profiles_root(), &adapter, None)?;
    let key = format!("{}:{:?}:{:?}", adapter, executable, binding.directory);
    let mut cache = service.0.lock().await;
    if !refresh.unwrap_or(false) {
        if let Some((checked, catalog)) = cache
            .get(&key)
            .filter(|(checked, _)| checked.elapsed() < Duration::from_secs(300))
        {
            let _ = checked;
            return Ok(catalog.clone());
        }
    }
    let models = read_catalog(&adapter, &executable, &binding).await?;
    let detail = if models.is_empty() {
        "The CLI returned no models. Check its sign-in or enter a model ID manually."
    } else {
        "Models reported by the current CLI account. Access and quota are checked when a task runs."
    };
    let catalog = ModelCatalog {
        models,
        source: adapter,
        account: Some(binding.label),
        checked_at: chrono::Utc::now().to_rfc3339(),
        detail: detail.into(),
    };
    if cache.len() >= 32 {
        cache.retain(|_, (checked, _)| checked.elapsed() < Duration::from_secs(300));
        if cache.len() >= 32 {
            cache.clear();
        }
    }
    cache.insert(key, (Instant::now(), catalog.clone()));
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_catalog_filters_hidden_invalid_and_duplicate_ids_without_inventing_models() {
        let models = parse_models(
            &json!([{"model":"code-model","displayName":"Code model","isDefault":true},{"value":"reasoning-model","displayName":"Reasoning"},{"id":"hidden","hidden":true},{"id":"code-model"},{"id":"--flag"},{"id":"two words"},{"name":"missing ID"}]),
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "code-model");
        assert!(models[0].is_default);
        assert_eq!(models[1].id, "reasoning-model");
        assert!(parse_models(&Value::Null).is_empty());
    }
}
