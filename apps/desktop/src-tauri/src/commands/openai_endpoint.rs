//! A loopback OpenAI-compatible model server, saved as an OpenCode account.
//!
//! LM Studio, vLLM and similar servers speak `GET /v1/models`. The saved account
//! keeps the address and model list. An optional API key stays in the account's
//! protected key file and is added to the process configuration at launch.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{IpAddr, SocketAddr, TcpStream},
    time::Duration,
};

use super::agent_profiles::AccountBinding;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EndpointRecord {
    pub name: String,
    pub base_url: String,
    pub provider_id: String,
    pub model: String,
    pub models: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointConnection {
    pub profile_id: String,
    pub name: String,
    pub models: Vec<String>,
    pub model: String,
}

/// `http://127.0.0.1:1234`, `http://127.0.0.1:1234/v1` or the same with `localhost`.
pub(super) fn normalize_base(input: &str) -> Result<(String, SocketAddr, String), String> {
    let input = input.trim().trim_end_matches('/');
    if input.len() > 200 || input.chars().any(char::is_control) {
        return Err("Enter the server address, such as http://127.0.0.1:1234/v1.".into());
    }
    let rest = input
        .strip_prefix("http://")
        .ok_or("Use an http:// address on this computer, such as http://127.0.0.1:1234/v1.")?;
    if rest.contains('@') || rest.contains('?') || rest.contains('#') {
        return Err("The address cannot include a username, query or fragment.".into());
    }
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    if authority.is_empty() || path.contains('/') {
        return Err("Enter the server address, such as http://127.0.0.1:1234/v1.".into());
    }
    if !path.is_empty() && path != "v1" {
        return Err("The address path must be empty or /v1.".into());
    }
    let (host, port) = if let Some(host) = authority.strip_prefix('[') {
        let (host, port) = host
            .split_once("]:")
            .ok_or("Include a port, such as http://[::1]:1234/v1.")?;
        (format!("[{host}]"), port)
    } else {
        let (host, port) = authority
            .split_once(':')
            .ok_or("Include a port, such as http://127.0.0.1:1234/v1.")?;
        (host.to_string(), port)
    };
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]") {
        return Err(
            "Only a server on this computer is accepted (127.0.0.1, localhost or ::1).".into(),
        );
    }
    let port: u16 = port
        .parse()
        .map_err(|_| "The port must be a number from 1 to 65535.".to_string())?;
    if port == 0 {
        return Err("The port must be a number from 1 to 65535.".into());
    }
    let ip = if host == "[::1]" {
        IpAddr::from([0, 0, 0, 0, 0, 0, 0, 1])
    } else {
        IpAddr::from([127, 0, 0, 1])
    };
    let base = format!("http://{host}:{port}/v1");
    Ok((base, SocketAddr::new(ip, port), host))
}

pub(super) fn provider_id(name: &str) -> Result<String, String> {
    let mut slug = String::new();
    for character in name.trim().chars() {
        if slug.len() >= 24 {
            break;
        }
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        return Err("Give the endpoint a name.".into());
    }
    Ok(format!("local-{slug}"))
}

pub(super) fn parse_models(body: &str) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct Listed {
        id: String,
    }
    #[derive(Deserialize)]
    struct Catalog {
        data: Vec<Listed>,
    }
    let catalog: Catalog = serde_json::from_str(body)
        .map_err(|_| "The server did not return an OpenAI model list.".to_string())?;
    let mut models = Vec::new();
    for item in catalog.data {
        let id = item.id.trim();
        if id.is_empty()
            || id.len() > 128
            || id
                .chars()
                .any(|character| char::is_control(character) || character == ' ')
        {
            continue;
        }
        if !models.iter().any(|existing: &String| existing == id) {
            models.push(id.to_string());
        }
        if models.len() == 40 {
            break;
        }
    }
    if models.is_empty() {
        return Err("The server returned no usable model ids.".into());
    }
    Ok(models)
}

pub(super) fn fetch_models(
    base: &str,
    address: SocketAddr,
    host: &str,
    api_key: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|_| format!("Could not connect to {base}."))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let authorization = match api_key {
        Some(key) if !key.is_empty() => format!("Authorization: Bearer {key}\r\n"),
        _ => String::new(),
    };
    let request = format!(
        "GET /v1/models HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nAccept: application/json\r\n{authorization}\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|_| format!("Could not ask {base} for its models."))?;
    let mut bytes = Vec::new();
    stream
        .take(1_000_000)
        .read_to_end(&mut bytes)
        .map_err(|_| format!("{base} did not finish its model list."))?;
    let text = String::from_utf8_lossy(&bytes);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| format!("{base} returned an incomplete response."))?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("");
    if status != "200" {
        return Err(format!("{base} returned HTTP {status} for /v1/models."));
    }
    parse_models(body)
}

