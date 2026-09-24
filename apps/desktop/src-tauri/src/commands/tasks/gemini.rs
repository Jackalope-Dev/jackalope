use super::*;

#[cfg(test)]
mod tests;

const MALFORMED: &str =
    "Gemini CLI returned malformed streaming output. Update gemini and inspect diagnostics.";
const UNTYPED: &str = "Gemini CLI returned an event without a protocol discriminator.";
const INVALID_SESSION: &str = "Gemini CLI returned an invalid session ID.";
const REPEATED_INIT: &str = "Gemini CLI returned an unexpected stream initialization.";
const REPORTED_ERROR: &str = "Gemini CLI reported an error";
const AUTHENTICATION: &str = "Gemini CLI could not authenticate. Sign in to the selected account in Agents, then retry the task.";
const EMPTY_SUCCESS: &str = "Gemini CLI reported success without a response.";
const INCOMPLETE: &str =
    "Gemini CLI ended without a final result. Inspect activity before continuing.";
const CHANGED_SESSION: &str = "Gemini CLI did not resume the saved session. The original conversation is preserved; inspect diagnostics before continuing.";
const HEADLESS_TOOLS: &str = "Gemini CLI headless mode only exposes tools allowed by its approval mode. Shell commands need a CLI policy that allows them.";
const PERMISSION: &str = "Gemini CLI could not obtain a required permission. Review activity and diagnostics, allow the specific operation in the CLI policy if intended, then continue the task.";

pub(super) fn configure(cmd: &mut Command, session: Option<&str>) {
    cmd.env("NO_BROWSER", "true");
    cmd.args([
        "--output-format",
        "stream-json",
        "--approval-mode",
        "auto_edit",
    ]);
    if let Some(session) = session {
        cmd.args(["--resume", session]);
    }
}

#[derive(Default)]
pub(super) struct Stream {
    initialized: bool,
    completed: bool,
    resumed: bool,
    session: Option<String>,
    // Consecutive assistant deltas extend one activity entry until another event.
    text_open: bool,
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
            run.error.get_or_insert(INVALID_SESSION.into());
            return false;
        };
        if self.session.as_deref().is_some_and(|saved| saved != id) {
            run.error.get_or_insert(CHANGED_SESSION.into());
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
            run.error.get_or_insert(MALFORMED.into());
            return;
        };
        let Some(kind) = event["type"].as_str() else {
            run.error.get_or_insert(UNTYPED.into());
            return;
        };
        let startup_error = !self.initialized
            && (kind == "error" || (kind == "result" && event["status"] == "error"));
        if kind != "init" && ((!self.initialized && !startup_error) || self.completed) {
            let kind: String = kind.chars().take(40).collect();
            let message = format!("Gemini CLI sent {kind} outside an active stream.");
            run.error.get_or_insert(message);
            return;
        }
        if kind != "message" {
            self.text_open = false;
        }
        match kind {
            "init" => {
                if self.initialized || self.completed {
                    run.error.get_or_insert(REPEATED_INIT.into());
                    return;
                }
                self.initialized = self.session(run, &event["session_id"]);
                if let Some(model) = event["model"].as_str().filter(|model| !model.is_empty()) {
                    run.model = Some(model.chars().take(160).collect());
                }
            }
            "message" => self.message(run, &event),
            "tool_use" => {
                // A tool can end the turn without another assistant message.
                run.result.clear();
                run.efficiency.observe(&event, "gemini", &run.workspace);
                let tool = event["tool_name"].as_str().unwrap_or("tool");
                let label = super::tool_activity::label(tool, &event["parameters"], &run.workspace);
                activity(run, &label);
            }
            "tool_result" => {
                let status = event["status"].as_str().unwrap_or("unknown");
                activity(run, &format!("Tool result: {status}"));
                let error = &event["error"];
                let message = error["message"].as_str().unwrap_or("");
                activity(run, message);
                let described = format!("{} {message}", error["type"].as_str().unwrap_or(""));
                if status == "error" && permission_denied(&described) {
                    mark_permission_denied(run);
                } else if described.contains("not found in registry") {
                    activity(run, HEADLESS_TOOLS);
                }
            }
            "error" => {
                let message = event["message"].as_str().unwrap_or(REPORTED_ERROR);
                activity(run, message);
                if event["severity"] != "warning" {
                    if let Some(failure) = quota_failure(message) {
                        run.quota_failure = Some(failure);
                    }
                    let message: String = message.chars().take(6000).collect();
                    run.error.get_or_insert(message);
                }
            }
            "result" => self.result(run, &event),
            _ => {}
        }
    }

    fn message(&mut self, run: &mut TaskRun, event: &Value) {
        if event["role"] != "assistant" {
            return;
        }
        let Some(text) = event["content"].as_str().filter(|text| !text.is_empty()) else {
            return;
        };
        let room = 120_000usize.saturating_sub(run.result.chars().count());
        run.result.extend(text.chars().take(room));
        match run.activity.last_mut().filter(|_| self.text_open) {
            Some(last) => {
                let room = 6000usize.saturating_sub(last.chars().count());
                last.extend(text.chars().take(room));
            }
            None => activity(run, text),
        }
        self.text_open = true;
    }

    fn result(&mut self, run: &mut TaskRun, event: &Value) {
        self.completed = true;
        let status = event["status"].as_str().unwrap_or("invalid");
        if status != "success" {
            let message = event["error"]["message"]
                .as_str()
                .unwrap_or("The task did not complete successfully");
            let described = format!(
                "{} {message}",
                event["error"]["type"].as_str().unwrap_or("")
            );
            if let Some(failure) = quota_failure(&described) {
                run.quota_failure = Some(failure);
            }
            if permission_denied(&described) {
                mark_permission_denied(run);
            }
            let status: String = status.chars().take(40).collect();
            let message: String = message.chars().take(6000).collect();
            let message = format!("Gemini CLI {status}: {message}");
            run.error.get_or_insert(message);
        } else if run.result.trim().is_empty() {
            run.error.get_or_insert(EMPTY_SUCCESS.into());
        }
        // Resumed sessions can restore earlier turns into the CLI's counters, so
        // their totals are not attributable to this attempt and stay unknown.
        if !self.resumed {
            if let Some(usage) = reported_usage(&event["stats"]) {
                run.usage = usage;
            }
        }
    }

    pub(super) fn finish(&self, run: &mut TaskRun) {
        if !self.completed {
            run.error.get_or_insert(INCOMPLETE.into());
        }
    }
}

