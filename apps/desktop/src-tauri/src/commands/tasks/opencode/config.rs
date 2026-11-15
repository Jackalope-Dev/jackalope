//! The inline configuration an OpenCode launch receives in `OPENCODE_CONFIG_CONTENT`.

use serde_json::{json, Map, Value};
use std::process::Command;

const VARIABLE: &str = "OPENCODE_CONFIG_CONTENT";

/// Starts from the configuration the process would inherit, collects each
/// launch step's additions in memory and is written to the command once.
pub(in crate::commands) struct OpenCodeConfig {
    value: Value,
    changed: bool,
}

impl OpenCodeConfig {
    pub fn read(command: &Command) -> Result<Self, String> {
        let inherited = crate::commands::mcp::command_env(command, VARIABLE);
        let mut value = match inherited.filter(|value| !value.trim().is_empty()) {
            Some(value) => serde_json::from_str::<Value>(&value).map_err(|_| {
                "OPENCODE_CONFIG_CONTENT must contain valid JSON to add project tools."
            })?,
            None => json!({}),
        };
        if !value.is_object() || value.get("mcp").is_some_and(|value| !value.is_object()) {
            return Err("OpenCode's inline configuration must contain an MCP object.".into());
        }
        if value.get("mcp").is_none() {
            value["mcp"] = json!({});
        }
        Ok(Self {
            value,
            changed: false,
        })
    }

    /// The configuration in `slot`, read from `command` the first time a step needs it.
    pub fn get<'a>(slot: &'a mut Option<Self>, command: &Command) -> Result<&'a mut Self, String> {
        if slot.is_none() {
            *slot = Some(Self::read(command)?);
        }
        Ok(slot.as_mut().expect("read above"))
    }

    /// Keeps the server session going after the user denies a permission.
    pub fn continue_on_deny(&mut self) -> Result<(), String> {
        if self
            .value
            .get("experimental")
            .is_some_and(|value| !value.is_object())
        {
            return Err("OpenCode experimental configuration must be an object.".into());
        }
        if self.value.get("experimental").is_none() {
            self.value["experimental"] = json!({});
        }
        self.value["experimental"]["continue_loop_on_deny"] = json!(true);
        self.changed = true;
        Ok(())
    }

    pub fn add_mcp(
        &mut self,
        servers: &Map<String, Value>,
        command: &Command,
    ) -> Result<(), String> {
        let entries = servers
            .iter()
            .map(|(name, server)| -> Result<(String, Value), String> {
                Ok((
                    name.clone(),
                    crate::commands::mcp::opencode_server(server, command)?,
                ))
            })
            .collect::<Result<Vec<_>, String>>()?;
        for (name, entry) in entries {
            self.value["mcp"][name.as_str()] = entry;
        }
        self.changed = true;
        Ok(())
    }

    pub fn check_plugins(&self) -> Result<(), String> {
        if self
            .value
            .get("plugin")
            .is_some_and(|value| !value.is_array())
        {
            return Err("OpenCode plugins must be an array.".into());
        }
        Ok(())
    }

    pub fn add_plugin(&mut self, url: &str) -> Result<(), String> {
        self.check_plugins()?;
        if self.value.get("plugin").is_none() {
            self.value["plugin"] = json!([]);
        }
        self.value["plugin"]
            .as_array_mut()
            .expect("checked above")
            .push(json!(url));
        self.changed = true;
        Ok(())
    }

    /// Writes the configuration if any step changed it; otherwise the command
    /// keeps whatever it inherits.
    pub fn apply(self, command: &mut Command) {
        if self.changed {
            command.env(VARIABLE, self.value.to_string());
        }
    }

    #[cfg(test)]
    pub fn value(&self) -> &Value {
        &self.value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_tools_keep_the_inherited_configuration() {
        let servers = json!({
            "local": {"command":"node","args":["a path/tool.js"]},
            "remote": {"type":"http","url":"https://example.invalid/mcp","timeout":2220000}
        });
        let servers = servers.as_object().unwrap();
        let mut command = Command::new("fixture");
        command.env(
            VARIABLE,
            r#"{"model":"provider/model","permission":"ask","mcp":{"existing":{"enabled":false}}}"#,
        );
        let mut config = OpenCodeConfig::read(&command).unwrap();
        config.add_mcp(servers, &command).unwrap();
        config.apply(&mut command);
        let written: Value =
            serde_json::from_str(&crate::commands::mcp::command_env(&command, VARIABLE).unwrap())
                .unwrap();
        assert_eq!(written["permission"], "ask");
        assert_eq!(written["model"], "provider/model");
        assert_eq!(written["mcp"]["existing"]["enabled"], false);
        assert_eq!(written["mcp"]["local"]["command"][1], "a path/tool.js");
        assert_eq!(written["mcp"]["remote"]["timeout"], 2220000);
        command.env(VARIABLE, "invalid");
        assert!(OpenCodeConfig::read(&command).is_err());
    }

    #[test]
    fn an_unchanged_configuration_is_not_written() {
        let mut command = Command::new("fixture");
        command.env(VARIABLE, r#"{"model":"provider/model"}"#);
        OpenCodeConfig::read(&command).unwrap().apply(&mut command);
        assert_eq!(
            crate::commands::mcp::command_env(&command, VARIABLE).as_deref(),
            Some(r#"{"model":"provider/model"}"#)
        );
    }
}
