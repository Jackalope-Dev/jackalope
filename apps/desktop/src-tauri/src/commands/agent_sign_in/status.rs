use super::super::{
    agent_profiles::{self, AccountBinding},
    capacity::client::Client,
};
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;
use tokio::time::{timeout, Duration};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub state: String,
    pub identity: Option<String>,
    pub detail: String,
    pub checked_at: String,
}

fn status(state: &str, identity: Option<String>, detail: &str) -> AccountStatus {
    AccountStatus {
        state: state.into(),
        identity,
        detail: detail.into(),
        checked_at: Utc::now().to_rfc3339(),
    }
}
fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
        .map(str::to_string)
}
fn parse_codex(value: &Value) -> AccountStatus {
    let account = &value["account"];
    match account["type"].as_str() {
        Some("chatgpt") => status(
            "signedIn",
            text(&account["email"]),
            "Codex reports a ChatGPT sign-in.",
        ),
        Some("apiKey") => status(
            "configured",
            None,
            "Codex reports an API key. Account identity and key validity are not verified.",
        ),
        _ if account.is_null() && value.get("account").is_some() => {
            status("signedOut", None, "Sign in to use this account.")
        }
        _ => status(
            "unknown",
            None,
            "This Codex version did not report a recognized account. Update it and check again.",
        ),
    }
}
fn parse_claude(value: &Value) -> AccountStatus {
    match value["loggedIn"].as_bool() {
        Some(true) => status(
            "signedIn",
            text(&value["email"]),
            "Claude reports a sign-in. This check does not run a model request.",
        ),
        Some(false) => status("signedOut", None, "Sign in to use this account."),
        _ => status(
            "unknown",
            None,
            "This Claude version did not report account status. Update it and check again.",
        ),
    }
}
fn parse_grok(value: &Value) -> AccountStatus {
    if let Some(email) = text(&value["email"]) {
        status(
            "signedIn",
            Some(email),
            "Grok reports this signed-in identity.",
        )
    } else {
        status(
            "unknown",
            None,
            "Grok did not report a signed-in identity. Sign in or check again.",
        )
    }
}

async fn read_rpc(binding: &AccountBinding) -> Result<AccountStatus, String> {
    let codex = binding.adapter == "codex";
    let args: &[&str] = if codex {
        &["app-server", "--listen", "stdio://"]
    } else {
        &["agent", "--no-leader", "stdio"]
    };
    let mut client = Client::spawn_bound(binding, args)?;
    let result = timeout(Duration::from_secs(20), async {
        if codex {
            client.request(json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"jackalope","version":env!("CARGO_PKG_VERSION")}}})).await?;
            client.notify(json!({"method":"initialized"})).await?;
            let value = client.request(json!({"id":1,"method":"account/read","params":{"refreshToken":false}})).await?;
            Ok(parse_codex(&value))
        } else {
            client.request(json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"jackalope","version":env!("CARGO_PKG_VERSION")}}})).await?;
            let value = client.request(json!({"jsonrpc":"2.0","id":1,"method":"_x.ai/auth/info","params":{}})).await?;
            Ok(parse_grok(&value))
        }
    }).await.unwrap_or_else(|_| Err("Account check timed out".into()));
    client.close().await;
    result
}

async fn check(binding: AccountBinding) -> Result<AccountStatus, String> {
    if binding.profile_id.is_some() && matches!(binding.adapter.as_str(), "gemini" | "goose") {
        let files: &[&str] = if binding.adapter == "gemini" {
            &[".gemini/oauth_creds.json", ".gemini/gemini-credentials.json"]
        } else {
            &["config/config.yaml"]
        };
        let configured = files.iter().any(|file| binding.directory.join(file).is_file());
        return Ok(if configured {
            status("configured", None, "Local account setup is saved. Account identity and credential validity have not been verified.")
        } else {
            status("signedOut", None, "Complete account setup in the provider terminal.")
        });
    }
    if binding.profile_id.is_some() && matches!(binding.adapter.as_str(), "antigravity" | "aider") {
        return Ok(if agent_profiles::has_api_key(&binding)? {
            status("configured", None, "An API key is saved for this account. The provider checks it when a task starts.")
        } else {
            status("signedOut", None, "Connect a provider API key for this account.")
        });
    }
    if ["codex", "grok"].contains(&binding.adapter.as_str()) {
        return read_rpc(&binding).await;
    }
    if binding.adapter != "claude" {
        return Ok(status("unknown", None, "This agent does not report a verified account identity here. Complete account setup; the provider validates credentials when a task starts."));
    }
    tokio::task::spawn_blocking(move || {
        let mut command =
            std::process::Command::new(super::super::tasks::executable(&binding.adapter)?);
        command
            .args(["auth", "status"])
            .current_dir(std::env::temp_dir());
        agent_profiles::apply_binding(&mut command, &binding)?;
        let output = super::super::process_control::run(command, Duration::from_secs(20))?;
        if output.timed_out || output.truncated {
            return Err("Account check timed out or exceeded its output limit".into());
        }
        let value: Value =
            serde_json::from_str(&output.stdout).map_err(|_| "Account status was not reported")?;
        Ok(parse_claude(&value))
    })
    .await
    .map_err(|_| "Account check stopped".to_string())?
}

#[tauri::command]
pub async fn agent_profile_status(
    runtime: State<'_, super::super::tasks::TaskRuntime>,
    agent: String,
    id: Option<String>,
) -> Result<AccountStatus, String> {
    let binding = agent_profiles::bind_account(&runtime.profiles_root(), &agent, id.as_deref())?;
    if super::super::tasks::executable(&agent).is_err() {
        return Ok(status(
            "notInstalled",
            None,
            "Install this agent, then check again.",
        ));
    }
    Ok(check(binding).await.unwrap_or_else(|_| {
        status(
            "unknown",
            None,
            "Could not check this account. Check your connection and agent version, then retry.",
        )
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "Reads installed CLI account status in empty isolated profiles; no login or model request"]
    async fn isolated_installed_account_status_trial() {
        for agent in ["codex", "claude"] {
            let directory = std::env::temp_dir()
                .join(format!("jackalope-account-check-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&directory).unwrap();
            let result = check(AccountBinding {
                adapter: agent.into(),
                profile_id: Some("trial".into()),
                directory: directory.clone(),
                label: "Isolated trial".into(),
            })
            .await
            .unwrap();
            assert_eq!(
                result.state, "signedOut",
                "An empty {agent} profile must not inherit another account"
            );
            assert!(result.identity.is_none());
            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn account_identity_comes_only_from_provider_fields() {
        assert_eq!(parse_codex(&json!({"account":{"type":"chatgpt","email":"work@example.test","accessToken":"secret"}})).identity.as_deref(), Some("work@example.test"));
        assert_eq!(parse_codex(&json!({"account":null})).state, "signedOut");
        assert_eq!(parse_codex(&json!({})).state, "unknown");
        assert_eq!(
            parse_codex(&json!({"account":{"type":"apiKey","key":"secret"}})).state,
            "configured"
        );
        assert_eq!(
            parse_claude(&json!({"loggedIn":false,"email":"old@example.test"})).identity,
            None
        );
        assert_eq!(
            parse_claude(&json!({"loggedIn":true,"email":"work@example.test"})).state,
            "signedIn"
        );
        assert_eq!(parse_grok(&json!({})).state, "unknown");
        assert!(text(&json!("bad\nidentity")).is_none());
    }
}
