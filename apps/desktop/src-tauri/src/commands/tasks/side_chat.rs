//! Side questions (`/btw`): one question answered by a read-only, unsaved fork of an
//! attempt's agent session, so it knows the work without joining its transcript or
//! queue. A side question takes no coordinator lock or execution guard and claims no
//! workspace, so it never waits on or interrupts the running attempt; the agent's own
//! read-only mode keeps it from changing files.

use super::helper_process::{reported, Interrupted, Turn};
use super::*;
use crate::commands::agent_profiles::AccountBinding;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// The only tools a Claude Code side question has: reading and searching the workspace.
const READ_ONLY_TOOLS: &str = "Read,Grep,Glob";
/// Claude Code tools that change files, run commands or start other agents.
const MUTATING_TOOLS: &str =
    "Bash,BashOutput,KillShell,Edit,MultiEdit,Write,NotebookEdit,Task,Agent,Skill,SlashCommand";
const LIMIT: Duration = Duration::from_secs(180);
const QUESTION_LIMIT: usize = 4000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideAnswer {
    pub text: String,
    pub model: Option<String>,
}

/// How `adapter` forks a saved session for one read-only question, or `None` when it
/// cannot. This is the provider hook: Claude Code forks with `--resume --fork-session`
/// in plan mode and Codex with `exec fork` in its read-only sandbox, neither saving the
/// fork. A Codex app-server thread fork belongs here once tasks run through it.
pub(in crate::commands) fn fork_arguments(
    adapter: &str,
    session: &str,
    model: Option<&str>,
) -> Option<Vec<String>> {
    let mut args: Vec<String> = match adapter {
        "claude" => [
            "--print",
            "--verbose",
            "--output-format",
            "stream-json",
            "--resume",
            session,
            "--fork-session",
            "--no-session-persistence",
            "--permission-mode",
            "plan",
            // Plan mode alone leaves refusing a write to the model; only reading tools
            // exist in the fork, and every tool that changes files or runs commands is
            // also refused by name.
            "--tools",
            READ_ONLY_TOOLS,
            "--disallowedTools",
            MUTATING_TOOLS,
            "--strict-mcp-config",
            "--mcp-config",
            r#"{"mcpServers":{}}"#,
        ]
        .map(String::from)
        .to_vec(),
        "codex" => [
            "exec",
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "sandbox_mode=\"read-only\"",
            "-c",
            "mcp_servers={}",
            "fork",
            session,
            "--ephemeral",
            "--skip-git-repo-check",
            "--json",
        ]
        .map(String::from)
        .to_vec(),
        _ => return None,
    };
    if let Some(model) = model {
        args.extend(["--model".to_string(), model.to_string()]);
    }
    if adapter == "codex" {
        args.push("-".into());
    }
    Some(args)
}

fn prompt(question: &str) -> String {
    format!(
        "The person asks a quick side question while this work continues. Answer it briefly \
         from this conversation and by reading the workspace if needed. This is a read-only \
         side thread: do not change files, run builds or carry on with the task.\n\nQuestion: {question}"
    )
}

fn in_flight() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static CALLS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    CALLS.get_or_init(Default::default)
}

/// Most cancels that may wait for their question to arrive.
const EARLY_CANCELS: usize = 64;

/// The stop flag for question `id`. A cancel can reach the app before its question does,
/// since the two commands run independently; it leaves a stopped flag that the question
/// then takes, so its fork never starts.
fn register(id: &str) -> Result<Arc<AtomicBool>, String> {
    let mut calls = in_flight()
        .lock()
        .map_err(|_| "Side questions are unavailable.")?;
    Ok(calls.entry(id.to_string()).or_default().clone())
}

fn cancel(id: &str) {
    let Ok(mut calls) = in_flight().lock() else {
        return;
    };
    if let Some(canceled) = calls.get(id) {
        canceled.store(true, Ordering::SeqCst);
    } else if uuid::Uuid::parse_str(id).is_ok() && calls.len() < EARLY_CANCELS {
        calls.insert(id.to_string(), Arc::new(AtomicBool::new(true)));
    }
}

