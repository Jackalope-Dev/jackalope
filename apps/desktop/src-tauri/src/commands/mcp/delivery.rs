use serde_json::{json, Map, Value};
use std::process::Command;

/// A variable as `command` will see it: its own setting, else the inherited one.
pub(in crate::commands) fn command_env(command: &Command, name: &str) -> Option<String> {
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
        let token = command_env(command, variable)
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

/// One `mcp` entry of OpenCode's inline configuration.
pub(in crate::commands) fn opencode_server(
    server: &Value,
    command: &Command,
) -> Result<Value, String> {
    let mut entry = if let Some(program) = server["command"].as_str() {
        let mut args = vec![json!(program)];
        args.extend(server["args"].as_array().into_iter().flatten().cloned());
        let environment = match server.get("env").filter(|value| !value.is_null()) {
            Some(value) => value
                .as_object()
                .filter(|env| env.values().all(Value::is_string))
                .cloned()
                .ok_or("Connection environment must contain string values.")?,
            None => Map::new(),
        };
        json!({"type":"local","command":args,"environment":environment,"enabled":true})
    } else {
        json!({"type":"remote","url":server["url"],"headers":headers(server,command)?,"enabled":true})
    };
    if let Some(timeout) = server["timeout"].as_u64() {
        entry["timeout"] = json!(timeout);
    }
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_tools_preserve_arguments_profiles_and_header_credentials() {
        let servers = json!({
            "local": {"command":"node","args":["a path/tool.js"],"env":{"MODE":"read"}},
            "remote": {"type":"http","url":"https://example.invalid/mcp","bearer_token_env_var":"JACKALOPE_TEST_TOKEN","timeout":2220000},
            "legacy": {"type":"sse","url":"https://example.invalid/sse"}
        });
        let servers = servers.as_object().unwrap();
        let mut command = Command::new("fixture");
        command.env("JACKALOPE_TEST_TOKEN", "fixture-token");
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
        let local = opencode_server(&servers["local"], &command).unwrap();
        assert_eq!(local["command"][1], "a path/tool.js");
        assert!(local.get("timeout").is_none());
        let remote = opencode_server(&servers["remote"], &command).unwrap();
        assert_eq!(remote["timeout"], 2220000);
        assert_eq!(remote["headers"]["Authorization"], "Bearer fixture-token");
        command.env_remove("JACKALOPE_TEST_TOKEN");
        assert!(acp_servers(servers, &command).is_err());
        assert!(opencode_server(&servers["remote"], &command).is_err());
    }

    #[test]
    fn opencode_local_tools_require_an_object_even_without_environment_overrides() {
        let command = Command::new("fixture");
        for env in [None, Some(Value::Null), Some(json!({}))] {
            let mut server = json!({"command":"node","args":["fixture.js"]});
            if let Some(env) = env {
                server["env"] = env;
            }
            assert_eq!(
                opencode_server(&server, &command).unwrap()["environment"],
                json!({})
            );
        }
        let invalid = json!({"command":"node","env":{"KEY":false}});
        assert!(opencode_server(&invalid, &command).is_err());
    }
}
