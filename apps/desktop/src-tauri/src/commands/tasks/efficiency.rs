use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Efficiency {
    pub launch_prompt_bytes: u64,
    pub launches: u64,
    pub verification_calls: u64,
    pub verification_failures: u64,
    pub verification_stdout_bytes: u64,
    pub verification_delivered_bytes: u64,
    pub tool_calls: std::collections::BTreeMap<String, u64>,
    pub tool_observations_truncated: bool,
    #[serde(skip)]
    seen_tools: std::collections::HashSet<String>,
}

impl Efficiency {
    fn tool(&mut self, id: &str, name: &str) {
        if self.seen_tools.contains(id) {
            return;
        }
        if self.seen_tools.len() >= 8192 || id.len() > 300 {
            self.tool_observations_truncated = true;
            return;
        }
        self.seen_tools.insert(id.into());
        let name: String = name.chars().take(100).collect();
        let name = if self.tool_calls.len() >= 100 && !self.tool_calls.contains_key(&name) {
            "other".into()
        } else {
            name
        };
        *self.tool_calls.entry(name).or_default() += 1;
    }

    pub fn observe(&mut self, event: &serde_json::Value, adapter: &str) {
        if adapter == "codex" && event["type"] == "item.completed" {
            let item = &event["item"];
            if let (Some(id), Some(kind)) = (item["id"].as_str(), item["type"].as_str()) {
                if [
                    "command_execution",
                    "mcp_tool_call",
                    "web_search",
                    "file_change",
                ]
                .contains(&kind)
                {
                    let name = if kind == "mcp_tool_call" {
                        format!(
                            "{}:{}",
                            item["server"].as_str().unwrap_or("mcp"),
                            item["tool"].as_str().unwrap_or("unknown")
                        )
                    } else {
                        kind.into()
                    };
                    self.tool(id, &name);
                }
            }
        }
        if ["claude", "grok"].contains(&adapter) && event["type"] == "assistant" {
            for block in event["message"]["content"].as_array().into_iter().flatten() {
                if block["type"] == "tool_use" {
                    if let (Some(id), Some(name)) = (block["id"].as_str(), block["name"].as_str()) {
                        self.tool(id, name);
                    }
                }
            }
        }
    }
    pub fn verification(&mut self, stdout: &str, response: &serde_json::Value, success: bool) {
        self.verification_calls += 1;
        self.verification_failures += u64::from(!success);
        self.verification_stdout_bytes += stdout.len() as u64;
        self.verification_delivered_bytes +=
            response["stdout"].as_str().unwrap_or_default().len() as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_unique_calls_without_storing_arguments_or_double_counting_stream_updates() {
        let mut metrics = Efficiency::default();
        let event = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"a","name":"Bash","input":{"secret":"never store"}}]}});
        metrics.observe(&event, "claude");
        metrics.observe(&event, "claude");
        assert_eq!(metrics.tool_calls["Bash"], 1);
        let saved = serde_json::to_string(&metrics).unwrap();
        assert!(!saved.contains("secret"));
        assert!(!saved.contains("seen_tools"));
        let restored: Efficiency = serde_json::from_str("{}").unwrap();
        assert_eq!(restored.launches, 0);
    }
}
