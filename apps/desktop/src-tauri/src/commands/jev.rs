use super::{account_storage, tasks::TaskRuntime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tauri::State;

pub(crate) const MODEL: &str = "jev-latest";
pub mod checks;
const ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";
const MAX_BYTES: usize = 256 * 1024;
use super::decisions::settings::{
    self, check_revision, directory, read as preferences, save, LOCK as SETTINGS_LOCK,
};

pub use super::decisions::DecisionMode as RoutingMode;
use super::decisions::JevFallback;

#[derive(Deserialize, Serialize)]
struct Connection {
    key: String,
    checked_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingSettings {
    mode: RoutingMode,
    default_mode: RoutingMode,
    project_mode: Option<RoutingMode>,
    jev_fallback: JevFallback,
    connected: bool,
    checked_at: Option<String>,
    revision: u64,
    has_key: bool,
    storage_error: Option<String>,
}

fn valid_key(key: &str) -> bool {
    !key.trim().is_empty()
        && key.len() <= 8192
        && key.is_ascii()
        && !key.chars().any(char::is_control)
}

fn connection(path: &Path) -> Result<Option<Connection>, String> {
    let Some(bytes) = account_storage::read(&path.join("api-key.bin"))? else {
        return Ok(None);
    };
    let value: Connection = serde_json::from_slice(&bytes)
        .map_err(|_| "Reconnect Jev: its saved API key could not be read.".to_string())?;
    if !valid_key(&value.key) {
        return Err("Reconnect Jev: its saved API key is invalid.".into());
    }
    Ok(Some(value))
}

fn status(path: &Path, project_id: Option<&str>) -> Result<RoutingSettings, String> {
    let preferences = preferences(path)?;
    let (connection, storage_error) = match connection(path) {
        Ok(value) => (value, None),
        Err(error) => (None, Some(error)),
    };
    Ok(RoutingSettings {
        mode: preferences.effective(project_id),
        default_mode: preferences.mode,
        project_mode: project_id.and_then(|id| preferences.project_modes.get(id).copied()),
        jev_fallback: preferences.effective_fallback(project_id),
        connected: connection.is_some(),
        checked_at: connection.map(|value| value.checked_at),
        revision: preferences.revision,
        has_key: path.join("api-key.bin").exists(),
        storage_error,
    })
}

pub(super) fn capacity_record(runtime: &TaskRuntime) -> Option<super::capacity::CapacityRecord> {
    directory(runtime).join("api-key.bin").exists().then(|| super::capacity::CapacityRecord {
        agent: "jev".into(), status: "unsupported".into(), account: "TypeSafe API key saved on this device".into(),
        source: "TypeSafe System One".into(), observed_at: None, windows: vec![],
        detail: "Jev token reports and estimated routing costs appear in Usage. Remaining balance, request limits and reset times are not available through this integration; check your TypeSafe account.".into(),
    })
}

pub(crate) fn key_for_routing(
    runtime: &TaskRuntime,
    project_id: &str,
) -> Result<Option<String>, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Routing settings are unavailable.")?;
    let path = directory(runtime);
    if preferences(&path)?.effective(Some(project_id)) != RoutingMode::Jev {
        return Ok(None);
    }
    connection(&path)?
        .map(|value| value.key)
        .ok_or_else(|| "Connect a Jev API key in Settings → Decisions.".into())
        .map(Some)
}

pub(crate) fn usage(value: &Value) -> super::tasks::Usage {
    match (
        value["usage"]["input_tokens"].as_u64(),
        value["usage"]["output_tokens"].as_u64(),
    ) {
        (Some(input), Some(output)) => super::tasks::Usage {
            input,
            output,
            reported: true,
            estimated_cost_usd: Some(input as f64 * 0.042 / 1_000_000.0),
            ..Default::default()
        },
        _ => Default::default(),
    }
}

#[tauri::command]
pub fn routing_settings(
    runtime: State<'_, TaskRuntime>,
    project_id: Option<String>,
) -> Result<RoutingSettings, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Routing settings are unavailable.")?;
    settings::validate_project(project_id.as_deref())?;
    status(&directory(&runtime), project_id.as_deref())
}

