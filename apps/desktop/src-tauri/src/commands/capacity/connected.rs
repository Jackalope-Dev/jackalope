use super::{client::Client, unavailable, CapacityRecord, CapacityWindow};
use chrono::Utc;
use serde_json::{json, Value};
use tokio::time::{timeout, Duration};

fn timestamp(value: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|time| time.timestamp())
        .filter(|time| *time > 0)
}

fn percentage(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite() && *n >= 0.0)
}

fn record(agent: &str, account: Option<String>, detail: &str) -> CapacityRecord {
    let mut record = unavailable(agent, "reported", detail, account);
    record.observed_at = Some(Utc::now().to_rfc3339());
    record
}

fn window(
    agent: &str,
    account: &str,
    name: &str,
    pool: &str,
    used: Option<f64>,
    minutes: Option<u64>,
    reset: Option<i64>,
) -> CapacityWindow {
    CapacityWindow {
        pool_id: format!("{agent}:{account}:{pool}"),
        pool_name: pool.into(),
        window: name.into(),
        used_percent: used,
        remaining_percent: used.map(|n| (100.0 - n).clamp(0.0, 100.0)),
        duration_minutes: minutes,
        resets_at: reset,
    }
}

fn parse_claude(value: &Value, account: Option<String>) -> CapacityRecord {
    if value["rate_limits_available"] == false {
        return unavailable("claude", "unsupported", "Subscription limits are unavailable for this CLI account. API-key and third-party provider accounts do not expose Claude plan allowances.", account);
    }
    let mut result = record("claude", account,
        "Shared Claude subscription limits, including work outside Jackalope. Usage credits are separate. Read through the CLI's experimental usage interface.");
    for (key, pool, minutes) in [
        ("five_hour", "Claude", 300),
        ("seven_day", "Claude", 10080),
        ("seven_day_oauth_apps", "Claude OAuth apps", 10080),
        ("seven_day_opus", "Claude Opus", 10080),
        ("seven_day_sonnet", "Claude Sonnet", 10080),
    ] {
        let raw = &value["rate_limits"][key];
        if raw.is_object() {
            result.windows.push(window(
                "claude",
                &result.account,
                key,
                pool,
                percentage(&raw["utilization"]),
                Some(minutes),
                timestamp(&raw["resets_at"]),
            ));
        }
    }
    if let Some(models) = value["rate_limits"]["model_scoped"].as_array() {
        for raw in models {
            if let Some(name) = raw["display_name"].as_str().filter(|n| !n.is_empty()) {
                let pool = format!("Claude {name}");
                if !result.windows.iter().any(|w| w.pool_name == pool) {
                    result.windows.push(window(
                        "claude",
                        &result.account,
                        "seven_day",
                        &pool,
                        percentage(&raw["utilization"]),
                        Some(10080),
                        timestamp(&raw["resets_at"]),
                    ));
                }
            }
        }
    }
    if result.windows.is_empty() {
        return unavailable("claude", "unavailable", "Claude returned no subscription windows. Check its sign-in, update Claude Code, and refresh.", Some(result.account));
    }
    result
}

fn cents(value: &Value) -> Option<f64> {
    let object = value.as_object()?;
    match object.get("val") {
        None => Some(0.0),
        Some(value) => value
            .as_i64()
            .or_else(|| value.as_str()?.parse().ok())
            .filter(|n| *n >= 0)
            .map(|n| n as f64),
    }
}