fn reported_usage(stats: &Value) -> Option<Usage> {
    let input = stats["input_tokens"].as_u64()?;
    let output = stats["output_tokens"].as_u64()?;
    // A stream that never reached the model reports empty counters, not real usage.
    if input == 0 && output == 0 {
        return None;
    }
    Some(Usage {
        input,
        output,
        cache_read: num(stats, "cached").min(input),
        reported: true,
        ..Usage::default()
    })
}

pub(super) fn quota_failure(message: &str) -> Option<super::routing::QuotaFailure> {
    let lower = message.to_ascii_lowercase();
    // The CLI retries transient rate limits itself; only terminal failures hand off.
    if lower.contains("retrying") {
        return None;
    }
    let terminal = [
        "resource_exhausted",
        "terminalquotaerror",
        "exhausted your capacity",
        "daily quota",
    ];
    if terminal.iter().any(|pattern| lower.contains(pattern)) {
        return Some(super::routing::QuotaFailure {
            model_only: false,
            message: message.chars().take(2000).collect(),
        });
    }
    super::routing::quota_failure(&serde_json::json!({"type":"error","message":message}))
}

pub(super) fn permission_denied(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    super::antigravity::permission_denied(message)
        || lower.contains("execution_denied")
        || lower.contains("untrusted folder")
}

pub(super) fn mark_permission_denied(run: &mut TaskRun) {
    run.error.get_or_insert(PERMISSION.into());
}

// Only classify stderr after an unsuccessful exit; the CLI can recover from retries.
pub(super) fn diagnostic(run: &mut TaskRun, line: &str) {
    let lower = line.to_ascii_lowercase();
    if lower.contains("error authenticating") || lower.contains("fatalauthenticationerror") {
        if run
            .error
            .as_deref()
            .is_none_or(|error| matches!(error, MALFORMED | UNTYPED | INCOMPLETE))
        {
            run.error = Some(AUTHENTICATION.into());
        }
        return;
    }
    if permission_denied(line) {
        mark_permission_denied(run);
    }
    if let Some(failure) = quota_failure(line) {
        let message = format!("Gemini CLI quota: {}", failure.message);
        run.error.get_or_insert(message);
        run.quota_failure = Some(failure);
    }
}
