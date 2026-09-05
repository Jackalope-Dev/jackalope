use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    process::Stdio,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
    time::timeout,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityWindow {
    pub pool_id: String,
    pub pool_name: String,
    pub window: String,
    pub used_percent: Option<f64>,
    pub remaining_percent: Option<f64>,
    pub duration_minutes: Option<u64>,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityRecord {
    pub agent: String,
    pub status: String,
    pub account: String,
    pub source: String,
    pub observed_at: Option<String>,
    pub detail: String,
    pub windows: Vec<CapacityWindow>,
}

#[derive(Default)]
struct Cache {
    checked: Option<Instant>,
    codex: Option<CapacityRecord>,
}

#[derive(Default)]
pub struct CapacityService(Mutex<Cache>);

fn unavailable(agent: &str, status: &str, detail: &str) -> CapacityRecord {
    CapacityRecord {
        agent: agent.into(),
        status: status.into(),
        account: "Current CLI account".into(),
        source: if agent == "codex" {
            "Codex account/rateLimits/read"
        } else {
            "No connected quota adapter"
        }
        .into(),
        observed_at: None,
        detail: detail.into(),
        windows: vec![],
    }
}

fn parse_codex(value: &Value) -> Result<CapacityRecord, String> {
    let pools: Vec<(String, &Value)> = if let Some(map) = value["rateLimitsByLimitId"].as_object() {
        map.iter().map(|(id, pool)| (id.clone(), pool)).collect()
    } else if value["rateLimits"].is_object() {
        vec![(
            value["rateLimits"]["limitId"]
                .as_str()
                .unwrap_or("codex")
                .into(),
            &value["rateLimits"],
        )]
    } else {
        return Err(
            "Codex did not return subscription quota windows. Check the CLI sign-in and try again."
                .into(),
        );
    };
    let account_id = value["accountId"].as_str();
    let mut windows = vec![];
    for (id, pool) in pools {
        for window in ["primary", "secondary"] {
            let raw = &pool[window];
            if !raw.is_object() {
                continue;
            }
            let used = raw["usedPercent"]
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0.0);
            windows.push(CapacityWindow {
                pool_id: format!(
                    "codex:{}:{id}",
                    account_id.unwrap_or("local-account-unidentified")
                ),
                pool_name: pool["limitName"].as_str().unwrap_or(&id).to_string(),
                window: window.into(),
                used_percent: used,
                remaining_percent: used.map(|n| (100.0 - n).clamp(0.0, 100.0)),
                duration_minutes: raw["windowDurationMins"].as_u64().filter(|n| *n > 0),
                resets_at: raw["resetsAt"].as_i64().filter(|n| *n > 0),
            });
        }
    }
    if windows.is_empty() {
        return Err("Codex returned no subscription quota windows for this account.".into());
    }
    Ok(CapacityRecord {
        agent: "codex".into(), status: "reported".into(), account: "Current Codex CLI account".into(),
        source: "Codex account/rateLimits/read".into(), observed_at: Some(Utc::now().to_rfc3339()),
        detail: if account_id.is_some() {
            "Shared across this account, including work outside Jackalope. Credit balances are not included."
        } else {
            "Account-wide windows. This CLI did not expose a stable account identity; cross-account pooling is unavailable."
        }.into(), windows,
    })
}

async fn response<R: AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
    expected: u64,
    bytes: &mut usize,
) -> Result<Value, String> {
    loop {
        let mut line = vec![];
        let size = (&mut *reader)
            .take(262_145)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| "Could not read the Codex quota response".to_string())?;
        *bytes += size;
        if size > 262_144 || *bytes > 1_048_576 {
            return Err("Codex quota output exceeded the response limit".into());
        }
        if size == 0 {
            return Err("Codex closed before returning quota information".into());
        }
        let value: Value = serde_json::from_slice(&line)
            .map_err(|_| "Codex returned an invalid quota response".to_string())?;
        if value["id"].as_u64() != Some(expected) {
            continue;
        }
        if value.get("error").is_some() {
            return Err("Codex could not read subscription limits. Check its sign-in and network connection, then refresh.".into());
        }
        return value
            .get("result")
            .cloned()
            .ok_or_else(|| "Codex returned no quota result".into());
    }
}

async fn read_codex() -> Result<CapacityRecord, String> {
    let executable = super::tasks::executable("codex")?;
    let mut command = Command::new(executable);
    command
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start Codex to read its quota".to_string())?;
    let result = timeout(Duration::from_secs(15), async {
        let mut input = child.stdin.take().ok_or("Codex quota input unavailable")?;
        let mut output = BufReader::new(child.stdout.take().ok_or("Codex quota output unavailable")?);
        let mut bytes = 0;
        let initialize = json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"jackalope","title":"Jackalope","version":"0.1.0"}}});
        input.write_all(format!("{initialize}\n").as_bytes()).await.map_err(|_| "Could not initialize Codex quota reader")?;
        response(&mut output, 0, &mut bytes).await?;
        input.write_all(b"{\"method\":\"initialized\",\"params\":{}}\n{\"id\":1,\"method\":\"account/rateLimits/read\"}\n").await.map_err(|_| "Could not request Codex quota")?;
        parse_codex(&response(&mut output, 1, &mut bytes).await?)
    }).await.unwrap_or_else(|_| Err("Codex quota refresh timed out after 15 seconds. Check its sign-in and network connection.".into()));
    let _ = child.start_kill();
    let _ = timeout(Duration::from_secs(2), child.wait()).await;
    result
}

