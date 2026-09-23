use super::*;
use rmcp::schemars;

#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Search {
    pub query: String,
}
#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Document {
    pub slug: String,
}
#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ActionQuery {
    pub id: String,
}
#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Theme {
    pub appearance: Option<String>,
    pub accent: Option<String>,
    pub harmony: Option<String>,
    pub atmosphere: Option<u8>,
    #[schemars(description = "app or project. Project requires shared project context.")]
    pub scope: String,
}
#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Preferences {
    pub notifications: Option<String>,
    pub mascot_animations: Option<bool>,
    pub show_theme_picker: Option<bool>,
    pub auto_scroll_logs: Option<bool>,
    pub os_notifications: Option<bool>,
}
#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Navigate {
    pub destination: String,
}
#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Draft {
    pub prompt: String,
    pub project_id: String,
}

#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct TaskAction {
    pub run_id: String,
}

#[derive(Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct DefaultAgent {
    pub agent: String,
}

pub(super) fn catalog() -> Value {
    mcp::catalog()
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| format!("Invalid tool arguments: {e}"))
}

fn enum_value(value: &Option<String>, values: &[&str]) -> bool {
    value.as_ref().is_none_or(|v| values.contains(&v.as_str()))
}

impl Helper {
    pub(super) fn call(&self, name: &str, arguments: Value, source: &str) -> Result<Value, String> {
        if arguments.to_string().len() > 10_000 {
            return Err("Tool arguments are too large.".into());
        }
        let docs: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../../../packages/knowledge/catalog.json"
        ))
        .map_err(|_| "Bundled help unavailable")?;
        match name {
            "search_docs" => {
                let query = decode::<Search>(arguments)?.query;
                if query.len() > 300 {
                    return Err("Use a shorter search query.".into());
                }
                let hits = crate::commands::retrieval::search(&query);
                return Ok(
                    json!({"source":"Bundled official documentation for this app build", "results":hits.into_iter().take(5).map(|doc| json!({"slug":doc["slug"],"title":doc["title"],"description":doc["description"],"url":doc["url"]})).collect::<Vec<_>>()}),
                );
            }
            "read_doc" => {
                let slug = decode::<Document>(arguments)?.slug;
                return docs
                    .into_iter()
                    .find(|doc| doc["slug"] == slug)
                    .ok_or("Document not found. Search docs for its exact slug.".into());
            }
            _ => {}
        }
        let mut inner = self.inner.lock().unwrap();
        if source.starts_with("helper:") && inner.canceled.load(Ordering::SeqCst) {
            return Err("Stopped.".into());
        }
        if name == "get_action" {
            let query: ActionQuery = decode(arguments)?;
            let action = inner
                .view
                .actions
                .iter()
                .find(|a| a.id == query.id)
                .ok_or("Action not found")?;
            return Ok(
                json!({"id":action.id,"operation":action.operation,"status":action.status,"result":action.result}),
            );
        }
        if inner
            .context_at
            .is_none_or(|at| at.elapsed() > Duration::from_secs(15))
        {
            return Err(
                "App context is unavailable or stale. Open Jackalope and try again.".into(),
            );
        }
        let context = &inner.context;
        let read_key = match name {
            "get_app_context" => Some("app"),
            "get_preferences" => Some("preferences"),
            "list_agents" => Some("agents"),
            "list_projects" => Some("projects"),
            "list_tasks" => Some("tasks"),
            _ => None,
        };
        if let Some(key) = read_key {
            if arguments != json!({}) {
                return Err("This tool takes no arguments.".into());
            }
            return context.get(key).cloned().ok_or(
                "This context is not shared. Enable it in the helper's Context section.".into(),
            );
        }
        let (arguments, expected) = match name {
            "open_task" | "stop_task" => {
                let input: TaskAction = decode(arguments)?;
                let task = context
                    .get("tasks")
                    .and_then(Value::as_array)
                    .and_then(|tasks| tasks.iter().find(|t| t["id"] == input.run_id))
                    .ok_or("Choose a task ID from the shared task list.")?;
                if name == "stop_task"
                    && !["starting", "running"].contains(&task["status"].as_str().unwrap_or(""))
                {
                    return Err("This task is not running.".into());
                }
                (json!(input), json!({}))
            }
            "set_default_agent" => {
                let input: DefaultAgent = decode(arguments)?;
                let agent = context
                    .get("agents")
                    .and_then(Value::as_array)
                    .and_then(|agents| agents.iter().find(|a| a["id"] == input.agent))
                    .ok_or("Choose a configured agent from list_agents.")?;
                if agent["enabled"] != true || agent["available"] != true {
                    return Err(
                        "Choose an enabled, installed agent. Configure agents in the app first."
                            .into(),
                    );
                }
                (
                    json!(input),
                    json!({"defaultAgent":context["app"]["defaultAgent"]}),
                )
            }
            "set_theme" => {
                let input: Theme = decode(arguments)?;
                if !["app", "project"].contains(&input.scope.as_str())
                    || !enum_value(&input.appearance, &["light", "dark", "auto"])
                    || !enum_value(&input.harmony, &["single", "duo", "trio"])
                    || input.atmosphere.is_some_and(|v| v > 64)
                    || input.accent.as_ref().is_some_and(|v| {
                        v.len() != 7
                            || !v.starts_with('#')
                            || !v[1..].bytes().all(|c| c.is_ascii_hexdigit())
                    })
                {
                    return Err("Use app/project scope, light/dark/auto appearance, #RRGGBB accent, single/duo/trio harmony and atmosphere 0-64.".into());
                }
                if input.appearance.is_none()
                    && input.accent.is_none()
                    && input.harmony.is_none()
                    && input.atmosphere.is_none()
                {
                    return Err("Specify a theme change.".into());
                }
                let preferences = context
                    .get("preferences")
                    .ok_or("Share appearance/preferences context first")?;
                if input.scope == "project"
                    && context
                        .get("activeProjectId")
                        .and_then(Value::as_str)
                        .is_none()
                {
                    return Err("Share a selected project first.".into());
                }
                (
                    json!(input),
                    json!({"preferences":preferences,"projectId":context["activeProjectId"]}),
                )
            }
            "set_preferences" => {
                let input: Preferences = decode(arguments)?;
                if !enum_value(&input.notifications, &["all", "failures-only", "none"]) {
                    return Err("Notifications must be all, failures-only or none.".into());
                }
                let value = json!(input);
                if value.as_object().unwrap().values().all(Value::is_null) {
                    return Err("Specify a preference change.".into());
                }
                (
                    value,
                    context
                        .get("preferences")
                        .cloned()
                        .ok_or("Share preferences context first")?,
                )
            }
            "navigate" => {
                let input: Navigate = decode(arguments)?;
                if ![
                    "tasks",
                    "agents",
                    "agent-settings",
                    "mcp",
                    "usage",
                    "settings",
                    "schedules",
                    "project",
                    "worktrees",
                    "knowledge",
                ]
                .contains(&input.destination.as_str())
                {
                    return Err("Unknown app destination.".into());
                }
                (json!(input), json!({}))
            }
            "prepare_task" => {
                let input: Draft = decode(arguments)?;
                if input.prompt.trim().is_empty() || input.prompt.len() > 8_000 {
                    return Err("Use a task prompt between 1 and 8,000 bytes.".into());
                }
                if !context
                    .get("projects")
                    .and_then(Value::as_array)
                    .is_some_and(|projects| projects.iter().any(|p| p["id"] == input.project_id))
                {
                    return Err("Choose an ID from the shared projects list.".into());
                }
                (json!(input), json!({}))
            }
            _ => return Err("Unknown Jackalope operation.".into()),
        };
        if inner.view.actions.len() >= 100 {
            return Err("Start a new helper conversation before preparing more actions.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        inner.view.actions.push(Action {
            id: id.clone(),
            operation: name.into(),
            arguments: json!({"input":arguments,"expected":expected}),
            source: source.into(),
            status: "proposed".into(),
            created_at: Utc::now().timestamp_millis(),
            result: None,
        });
        self.save(&mut inner)?;
        Ok(
            json!({"status":"proposed","id":id,"message":"Prepared for review in the Jackalope helper. Nothing has changed yet. The user must apply this action there."}),
        )
    }
}
