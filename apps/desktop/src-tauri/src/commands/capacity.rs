use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    process::Stdio,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::{process::Command, sync::Mutex, time::timeout};

pub(in crate::commands) mod antigravity;
mod connected;
pub(in crate::commands) mod kimi;
mod routing_cache;

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
    records: std::collections::HashMap<&'static str, CapacityRecord>,
}

#[derive(Default)]
pub struct CapacityService(Mutex<Cache>);

fn unavailable(agent: &str, status: &str, detail: &str, account: Option<String>) -> CapacityRecord {
    CapacityRecord {
        agent: agent.into(),
        status: status.into(),
        account: account.unwrap_or_else(|| "Account identity not available for this agent".into()),
        source: super::agents::find(agent)
            .and_then(|agent| agent.quota_source.as_deref())
            .unwrap_or("No connected quota adapter")
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
        agent: "codex".into(), status: "reported".into(),
        account: account_id.map(|id| format!("Codex account {id}")).unwrap_or_else(|| "Current Codex CLI account (identity not exposed)".into()),
        source: "Codex account/rateLimits/read".into(), observed_at: Some(Utc::now().to_rfc3339()),
        detail: if account_id.is_some() {
            "Shared across this account, including work outside Jackalope. Credit balances are not included."
        } else {
            "Account-wide windows. This CLI did not expose a stable account identity; cross-account pooling is unavailable."
        }.into(), windows,
    })
}

#[cfg(test)]
async fn read_codex(profiles_root: &std::path::Path) -> Result<CapacityRecord, String> {
    let binding = super::agent_profiles::bind_account(profiles_root, "codex", None)?;
    read_codex_bound(&binding).await
}

async fn read_codex_bound(
    binding: &super::agent_profiles::AccountBinding,
) -> Result<CapacityRecord, String> {
    let mut client =
        super::cli_rpc::Client::spawn_bound(binding, &["app-server", "--listen", "stdio://"])?;
    let result = timeout(Duration::from_secs(15), async {
        let initialize = json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"jackalope","title":"Jackalope","version":"0.1.0"}}});
        client.request(initialize).await?;
        client.notify(json!({"method":"initialized","params":{}})).await?;
        let limits = client
            .request(json!({"id":1,"method":"account/rateLimits/read"}))
            .await
            .map_err(|failure| match failure.error {
                super::cli_rpc::RpcError::Rejected => "Codex could not read subscription limits. Check its sign-in and network connection, then refresh.".to_string(),
                _ => failure.message(),
            })?;
        parse_codex(&limits)
    }).await.unwrap_or_else(|_| Err("Codex quota refresh timed out after 15 seconds. Check its sign-in and network connection.".into()));
    client.close().await;
    result
}

async fn account_snapshot(root: &std::path::Path, adapter: &str) -> Result<CapacityRecord, String> {
    let binding = super::agent_profiles::bind_account(root, adapter, None)?;
    Ok(routing_snapshot(&binding).await)
}

pub(in crate::commands) async fn routing_snapshot(
    binding: &super::agent_profiles::AccountBinding,
) -> CapacityRecord {
    type RoutingCache = routing_cache::RoutingCache<(String, std::path::PathBuf), CapacityRecord>;
    static CACHE: std::sync::OnceLock<RoutingCache> = std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let key = (binding.adapter.clone(), binding.directory.clone());
    let record = cache.get(key, refresh_routing_snapshot(binding)).await;
    current_snapshot(record, Utc::now().timestamp())
}

async fn refresh_routing_snapshot(
    binding: &super::agent_profiles::AccountBinding,
) -> CapacityRecord {
    let result = match binding.adapter.as_str() {
        "codex" => read_codex_bound(binding).await,
        "claude" => connected::read_claude_bound(binding).await,
        "grok" => connected::read_grok_bound(binding).await,
        "kimi" => kimi::read_bound(binding).await,
        "antigravity" => antigravity::read_bound(binding).await,
        _ => {
            return unavailable(
                &binding.adapter,
                "unsupported",
                "No supported account-quota interface is connected for this provider.",
                None,
            )
        }
    };
    result
        .map(|record| current_snapshot(record, Utc::now().timestamp()))
        .unwrap_or_else(|message| {
            unavailable(
                &binding.adapter,
                "unavailable",
                &format!("{message} Remaining capacity is unknown."),
                None,
            )
        })
}

