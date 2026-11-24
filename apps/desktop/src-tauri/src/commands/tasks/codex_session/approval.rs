//! Codex approval requests, decided the way Claude Code's permission requests are.
//!
//! Codex runs every command and edit in its sandbox without asking; with the
//! `on-request` approval policy it asks only to go beyond it (a command outside the
//! sandbox or with network access, a write outside the workspace, extra permissions or an
//! input a connection asks for). Each request goes through the project's standing rules,
//! then its auto-approval setting ([`permission_risk::decide`]), then a question to the
//! person on the attempt. A read-only plan session never escalates: it is denied.
//!
//! [`permission_risk::decide`]: crate::commands::permission_risk::decide

use super::super::*;
use crate::commands::{permission_risk, permission_rules};
use serde_json::json;

const ALLOW_ONCE: &str = "Allow once";
const ALWAYS_PREFIX: &str = "Always allow ";
const DENY: &str = "Deny";

/// What Codex asks to do, in the terms the permission flow assesses: Claude Code style
/// tool requests.
#[derive(Debug, PartialEq)]
pub(super) struct Subject {
    /// The tool the request is assessed as, such as `Bash` or `Write`.
    pub tool: String,
    /// One tool input per thing the request covers, such as each file a change writes.
    pub inputs: Vec<Value>,
    /// The short form for activity lines.
    pub label: String,
    /// The question shown to the person.
    pub question: String,
    /// Whether auto-approval may decide it; anything Jackalope cannot assess asks.
    pub assessable: bool,
}

/// The program and script of a shell wrapper Codex runs a command in, such as
/// `/bin/zsh -lc 'pnpm test'`, or the command itself when it is not wrapped. `None` when
/// the wrapped script uses quoting this cannot undo exactly.
pub(super) fn script(command: &str) -> Option<String> {
    let command = command.trim();
    let mut words = command.splitn(3, ' ');
    let (Some(program), Some(flag), Some(rest)) = (words.next(), words.next(), words.next()) else {
        return Some(command.to_string());
    };
    let shell = program.rsplit('/').next().unwrap_or(program);
    if !["sh", "bash", "zsh", "dash"].contains(&shell) || !["-c", "-lc"].contains(&flag) {
        return Some(command.to_string());
    }
    let rest = rest.trim();
    match rest
        .strip_prefix('\'')
        .and_then(|rest| rest.strip_suffix('\''))
    {
        Some(inner) if !inner.contains('\'') => Some(inner.to_string()),
        Some(_) => None,
        None if !rest.contains(['\'', '"', '\\']) => Some(rest.to_string()),
        None => None,
    }
}

fn reason_line(params: &Value) -> String {
    params["reason"]
        .as_str()
        .filter(|reason| !reason.trim().is_empty())
        .map(|reason| {
            format!(
                "\nCodex says: {}",
                reason.chars().take(300).collect::<String>()
            )
        })
        .unwrap_or_default()
}

/// The request as a [`Subject`], or `None` for a request Jackalope does not answer.
pub(super) fn subject(method: &str, params: &Value, files: &[String]) -> Option<Subject> {
    match method {
        "item/commandExecution/requestApproval" => {
            let command = params["command"].as_str().unwrap_or_default();
            if params["kind"] == "writeStdin" {
                return Some(Subject {
                    tool: "Bash".into(),
                    inputs: vec![],
                    label: "Bash: input to a running command".into(),
                    question: format!(
                        "Allow Codex to send input to a running command?\n{}{}",
                        command.chars().take(3000).collect::<String>(),
                        reason_line(params)
                    ),
                    assessable: false,
                });
            }
            let shown = script(command).unwrap_or_else(|| command.to_string());
            let network = params["networkApprovalContext"].is_object();
            Some(Subject {
                tool: "Bash".into(),
                inputs: vec![json!({"command": shown})],
                label: format!("Bash: {shown}"),
                question: format!(
                    "Allow Codex to run this command outside its sandbox{}?\n{}{}",
                    if network { " with network access" } else { "" },
                    shown.chars().take(3000).collect::<String>(),
                    reason_line(params)
                ),
                assessable: !command.is_empty(),
            })
        }
        "item/fileChange/requestApproval" => {
            let mut paths = files.to_vec();
            paths.extend(params["grantRoot"].as_str().map(str::to_string));
            let listed: Vec<&str> = paths.iter().take(20).map(String::as_str).collect();
            Some(Subject {
                tool: "Write".into(),
                inputs: paths
                    .iter()
                    .map(|path| json!({"file_path": path}))
                    .collect(),
                label: format!("Write: {}", listed.join(", ")),
                question: format!(
                    "Allow Codex to change {}?{}",
                    if listed.is_empty() {
                        "files outside its sandbox".to_string()
                    } else {
                        listed.join(", ")
                    },
                    reason_line(params)
                ),
                assessable: !paths.is_empty(),
            })
        }
        "item/permissions/requestApproval" => Some(Subject {
            tool: "Permissions".into(),
            inputs: vec![],
            label: "Permissions: more access".into(),
            question: format!(
                "Allow Codex more access for this turn?\n{}{}",
                params["permissions"]
                    .to_string()
                    .chars()
                    .take(3000)
                    .collect::<String>(),
                reason_line(params)
            ),
            assessable: false,
        }),
        "mcpServer/elicitation/request" => {
            let server = params["serverName"].as_str().unwrap_or("A connection");
            Some(Subject {
                tool: format!("mcp__{server}"),
                inputs: vec![],
                label: format!(
                    "{server}: {}",
                    params["message"].as_str().unwrap_or("request")
                ),
                question: format!(
                    "{server} asks through Codex:\n{}",
                    params["message"]
                        .as_str()
                        .unwrap_or_default()
                        .chars()
                        .take(3000)
                        .collect::<String>()
                ),
                assessable: false,
            })
        }
        _ => None,
    }
}

