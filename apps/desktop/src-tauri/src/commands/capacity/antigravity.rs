use super::*;
use crate::commands::{
    agent_profiles::{self, AccountBinding},
    process_control::ProcessTree,
};
use std::path::Path;

pub(in crate::commands) async fn output(
    binding: &AccountBinding,
    executable: &Path,
    args: &[&str],
) -> Result<String, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    agent_profiles::apply_binding(command.as_std_mut(), binding)?;
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start the Antigravity metadata reader.")?;
    let tree =
        match ProcessTree::attach_pid(child.id().ok_or("Antigravity metadata process exited.")?) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err(error);
            }
        };
    let result = timeout(Duration::from_secs(30), async {
        let mut bytes = Vec::new();
        child
            .stdout
            .take()
            .ok_or("Antigravity output unavailable.")?
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Could not read Antigravity metadata.")?;
        if bytes.len() > 1_048_576 {
            return Err("Antigravity metadata exceeded the response limit.".into());
        }
        if !child
            .wait()
            .await
            .map_err(|_| "Could not wait for Antigravity metadata.")?
            .success()
        {
            return Err(
                "Antigravity could not report metadata. Check its sign-in and CLI version.".into(),
            );
        }
        String::from_utf8(bytes).map_err(|_| "Antigravity returned invalid metadata.".into())
    })
    .await
    .unwrap_or_else(|_| {
        Err("Antigravity metadata refresh timed out. Check its sign-in and retry.".into())
    });
    tree.terminate();
    let _ = child.start_kill();
    let _ = timeout(Duration::from_secs(2), child.wait()).await;
    result
}

fn supports_commands(version: &str) -> bool {
    let values: Result<Vec<u64>, _> = version.trim().split('.').map(str::parse).collect();
    matches!(values.as_deref(), Ok([major, minor, patch]) if (*major, *minor, *patch) >= (1, 1, 11))
}

pub(in crate::commands) async fn require_commands(
    binding: &AccountBinding,
    executable: &Path,
) -> Result<(), String> {
    if !supports_commands(&output(binding, executable, &["--version"]).await?) {
        return Err("Update Antigravity CLI to 1.1.11 or later to read quota and models without a model request.".into());
    }
    Ok(())
}

fn parse(value: &Value, account: &str) -> Result<CapacityRecord, String> {
    if value["status"] != "SUCCESS"
        || value["command"]["name"] != "usage"
        || value["num_turns"] != 0
    {
        return Err("Antigravity did not return a read-only quota response.".into());
    }
    let groups = value["command"]["data"]["groups"]
        .as_array()
        .ok_or("Antigravity returned no quota groups.")?;
    let mut record = unavailable("antigravity", "reported", "Shared Antigravity subscription pools include usage outside Jackalope. Credit balances and Gemini API billing are separate. Account identity is not exposed by this response.", Some(account.into()));
    for group in groups.iter().take(32) {
        let Some(name) = group["name"].as_str().filter(|name| !name.is_empty()) else {
            continue;
        };
        for bucket in group["buckets"].as_array().into_iter().flatten().take(32) {
            if bucket["disabled"] == true {
                continue;
            }
            let remaining = bucket["remaining_fraction"]
                .as_f64()
                .filter(|n| n.is_finite() && (0.0..=1.0).contains(n))
                .map(|n| n * 100.0);
            let Some(window) = bucket["window"].as_str() else {
                continue;
            };
            record.windows.push(CapacityWindow {
                pool_id: format!(
                    "antigravity:unidentified:{}",
                    name.chars().take(100).collect::<String>()
                ),
                pool_name: name.chars().take(100).collect(),
                window: window.chars().take(100).collect(),
                used_percent: remaining.map(|n| 100.0 - n),
                remaining_percent: remaining,
                duration_minutes: match window {
                    "weekly" => Some(10080),
                    "5h" => Some(300),
                    _ => None,
                },
                resets_at: bucket["reset_time"]
                    .as_str()
                    .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                    .map(|time| time.timestamp()),
            });
        }
    }
    if record.windows.is_empty() {
        return Err("Antigravity returned no subscription windows for this account.".into());
    }
    record.observed_at = Some(Utc::now().to_rfc3339());
    Ok(record)
}

pub(super) async fn read_bound(binding: &AccountBinding) -> Result<CapacityRecord, String> {
    if binding.profile_id.is_some() {
        return Ok(unavailable("antigravity", "unsupported", "Gemini API-key profiles use separate API billing; Antigravity subscription quota does not apply.", Some(binding.label.clone())));
    }
    let executable = crate::commands::tasks::executable("antigravity")?;
    require_commands(binding, &executable).await?;
    let data = output(
        binding,
        &executable,
        &[
            "-p",
            "/usage",
            "--output-format",
            "json",
            "--print-timeout",
            "20s",
        ],
    )
    .await?;
    let value =
        serde_json::from_str(&data).map_err(|_| "Antigravity returned invalid quota JSON.")?;
    parse(&value, &binding.label)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn antigravity_quota_requires_metadata_and_keeps_pools_and_unknowns_distinct() {
        assert!(!supports_commands("1.1.10"));
        assert!(supports_commands("1.1.26"));
        assert!(supports_commands("1.2.0\n"));
        assert!(!supports_commands("unknown"));
        let value = json!({"status":"SUCCESS","num_turns":0,"command":{"name":"usage","data":{"groups":[{"name":"Gemini Models","buckets":[{"window":"weekly","remaining_fraction":0.57,"reset_time":"2030-01-01T00:00:00Z"},{"window":"5h","remaining_amount":100}]},{"name":"Claude and GPT models","buckets":[{"window":"weekly","remaining_fraction":1},{"window":"5h","remaining_fraction":0,"disabled":true}]}]}}});
        let result = parse(&value, "Current CLI account").unwrap();
        assert_eq!(result.windows.len(), 3);
        assert!((result.windows[0].remaining_percent.unwrap() - 57.0).abs() < 0.000001);
        assert_eq!(result.windows[1].remaining_percent, None);
        assert_ne!(result.windows[0].pool_id, result.windows[2].pool_id);
        assert!(result.windows[0].resets_at.is_some());
        assert_eq!(result.windows[0].duration_minutes, Some(10080));
        assert!(parse(
            &json!({"status":"SUCCESS","num_turns":1,"response":"100%"}),
            "Account"
        )
        .is_err());
    }
}