pub(super) fn configuration(record: &EndpointRecord, api_key: Option<&str>) -> Value {
    let key = record.model.replace('/', "-");
    let mut options = json!({ "baseURL": record.base_url });
    if let Some(api_key) = api_key.filter(|key| !key.is_empty()) {
        options["apiKey"] = json!(api_key);
    }
    let mut config = json!({
        "$schema": "https://opencode.ai/config.json",
        "model": format!("{}/{key}", record.provider_id),
        "small_model": format!("{}/{key}", record.provider_id),
        "enabled_providers": [record.provider_id],
        "share": "disabled"
    });
    let mut models = serde_json::Map::new();
    models.insert(
        key.clone(),
        json!({
            "id": record.model,
            "name": record.model,
            "tool_call": true,
            "limit": { "context": 32768, "output": 8192 }
        }),
    );
    let mut providers = serde_json::Map::new();
    providers.insert(
        record.provider_id.clone(),
        json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": record.name,
            "options": options,
            "models": models
        }),
    );
    config["provider"] = Value::Object(providers);
    config
}

pub(super) fn read_record(binding: &AccountBinding) -> Result<Option<EndpointRecord>, String> {
    let path = binding.directory.join("jackalope-endpoint.json");
    if !path.exists() {
        return Ok(None);
    }
    let record: EndpointRecord =
        serde_json::from_slice(&super::history::read_bounded(&path, 65536)?)
            .map_err(|_| "This endpoint account is unreadable. Connect it again.".to_string())?;
    normalize_base(&record.base_url)?;
    Ok(Some(record))
}

pub(super) fn runtime_overlay(binding: &AccountBinding) -> Result<Option<Value>, String> {
    let Some(record) = read_record(binding)? else {
        return Ok(None);
    };
    let api_key = super::agent_profiles::endpoint_api_key(binding)?;
    Ok(Some(configuration(&record, api_key.as_deref())))
}

#[tauri::command]
pub async fn openai_endpoint_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let (base, address, host) = normalize_base(&base_url)?;
    let key = api_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(key) = &key {
        if key.len() > 8192 || key.chars().any(char::is_control) {
            return Err("Enter a valid API key, or leave it empty.".into());
        }
    }
    fetch_models(&base, address, &host, key.as_deref())
}

#[tauri::command]
pub async fn openai_endpoint_connect(
    runtime: tauri::State<'_, super::tasks::TaskRuntime>,
    name: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<EndpointConnection, String> {
    runtime.access.ensure()?;
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Give the endpoint a name up to 80 characters.".into());
    }
    let (base, address, host) = normalize_base(&base_url)?;
    let provider = provider_id(&name)?;
    let key = api_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(key) = &key {
        if key.len() > 8192 || key.chars().any(char::is_control) {
            return Err("Enter a valid API key, or leave it empty.".into());
        }
    }
    let models = fetch_models(&base, address, &host, key.as_deref())?;
    let model = model.trim();
    if !models.iter().any(|candidate| candidate == model) {
        return Err("Choose a model from the server's list.".into());
    }
    let profile = super::agent_profiles::install_endpoint(
        &runtime.profiles_root(),
        &name,
        &base,
        &provider,
        model,
        &models,
        key.as_deref(),
    )?;
    Ok(EndpointConnection {
        profile_id: profile.id,
        name: profile.name,
        models,
        model: model.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_addresses_normalize_and_other_hosts_are_refused() {
        let (base, address, host) = normalize_base("http://127.0.0.1:1234").unwrap();
        assert_eq!(base, "http://127.0.0.1:1234/v1");
        assert_eq!(address.port(), 1234);
        assert_eq!(host, "127.0.0.1");
        assert!(normalize_base("http://127.0.0.1:1234/v1/").is_ok());
        assert!(normalize_base("http://localhost:1234/v1").is_ok());
        assert!(normalize_base("http://[::1]:1234/v1").is_ok());
        assert!(normalize_base("https://127.0.0.1:1234/v1").is_err());
        assert!(normalize_base("http://10.0.0.8:1234/v1").is_err());
        assert!(normalize_base("http://127.0.0.1:1234/v1/models").is_err());
    }

    #[test]
    fn model_lists_keep_usable_ids() {
        let models =
            parse_models(r#"{"data":[{"id":"llama"},{"id":"llama"},{"id":"bad id"}]}"#).unwrap();
        assert_eq!(models, ["llama"]);
        assert!(parse_models(r#"{"data":[]}"#).is_err());
    }
}