#[tauri::command]
pub fn routing_set_mode(
    runtime: State<'_, TaskRuntime>,
    mode: Option<RoutingMode>,
    revision: u64,
    project_id: Option<String>,
    jev_fallback: Option<JevFallback>,
) -> Result<RoutingSettings, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Routing settings are unavailable.")?;
    let path = directory(&runtime);
    let mut current = preferences(&path)?;
    check_revision(&current, revision)?;
    settings::validate_project(project_id.as_deref())?;
    if mode == Some(RoutingMode::Jev) && connection(&path)?.is_none() {
        return Err("Connect your Jev API key before using Jev routing.".into());
    }
    current.set_mode(project_id.as_deref(), mode, jev_fallback)?;
    save(&path, &mut current)?;
    status(&path, project_id.as_deref())
}

#[tauri::command]
pub async fn routing_connect(
    runtime: State<'_, TaskRuntime>,
    key: String,
    revision: u64,
    project_id: Option<String>,
) -> Result<RoutingSettings, String> {
    runtime.access.ensure()?;
    settings::validate_project(project_id.as_deref())?;
    if !valid_key(&key) {
        return Err("Enter a valid TypeSafe API key.".into());
    }
    let path = directory(&runtime);
    {
        let _guard = SETTINGS_LOCK
            .lock()
            .map_err(|_| "Routing settings are unavailable.")?;
        check_revision(&preferences(&path)?, revision)?;
    }
    let response = evaluate(key.trim(), &json!({
        "model": MODEL,
        "state": "Jackalope connection check. The requested answer is ready.",
        "questions": {"connection": {"type": "choice", "instructions": "Select the requested answer.", "criteria": {"ready": "The requested answer is ready.", "unavailable": "The requested answer is unavailable."}}}
    }), || false).await;
    checks::record(&path, response.as_ref().ok())?;
    let response = response?;
    validate_choice(
        &response["answers"]["connection"],
        &["ready", "unavailable"],
    )?;
    if response["answers"]["connection"]["choice"] != "ready" {
        return Err("Jev did not complete the connection check. Try again.".into());
    }
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Routing settings are unavailable.")?;
    let mut current = preferences(&path)?;
    check_revision(&current, revision)?;
    let value = Connection {
        key: key.trim().into(),
        checked_at: chrono::Utc::now().to_rfc3339(),
    };
    std::fs::create_dir_all(&path).map_err(|_| "Could not create secure Jev storage.")?;
    account_storage::write(
        &path.join("api-key.bin"),
        &serde_json::to_vec(&value).map_err(|_| "Could not prepare the Jev connection.")?,
    )?;
    save(&path, &mut current)?;
    status(&path, project_id.as_deref())
}

#[tauri::command]
pub fn routing_disconnect(
    runtime: State<'_, TaskRuntime>,
    revision: u64,
    project_id: Option<String>,
) -> Result<RoutingSettings, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Routing settings are unavailable.")?;
    let path = directory(&runtime);
    let mut current = preferences(&path)?;
    check_revision(&current, revision)?;
    if current.mode == RoutingMode::Jev {
        current.mode = RoutingMode::Deterministic;
    }
    for mode in current.project_modes.values_mut() {
        if *mode == RoutingMode::Jev {
            *mode = RoutingMode::Deterministic;
        }
    }
    save(&path, &mut current)?;
    account_storage::remove(&path.join("api-key.bin"))?;
    status(&path, project_id.as_deref())
}

pub(crate) async fn evaluate(
    key: &str,
    payload: &Value,
    canceled: impl Fn() -> bool,
) -> Result<Value, String> {
    evaluate_at(ENDPOINT, key, payload, canceled).await
}

pub(crate) fn check_request_size(payload: &Value) -> Result<(), String> {
    if serde_json::to_vec(payload)
        .map_err(|_| "Could not prepare Jev decisions.")?
        .len()
        > MAX_BYTES
    {
        return Err("This context is too large for Jev decisions.".into());
    }
    Ok(())
}