/// Where a side question about `run` forks from: its agent, session, folder and account.
fn source(run: &TaskRun) -> Result<(&str, &str, AccountBinding), String> {
    if run.remote.is_some() {
        return Err("Side questions run on this device, and this work ran on a computer.".into());
    }
    let (session, workspace) = match (&run.session_id, &run.continues) {
        (Some(session), _) if !run.workspace.is_empty() => (session.as_str(), run.workspace.as_str()),
        (None, Some(continued)) => (continued.session_id.as_str(), continued.workspace.as_str()),
        _ => {
            return Err(
                "There is no saved agent session to ask about yet. Ask again once the agent has started."
                    .into(),
            )
        }
    };
    if !Path::new(workspace).is_dir() {
        return Err("This work's folder is no longer available.".into());
    }
    let binding = run
        .account_binding
        .clone()
        .ok_or("This attempt has no recorded account, so its session cannot be forked.")?;
    Ok((session, workspace, binding))
}

fn ask(
    runtime: &TaskRuntime,
    run_id: &str,
    question: &str,
    canceled: &AtomicBool,
) -> Result<SideAnswer, String> {
    let question = question.trim();
    if question.is_empty() || question.chars().count() > QUESTION_LIMIT {
        return Err("Ask a side question of up to 4,000 characters.".into());
    }
    let run = runtime
        .run_snapshot(run_id)
        .ok_or("This work is no longer loaded.")?;
    let policy = runtime.policy()?;
    let (adapter, executable) = policy.resolve(&run.agent)?;
    let model = run.model.clone().or(run.requested_model.clone());
    let spec = crate::commands::agents::find(&adapter);
    if !spec.is_some_and(|agent| agent.side_questions) {
        return Err(format!(
            "{} can't answer side questions: Jackalope can fork only Claude Code and Codex sessions read-only.",
            spec.map(|agent| agent.name.as_str()).unwrap_or(&run.agent)
        ));
    }
    let (session, workspace, binding) = source(&run)?;
    crate::commands::agent_profiles::validate_binding(&runtime.profiles_root(), &binding)?;
    let text = prompt(question);
    let mut cmd = command(&executable);
    cmd.args(fork_arguments(&adapter, session, model.as_deref()).unwrap_or_default());
    crate::commands::agent_profiles::apply_binding(&mut cmd, &binding)?;
    let answer = Turn {
        agent: &run.agent,
        adapter: &adapter,
        executable,
        binding: &binding,
        model: model.as_deref(),
        prompt: &text,
        directory: PathBuf::from(workspace),
        prompt_path: PathBuf::new(),
        attempt: None,
        limit: LIMIT,
    }
    .run_command(runtime, cmd, &|| canceled.load(Ordering::SeqCst))?;
    let status = answer.exit.map_err(|interrupted| match interrupted {
        Interrupted::Stopped => "Stopped.".to_string(),
        Interrupted::TimedOut => "The side question took longer than three minutes.".into(),
        Interrupted::Failed(error) => error,
    })?;
    let (output, truncated) = answer.output;
    if truncated {
        return Err("The answer exceeded the size limit.".into());
    }
    let mut parsed = TaskRun {
        agent: run.agent.clone(),
        ..Default::default()
    };
    for line in output.lines() {
        consume_adapter_event(&mut parsed, line, &adapter);
    }
    // A plan-mode fork that tried to edit is refused; its answer still stands.
    let text = parsed.result.trim().to_string();
    if !text.is_empty() {
        return Ok(SideAnswer {
            text,
            model: parsed.model.or(model),
        });
    }
    if parsed.quota_failure.is_some() {
        return Err("This agent account has reached its usage limit.".into());
    }
    if let Some(error) = parsed.error {
        return Err(error);
    }
    Err(reported(
        if status.success() {
            "The agent returned no answer."
        } else {
            "The agent could not answer."
        },
        &answer.diagnostics,
    ))
}