fn failed_refresh(previous: Option<&CapacityRecord>, message: &str) -> CapacityRecord {
    if let Some(previous) = previous {
        let mut record = previous.clone();
        record.status = "stale".into();
        record.detail = format!("{message} Values below are the last successful snapshot.");
        record
    } else {
        unavailable("codex", "unavailable", message)
    }
}

fn current_snapshot(mut record: CapacityRecord, now: i64) -> CapacityRecord {
    let expired = record
        .windows
        .iter()
        .any(|window| window.resets_at.is_some_and(|reset| reset <= now));
    let old = record
        .observed_at
        .as_ref()
        .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
        .is_some_and(|time| now - time.timestamp() > 300);
    if record.status == "reported" && (expired || old) {
        record.status = "stale".into();
        record.detail = "This snapshot is old or a reported window has ended. Refresh before using it to decide where to send work.".into();
    }
    record
}

#[tauri::command]
pub async fn capacity_snapshot(
    service: State<'_, CapacityService>,
    refresh: Option<bool>,
) -> Result<Vec<CapacityRecord>, String> {
    let mut cache = service.0.lock().await;
    let age = cache.checked.map(|time| time.elapsed());
    let should_refresh = age.is_none()
        || (refresh.unwrap_or(false) && age.is_some_and(|age| age >= Duration::from_secs(60)));
    if should_refresh {
        cache.codex = Some(match read_codex().await {
            Ok(record) => record,
            Err(error) => failed_refresh(
                cache.codex.as_ref().filter(|r| r.observed_at.is_some()),
                &error,
            ),
        });
        cache.checked = Some(Instant::now());
    }
    let mut records = vec![current_snapshot(
        cache
            .codex
            .clone()
            .unwrap_or_else(|| unavailable("codex", "unavailable", "No quota snapshot yet")),
        Utc::now().timestamp(),
    )];
    for (agent, detail) in [
        ("claude", "Quota refresh is not connected. Claude exposes subscription windows through its interactive status line after a response; Jackalope's headless runner does not collect that yet."),
        ("grok", "Quota refresh is not connected. This Grok CLI adapter has no verified standalone subscription balance interface."),
    ] {
        records.push(if super::tasks::executable(agent).is_ok() { unavailable(agent, "unsupported", detail) }
            else { unavailable(agent, "notInstalled", "Install this agent to connect it. Remaining capacity is unknown.") });
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "Reads the locally signed-in Codex account; no agent task is started"]
    async fn installed_codex_quota_read() {
        let record = read_codex().await.unwrap();
        assert_eq!(record.status, "reported");
        assert!(!record.windows.is_empty());
        assert!(record.observed_at.is_some());
    }

    #[test]
    fn prefers_pools_without_double_counting_legacy_or_missing_windows() {
        let record = parse_codex(&json!({"accountId":"account-a","rateLimits":{"primary":{"usedPercent":99}},"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":1800000000},"secondary":{"usedPercent":null}}}})).unwrap();
        assert_eq!(record.windows.len(), 2);
        assert_eq!(record.windows[0].remaining_percent, Some(75.0));
        assert_eq!(record.windows[0].pool_id, "codex:account-a:codex");
        assert_eq!(record.windows[1].remaining_percent, None);
        assert_eq!(record.windows[1].resets_at, None);
    }

    #[test]
    fn legacy_and_exhausted_windows_preserve_source_values() {
        let record = parse_codex(&json!({"rateLimits":{"primary":{"usedPercent":110}}})).unwrap();
        assert_eq!(record.windows[0].used_percent, Some(110.0));
        assert_eq!(record.windows[0].remaining_percent, Some(0.0));
        assert!(parse_codex(&json!({"rateLimits":null})).is_err());
        assert!(parse_codex(&json!({"rateLimitsByLimitId":{}})).is_err());
    }

    #[test]
    fn refresh_error_keeps_original_observation_time_and_marks_stale() {
        let record = parse_codex(&json!({"rateLimits":{"primary":{"usedPercent":20}}})).unwrap();
        let stale = failed_refresh(Some(&record), "Connection failed");
        assert_eq!(stale.status, "stale");
        assert_eq!(stale.observed_at, record.observed_at);
        assert_eq!(stale.windows[0].remaining_percent, Some(80.0));
        assert!(failed_refresh(None, "Offline").windows.is_empty());
    }

    #[test]
    fn old_or_reset_windows_cannot_claim_current_capacity() {
        let mut record =
            parse_codex(&json!({"rateLimits":{"primary":{"usedPercent":20,"resetsAt":1000}}}))
                .unwrap();
        assert_eq!(current_snapshot(record.clone(), 1001).status, "stale");
        record.windows[0].resets_at = None;
        record.observed_at = Some("2020-01-01T00:00:00Z".into());
        assert_eq!(
            current_snapshot(record, Utc::now().timestamp()).status,
            "stale"
        );
    }

    #[tokio::test]
    async fn protocol_bounds_and_error_payload_are_safe() {
        let mut bytes = 0;
        let mut reader =
            BufReader::new(&b"{\"id\":1,\"error\":{\"message\":\"secret upstream data\"}}\n"[..]);
        assert!(!response(&mut reader, 1, &mut bytes)
            .await
            .unwrap_err()
            .contains("secret"));
        let oversized = vec![b'x'; 262_145];
        let mut reader = BufReader::new(oversized.as_slice());
        assert!(response(&mut reader, 1, &mut 0)
            .await
            .unwrap_err()
            .contains("limit"));
    }
}
