use super::*;
use crate::commands::agent_profiles::AccountBinding;
use std::io::Read;
use std::path::Path;

fn read_private(path: &Path) -> Result<String, String> {
    let file =
        std::fs::File::open(path).map_err(|_| "Kimi account configuration is unavailable.")?;
    let mut bytes = Vec::new();
    file.take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read Kimi account configuration.")?;
    if bytes.len() > 1_048_576 {
        return Err("Kimi account configuration exceeded the size limit.".into());
    }
    String::from_utf8(bytes).map_err(|_| "Kimi account configuration is invalid.".into())
}

fn managed_account(config: &toml::Value) -> Result<(String, String), String> {
    let provider = config
        .get("providers")
        .and_then(|v| v.get("managed:kimi-code"))
        .ok_or("Configure a managed Kimi Code account to read its quota.")?;
    let base = provider
        .get("base_url")
        .and_then(toml::Value::as_str)
        .unwrap_or("https://api.kimi.com/coding/v1")
        .trim_end_matches('/');
    if ![
        "https://api.kimi.com/coding/v1",
        "https://api.kimi.ai/coding/v1",
    ]
    .contains(&base)
    {
        return Err("Quota is unavailable for a custom Kimi provider endpoint.".into());
    }
    let key = provider
        .get("oauth")
        .and_then(|v| v.get("key"))
        .and_then(toml::Value::as_str)
        .unwrap_or("oauth/kimi-code");
    let name = key.strip_prefix("oauth/").unwrap_or(key);
    if name.is_empty()
        || name.len() > 100
        || name.starts_with('.')
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("Kimi's credential reference is invalid.".into());
    }
    Ok((format!("{base}/usages"), format!("{name}.json")))
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|n| n.is_finite() && *n >= 0.0)
}

pub(in crate::commands) fn uses_membership(binding: &AccountBinding, model: Option<&str>) -> bool {
    let Ok(text) = read_private(&binding.directory.join("config.toml")) else {
        return false;
    };
    let Ok(config) = toml::from_str::<toml::Value>(&text) else {
        return false;
    };
    let Some(alias) = model.or_else(|| config.get("default_model").and_then(toml::Value::as_str))
    else {
        return false;
    };
    config
        .get("models")
        .and_then(|models| models.get(alias))
        .and_then(|model| model.get("provider"))
        .and_then(toml::Value::as_str)
        == Some("managed:kimi-code")
}

fn parse(value: &Value, account: &str) -> CapacityRecord {
    let mut record = unavailable(
        "kimi",
        "unavailable",
        "Kimi returned no usable quota windows.",
        Some(account.into()),
    );
    let mut rows = vec![("weekly".to_string(), &value["usage"], Some(10080))];
    for (index, limit) in value["limits"]
        .as_array()
        .into_iter()
        .flatten()
        .take(32)
        .enumerate()
    {
        let multiplier = match limit["window"]["timeUnit"].as_str() {
            Some("TIME_UNIT_MINUTE") => Some(1),
            Some("TIME_UNIT_HOUR") => Some(60),
            Some("TIME_UNIT_DAY") => Some(1440),
            Some("TIME_UNIT_WEEK") => Some(10080),
            _ => None,
        };
        let minutes = limit["window"]["duration"]
            .as_u64()
            .or_else(|| limit["window"]["duration"].as_str()?.parse().ok())
            .zip(multiplier)
            .and_then(|(n, unit)| n.checked_mul(unit))
            .filter(|n| *n > 0);
        let name = limit["name"]
            .as_str()
            .filter(|name| !name.is_empty())
            .map(|name| name.chars().take(100).collect())
            .unwrap_or_else(|| format!("limit-{}", index + 1));
        rows.push((name, &limit["detail"], minutes));
    }
    for (name, row, minutes) in rows {
        let Some((used, limit)) =
            number(&row["used"]).zip(number(&row["limit"]).filter(|n| *n > 0.0))
        else {
            continue;
        };
        let percent = (used / limit * 100.0).clamp(0.0, 100.0);
        record.windows.push(CapacityWindow {
            pool_id: "kimi:unidentified:kimi-code".into(),
            pool_name: "Kimi Code membership".into(),
            window: name,
            used_percent: Some(percent),
            remaining_percent: Some(100.0 - percent),
            duration_minutes: minutes,
            resets_at: row["resetTime"]
                .as_str()
                .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                .map(|time| time.timestamp()),
        });
    }
    if !record.windows.is_empty() {
        record.status = "reported".into();
        record.observed_at = Some(Utc::now().to_rfc3339());
        record.detail = "Kimi Code membership windows include activity outside Jackalope. Extra-usage balances and other billing limits are not included.".into();
    }
    record
}