pub(in crate::commands) async fn routing_snapshots(
    bindings: Vec<super::agent_profiles::AccountBinding>,
    canceled: impl Fn() -> bool,
) -> Result<Vec<CapacityRecord>, String> {
    let mut results = vec![None; bindings.len()];
    let mut pending = bindings.into_iter().enumerate();
    let mut active = tokio::task::JoinSet::new();
    let started = Instant::now();
    loop {
        while active.len() < 4 {
            let Some((index, binding)) = pending.next() else {
                break;
            };
            active.spawn(async move { (index, routing_snapshot(&binding).await) });
        }
        if canceled() || started.elapsed() > Duration::from_secs(60) {
            active.shutdown().await;
            return Err(if canceled() {
                "Routing was stopped."
            } else {
                "Quota discovery took too long. Retry after checking the enabled accounts."
            }
            .into());
        }
        if active.is_empty() {
            break;
        }
        if let Ok(Some(result)) = timeout(Duration::from_millis(50), active.join_next()).await {
            let (index, record) = match result {
                Ok(record) => record,
                Err(_) => {
                    active.shutdown().await;
                    return Err("An account capacity check stopped unexpectedly.".into());
                }
            };
            results[index] = Some(record);
        }
    }
    results
        .into_iter()
        .map(|record| record.ok_or_else(|| "An account capacity check did not complete.".into()))
        .collect()
}

/// Agents whose account quota Jackalope reads, in display order.
fn quota_agents() -> impl Iterator<Item = &'static str> {
    super::agents::all()
        .iter()
        .filter(|agent| agent.capabilities.capacity)
        .map(|agent| agent.id.as_str())
}

fn connected_refresh(
    agent: &str,
    previous: Option<&CapacityRecord>,
    result: Result<CapacityRecord, String>,
) -> CapacityRecord {
    match result {
        Ok(record) => record,
        Err(message) => {
            if super::tasks::executable(agent).is_err() {
                return unavailable(agent, "notInstalled", &message, None);
            }
            if let Some(previous) = previous.filter(|r| r.observed_at.is_some()) {
                let mut record = previous.clone();
                record.status = "stale".into();
                record.detail = format!("{message} Showing the previous account snapshot; its current sign-in and remaining capacity could not be verified.");
                record
            } else {
                unavailable(agent, "unavailable", &message, None)
            }
        }
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

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::capacity::capacity_snapshot,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub async fn capacity_snapshot(
    service: State<'_, CapacityService>,
    runtime: State<'_, super::tasks::TaskRuntime>,
    refresh: Option<bool>,
) -> Result<Vec<CapacityRecord>, String> {
    let mut cache = service.0.lock().await;
    let age = cache.checked.map(|time| time.elapsed());
    let should_refresh = age.is_none()
        || (refresh.unwrap_or(false) && age.is_some_and(|age| age >= Duration::from_secs(60)));
    if should_refresh {
        let profiles_root = runtime.profiles_root();
        let mut reads = tokio::task::JoinSet::new();
        for agent in quota_agents() {
            let root = profiles_root.clone();
            reads.spawn(async move { (agent, account_snapshot(&root, agent).await) });
        }
        while let Some(read) = reads.join_next().await {
            let (agent, result) = read.map_err(|error| error.to_string())?;
            let record = connected_refresh(agent, cache.records.get(agent), result);
            cache.records.insert(agent, record);
        }
        cache.checked = Some(Instant::now());
    }
    let mut records: Vec<_> = quota_agents()
        .map(|agent| {
            current_snapshot(
                cache.records.get(agent).cloned().unwrap_or_else(|| {
                    unavailable(agent, "unavailable", "No quota snapshot yet", None)
                }),
                Utc::now().timestamp(),
            )
        })
        .collect();
    if let Some(record) = super::jev::capacity_record(&runtime) {
        records.push(record);
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_confirmed_account_change_or_unsupported_plan_discards_old_windows() {
        let mut previous =
            parse_codex(&json!({"rateLimits":{"primary":{"usedPercent":20}}})).unwrap();
        previous.agent = "claude".into();
        previous.account = "old@example.com".into();
        for status in ["unavailable", "unsupported"] {
            let next = unavailable(
                "claude",
                status,
                "No subscription data",
                Some("new@example.com".into()),
            );
            let result = connected_refresh("claude", Some(&previous), Ok(next));
            assert_eq!(result.account, "new@example.com");
            assert_eq!(result.status, status);
            assert!(result.windows.is_empty());
            assert!(result.observed_at.is_none());
        }
    }

    #[tokio::test]
    #[ignore = "Reads the locally signed-in Codex account; no agent task is started"]
    async fn installed_codex_quota_read() {
        let record = read_codex(&std::env::temp_dir().join("jackalope-no-profile-test"))
            .await
            .unwrap();
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
        let stale = connected_refresh("codex", Some(&record), Err("Connection failed".into()));
        if super::super::tasks::executable("codex").is_err() {
            assert_eq!(stale.status, "notInstalled");
        } else {
            assert_eq!(stale.status, "stale");
            assert_eq!(stale.observed_at, record.observed_at);
            assert_eq!(stale.windows[0].remaining_percent, Some(80.0));
        }
        assert!(connected_refresh("codex", None, Err("Offline".into()))
            .windows
            .is_empty());
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
}