#[tauri::command]
pub async fn task_side_question(
    runtime: tauri::State<'_, TaskRuntime>,
    run_id: String,
    question: String,
    operation_id: String,
) -> Result<SideAnswer, String> {
    if uuid::Uuid::parse_str(&operation_id).is_err() {
        return Err("Provide a valid side question identifier.".into());
    }
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let canceled = register(&operation_id)?;
        let result = ask(&runtime, &run_id, &question, &canceled);
        if let Ok(mut calls) = in_flight().lock() {
            calls.remove(&operation_id);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn task_side_question_cancel(operation_id: String) {
    cancel(&operation_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_and_codex_fork_read_only_without_saving_and_others_cannot() {
        let claude = fork_arguments("claude", "s-1", Some("claude-opus-5-5")).unwrap();
        for flag in [
            "--fork-session",
            "--no-session-persistence",
            "plan",
            "--strict-mcp-config",
        ] {
            assert!(claude.iter().any(|arg| arg == flag), "{flag}");
        }
        let resume = claude.iter().position(|arg| arg == "--resume").unwrap();
        assert_eq!(claude[resume + 1], "s-1");
        assert_eq!(&claude[claude.len() - 2..], ["--model", "claude-opus-5-5"]);
        let value = |flag: &str| {
            let at = claude.iter().position(|arg| arg == flag).unwrap();
            claude[at + 1]
                .split(',')
                .map(str::to_string)
                .collect::<Vec<_>>()
        };
        assert_eq!(value("--tools"), ["Read", "Grep", "Glob"]);
        let refused = value("--disallowedTools");
        for tool in [
            "Bash",
            "BashOutput",
            "KillShell",
            "Edit",
            "MultiEdit",
            "Write",
            "NotebookEdit",
            "Task",
            "Agent",
            "Skill",
            "SlashCommand",
        ] {
            assert!(refused.iter().any(|name| name == tool), "{tool}");
        }
        assert!(value("--tools").iter().all(|tool| !refused.contains(tool)));

        let codex = fork_arguments("codex", "t-1", None).unwrap();
        let fork = codex.iter().position(|arg| arg == "fork").unwrap();
        assert_eq!(codex[fork + 1], "t-1");
        assert!(codex[..fork].contains(&"sandbox_mode=\"read-only\"".to_string()));
        assert!(codex[fork..].contains(&"--ephemeral".to_string()));
        assert_eq!(codex.last().map(String::as_str), Some("-"));

        for agent in crate::commands::agents::all() {
            assert_eq!(
                fork_arguments(&agent.id, "x", None).is_some(),
                agent.side_questions,
                "{}",
                agent.id
            );
        }
    }

    #[test]
    fn a_cancel_that_arrives_before_its_question_still_stops_it() {
        let early = uuid::Uuid::new_v4().to_string();
        cancel(&early);
        assert!(register(&early).unwrap().load(Ordering::SeqCst));
        in_flight().lock().unwrap().remove(&early);

        let asked = uuid::Uuid::new_v4().to_string();
        let flag = register(&asked).unwrap();
        assert!(!flag.load(Ordering::SeqCst));
        cancel(&asked);
        assert!(flag.load(Ordering::SeqCst));
        in_flight().lock().unwrap().remove(&asked);

        cancel("not-an-operation");
        assert!(!in_flight().lock().unwrap().contains_key("not-an-operation"));
    }

    #[test]
    fn a_side_question_needs_a_local_saved_session_and_its_account() {
        let folder = std::env::temp_dir();
        let mut run = TaskRun {
            agent: "claude".into(),
            workspace: folder.to_string_lossy().into_owned(),
            ..Default::default()
        };
        assert!(source(&run).unwrap_err().contains("no saved agent session"));
        run.session_id = Some("s-1".into());
        assert!(source(&run).unwrap_err().contains("no recorded account"));
        run.remote = Some(RemoteExecution::default());
        assert!(source(&run).unwrap_err().contains("computer"));
        run.remote = None;
        run.workspace = folder
            .join("missing-side-chat")
            .to_string_lossy()
            .into_owned();
        assert!(source(&run).unwrap_err().contains("no longer available"));
    }
}
