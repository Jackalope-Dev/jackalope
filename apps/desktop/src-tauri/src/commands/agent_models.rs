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

fn parse_acp_models(response: &Value) -> Vec<AgentModel> {
    let option = response["configOptions"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|option| option["id"] == "model" || option["category"] == "model");
    if let Some(option) = option {
        let mut values = Vec::new();
        for entry in option["options"].as_array().into_iter().flatten().take(512) {
            if let Some(group) = entry["options"].as_array() {
                values.extend(group.iter().take(512).cloned());
            } else {
                values.push(entry.clone());
            }
        }
        let mut models = parse_models(&Value::Array(values));
        for model in &mut models {
            model.is_default = option["currentValue"].as_str() == Some(&model.id);
        }
        return models;
    }
    let values: Vec<_> = response["models"]["availableModels"].as_array().into_iter().flatten().take(512)
        .map(|model| json!({"id":model["modelId"],"name":model["name"],"isDefault":model["modelId"] == response["models"]["currentModelId"]})).collect();
    parse_models(&Value::Array(values))
}

fn parse_antigravity_model(value: &Value) -> Vec<AgentModel> {
    if value["status"] != "SUCCESS"
        || value["command"]["name"] != "model"
        || value["num_turns"] != 0
    {
        return vec![];
    }
    let model = &value["command"]["data"];
    parse_models(&json!([{"id":model["id"],"name":model["label"],"isDefault":true}]))
}

async fn read_catalog(
    adapter: &str,
    executable: &Path,
    binding: &agent_profiles::AccountBinding,
) -> Result<Vec<AgentModel>, String> {
    if adapter == "antigravity" {
        super::capacity::antigravity::require_commands(binding, executable).await?;
        let output = super::capacity::antigravity::output(
            binding,
            executable,
            &[
                "-p",
                "/model",
                "--output-format",
                "json",
                "--print-timeout",
                "20s",
            ],
        )
        .await?;
        let value = serde_json::from_str(&output)
            .map_err(|_| "Antigravity returned invalid model metadata.")?;
        return Ok(parse_antigravity_model(&value));
    }
    if matches!(adapter, "kimi" | "grok") {
        let args: &[&str] = if adapter == "kimi" {
            &["acp"]
        } else {
            &["agent", "--no-leader", "stdio"]
        };
        let mut client = Client::spawn_executable(binding, executable, args)?;
        let result = timeout(Duration::from_secs(20), async {
            client.request(super::tasks::kimi::initialize()).await?;
            let response = client
                .request(super::tasks::kimi::session_request(
                    &std::env::temp_dir().to_string_lossy(),
                    None,
                ))
                .await?;
            if let Some(session_id) = response["sessionId"].as_str().filter(|_| adapter == "kimi") {
                let _ = client.request(json!({"jsonrpc":"2.0","id":2,"method":"session/delete","params":{"sessionId":session_id}})).await;
            }
            Ok(parse_acp_models(&response))
        })
        .await
        .unwrap_or_else(|_| Err(format!("{adapter} model discovery timed out.")));
        client.close().await;
        return result;
    }
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
    agent_profile_id: Option<String>,
) -> Result<ModelCatalog, String> {
    let mut policy = runtime.policy()?;
    policy.enabled_agents.clear();
    let (adapter, executable) = policy.resolve(&agent)?;
    if !["codex", "claude", "grok", "opencode", "kimi", "antigravity"].contains(&adapter.as_str()) {
        return Ok(ModelCatalog {models: vec![], source: adapter, account: None, checked_at: chrono::Utc::now().to_rfc3339(), detail: "This agent does not expose a supported model catalog. Model selection is unavailable; the agent manages its model unless a saved override exists.".into()});
    }
    let binding = agent_profiles::bind_account(
        &runtime.profiles_root(),
        &adapter,
        agent_profile_id.as_deref(),
    )?;
    if let Some(model) = agent_profiles::local_model(&binding)? {
        return Ok(ModelCatalog {
            models: vec![AgentModel { id: format!("{}/{model}", super::local_ai::PROVIDER), name: format!("Local · {model}"), is_default: true }],
            source: "local".into(), account: Some(binding.label), checked_at: chrono::Utc::now().to_rfc3339(),
            detail: "This local account uses the model checked during setup. Ollama must be running; current availability is checked at launch.".into(),
        });
    }
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
        "The agent returned no models. Check its sign-in and refresh. Model selection is unavailable until models can be detected."
    } else if adapter == "antigravity" {
        "Antigravity reports its current CLI model here. The full catalog is not exposed by this command; use agy to change the current model, then refresh."
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
    fn antigravity_current_model_requires_a_zero_turn_command_receipt() {
        let value = json!({"status":"SUCCESS","num_turns":0,"command":{"name":"model","data":{"id":"reported-model","label":"Current model"}}});
        assert_eq!(
            parse_antigravity_model(&value),
            vec![AgentModel {
                id: "reported-model".into(),
                name: "Current model".into(),
                is_default: true
            }]
        );
        assert!(parse_antigravity_model(
            &json!({"status":"SUCCESS","num_turns":1,"response":"invented"})
        )
        .is_empty());
    }
    #[test]
    fn kimi_catalog_uses_reported_aliases_and_grouped_options() {
        let models = parse_acp_models(
            &json!({"configOptions":[{"id":"model","currentValue":"saved-alias","options":[{"group":"Provider","options":[{"value":"saved-alias","name":"Configured model"},{"value":"--invalid"}]}]}]}),
        );
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "saved-alias");
        assert!(models[0].is_default);
        let legacy = parse_acp_models(
            &json!({"models":{"currentModelId":"alias","availableModels":[{"modelId":"alias","name":"Model"}]}}),
        );
        assert_eq!(legacy[0].id, "alias");
        assert!(legacy[0].is_default);
        assert!(parse_acp_models(&Value::Null).is_empty());
    }

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