fn parse_grok(value: &Value, account: Option<String>) -> CapacityRecord {
    let config = &value["config"];
    if !config.is_object() || config.as_object().is_some_and(|c| c.is_empty()) {
        return unavailable(
            "grok",
            "unavailable",
            "Grok returned no subscription allowance. Check its sign-in and plan, then refresh.",
            account,
        );
    }
    let used = if config.get("creditUsagePercent").is_some() {
        percentage(&config["creditUsagePercent"])
    } else {
        cents(&config["monthlyLimit"])
            .filter(|limit| *limit > 0.0)
            .zip(cents(&config["used"]))
            .map(|(limit, used)| used / limit * 100.0)
    };
    let period = &config["currentPeriod"];
    let reset = timestamp(&period["end"]).or_else(|| timestamp(&config["billingPeriodEnd"]));
    let start = timestamp(&period["start"]).or_else(|| timestamp(&config["billingPeriodStart"]));
    let minutes = start
        .zip(reset)
        .and_then(|(start, end)| u64::try_from((end - start) / 60).ok())
        .filter(|n| *n > 0);
    let name = match period["type"].as_str() {
        Some("USAGE_PERIOD_TYPE_WEEKLY") => "weekly",
        Some("USAGE_PERIOD_TYPE_MONTHLY") => "monthly",
        _ => "billing",
    };
    let shared = config["isUnifiedBillingUser"] == true;
    let mut result = record(
        "grok",
        account,
        if shared {
            "Shared Grok allowance, including work outside Jackalope. Purchased credits and on-demand spending are separate."
        } else {
            "Grok Build included allowance. Purchased credits and on-demand spending are separate."
        },
    );
    if used.is_none() {
        result.detail.push_str(" Grok did not report a usage percentage or a complete used/limit pair for this account; remaining capacity is unknown.");
    }
    let pool = value["subscription_tier"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(if shared { "Grok" } else { "Grok Build" });
    result.windows.push(window(
        "grok",
        &result.account,
        name,
        pool,
        used,
        minutes,
        reset,
    ));
    result
}

pub(super) async fn read_claude() -> Result<CapacityRecord, String> {
    let mut client = Client::spawn(
        "claude",
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
        ],
    )?;
    let result = timeout(Duration::from_secs(20), async {
        let init = client.request(json!({"type":"control_request","request_id":"init","request":{"subtype":"initialize","hooks":{}}})).await?;
        let account = init["account"]["email"].as_str().filter(|s| !s.is_empty()).map(str::to_string);
        let usage = client.request(json!({"type":"control_request","request_id":"usage","request":{"subtype":"get_usage","skip_behaviors":true}})).await;
        Ok(match usage {
            Ok(value) => parse_claude(&value, account),
            Err(message) => unavailable("claude", "unavailable", &message, account),
        })
    }).await.unwrap_or_else(|_| Err("Claude quota refresh timed out. Check its sign-in and connection.".into()));
    client.close().await;
    result
}

