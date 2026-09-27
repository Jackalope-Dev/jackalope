//! Learning extraction from live conversation history.
//!
//! Evaluates messages and attempts in a conversation up to the previous
//! `/learn` point, extracting user preferences, corrections, clarifications,
//! verification commands and session lessons into reusable project context.

use super::{LiveSessions, SessionMessage};
use crate::commands::{
    knowledge::{KnowledgeEntry, KnowledgeKind, LearningSource},
    tasks::{TaskRun, TaskRuntime},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedResult {
    pub count: usize,
    pub lessons: Vec<String>,
    pub message: String,
}

fn words(text: &str) -> String {
    format!(
        " {} ",
        text.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    )
}

fn phrases(text: &str) -> Vec<String> {
    let stop = [
        "always", "never", "prefer", "please", "should", "would", "could", "these", "those",
        "their", "there", "before", "after", "about", "using", "ensure", "instead", "without",
        "with", "from", "this", "that", "have", "only", "when", "must", "still", "work", "works",
        "next", "just", "then", "already", "continue", "thanks", "make", "sure", "remember",
    ];
    let mut seen = HashSet::new();
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 4 && w.len() <= 60 && !stop.contains(w))
        .filter(|w| seen.insert(w.to_string()))
        .take(8)
        .map(str::to_string)
        .collect()
}

fn reusable(text: &str) -> bool {
    let text = text.trim();
    let lower = text.to_lowercase();
    text.len() >= 15
        && text.len() <= 500
        && !text.contains(['\0', '\n', '\r'])
        && ![
            "password",
            "secret",
            "token",
            "credential",
            "api key",
            "api_key",
            "bearer",
            "-----begin",
            "://",
            "permission",
            "authorization",
        ]
        .iter()
        .any(|s| lower.contains(s))
}

fn candidate(
    project_id: &str,
    project_path: &str,
    key: &str,
    title: &str,
    content: String,
    mut keywords: Vec<String>,
    kind: &str,
    evidence: String,
    run_id: Option<String>,
) -> KnowledgeEntry {
    keywords.sort();
    keywords.dedup();
    let hash = Sha256::digest(format!(
        "session-learning-v1\0{project_id}\0{project_path}\0{key}"
    ));
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    KnowledgeEntry {
        id: uuid::Uuid::from_bytes(bytes).to_string(),
        project_id: project_id.into(),
        project_path: project_path.into(),
        kind: KnowledgeKind::Memory,
        title: title.chars().take(100).collect(),
        content,
        keywords,
        enabled: true,
        dismissed: false,
        process: Default::default(),
        automatic: Some(LearningSource {
            kind: kind.into(),
            evidence: vec![evidence],
            managed: false,
            resolution: None,
        }),
        source_run_id: run_id,
        source_head: None,
        revision: 0,
        updated_at: Utc::now().to_rfc3339(),
    }
}

