use super::*;

pub(super) const TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub(super) fn configure(cmd: &mut Command, workspace: &str, session: Option<&str>) {
    cmd.args([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--disable-slash-commands",
        "--print-timeout",
        "30m",
        "--add-dir",
        workspace,
    ]);
    if let Some(session) = session {
        cmd.args(["--conversation", session]);
    }
}

pub(super) fn input(prompt: &str, workspace: &str) -> String {
    let shell = if cfg!(windows) {
        "\nFor Windows shell tools, use PowerShell statements directly or a .ps1 file with -File. Do not nest a double-quoted powershell -Command script inside PowerShell: it expands variables before execution and can expose credentials. Never print environment credentials."
    } else {
        ""
    };
    let content = format!("Jackalope assigned workspace: {workspace}\nUse this absolute directory for project files, including on continuation. Do not search for a different checkout or use Antigravity's scratch directory for project edits.{shell}\n\n{prompt}");
    format!(
        "{}\n",
        serde_json::json!({"event":"user","message":{"content":content}})
    )
}

#[derive(Default)]
pub(super) struct Stream {
    initialized: bool,
    completed: bool,
    session: Option<String>,
    text_step: Option<u64>,
    usage: HashMap<u64, Usage>,
    resumed: bool,
}

impl Stream {
    pub(super) fn new(session: Option<String>) -> Self {
        Self {
            resumed: session.is_some(),
            session,
            ..Self::default()
        }
    }

    fn session(&mut self, run: &mut TaskRun, value: &Value) -> bool {
        let Some(id) = value.as_str().filter(|id| {
            !id.is_empty()
                && id.len() <= 200
                && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        }) else {
            run.error
                .get_or_insert("Antigravity returned an invalid conversation ID.".into());
            return false;
        };
        if self
            .session
            .as_deref()
            .is_some_and(|expected| expected != id)
        {
            run.error.get_or_insert("Antigravity returned a different conversation. Start a new task instead of continuing this attempt.".into());
            return false;
        }
        self.session = Some(id.into());
        run.session_id = Some(id.into());
        true
    }

