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
    /// Workspace-relative paths this attempt opened or edited, taken only from known path
    /// arguments. Tool arguments are otherwise never stored; these feed the repository map
    /// of a later task in the same project, so it can rank the area that was worked in.
    pub touched_paths: std::collections::BTreeSet<String>,
    #[serde(skip)]
    seen_tools: std::collections::HashSet<String>,
}

/// Argument names the supported CLIs use for a file the agent reads or edits.
const PATH_KEYS: &[&str] = &[
    "file_path",
    "filePath",
    "path",
    "target_file",
    "notebook_path",
    "new_path",
];
const MAX_TOUCHED_PATHS: usize = 200;

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

    /// Records a path argument, normalized to a workspace-relative form. Absolute paths and
    /// parent traversals are dropped rather than stored, so nothing outside the project is kept.
    fn touched(&mut self, input: &serde_json::Value) {
        if self.touched_paths.len() >= MAX_TOUCHED_PATHS {
            return;
        }
        for key in PATH_KEYS {
            let Some(raw) = input[*key].as_str() else {
                continue;
            };
            let path = raw.replace('\\', "/");
            let path = path.trim_start_matches("./");
            if path.is_empty()
                || path.len() > 200
                || path.starts_with('/')
                || path.starts_with("..")
                || path.chars().nth(1) == Some(':')
            {
                continue;
            }
            self.touched_paths.insert(path.to_owned());
        }
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
                    self.touched(item);
                    for change in item["changes"].as_array().into_iter().flatten() {
                        self.touched(change);
                    }
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
                        self.touched(&block["input"]);
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

    #[test]
    fn records_workspace_paths_only_and_never_content_or_locations_outside_the_project() {
        let mut metrics = Efficiency::default();
        for (index, input) in [
            serde_json::json!({"file_path":"src/lib/usage.ts","content":"never store"}),
            serde_json::json!({"target_file":".\\apps\\desktop\\src\\App.tsx"}),
            serde_json::json!({"path":"/etc/passwd"}),
            serde_json::json!({"path":"C:/Users/someone/.ssh/id_rsa"}),
            serde_json::json!({"path":"../../outside.ts"}),
            serde_json::json!({"command":"grep -r token ."}),
        ]
        .into_iter()
        .enumerate()
        {
            metrics.observe(
                &serde_json::json!({"type":"assistant","message":{"content":[
                    {"type":"tool_use","id":format!("call-{index}"),"name":"read_file","input":input}
                ]}}),
                "grok",
            );
        }
        assert_eq!(
            metrics.touched_paths.iter().cloned().collect::<Vec<_>>(),
            ["apps/desktop/src/App.tsx", "src/lib/usage.ts"]
        );
        let saved = serde_json::to_string(&metrics).unwrap();
        assert!(!saved.contains("never store"));
        assert!(!saved.contains("passwd"));
        assert!(!saved.contains("id_rsa"));
    }
}