/// Evaluates a conversation's history up to the previous `/learn`, pulling out
/// durable lessons, preferences and conventions for project context.
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

    let visible_messages: Vec<&SessionMessage> =
        session.messages.iter().filter(|m| !m.canceled).collect();

    let start_idx = match &session.last_learned_message_id {
        Some(last_id) => match visible_messages.iter().position(|m| &m.id == last_id) {
            Some(pos) => pos + 1,
            None => 0,
        },
        None => 0,
    };

    let messages_to_learn = &visible_messages[start_idx..];
    if messages_to_learn.is_empty() {
        return Ok(LearnedResult {
            count: 0,
            lessons: vec![],
            message: if session.last_learned_message_id.is_some() {
                "No new session history to learn from since the last /learn.".into()
            } else {
                "This conversation has no messages to learn from yet.".into()
            },
        });
    }

    let run_ids: HashSet<String> = messages_to_learn
        .iter()
        .filter_map(|m| m.run_id.clone())
        .collect();

    let relevant_runs: Vec<&TaskRun> = snapshot
        .runs
        .iter()
        .filter(|run| run_ids.contains(&run.id))
        .collect();

    let project_id = &session.request.project_id;
    let project_path = &session.request.project_path;

    let mut candidates: Vec<KnowledgeEntry> = Vec::new();

    // 1. Directives, preferences, and rules in user messages
    for msg in messages_to_learn {
        let mut in_code = false;
        for line in msg.text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("```") {
                in_code = !in_code;
                continue;
            }
            if in_code {
                continue;
            }
            let stripped = trimmed.trim_start_matches(['-', '*', ' ', '•']);
            let lower = stripped.to_lowercase();
            let is_pref = [
                "always ",
                "never ",
                "prefer ",
                "ensure ",
                "make sure ",
                "remember to ",
                "should ",
                "must ",
                "don't ",
                "do not ",
                "we use ",
                "in this project ",
                "use ",
            ]
            .iter()
            .any(|prefix| lower.starts_with(prefix));

            if is_pref && reusable(stripped) {
                let kw = phrases(stripped);
                if !kw.is_empty() {
                    candidates.push(candidate(
                        project_id,
                        project_path,
                        &format!("preference:{}", words(stripped)),
                        "User preference",
                        format!("Previously requested by the user: {stripped}\nApply when relevant to future tasks in this project; newer instructions take precedence."),
                        kw,
                        "preference",
                        format!("Session {} · {}", session.id, stripped),
                        msg.run_id.clone(),
                    ));
                }
            } else if (lower.starts_with("instead of ")
                || lower.starts_with("correction:")
                || lower.starts_with("fix:")
                || lower.contains("that broke")
                || lower.contains("instead of"))
                && reusable(stripped)
            {
                let kw = phrases(stripped);
                if !kw.is_empty() {
                    candidates.push(candidate(
                        project_id,
                        project_path,
                        &format!("correction:{}", words(stripped)),
                        "Session correction",
                        format!("In session \"{}\", user clarified: {stripped}\nKeep this feedback in mind for future work on this project.", session.title),
                        kw,
                        "adjustment",
                        format!("Session {} · {}", session.id, stripped),
                        msg.run_id.clone(),
                    ));
                }
            }
        }
    }

    // 2. Answered clarification questions from runs
    for run in &relevant_runs {
        for prompt in &run.prompts {
            if prompt.status == "answered" && prompt.input_type == "text" {
                if let Some(answer) = &prompt.answer {
                    let trimmed_ans = answer.trim();
                    if reusable(trimmed_ans) {
                        let combined = format!("{} {}", prompt.question, trimmed_ans);
                        let kw = phrases(&combined);
                        if !kw.is_empty() {
                            let title = format!(
                                "Clarification: {}",
                                prompt.question.chars().take(60).collect::<String>()
                            );
                            candidates.push(candidate(
                                project_id,
                                project_path,
                                &format!("prompt:{}:{}", run.id, prompt.id),
                                &title,
                                format!("Clarification in \"{}\": {}\nApply when relevant to future work in this project.", session.title, trimmed_ans),
                                kw,
                                "clarification",
                                format!("Session {} · Task {} · prompt {}", session.id, run.id, prompt.id),
                                Some(run.id.clone()),
                            ));
                        }
                    }
                }
            }
        }

        // 3. Verified checks
        if let Some(check) = &run.verification {
            if check.result.success && reusable(&format!("Saved verification: {}", check.command)) {
                candidates.push(candidate(
                    project_id,
                    project_path,
                    &format!("check:{}", check.command),
                    "Verified check command",
                    format!("The command \"{}\" passed verification in session \"{}\". Consider this command when testing changes in this project.", check.command, session.title),
                    vec!["test".into(), "tests".into(), "verify".into(), "check".into(), "verification".into()],
                    "verification",
                    format!("Session {} · Task {} · check", session.id, run.id),
                    Some(run.id.clone()),
                ));
            }
        }
    }

    // 4. Session Summary fallback if no specific candidates were extracted
    if candidates.is_empty() {
        let user_text = messages_to_learn
            .iter()
            .map(|m| m.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let user_summary: String = user_text
            .lines()
            .filter(|l| !l.trim().starts_with("```"))
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(300)
            .collect();
        let user_summary = user_summary.trim();

        if user_summary.len() >= 15 && reusable(user_summary) {
            let mut kw = phrases(user_summary);
            if kw.is_empty() {
                kw = phrases(&session.title);
            }
            if kw.is_empty() {
                kw.push("workflow".into());
            }

            let result_summary: Option<String> = relevant_runs
                .iter()
                .find(|r| !r.result.trim().is_empty())
                .map(|r| {
                    let first_line = r
                        .result
                        .lines()
                        .find(|l| !l.trim().is_empty())
                        .unwrap_or("");
                    first_line.chars().take(200).collect::<String>()
                });

            let content = match result_summary {
                Some(res) if reusable(&res) => format!(
                    "Learned from session \"{}\": {}\nOutcome: {}",
                    session.title, user_summary, res
                ),
                _ => format!(
                    "Session guidance from \"{}\": {}\nKeep this context in mind for similar tasks in this project.",
                    session.title, user_summary
                ),
            };

            let title = format!(
                "Session lesson: {}",
                session.title.chars().take(80).collect::<String>()
            );
            candidates.push(candidate(
                project_id,
                project_path,
                &format!("session-summary:{}", session.id),
                &title,
                content,
                kw,
                "session",
                format!("Session {}", session.id),
                relevant_runs.first().map(|r| r.id.clone()),
            ));
        }
    }

    // Save candidates to KnowledgeStore
    let existing_entries = runtime.knowledge.list(project_id, project_path)?;
    let mut saved_lessons = Vec::new();

    for mut entry in candidates {
        if let Some(existing) = existing_entries.iter().find(|e| e.id == entry.id) {
            if existing.content == entry.content && existing.enabled && !existing.dismissed {
                saved_lessons.push(format!(
                    "{}: {}",
                    entry.title,
                    entry.content.lines().next().unwrap_or(&entry.content)
                ));
                continue;
            }
            entry.revision = existing.revision;
        } else {
            entry.revision = 0;
        }

        match runtime.knowledge.save(entry) {
            Ok(saved) => {
                let summary_line = saved
                    .content
                    .lines()
                    .next()
                    .unwrap_or(&saved.content)
                    .to_string();
                saved_lessons.push(format!("{}: {}", saved.title, summary_line));
            }
            Err(e) => {
                return Err(format!("Could not save learned lesson: {e}"));
            }
        }
    }

    // Update last_learned_message_id in the session
    let latest_message_id = messages_to_learn.last().map(|m| m.id.clone());
    sessions.update(|ledger| {
        let s = LiveSessions::session(ledger, session_id)?;
        s.last_learned_message_id = latest_message_id;
        s.updated_at = Utc::now().to_rfc3339();
        Ok(())
    })?;

    let count = saved_lessons.len();
    let message = if count == 0 {
        "No new project lessons found in this session history.".into()
    } else if count == 1 {
        "Learned 1 project lesson and saved to context".into()
    } else {
        format!("Learned {count} project lessons and saved to context")
    };

    Ok(LearnedResult {
        count,
        lessons: saved_lessons,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrases_filters_stopwords_and_short_words() {
        let extracted = phrases("Always use pnpm for package management and tests");
        assert!(extracted.contains(&"pnpm".to_string()));
        assert!(extracted.contains(&"package".to_string()));
        assert!(extracted.contains(&"management".to_string()));
        assert!(extracted.contains(&"tests".to_string()));
        assert!(!extracted.contains(&"always".to_string()));
        assert!(!extracted.contains(&"for".to_string()));
    }

    #[test]
    fn reusable_rejects_credentials_and_invalid_lengths() {
        assert!(!reusable("short"));
        assert!(!reusable("password = 123456789012345"));
        assert!(!reusable("my api_key is sk-abcdef123456789"));
        assert!(!reusable("token: bearer abcdef123456789"));
        assert!(reusable("Always use pnpm for package management."));
    }

    #[test]
    fn candidate_produces_valid_knowledge_entry() {
        let entry = candidate(
            "proj-1",
            "/path/to/project",
            "pref:biome",
            "User preference",
            "Always format with Biome before completing tasks.".into(),
            vec!["biome".into(), "format".into()],
            "preference",
            "Session s1 · Always format with Biome".into(),
            Some("run-1".into()),
        );
        assert_eq!(entry.project_id, "proj-1");
        assert_eq!(entry.project_path, "/path/to/project");
        assert_eq!(entry.kind, KnowledgeKind::Memory);
        assert_eq!(entry.title, "User preference");
        assert!(entry.enabled);
        assert!(!entry.dismissed);
        assert_eq!(entry.keywords, vec!["biome", "format"]);
        assert!(uuid::Uuid::parse_str(&entry.id).is_ok());
        let automatic = entry.automatic.expect("should have automatic source");
        assert_eq!(automatic.kind, "preference");
        assert!(!automatic.managed);
    }

    #[test]
    fn history_slicing_respects_previous_learn_marker() {
        let msg1 = SessionMessage {
            id: "m1".into(),
            text: "Hello".into(),
            created_at: "2026-09-01T00:00:00Z".into(),
            run_id: None,
            canceled: false,
        };
        let msg2 = SessionMessage {
            id: "m2".into(),
            text: "Always use pnpm for package management.".into(),
            created_at: "2026-09-01T00:01:00Z".into(),
            run_id: None,
            canceled: false,
        };
        let msg3 = SessionMessage {
            id: "m3".into(),
            text: "Ensure keyboard focus stays inside modals.".into(),
            created_at: "2026-09-01T00:02:00Z".into(),
            run_id: None,
            canceled: false,
        };
        let messages = vec![&msg1, &msg2, &msg3];

        // Without prior learn, all messages are inspected
        let start_none = match None as Option<&str> {
            Some(last_id) => messages
                .iter()
                .position(|m| m.id == last_id)
                .map(|p| p + 1)
                .unwrap_or(0),
            None => 0,
        };
        assert_eq!(start_none, 0);
        assert_eq!(messages[start_none..].len(), 3);

        // With prior learn at m2, only m3 is inspected
        let last_id = Some("m2");
        let start_m2 = match last_id {
            Some(last_id) => messages
                .iter()
                .position(|m| m.id == last_id)
                .map(|p| p + 1)
                .unwrap_or(0),
            None => 0,
        };
        assert_eq!(start_m2, 2);
        assert_eq!(messages[start_m2..].len(), 1);
        assert_eq!(messages[start_m2].id, "m3");

        // With prior learn at m3, slice is empty
        let last_id = Some("m3");
        let start_m3 = match last_id {
            Some(last_id) => messages
                .iter()
                .position(|m| m.id == last_id)
                .map(|p| p + 1)
                .unwrap_or(0),
            None => 0,
        };
        assert_eq!(start_m3, 3);
        assert!(messages[start_m3..].is_empty());
    }
}
