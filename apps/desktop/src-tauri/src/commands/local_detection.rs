use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tauri::State;

use super::agent_profiles::{self, AgentProfile};
use super::tasks::TaskRuntime;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmEndpoint {
    pub service: String,
    pub port: u16,
    pub endpoint: String,
    pub online: bool,
    pub models: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedKey {
    pub key_name: String,
    pub provider: String,
    pub target_agent: String,
    pub source: String,
    pub masked_preview: String,
    pub is_configured: bool,
}

pub fn mask_key(val: &str) -> String {
    let len = val.len();
    if len >= 12 {
        let prefix = &val[..std::cmp::min(7, len)];
        let suffix = &val[len - 4..];
        format!("{prefix}...{suffix}")
    } else if len >= 4 {
        let prefix = &val[..2];
        format!("{prefix}...***")
    } else {
        "***".to_string()
    }
}

pub fn key_provider_info(name: &str) -> Option<(&'static str, &'static str)> {
    match name {
        "OPENAI_API_KEY" | "CODEX_API_KEY" => Some(("OpenAI", "codex")),
        "ANTHROPIC_API_KEY" => Some(("Anthropic", "claude")),
        "XAI_API_KEY" | "GROK_API_KEY" => Some(("xAI (Grok)", "grok")),
        "GEMINI_API_KEY" => Some(("Google Gemini", "gemini")),
        "DEEPSEEK_API_KEY" => Some(("DeepSeek", "opencode")),
        "GROQ_API_KEY" => Some(("Groq", "opencode")),
        "MISTRAL_API_KEY" => Some(("Mistral AI", "opencode")),
        _ => None,
    }
}

const KNOWN_KEY_NAMES: &[&str] = &[
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
    "GEMINI_API_KEY",
    "DEEPSEEK_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
];

#[tauri::command]
pub async fn system_detect_local_llms() -> Result<Vec<LocalLlmEndpoint>, String> {
    let targets = [
        ("Ollama", 11434, "http://127.0.0.1:11434"),
        ("LM Studio", 1234, "http://127.0.0.1:1234"),
        ("llama.cpp / LocalAI", 8080, "http://127.0.0.1:8080"),
    ];

    let mut results = Vec::new();

    for (service, port, endpoint) in targets {
        let addr = format!("127.0.0.1:{port}");
        let online = tokio::time::timeout(
            Duration::from_millis(200),
            tokio::net::TcpStream::connect(&addr),
        )
        .await
        .is_ok_and(|res| res.is_ok());

        let mut models = Vec::new();
        if online {
            // Attempt a quick model list retrieval
            if service == "Ollama" {
                if let Ok(body) = fetch_json_tag_names("http://127.0.0.1:11434/api/tags").await {
                    models = body;
                }
            } else if let Ok(body) = fetch_openai_model_ids(&format!("{endpoint}/v1/models")).await
            {
                models = body;
            }
        }

        results.push(LocalLlmEndpoint {
            service: service.to_string(),
            port,
            endpoint: endpoint.to_string(),
            online,
            models,
        });
    }

    Ok(results)
}

async fn fetch_json_tag_names(url: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(600))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    if let Some(arr) = json.get("models").and_then(|m| m.as_array()) {
        for item in arr {
            if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                names.push(name.to_string());
            }
        }
    }
    Ok(names)
}

async fn fetch_openai_model_ids(url: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(600))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                ids.push(id.to_string());
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
pub fn system_detect_env_keys(runtime: State<'_, TaskRuntime>) -> Result<Vec<DetectedKey>, String> {
    let profiles_root = runtime.profiles_root();
    let mut detected = Vec::new();

    for &name in KNOWN_KEY_NAMES {
        if let Ok(val) = std::env::var(name) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                if let Some((provider, target_agent)) = key_provider_info(name) {
                    let is_configured = is_key_configured(&profiles_root, target_agent, name);
                    detected.push(DetectedKey {
                        key_name: name.to_string(),
                        provider: provider.to_string(),
                        target_agent: target_agent.to_string(),
                        source: "System Environment".to_string(),
                        masked_preview: mask_key(trimmed),
                        is_configured,
                    });
                }
            }
        }
    }

    Ok(detected)
}

fn is_key_configured(profiles_root: &Path, agent: &str, key_name: &str) -> bool {
    let agent_dir = profiles_root.join(agent);
    if !agent_dir.exists() {
        return false;
    }
    if let Ok(entries) = std::fs::read_dir(agent_dir) {
        for entry in entries.flatten() {
            let env_file = entry.path().join(".env");
            if env_file.exists() {
                if let Ok(content) = std::fs::read_to_string(env_file) {
                    if content.lines().any(|l| l.trim().starts_with(key_name)) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[tauri::command]
pub fn agent_import_detected_key(
    runtime: State<'_, TaskRuntime>,
    key_name: String,
    profile_name: Option<String>,
) -> Result<AgentProfile, String> {
    let (_, target_agent) = key_provider_info(&key_name)
        .ok_or_else(|| format!("Unknown or unsupported key name: {key_name}"))?;

    let val = std::env::var(&key_name)
        .map_err(|_| format!("Key {key_name} is no longer present in the environment"))?;
    let val = val.trim();
    if val.is_empty() {
        return Err("Environment variable contains an empty value.".into());
    }

    let default_name = format!("{} (Imported Key)", key_name);
    let name = profile_name.unwrap_or(default_name).trim().to_string();

    let root = runtime.profiles_root();
    // Create profile
    let profile = agent_profiles::agent_profile_create(
        runtime.clone(),
        target_agent.to_string(),
        name,
        Some("personal".to_string()),
        None,
    )?;

    // Set tag
    let _ = agent_profiles::agent_profile_set_tag(
        runtime.clone(),
        target_agent.to_string(),
        Some(profile.id.clone()),
        Some("Imported Key".to_string()),
    );

    // Securely write key to profile directory's .env file
    let profile_dir = root.join(target_agent).join(&profile.id);
    let env_path = profile_dir.join(".env");
    let env_content = format!("{key_name}={val}\n");
    std::fs::write(env_path, env_content).map_err(|e| e.to_string())?;

    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_key_produces_safe_previews() {
        let long_key = "sk-ant-api03-abcdefghijklmnop1234";
        let masked = mask_key(long_key);
        assert_eq!(masked, "sk-ant-...1234");
        assert!(!masked.contains("abcdefghijklmnop"));

        let short_key = "short";
        let masked_short = mask_key(short_key);
        assert_eq!(masked_short, "sh...***");

        let tiny = "abc";
        assert_eq!(mask_key(tiny), "***");
    }

    #[test]
    fn key_provider_info_matches_agents() {
        assert_eq!(
            key_provider_info("OPENAI_API_KEY"),
            Some(("OpenAI", "codex"))
        );
        assert_eq!(
            key_provider_info("ANTHROPIC_API_KEY"),
            Some(("Anthropic", "claude"))
        );
        assert_eq!(
            key_provider_info("XAI_API_KEY"),
            Some(("xAI (Grok)", "grok"))
        );
        assert_eq!(
            key_provider_info("GEMINI_API_KEY"),
            Some(("Google Gemini", "gemini"))
        );
        assert_eq!(key_provider_info("UNKNOWN_KEY"), None);
    }
}
