use serde_json::{json, Map, Value};
use std::process::Command;

fn environment(command: &Command, name: &str) -> Option<String> {
    command
        .get_envs()
        .find(|(key, _)| {
            if cfg!(windows) {
                key.to_string_lossy().eq_ignore_ascii_case(name)
            } else {
                *key == name
            }
        })
        .map(|(_, value)| value.map(|v| v.to_string_lossy().into_owned()))
        .unwrap_or_else(|| std::env::var(name).ok())
}

fn headers(server: &Value, command: &Command) -> Result<Map<String, Value>, String> {
    let mut headers = match server.get("headers") {
        None => Map::new(),
        Some(value) => value
            .as_object()
            .cloned()
            .ok_or("Connection headers must be an object.")?,
    };
    if let Some(variable) = server["bearer_token_env_var"].as_str() {
        let token = environment(command, variable)
            .filter(|value| !value.is_empty())
            .ok_or("The selected connection's bearer-token environment variable is unavailable.")?;
        headers.insert("Authorization".into(), json!(format!("Bearer {token}")));
    }
    if headers.values().any(|value| !value.is_string()) {
        return Err("Connection header values must be strings.".into());
    }
    Ok(headers)
}

pub(in crate::commands) fn acp_servers(
    servers: &Map<String, Value>,
    command: &Command,
) -> Result<Vec<Value>, String> {
    servers
        .iter()
        .map(|(name, server)| {
            if server["command"].is_string() {
                let env: Vec<_> = server["env"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(name, value)| json!({"name": name, "value": value}))
                    .collect();
                Ok(json!({"name":name,"command":server["command"],"args":server["args"],"env":env}))
            } else {
                let headers: Vec<_> = headers(server, command)?
                    .into_iter()
                    .map(|(name, value)| json!({"name":name,"value":value}))
                    .collect();
                Ok(json!({"name":name,"type":server["type"],"url":server["url"],"headers":headers}))
            }
        })
        .collect()
}

pub(in crate::commands) fn opencode_config(
    servers: &Map<String, Value>,
    command: &Command,
) -> Result<String, String> {
    let inherited = environment(command, "OPENCODE_CONFIG_CONTENT");
    let mut config = match inherited.filter(|value| !value.trim().is_empty()) {
        Some(value) => serde_json::from_str::<Value>(&value)
            .map_err(|_| "OPENCODE_CONFIG_CONTENT must contain valid JSON to add project tools.")?,
        None => json!({}),
    };
    if !config.is_object() || config.get("mcp").is_some_and(|value| !value.is_object()) {
        return Err("OpenCode's inline configuration must contain an MCP object.".into());
    }
    if config.get("mcp").is_none() {
        config["mcp"] = json!({});
    }
    for (name, server) in servers {
        let entry = if let Some(program) = server["command"].as_str() {
            let mut args = vec![json!(program)];
            args.extend(server["args"].as_array().into_iter().flatten().cloned());
            json!({"type":"local","command":args,"environment":server["env"],"enabled":true})
        } else {
            json!({"type":"remote","url":server["url"],"headers":headers(server,command)?,"enabled":true})
        };
        config["mcp"][name] = entry;
    }
    Ok(config.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_tools_preserve_arguments_profiles_and_header_credentials() {
        let servers = json!({
            "local": {"command":"node","args":["a path/tool.js"],"env":{"MODE":"read"}},
            "remote": {"type":"http","url":"https://example.invalid/mcp","bearer_token_env_var":"JACKALOPE_TEST_TOKEN"},
            "legacy": {"type":"sse","url":"https://example.invalid/sse"}
        });
        let servers = servers.as_object().unwrap();
        let mut command = Command::new("fixture");
        command.env("JACKALOPE_TEST_TOKEN", "fixture-token").env(
            "OPENCODE_CONFIG_CONTENT",
            r#"{"model":"provider/model","permission":"ask","mcp":{"existing":{"enabled":false}}}"#,
        );
        let acp = acp_servers(servers, &command).unwrap();
        let local = acp.iter().find(|server| server["name"] == "local").unwrap();
        let remote = acp
            .iter()
            .find(|server| server["name"] == "remote")
            .unwrap();
        let legacy = acp
            .iter()
            .find(|server| server["name"] == "legacy")
            .unwrap();
        assert_eq!(legacy["type"], "sse");
        assert!(local.get("type").is_none());
        assert_eq!(local["args"][0], "a path/tool.js");
        assert_eq!(remote["headers"][0]["value"], "Bearer fixture-token");
        let config: Value =
            serde_json::from_str(&opencode_config(servers, &command).unwrap()).unwrap();
        assert_eq!(config["permission"], "ask");
        assert_eq!(config["model"], "provider/model");
        assert_eq!(config["mcp"]["existing"]["enabled"], false);
        assert_eq!(config["mcp"]["local"]["command"][1], "a path/tool.js");
        command.env_remove("JACKALOPE_TEST_TOKEN");
        assert!(acp_servers(servers, &command).is_err());
        command.env("OPENCODE_CONFIG_CONTENT", "invalid");
        assert!(opencode_config(servers, &command).is_err());
    }
}
