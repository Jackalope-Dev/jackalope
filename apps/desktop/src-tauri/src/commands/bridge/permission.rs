//! Claude Code style permission questions: the `permission_prompt` tool and
//! the approvals of tools an agent on a computer runs without its own prompt.

use super::{Call, Reply, ToolError};
use crate::commands::{coordination::Coordinator, tasks::TaskRun};
use rmcp::schemars;
use serde::Deserialize;

/// Claude Code's `--permission-prompt-tool` request for a tool call its policy does not allow.
#[derive(Deserialize, schemars::JsonSchema)]
pub(super) struct PermissionPromptInput {
    tool_name: String,
    #[serde(default)]
    input: serde_json::Value,
}

const ALLOW_ONCE: &str = "Allow once";
const ALWAYS_PREFIX: &str = "Always allow ";
const DENY: &str = "Deny";
/// Shorter than the bridge timeout so Claude Code receives a denial, not a transport error.
const PERMISSION_WAIT_SECS: u64 = 1800;

fn permission_question(input: &PermissionPromptInput, escalation: Option<&str>) -> String {
    // Show what would run the way a person reads it: a shell command or file
    // path as written, anything else as its JSON input.
    let detail = ["command", "file_path", "url", "pattern"]
        .iter()
        .find_map(|key| input.input[*key].as_str())
        .map(str::to_string)
        .unwrap_or_else(|| input.input.to_string());
    let reason = input.input["description"]
        .as_str()
        .map(|text| format!("\n{}", text.chars().take(300).collect::<String>()))
        .unwrap_or_default();
    let escalated = escalation
        .map(|reason| format!("\nJackalope is asking because {reason}."))
        .unwrap_or_default();
    format!(
        "Allow Claude Code to use {}?\n{}{reason}{escalated}",
        input.tool_name.chars().take(200).collect::<String>(),
        detail.chars().take(3000).collect::<String>()
    )
}

/// Claude Code reads the decision as JSON text; anything but an explicit allow denies.
fn permission_decision(input: serde_json::Value, answer: Option<&str>) -> serde_json::Value {
    if answer == Some(ALLOW_ONCE) {
        serde_json::json!({"behavior":"allow","updatedInput":input})
    } else {
        serde_json::json!({"behavior":"deny","message":"The user denied this action in Jackalope or did not answer. Do not retry it or work around it; report what is blocked."})
    }
}

/// Decides a Claude Code style permission request the way Claude Code's
/// permission prompt tool does: standing project rules, then the project's
/// auto-approval, then a question to the person. Returns the prompt tool's
/// `behavior` answer.
async fn permission_for(
    service: &Coordinator,
    run: &TaskRun,
    input: PermissionPromptInput,
) -> serde_json::Value {
    let rules = crate::commands::permission_rules::path(&service.runtime.preferences_directory());
    let standing = crate::commands::permission_rules::rule_for(&input.tool_name, &input.input);
    let always = standing
        .as_ref()
        .map(|(_, label)| format!("{ALWAYS_PREFIX}{label} in {}", run.project_name));
    let mut asked = false;
    let mut automatic = false;
    let mut escalation = None;
    let answer = if crate::commands::permission_rules::allows(
        &rules,
        &run.project_id,
        &input.tool_name,
        &input.input,
    ) {
        Some(ALLOW_ONCE.to_string())
    } else if let crate::commands::permission_risk::Decision::Ask(reason) =
        crate::commands::permission_risk::decide(
            &service.runtime,
            &run.id,
            &crate::commands::permission_risk::label(&input.tool_name, &input.input),
            |scope| crate::commands::permission_risk::assess(&input.tool_name, &input.input, scope),
        )
    {
        escalation = reason;
        asked = true;
        None
    } else {
        automatic = true;
        Some(ALLOW_ONCE.to_string())
    };
    let answer = if !asked || !crate::commands::harness::can_ask(run) {
        answer
    } else {
        let mut options = vec![ALLOW_ONCE.to_string()];
        options.extend(always.clone());
        options.push(DENY.into());
        let question = crate::commands::harness::AskUserInput {
            question: permission_question(&input, escalation.as_deref()),
            input_type: "choice".into(),
            options,
            default_value: None,
            presentation: Default::default(),
            category: None,
        };
        let prompt = crate::commands::harness::ask_user_async(
            &run.id,
            question,
            std::time::Duration::from_secs(PERMISSION_WAIT_SECS),
            |prompt| service.runtime.record_prompt(prompt),
        )
        .await;
        service.runtime.record_prompt(&prompt);
        match (prompt.answer, &always, &standing) {
            (Some(answer), Some(always), Some((standing, _))) if &answer == always => {
                if let Err(error) =
                    crate::commands::permission_rules::remember(&rules, &run.project_id, standing)
                {
                    service.runtime.update(&run.id, |r| {
                        r.activity
                            .push(format!("Could not save the permission rule: {error}"))
                    });
                }
                Some(ALLOW_ONCE.to_string())
            }
            (answer, _, _) => answer,
        }
    };
    let decision = permission_decision(input.input, answer.as_deref());
    // Automatic approvals already recorded their own activity line.
    if !automatic {
        service.runtime.update(&run.id, |r| {
            r.activity.push(format!(
                "Claude Code permission {}",
                if decision["behavior"] == "allow" {
                    "allowed"
                } else {
                    "denied"
                }
            ))
        });
    }
    decision
}

