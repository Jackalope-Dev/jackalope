use super::*;
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Question {
    Choice {
        instructions: Value,
        criteria: BTreeMap<String, Value>,
    },
    Score {
        instructions: Value,
        criteria: Vec<Value>,
    },
    Noul {
        instructions: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        criteria: Option<NoulCriteria>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NoulCriteria {
    #[serde(rename = "true")]
    #[serde(skip_serializing_if = "Option::is_none")]
    yes: Option<String>,
    #[serde(rename = "false")]
    #[serde(skip_serializing_if = "Option::is_none")]
    no: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Source {
    #[serde(rename_all = "camelCase")]
    File {
        path: String,
        start_line: Option<usize>,
        lines: Option<usize>,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        result_handle: String,
        json_pointer: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Input {
    #[schemars(
        description = "Task evidence as text, an object or an array. Jev sees this as input, alongside native task.objective/task.requirements and named sources. Never include credentials."
    )]
    pub state: Value,
    #[schemars(
        description = "Batch 1-32 independent choice, score or noul questions. Each instruction must identify evidence paths, e.g. sources.report.report.items[0]. IDs only route answers; they are not shown to Jev."
    )]
    pub questions: BTreeMap<String, Question>,
    #[serde(default)]
    #[schemars(
        description = "Up to eight named file excerpts or captured tool results, read directly by Jackalope. File reads follow workspace/source restrictions; captured handles belong to this attempt. Missing sources fail explicitly."
    )]
    pub sources: BTreeMap<String, Source>,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn content(value: &Value, limit: usize, allow_null: bool) -> bool {
    ((allow_null && value.is_null())
        || value.as_str().is_some_and(|text| !text.trim().is_empty())
        || value.is_object()
        || value.is_array())
        && value.to_string().len() <= limit
}

impl Input {
    pub(crate) fn validate_preparation(&self) -> Result<(), String> {
        self.validate()?;
        if self
            .sources
            .values()
            .any(|source| matches!(source, Source::ToolResult { .. }))
        {
            return Err("Task preparation accepts file sources only; captured tool results do not exist before execution.".into());
        }
        Ok(())
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        if !content(&self.state, 96_000, false)
            || self.questions.is_empty()
            || self.questions.len() > 32
            || self.sources.len() > 8
            || self
                .sources
                .keys()
                .chain(self.questions.keys())
                .any(|id| !identifier(id))
        {
            return Err("Use text/object/array state up to 96 KB, 1-32 questions and up to eight named sources. IDs use letters, digits, underscores or hyphens, up to 80 bytes.".into());
        }
        for question in self.questions.values() {
            let (instructions, valid) = match question {
                Question::Choice {
                    instructions,
                    criteria,
                } => (
                    instructions,
                    !criteria.is_empty()
                        && criteria.len() <= 255
                        && criteria.iter().all(|(key, value)| {
                            !key.trim().is_empty()
                                && key.len() <= 200
                                && !key.chars().any(char::is_control)
                                && content(value, 2000, true)
                        }),
                ),
                Question::Score {
                    instructions,
                    criteria,
                } => (
                    instructions,
                    (2..=10).contains(&criteria.len())
                        && criteria.iter().all(|value| content(value, 2000, false)),
                ),
                Question::Noul {
                    instructions,
                    criteria,
                } => (
                    instructions,
                    criteria.as_ref().is_none_or(|criteria| {
                        [&criteria.yes, &criteria.no]
                            .into_iter()
                            .flatten()
                            .all(|text| !text.trim().is_empty() && text.len() <= 2000)
                    }),
                ),
            };
            if !valid || !content(instructions, 4000, false) {
                return Err("Every question needs bounded self-contained instructions. Choice accepts 1-255 described options, Score 2-10 ordered levels, and Noul optional true/false descriptions.".into());
            }
        }
        Ok(())
    }
}

pub(super) async fn prepare(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: Input,
) -> Result<(Value, Value), String> {
    input.validate()?;
    let mut sources = serde_json::Map::new();
    let mut provenance = serde_json::Map::new();
    for (name, source) in input.sources {
        let (value, metadata) = match source {
            Source::File {
                path,
                start_line,
                lines,
            } => {
                let workspace = run.workspace.clone();
                let result = tauri::async_runtime::spawn_blocking(move || {
                    crate::commands::codebase::context_read::read(
                        std::path::Path::new(&workspace),
                        crate::commands::codebase::context_read::Input {
                            blocks: vec![crate::commands::codebase::context_read::BlockRequest {
                                path,
                                start_line,
                                lines,
                                known_hash: None,
                            }],
                            query: None,
                        },
                    )
                })
                .await
                .map_err(|_| "Source read interrupted.")??;
                let block = &result["blocks"][0];
                if block["error"].is_string() {
                    return Err(format!(
                        "Source {name}: {}",
                        block["error"].as_str().unwrap()
                    ));
                }
                let mut metadata = block.clone();
                metadata
                    .as_object_mut()
                    .ok_or("Missing source metadata.")?
                    .remove("text");
                (block.clone(), metadata)
            }
            Source::ToolResult {
                result_handle,
                json_pointer,
            } => {
                let value = runtime
                    .mcp_broker
                    .captured_json(&run.id, &result_handle, json_pointer.as_deref())
                    .await?;
                let metadata = json!({"kind":"tool_result","resultHandle":result_handle,"jsonPointer":json_pointer,"sha256":super::super::context::fingerprint(&value),"bytes":value.to_string().len()});
                (value, metadata)
            }
        };
        sources.insert(name.clone(), value);
        provenance.insert(name, metadata);
    }
    let payload = json!({"model":jev::MODEL,"state":{"task":{"objective":run.prompt,"requirements":run.contract.requirements},"input":input.state,"sources":sources},"questions":input.questions});
    if payload.to_string().len() > 128_000 {
        return Err("Jev task evidence exceeds 128 KB. Narrow source ranges or JSON pointers; no evidence was silently truncated.".into());
    }
    Ok((payload, Value::Object(provenance)))
}