pub(super) async fn read_bound(binding: &AccountBinding) -> Result<CapacityRecord, String> {
    if ["KIMI_CODE_BASE_URL", "KIMI_CODE_OAUTH_HOST"]
        .iter()
        .any(|key| std::env::var(key).is_ok_and(|v| !v.is_empty()))
    {
        return Err("Refresh quota in Kimi while an endpoint override is configured.".into());
    }
    let config: toml::Value =
        toml::from_str(&read_private(&binding.directory.join("config.toml"))?)
            .map_err(|_| "Kimi account configuration is invalid.")?;
    let (url, name) = managed_account(&config)?;
    let credentials: Value = serde_json::from_str(&read_private(
        &binding.directory.join("credentials").join(name),
    )?)
    .map_err(|_| "Kimi credentials are unavailable. Sign in with the selected profile.")?;
    let token = credentials["access_token"]
        .as_str()
        .filter(|token| !token.is_empty() && token.len() < 65536)
        .ok_or("Kimi has no usable access token. Sign in with the selected profile.")?;
    if credentials["expires_at"]
        .as_f64()
        .is_none_or(|expiry| expiry <= Utc::now().timestamp() as f64)
    {
        return Err(
            "Kimi's access token expired. Refresh its sign-in before reading quota.".into(),
        );
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Could not start the Kimi quota reader.")?;
    let mut response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Kimi quota could not be refreshed.")?;
    if !response.status().is_success() {
        return Err(
            "Kimi rejected the quota request. Refresh the selected profile's sign-in.".into(),
        );
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read Kimi quota.")?
    {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err("Kimi quota response exceeded its size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Kimi returned an invalid quota response.")?;
    Ok(parse(&value, &binding.label))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kimi_quota_keeps_missing_data_unknown_and_credentials_bound() {
        let config: toml::Value = toml::from_str("[providers.\"managed:kimi-code\"]\nbase_url='https://api.kimi.com/coding/v1'\n[providers.\"managed:kimi-code\".oauth]\nkey='oauth/kimi-code-env-example'").unwrap();
        assert_eq!(
            managed_account(&config).unwrap().1,
            "kimi-code-env-example.json"
        );
        let mut bad = config.clone();
        bad["providers"]["managed:kimi-code"]["base_url"] =
            toml::Value::String("https://example.invalid/coding/v1".into());
        assert!(managed_account(&bad).is_err());
        bad = config;
        bad["providers"]["managed:kimi-code"]["oauth"]["key"] =
            toml::Value::String("../../other".into());
        assert!(managed_account(&bad).is_err());
        let record = parse(
            &json!({"usage":{"used":"25","limit":"100","resetTime":"2030-01-01T00:00:00Z"},"limits":[{"name":"five-hour","window":{"duration":5,"timeUnit":"TIME_UNIT_HOUR"},"detail":{"used":10,"limit":20}},{"detail":{"limit":20}}]}),
            "Work",
        );
        assert_eq!(record.status, "reported");
        assert_eq!(record.windows.len(), 2);
        assert_eq!(record.windows[0].remaining_percent, Some(75.0));
        assert_eq!(record.windows[1].duration_minutes, Some(300));
        assert!(parse(&json!({"usage":{"limit":100}}), "Work")
            .windows
            .is_empty());
    }
}