pub(super) async fn permission_prompt(
    call: Call,
    input: PermissionPromptInput,
) -> Result<Reply, ToolError> {
    let decision = permission_for(&call.service, call.run(), input).await;
    Ok(Reply::Text(decision.to_string()))
}

/// Approves `execute_tool` at the bridge for attempts whose agent runs without
/// its own permission prompt (Claude Code on a computer, which runs with
/// `bypassPermissions`). The request goes through the same rules, auto-approval
/// and question as Claude Code's prompt for `mcp__jackalope__execute_tool`
/// locally, so moving the agent does not skip an approval.
pub(in crate::commands) async fn approve_remote_execute(
    service: &Coordinator,
    run: &TaskRun,
    input: &crate::commands::mcp_broker::ExecuteInput,
) -> Result<(), String> {
    let broker = &service.runtime.mcp_broker;
    if !broker.approves_executes(&run.id) {
        return Ok(());
    }
    let (server, tool) = broker
        .describe(&run.id, &input.handle)
        .await
        .ok_or("Unknown or expired tool handle. Search for the tool first.")?;
    let request = PermissionPromptInput {
        tool_name: "mcp__jackalope__execute_tool".into(),
        input: serde_json::json!({
            "handle": input.handle,
            "connection": server,
            "tool": tool,
            "arguments": input.arguments,
        }),
    };
    let decision = permission_for(service, run, request).await;
    if decision["behavior"] == "allow" {
        Ok(())
    } else {
        Err(decision["message"]
            .as_str()
            .unwrap_or("The user denied this action.")
            .to_string())
    }
}

/// Approves a tool of a connection that runs on the computer of a Claude Code
/// attempt. Claude Code runs there with `bypassPermissions`, so the
/// computer's agent installs a `PreToolUse` hook for those tools (see
/// `resources/computer/agent.py`, `mcp-approve`) that asks here through the
/// bridge relay. The request goes through the same rules, auto-approval and
/// question as Claude Code's permission prompt for that tool on this device.
/// Returns the prompt tool's answer: `behavior` is `allow` or `deny`.
pub(in crate::commands) async fn approve_computer_tool(
    service: &Coordinator,
    run: &TaskRun,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let remote = !crate::commands::computers::runner::for_run(&run.id).on_device();
    let request = computer_tool_request(remote, body)?;
    Ok(permission_for(service, run, request).await)
}

fn computer_tool_request(
    remote: bool,
    body: serde_json::Value,
) -> Result<PermissionPromptInput, String> {
    if !remote {
        return Err("Only an agent on a computer asks for tool approval this way.".into());
    }
    let request: PermissionPromptInput =
        serde_json::from_value(body).map_err(|_| "Send tool_name and input.".to_string())?;
    let name = request.tool_name.as_str();
    if !name.starts_with("mcp__") || name.starts_with("mcp__jackalope__") || name.len() > 300 {
        return Err(
            "Only tools of connections that run on the computer are approved this way.".into(),
        );
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computer_tool_approvals_accept_only_computer_connection_tools() {
        let body = |name: &str| serde_json::json!({"tool_name": name, "input": {"q": 1}});
        let request = computer_tool_request(true, body("mcp__linear__create_issue")).unwrap();
        assert_eq!(request.tool_name, "mcp__linear__create_issue");
        assert_eq!(request.input["q"], 1);
        assert!(computer_tool_request(false, body("mcp__linear__create_issue")).is_err());
        for name in ["Bash", "mcp__jackalope__ask_user", "mcp_", ""] {
            assert!(computer_tool_request(true, body(name)).is_err(), "{name}");
        }
        assert!(computer_tool_request(true, serde_json::json!({"input": {}})).is_err());
    }

    #[test]
    fn permission_prompt_allows_only_an_explicit_allow() {
        let input = serde_json::json!({"command":"pnpm add x"});
        assert_eq!(
            permission_decision(input.clone(), Some(ALLOW_ONCE)),
            serde_json::json!({"behavior":"allow","updatedInput":input})
        );
        for answer in [Some(DENY), Some("yes"), None] {
            assert_eq!(
                permission_decision(input.clone(), answer)["behavior"],
                "deny"
            );
        }
        let request = PermissionPromptInput {
            tool_name: "Bash".into(),
            input,
        };
        let question = permission_question(&request, None);
        assert!(question.contains("Bash") && question.contains("pnpm add x"));
        assert!(
            permission_question(&request, Some("it pushes commits to a remote"))
                .ends_with("Jackalope is asking because it pushes commits to a remote.")
        );
    }
}