pub(super) async fn read_grok() -> Result<CapacityRecord, String> {
    let mut client = Client::spawn("grok", &["agent", "--no-leader", "stdio"])?;
    let result = timeout(Duration::from_secs(20), async {
        client.request(json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"jackalope","version":env!("CARGO_PKG_VERSION")}}})).await?;
        let auth = client.request(json!({"jsonrpc":"2.0","id":1,"method":"_x.ai/auth/info","params":{}})).await?;
        let account = auth["email"].as_str().filter(|s| !s.is_empty()).map(str::to_string);
        let billing = client.request(json!({"jsonrpc":"2.0","id":2,"method":"_x.ai/billing","params":{}})).await;
        Ok(match billing {
            Ok(value) => parse_grok(&value, account),
            Err(message) => unavailable("grok", "unavailable", &message, account),
        })
    }).await.unwrap_or_else(|_| Err("Grok quota refresh timed out. Check its sign-in and connection.".into()));
    client.close().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_uses_percentage_units_and_keeps_model_pools_distinct() {
        let value = json!({"rate_limits_available":true,"rate_limits":{
            "five_hour":{"utilization":13,"resets_at":"2026-09-05T08:59:59Z"},
            "seven_day":{"utilization":58,"resets_at":null},
            "seven_day_opus":{"utilization":null},
            "model_scoped":[{"display_name":"Opus","utilization":90},{"display_name":"Fable","utilization":110}],
            "extra_usage":{"utilization":14}}});
        let result = parse_claude(&value, Some("user@example.com".into()));
        assert_eq!(result.windows.len(), 4);
        assert_eq!(result.windows[0].remaining_percent, Some(87.0));
        assert_eq!(result.windows[0].duration_minutes, Some(300));
        assert!(result.windows[0].resets_at.is_some());
        assert_eq!(result.windows[1].remaining_percent, Some(42.0));
        assert_eq!(result.windows[2].remaining_percent, None);
        assert_eq!(result.windows[3].used_percent, Some(110.0));
        assert_eq!(result.windows[3].remaining_percent, Some(0.0));
        assert_ne!(result.windows[2].pool_id, result.windows[3].pool_id);
        assert_eq!(
            parse_claude(&json!({"rate_limits_available":false}), None).status,
            "unsupported"
        );
        assert_eq!(parse_claude(&json!({}), None).status, "unavailable");
    }

    #[test]
    fn grok_prefers_reported_usage_and_period_over_legacy_fields() {
        let value = json!({"subscription_tier":"SuperGrok","config":{
            "creditUsagePercent":25,"monthlyLimit":{"val":100},"used":{"val":99},
            "currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2026-09-03T17:00:00Z","end":"2026-09-10T17:00:00Z"},
            "billingPeriodEnd":"2020-01-01T00:00:00Z","isUnifiedBillingUser":true}});
        let result = parse_grok(&value, Some("user@example.com".into()));
        assert_eq!(result.windows[0].remaining_percent, Some(75.0));
        assert_eq!(result.windows[0].duration_minutes, Some(10080));
        assert_eq!(result.windows[0].window, "weekly");
        assert_eq!(result.windows[0].pool_name, "SuperGrok");
        assert_eq!(
            result.windows[0].resets_at,
            timestamp(&value["config"]["currentPeriod"]["end"])
        );
    }

    #[test]
    fn grok_missing_usage_is_unknown_and_zero_is_only_explicit() {
        let absent = parse_grok(
            &json!({"config":{"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","end":"2026-09-10T17:00:00Z"}}}),
            None,
        );
        assert_eq!(absent.windows[0].remaining_percent, None);
        assert!(absent.windows[0].resets_at.is_some());
        for (config, expected) in [
            (json!({"creditUsagePercent":0}), Some(100.0)),
            (
                json!({"creditUsagePercent":null,"monthlyLimit":{"val":100},"used":{}}),
                None,
            ),
            (json!({"creditUsagePercent":-1}), None),
            (
                json!({"monthlyLimit":{"val":"200"},"used":{"val":"50"}}),
                Some(75.0),
            ),
            (json!({"monthlyLimit":{"val":200},"used":{}}), Some(100.0)),
            (json!({"monthlyLimit":{},"used":{}}), None),
            (json!({"monthlyLimit":{"val":200}}), None),
        ] {
            assert_eq!(
                parse_grok(&json!({"config":config}), None).windows[0].remaining_percent,
                expected
            );
        }
        assert_eq!(
            parse_grok(&json!({"config":null}), None).status,
            "unavailable"
        );
    }

    #[tokio::test]
    #[ignore = "Reads installed CLI accounts without sending prompts or starting model tasks"]
    async fn installed_connected_quota_readers() {
        let (claude, grok) = tokio::join!(read_claude(), read_grok());
        for result in [claude, grok] {
            let record = result.unwrap();
            assert_eq!(
                record.status, "reported",
                "{}: {}",
                record.agent, record.detail
            );
            assert!(!record.windows.is_empty());
            assert!(record.observed_at.is_some());
            println!(
                "{}: {} window(s), {} with reported percentages",
                record.agent,
                record.windows.len(),
                record
                    .windows
                    .iter()
                    .filter(|w| w.used_percent.is_some())
                    .count()
            );
        }
    }
}
