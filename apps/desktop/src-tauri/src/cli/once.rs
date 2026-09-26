//! `jackalope -p`: one message, one reply, for scripts and CI. The work runs
//! in the host like any conversation, so it also appears in the app and can be
//! rejoined with `jackalope attach`.

use crate::protocol::{Client, Request, Response, SessionView};
use crate::ColdStart;
use std::io::{IsTerminal, Read};

/// Statuses that mean the agent is still going.
const WORKING: &[&str] = &["starting", "running", "routing", "queued", "stopping"];

/// Runs `message` and returns the process exit status.
pub fn run(
    message: String,
    agent: Option<String>,
    json: bool,
    preference: Option<ColdStart>,
) -> Result<i32, String> {
    let message = with_stdin(message)?;
    if message.trim().is_empty() {
        return Err(
            "Nothing to send. Pass a message: jackalope -p \"fix the failing test\"".into(),
        );
    }
    let (handshake, mut client) = crate::ensure_host(preference)?;
    let project = crate::project(&mut client)?;
    let session_id = match client.send(&Request::StartSession {
        project_path: project.path.clone(),
        text: message,
        agent,
    })? {
        Response::Started { session_id } => session_id,
        Response::Error { message } => return Err(message),
        _ => return Err("The host answered unexpectedly.".into()),
    };
    let progress = std::io::stderr().is_terminal() && !json;
    let mut watcher = Client::connect(&handshake.endpoint)?;
    let mut since = 0;
    let mut last_step = String::new();
    loop {
        let view = match client.send(&Request::SessionDetail {
            session_id: session_id.clone(),
        })? {
            Response::Session { session, .. } => *session,
            Response::Error { message } => return Err(message),
            _ => return Err("The host answered unexpectedly.".into()),
        };
        if progress {
            let step = view
                .step
                .clone()
                .or_else(|| view.status.clone())
                .unwrap_or_default();
            if !step.is_empty() && step != last_step {
                eprintln!("· {step}");
                last_step = step;
            }
        }
        if let Some(outcome) = outcome(&view) {
            return Ok(finish(&view, &session_id, outcome, json));
        }
        // Blocks until work moves. A timed-out or dropped watch just re-reads.
        match watcher.send(&Request::Watch { since }) {
            Ok(Response::Changed { revision }) => since = revision,
            _ => {
                std::thread::sleep(std::time::Duration::from_millis(500));
                watcher = Client::connect(&handshake.endpoint)?;
            }
        }
    }
}

/// Piped input is appended to the message, as `git diff | jackalope -p "review"`.
fn with_stdin(message: String) -> Result<String, String> {
    let stdin = std::io::stdin();
    if stdin.is_terminal() {
        return Ok(message);
    }
    let mut piped = String::new();
    stdin
        .lock()
        .read_to_string(&mut piped)
        .map_err(|error| format!("Could not read standard input: {error}"))?;
    Ok(match (message.trim().is_empty(), piped.trim().is_empty()) {
        (_, true) => message,
        (true, false) => piped,
        (false, false) => format!("{message}\n\n{piped}"),
    })
}

#[derive(Debug, PartialEq)]
enum Outcome {
    Done,
    Failed(String),
    Asked(String),
}

/// Whether the conversation has settled, and how.
fn outcome(view: &SessionView) -> Option<Outcome> {
    if let Some(error) = view
        .error
        .as_deref()
        .filter(|error| !error.trim().is_empty() && *error != "null")
    {
        return Some(Outcome::Failed(error.to_string()));
    }
    if let Some(question) = view.questions.first() {
        return Some(Outcome::Asked(question.question.clone()));
    }
    let working = view
        .status
        .as_deref()
        .is_some_and(|status| WORKING.contains(&status));
    let answered = view
        .messages
        .last()
        .is_some_and(|message| message.role == "agent");
    let all_sent = view.messages.iter().all(|message| message.sent);
    (!working && all_sent && answered).then_some(Outcome::Done)
}

fn reply(view: &SessionView) -> String {
    view.messages
        .iter()
        .rev()
        .find(|message| message.role == "agent")
        .map(|message| message.text.clone())
        .unwrap_or_else(|| view.result.clone())
}

fn finish(view: &SessionView, session_id: &str, outcome: Outcome, json: bool) -> i32 {
    let (status, code, detail) = match &outcome {
        Outcome::Done => ("done", 0, None),
        Outcome::Failed(error) => ("failed", 1, Some(error.clone())),
        Outcome::Asked(question) => ("question", 2, Some(question.clone())),
    };
    if json {
        let value = serde_json::json!({
            "sessionId": session_id,
            "status": status,
            "reply": reply(view),
            "error": matches!(outcome, Outcome::Failed(_)).then(|| detail.clone()).flatten(),
            "question": matches!(outcome, Outcome::Asked(_)).then(|| detail.clone()).flatten(),
            "agent": view.agent,
            "model": view.model,
            "branch": view.branch,
            "workspace": view.workspace,
        });
        println!("{value}");
        return code;
    }
    let text = reply(view);
    if !text.trim().is_empty() {
        println!("{}", text.trim_end());
    }
    match outcome {
        Outcome::Done => {}
        Outcome::Failed(error) => eprintln!("Failed: {error}"),
        Outcome::Asked(question) => {
            eprintln!("The agent asked: {question}");
            eprintln!(
                "Answer with: jackalope attach {}",
                session_id.get(..8).unwrap_or(session_id)
            );
        }
    }
    code
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{Message, Question};

    fn view(status: Option<&str>, messages: &[(&str, bool)]) -> SessionView {
        SessionView {
            id: "s".into(),
            title: "t".into(),
            paused: false,
            error: None,
            messages: messages
                .iter()
                .map(|(role, sent)| Message {
                    role: (*role).into(),
                    text: format!("{role} text"),
                    sent: *sent,
                })
                .collect(),
            run_id: None,
            status: status.map(String::from),
            agent: None,
            account: None,
            model: None,
            routing: None,
            step: None,
            step_detail: None,
            attempt: None,
            workspace: None,
            branch: None,
            result: String::new(),
            questions: Vec::new(),
        }
    }

    #[test]
    fn a_run_settles_only_once_the_agent_has_answered_everything() {
        assert_eq!(outcome(&view(None, &[("you", false)])), None);
        assert_eq!(outcome(&view(Some("running"), &[("you", true)])), None);
        assert_eq!(
            outcome(&view(Some("running"), &[("you", true), ("agent", true)])),
            None
        );
        assert_eq!(
            outcome(&view(Some("completed"), &[("you", true), ("agent", true)])),
            Some(Outcome::Done)
        );
        let mut failed = view(Some("failed"), &[("you", true)]);
        failed.error = Some("no account".into());
        assert_eq!(outcome(&failed), Some(Outcome::Failed("no account".into())));
        let mut asked = view(Some("running"), &[("you", true)]);
        asked.questions.push(Question {
            id: "q".into(),
            run_id: "r".into(),
            question: "Which branch?".into(),
            options: Vec::new(),
        });
        assert_eq!(
            outcome(&asked),
            Some(Outcome::Asked("Which branch?".into()))
        );
        assert_eq!(
            reply(&view(None, &[("you", true), ("agent", true)])),
            "agent text"
        );
    }
}