async fn evaluate_at(
    endpoint: &str,
    key: &str,
    payload: &Value,
    canceled: impl Fn() -> bool,
) -> Result<Value, String> {
    let body = serde_json::to_vec(payload).map_err(|_| "Could not prepare Jev routing.")?;
    if body.len() > MAX_BYTES {
        return Err("This routing context is too large for Jev routing.".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "Could not connect to Jev.")?;
    let request = async {
        let mut authorization = reqwest::header::HeaderValue::from_str(&format!("Bearer {key}"))
            .map_err(|_| "Enter a valid TypeSafe API key.")?;
        authorization.set_sensitive(true);
        let mut response = client
            .post(endpoint)
            .header(reqwest::header::AUTHORIZATION, authorization)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|_| "Jev could not be reached. Check your connection and try again.")?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 => "Jev rejected this key. Check your TypeSafe API key and model access.",
                429 => "Jev is at its request or usage limit. Check your TypeSafe account or try again later.",
                _ => "Jev is unavailable or rejected this request. Try again later.",
            }.to_string());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Jev's response was interrupted.")?
        {
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err("Jev's response exceeded its size limit.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| "Jev returned an unreadable response.".into())
    };
    tokio::pin!(request);
    loop {
        if canceled() {
            return Err("Jev routing was stopped.".into());
        }
        tokio::select! {
            result = &mut request => return result,
            _ = tokio::time::sleep(Duration::from_millis(50)) => {},
        }
    }
}

pub(crate) fn validate_choice(answer: &Value, options: &[&str]) -> Result<(), String> {
    let invalid = "Jev returned an invalid routing decision.";
    if answer["type"] != "choice" {
        return Err(invalid.into());
    }
    let selected = answer["choice"].as_str().ok_or(invalid)?;
    let confidence = answer["confidence"].as_f64().ok_or(invalid)?;
    let probabilities = answer["probabilities"].as_object().ok_or(invalid)?;
    if !options.contains(&selected)
        || !(0.0..=1.0).contains(&confidence)
        || probabilities.len() != options.len()
    {
        return Err(invalid.into());
    }
    let mut sum = 0.0;
    let selected_probability = probabilities
        .get(selected)
        .and_then(Value::as_f64)
        .ok_or(invalid)?;
    for option in options {
        let value = probabilities
            .get(*option)
            .and_then(Value::as_f64)
            .ok_or(invalid)?;
        if !(0.0..=1.0).contains(&value) || value > selected_probability + 0.000001 {
            return Err(invalid.into());
        }
        sum += value;
    }
    if (sum - 1.0).abs() > 0.01 {
        return Err(invalid.into());
    }
    Ok(())
}

pub(crate) fn validate_noul(answer: &Value) -> Result<f64, String> {
    let value = answer["noul"]
        .as_f64()
        .filter(|value| (0.0..=1.0).contains(value));
    if answer["type"] != "noul" {
        return Err("Jev returned an invalid tool-support assessment.".into());
    }
    value.ok_or_else(|| "Jev returned an invalid tool-support assessment.".into())
}

pub(crate) fn validate_score(answer: &Value, levels: usize) -> Result<(f64, f64), String> {
    let invalid = "Jev returned an invalid reasoning-fit assessment.";
    if !(2..=10).contains(&levels) {
        return Err(invalid.into());
    }
    if answer["type"] != "score" {
        return Err(invalid.into());
    }
    let confidence = answer["confidence"]
        .as_f64()
        .filter(|value| (0.0..=1.0).contains(value))
        .ok_or(invalid)?;
    let score = answer["score"]
        .as_f64()
        .filter(|value| (0.0..=(levels - 1) as f64).contains(value))
        .ok_or(invalid)?;
    let probabilities = answer["probabilities"]
        .as_object()
        .filter(|values| values.len() == levels)
        .ok_or(invalid)?;
    let mut sum = 0.0;
    let mut weighted = 0.0;
    for level in 0..levels {
        let value = probabilities
            .get(&level.to_string())
            .and_then(Value::as_f64)
            .filter(|value| (0.0..=1.0).contains(value))
            .ok_or(invalid)?;
        sum += value;
        weighted += level as f64 * value;
    }
    if (sum - 1.0).abs() > 0.01 || (score - weighted).abs() > 0.02 {
        return Err(invalid.into());
    }
    Ok((score, confidence))
}

#[cfg(test)]
mod tests;