/// Whether an elicitation can be accepted without filling in a form.
fn confirmation_only(params: &Value) -> bool {
    match params["mode"].as_str() {
        Some("form") => params["requestedSchema"]["properties"]
            .as_object()
            .is_none_or(|properties| properties.is_empty()),
        _ => false,
    }
}

/// The answer Codex expects for `method` when the request is allowed or not.
pub(super) fn reply(method: &str, params: &Value, allowed: bool) -> Value {
    match method {
        "item/permissions/requestApproval" if allowed => {
            json!({"permissions": params["permissions"], "scope": "turn"})
        }
        "item/permissions/requestApproval" => json!({"permissions": {}, "scope": "turn"}),
        "mcpServer/elicitation/request" if allowed => {
            json!({"action": "accept", "content": {}, "_meta": null})
        }
        "mcpServer/elicitation/request" => {
            json!({"action": "decline", "content": null, "_meta": null})
        }
        _ => json!({"decision": if allowed { "accept" } else { "decline" }}),
    }
}

/// Decides one approval request of attempt `run_id` and returns Codex's answer. Blocks
/// while the person is asked, until they answer or the attempt stops.
pub(super) fn answer(
    runtime: &TaskRuntime,
    run_id: &str,
    read_only: bool,
    method: &str,
    params: &Value,
    files: &[String],
) -> Value {
    let Some(subject) = subject(method, params, files) else {
        return reply(method, params, false);
    };
    if read_only {
        runtime.update(run_id, |run| {
            activity(
                run,
                &format!(
                    "Denied: this is a read-only plan session ({})",
                    subject.label
                ),
            )
        });
        return reply(method, params, false);
    }
    if method == "mcpServer/elicitation/request" && !confirmation_only(params) {
        runtime.update(run_id, |run| {
            activity(
                run,
                &format!(
                    "Declined: Jackalope cannot fill in this form ({})",
                    subject.label
                ),
            )
        });
        return reply(method, params, false);
    }
    let Some(run) = runtime.run_snapshot(run_id) else {
        return reply(method, params, false);
    };
    let rules = permission_rules::path(&runtime.preferences_directory());
    let command = (subject.tool == "Bash")
        .then(|| subject.inputs.first())
        .flatten()
        .filter(|_| subject.assessable);
    let standing = command
        .filter(|input| script(input["command"].as_str().unwrap_or_default()).is_some())
        .and_then(|input| permission_rules::rule_for("Bash", input));
    if command.is_some_and(|input| permission_rules::allows(&rules, &run.project_id, "Bash", input))
    {
        runtime.update(run_id, |run| {
            activity(run, &format!("Allowed by a saved rule: {}", subject.label))
        });
        return reply(method, params, true);
    }
    let escalation = if subject.assessable {
        match permission_risk::decide(runtime, run_id, &subject.label, |scope| {
            subject
                .inputs
                .iter()
                .map(|input| permission_risk::assess(&subject.tool, input, scope))
                .find(|verdict| *verdict != permission_risk::Verdict::Routine)
                .unwrap_or(permission_risk::Verdict::Routine)
        }) {
            permission_risk::Decision::Approve => return reply(method, params, true),
            permission_risk::Decision::Ask(reason) => reason,
        }
    } else {
        None
    };
    if !crate::commands::harness::can_ask(&run) {
        runtime.update(run_id, |run| {
            activity(
                run,
                &format!(
                    "Denied: this task has asked too many questions to ask about {}",
                    subject.label
                ),
            )
        });
        return reply(method, params, false);
    }
    let always = standing
        .as_ref()
        .map(|(_, label)| format!("{ALWAYS_PREFIX}{label} in {}", run.project_name));
    let mut options = vec![ALLOW_ONCE.to_string()];
    options.extend(always.clone());
    options.push(DENY.into());
    let question = format!(
        "{}{}",
        subject.question,
        escalation
            .map(|reason| format!("\nJackalope is asking because {reason}."))
            .unwrap_or_default()
    );
    let answer = super::super::kimi::wait_for_answer(runtime, run_id, question, options, "choice");
    let allowed = match (answer.as_deref(), &always, &standing) {
        (Some(ALLOW_ONCE), _, _) => true,
        (Some(answer), Some(always), Some((rule, _))) if answer == always => {
            if let Err(error) = permission_rules::remember(&rules, &run.project_id, rule) {
                runtime.update(run_id, |run| {
                    activity(run, &format!("Could not save the permission rule: {error}"))
                });
            }
            true
        }
        _ => false,
    };
    runtime.update(run_id, |run| {
        activity(
            run,
            &format!(
                "Codex permission {}: {}",
                if allowed { "allowed" } else { "denied" },
                subject.label
            ),
        )
    });
    reply(method, params, allowed)
}
