//! `/learn`: reflects on a conversation since the previous `/learn` (or its
//! start) and sends the resulting proposals through the same promotion gate
//! as background learning.

use super::{LiveSessions, SessionMessage};
use crate::commands::{
    knowledge::learning::{self, Observation, ObservationKind},
    tasks::{TaskRun, TaskRuntime},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedResult {
    pub count: usize,
    pub lessons: Vec<String>,
    pub message: String,
}

impl LiveSessions {
    /// The person's own messages sent in one turn of a conversation.
    pub(in crate::commands) fn turn_messages(&self, session_id: &str, run_id: &str) -> Vec<String> {
        let Ok(inner) = self.inner.lock() else {
            return vec![];
        };
        let Some(session) = inner
            .ledger
            .sessions
            .iter()
            .find(|session| session.id == session_id)
        else {
            return vec![];
        };
        let ids: HashSet<&str> = session
            .batches
            .iter()
            .filter(|batch| batch.run_id == run_id)
            .flat_map(|batch| batch.message_ids.iter().map(String::as_str))
            .collect();
        session
            .messages
            .iter()
            .filter(|message| {
                (ids.contains(message.id.as_str()) || message.run_id.as_deref() == Some(run_id))
                    && personal(message)
            })
            .map(|message| message.text.clone())
            .collect()
    }
}

/// Written by the person, not a wake-up, another bot or a card answer.
fn personal(message: &SessionMessage) -> bool {
    !message.canceled && message.origin.is_none()
}

/// Messages after the previous `/learn` marker; all of them when there is none
/// or it no longer exists.
fn since_marker<'a>(
    messages: &'a [&'a SessionMessage],
    marker: Option<&str>,
) -> &'a [&'a SessionMessage] {
    let start = marker
        .and_then(|id| messages.iter().position(|message| message.id == id))
        .map_or(0, |position| position + 1);
    &messages[start..]
}

fn observations(
    session_id: &str,
    messages: &[&SessionMessage],
    runs: &[&TaskRun],
) -> Vec<Observation> {
    let mut found: Vec<Observation> = messages
        .iter()
        .filter(|message| personal(message))
        .map(|message| Observation {
            kind: ObservationKind::Statement,
            text: message.text.clone(),
            reference: format!("Conversation {session_id}"),
            run_id: message.run_id.clone(),
        })
        .collect();
    for run in runs {
        found.extend(
            learning::watcher::observations(run, Some(vec![]))
                .into_iter()
                .filter(|observation| observation.kind != ObservationKind::Statement),
        );
    }
    found
}

pub fn learn_from_session(
    sessions: &LiveSessions,
    runtime: &TaskRuntime,
    session_id: &str,
) -> Result<LearnedResult, String> {
    let snapshot = sessions.snapshot(Some(session_id))?;
    let session = snapshot
        .sessions
        .iter()
        .find(|s| s.id == session_id)
        .ok_or_else(|| "That conversation is no longer open.".to_string())?;
    let visible: Vec<&SessionMessage> = session.messages.iter().filter(|m| !m.canceled).collect();
    let pending = since_marker(&visible, session.last_learned_message_id.as_deref());
    if pending.is_empty() {
        return Ok(LearnedResult {
            count: 0,
            lessons: vec![],
            message: if session.last_learned_message_id.is_some() {
                "No new conversation history to learn from since the last /learn.".into()
            } else {
                "This conversation has no messages to learn from yet.".into()
            },
        });
    }
    let run_ids: HashSet<&str> = pending.iter().filter_map(|m| m.run_id.as_deref()).collect();
    let runs: Vec<&TaskRun> = snapshot
        .runs
        .iter()
        .filter(|run| run_ids.contains(run.id.as_str()))
        .collect();
    let project_id = &session.request.project_id;
    let project_path = &session.request.project_path;
    let observations = observations(session_id, pending, &runs);
    let existing = runtime.knowledge.list(project_id, project_path)?;
    let proposals = learning::reflect(&observations, &existing);
    let report = runtime
        .knowledge
        .promote(project_id, project_path, proposals, "session")
        .map_err(|e| format!("Could not save learned lessons: {e}"))?;

    let latest = pending.last().map(|m| m.id.clone());
    sessions.update(|ledger| {
        let s = LiveSessions::session(ledger, session_id)?;
        s.last_learned_message_id = latest;
        s.updated_at = Utc::now().to_rfc3339();
        Ok(())
    })?;

    let mut lessons = report.applied.clone();
    lessons.extend(
        report
            .known
            .iter()
            .map(|title| format!("Already known: {title}")),
    );
    lessons.extend(report.rejected.iter().cloned());
    let count = report.applied.len();
    let message = match (count, report.known.len()) {
        (0, 0) => "No new project lessons found in this conversation.".into(),
        (0, _) => "Nothing new; these lessons are already saved".into(),
        (1, _) => "Learned 1 project lesson (on probation until it is used)".into(),
        _ => format!("Learned {count} project lessons (on probation until they are used)"),
    };
    Ok(LearnedResult {
        count,
        lessons,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str, text: &str) -> SessionMessage {
        SessionMessage {
            id: id.into(),
            text: text.into(),
            created_at: "2026-09-01T00:00:00Z".into(),
            run_id: None,
            canceled: false,
            origin: None,
        }
    }

    #[test]
    fn history_slicing_respects_previous_learn_marker() {
        let (a, b, c) = (
            message("m1", "Hello"),
            message("m2", "Always use pnpm for package management."),
            message("m3", "Ensure keyboard focus stays inside modals."),
        );
        let messages = vec![&a, &b, &c];
        assert_eq!(since_marker(&messages, None).len(), 3);
        assert_eq!(since_marker(&messages, Some("m2"))[0].id, "m3");
        assert!(since_marker(&messages, Some("m3")).is_empty());
        assert_eq!(since_marker(&messages, Some("gone")).len(), 3);
    }

    #[test]
    fn only_the_persons_messages_are_observed() {
        let mut bot = message("m2", "Always deploy on Fridays.");
        bot.origin = Some(super::super::MessageOrigin {
            kind: "bot".into(),
            label: "Helper".into(),
            bot_id: None,
            bot_name: None,
            session_id: None,
        });
        let mine = message("m1", "Always use pnpm for package management.");
        let found = observations("s1", &[&mine, &bot], &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].reference, "Conversation s1");
        let proposals = learning::reflect(&found, &[]);
        assert!(
            matches!(&proposals[..], [learning::Proposal::Add(lesson)] if lesson.statement.contains("pnpm"))
        );
    }
}
