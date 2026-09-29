//! `jackalope -p`: one message, one reply, for scripts and CI. The work runs
//! in the host like any conversation, so it also appears in the app and can be
//! rejoined with `jackalope attach`.

use crate::connection::{short, Connection};
use crate::host::{self, ColdStart};
use crate::protocol::{self, SessionView};
use crate::subcommands;
use std::io::{IsTerminal, Read};
use std::time::{Duration, Instant};

pub struct Options {
    pub agent: Option<String>,
    pub json: bool,
    pub timeout: Option<Duration>,
    pub cold_start: Option<ColdStart>,
}

/// Runs `message` and returns the process exit status.
pub fn run(message: String, options: Options) -> Result<i32, String> {
    let message = with_stdin(message)?;
    if message.trim().is_empty() {
        return Err(
            "Nothing to send. Pass a message: jackalope -p \"fix the failing test\"".into(),
        );
    }
    let mut connection = host::ensure(options.cold_start)?;
    let project = subcommands::here(&mut connection)?;
    let session_id = connection.start(&project.path, message, options.agent)?;
    let progress = std::io::stderr().is_terminal() && !options.json;
    // The watch blocks, so it gets a connection of its own.
    let mut watcher = Connection::lazy(connection.handshake().clone());
    let deadline = options.timeout.map(|timeout| Instant::now() + timeout);
    let mut since = 0;
    let mut last_step = String::new();
    loop {
        let view = connection.session(&session_id)?;
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
        let outcome = outcome(&view).or_else(|| {
            deadline
                .filter(|deadline| Instant::now() >= *deadline)
                .map(|_| Outcome::TimedOut)
        });
        if let Some(outcome) = outcome {
            return Ok(finish(&view, &session_id, outcome, options.json));
        }
        // Blocks until work moves. A dropped watch waits briefly and re-reads;
        // the connection finds a restarted host on its own.
        match watcher.watch(since) {
            Ok(revision) => since = revision,
            Err(_) => std::thread::sleep(Duration::from_millis(500)),
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
    TimedOut,
}

/// Whether the conversation has settled, and how.
fn outcome(view: &SessionView) -> Option<Outcome> {
    if let Some(error) = protocol::present(view.error.as_deref()) {
        return Some(Outcome::Failed(error.to_string()));
    }
    if let Some(question) = view.questions.first() {
        return Some(Outcome::Asked(question.question.clone()));
    }
    let status = view.status.as_deref();
    if protocol::working(status) {
        return None;
    }
    if view.paused {
        return Some(Outcome::Failed(
            "The conversation was paused before it finished.".into(),
        ));
    }
    // Queued messages dispatch shortly, and no status means routing has not
    // started a run yet.
    if !view.messages.iter().all(|message| message.sent) {
        return None;
    }
    let status = status?;
    if protocol::STOPPED.contains(&status) {
        return Some(Outcome::Failed(
            "The work was stopped before it finished.".into(),
        ));
    }
    if protocol::FAILED.contains(&status) {
        return Some(Outcome::Failed(
            "The agent could not finish the work.".into(),
        ));
    }
    Some(Outcome::Done)
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
        Outcome::TimedOut => ("timeout", 3, None),
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
    let rejoin = format!("jackalope attach {}", short(session_id));
    match outcome {
        Outcome::Done => {}
        Outcome::Failed(error) => eprintln!("Failed: {error}"),
        Outcome::Asked(question) => {
            eprintln!("The agent asked: {question}");
            eprintln!("Answer with: {rejoin}");
        }
        Outcome::TimedOut => {
            eprintln!("Timed out; the work continues. Follow it with: {rejoin}");
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
                    attempt: None,
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
    fn a_run_settles_once_its_work_has_ended() {
        assert_eq!(outcome(&view(None, &[("you", false)])), None);
        assert_eq!(
            outcome(&view(None, &[("you", true)])),
            None,
            "not routed yet"
        );
        assert_eq!(outcome(&view(Some("running"), &[("you", true)])), None);
        assert_eq!(
            outcome(&view(Some("completed"), &[("you", true), ("agent", true)])),
            Some(Outcome::Done)
        );
        assert_eq!(
            outcome(&view(Some("completed"), &[("you", true), ("you", false)])),
            None,
            "a queued follow-up still has to run"
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

    #[test]
    fn stopped_paused_and_silent_failures_do_not_wait_forever() {
        for status in ["stopped", "cancelled", "canceled", "interrupted", "failed"] {
            assert!(
                matches!(
                    outcome(&view(Some(status), &[("you", true)])),
                    Some(Outcome::Failed(_))
                ),
                "{status}"
            );
        }
        let mut paused = view(Some("completed"), &[("you", true), ("you", false)]);
        paused.paused = true;
        assert!(matches!(outcome(&paused), Some(Outcome::Failed(_))));
        let mut error = view(Some("completed"), &[("you", true)]);
        error.error = Some("null".into());
        assert_eq!(outcome(&error), Some(Outcome::Done), "a null error is none");
    }
}