    pub(super) fn consume(&mut self, run: &mut TaskRun, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            run.error.get_or_insert("Antigravity returned malformed streaming output. Update agy and inspect diagnostics.".into());
            return;
        };
        match event["event"].as_str() {
            Some("init") => {
                if self.initialized || self.completed {
                    run.error.get_or_insert(
                        "Antigravity returned an unexpected stream initialization.".into(),
                    );
                    return;
                }
                self.initialized = self.session(run, &event["conversation_id"]);
                if let Some(model) = event["init"]["model"].as_str() {
                    run.model = Some(model.chars().take(160).collect());
                }
                let mode = event["init"]["permission_mode"]
                    .as_str()
                    .unwrap_or("not reported");
                activity(run, &format!("Antigravity CLI permission mode: {mode}. Uses the CLI's configured policy."));
            }
            Some("step_update") => {
                if !self.initialized || self.completed {
                    run.error.get_or_insert(
                        "Antigravity returned activity outside an active stream.".into(),
                    );
                    return;
                }
                let step = &event["step_update"];
                if !self.session(run, &step["conversation_id"]) {
                    return;
                }
                let Some(index) = step["step_index"].as_u64() else {
                    run.error
                        .get_or_insert("Antigravity returned an invalid step index.".into());
                    return;
                };
                if let Some(usage) = reported_usage(&step["usage"]) {
                    if self.usage.len() < 2000 || self.usage.contains_key(&index) {
                        self.usage.insert(index, usage);
                        run.usage = self.usage.values().fold(
                            Usage {
                                reported: true,
                                ..Usage::default()
                            },
                            |mut total, item| {
                                total.input = total.input.saturating_add(item.input);
                                total.output = total.output.saturating_add(item.output);
                                total.cache_read = total.cache_read.saturating_add(item.cache_read);
                                total
                            },
                        );
                    } else {
                        run.error.get_or_insert(
                            "Antigravity exceeded the task usage-record limit.".into(),
                        );
                    }
                }
                if let Some(text) = step["text_delta"].as_str().filter(|text| !text.is_empty()) {
                    if self.text_step == Some(index) {
                        if let Some(last) = run.activity.last_mut() {
                            let room = 6000usize.saturating_sub(last.chars().count());
                            last.extend(text.chars().take(room));
                        }
                    } else {
                        activity(run, text);
                    }
                    self.text_step = Some(index);
                }
                if step["step_type"] == "tool" {
                    self.text_step = None;
                    let tool = step["tool_name"].as_str().unwrap_or("tool");
                    let state = step["state"].as_str().unwrap_or("unknown");
                    activity(run, &format!("{tool}: {state}"));
                    let error = step["tool_info"]["error"]["message"].as_str().unwrap_or("");
                    if !error.is_empty() {
                        activity(run, error);
                        if permission_denied(error) {
                            mark_permission_denied(run);
                        }
                    }
                    if ["ask_question", "ask_permission", "ask_custom_permission"].contains(&tool) {
                        run.error.get_or_insert("Antigravity requested interactive input in headless mode. Review activity and continue with an answer or update the CLI permission rules. Jackalope bridge questions can be answered while a task runs.".into());
                    }
                }
            }
            Some("result") => {
                if self.completed {
                    run.error.get_or_insert(
                        "Antigravity returned more than one result for this attempt.".into(),
                    );
                    return;
                }
                self.completed = true;
                let result = &event["result"];
                let status = result["status"].as_str().unwrap_or("INVALID");
                if status != "SUCCESS" {
                    let message = result["error"]
                        .as_str()
                        .unwrap_or("The task did not complete successfully");
                    run.quota_failure = super::routing::quota_failure(
                        &serde_json::json!({"type":"error","message":message}),
                    );
                    run.error.get_or_insert_with(|| {
                        format!(
                            "Antigravity {status}: {}",
                            message.chars().take(6000).collect::<String>()
                        )
                    });
                }
                if status == "SUCCESS"
                    && (!self.initialized || !self.session(run, &result["conversation_id"]))
                {
                    run.error.get_or_insert(
                        "Antigravity returned a result without a valid session initialization."
                            .into(),
                    );
                }
                run.result = result["response"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(120_000)
                    .collect();
                if run.result.trim().is_empty() && status == "SUCCESS" {
                    run.error
                        .get_or_insert("Antigravity reported success without a result.".into());
                }
                // Result counters can include earlier turns. Step usage belongs to this attempt.
                if self.usage.is_empty() && !self.resumed {
                    if let Some(usage) = reported_usage(&result["usage"]) {
                        run.usage = usage;
                    }
                }
            }
            Some(_) => {}
            None => {
                run.error.get_or_insert(
                    "Antigravity returned an event without a protocol discriminator.".into(),
                );
            }
        }
    }

    pub(super) fn finish(&self, run: &mut TaskRun) {
        if !self.completed {
            run.error.get_or_insert(
                "Antigravity ended without a final result. Inspect activity before continuing."
                    .into(),
            );
        }
    }
}

fn reported_usage(value: &Value) -> Option<Usage> {
    let input = value["input_tokens"].as_u64()?;
    let output = value["output_tokens"].as_u64()?;
    let cache_read = num(value, "cache_read_tokens");
    Some(Usage {
        input: input.saturating_add(cache_read),
        output,
        cache_read,
        reported: true,
        ..Usage::default()
    })
}

pub(super) fn permission_denied(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    [
        "permission denied",
        "permission_denied",
        "permission check failed",
        "requires approval",
        "requires permission",
        "soft-denied",
        "denied by",
        "not allowed in headless",
        "cannot ask for permission",
    ]
    .iter()
    .any(|pattern| message.contains(pattern))
}

pub(super) fn mark_permission_denied(run: &mut TaskRun) {
    run.error.get_or_insert("Antigravity could not obtain a required permission. Review activity and diagnostics, allow the specific operation in the CLI if intended, then continue the task.".into());
}
