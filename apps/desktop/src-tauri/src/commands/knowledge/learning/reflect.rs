//! Reflection: turns what a person said and what was verified into proposals
//! against the project's learned lessons. Local and deterministic; it makes no
//! model calls. The promotion gate validates everything proposed here.

use super::{lifecycle, owned, Lesson, Proposal};
use crate::commands::knowledge::{words, KnowledgeEntry};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq)]
pub enum ObservationKind {
    /// Something the person wrote: a message, follow-up or task instruction.
    Statement,
    /// The person's typed answer to an agent's question.
    Answer { question: String },
    /// A check command that passed.
    Check,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    pub kind: ObservationKind,
    pub text: String,
    /// Where it came from, such as `Task <id>` or `Conversation <id>`.
    pub reference: String,
    pub run_id: Option<String>,
}

const DIRECTIVES: &[&str] = &[
    "always ",
    "never ",
    "prefer ",
    "ensure ",
    "make sure ",
    "remember to ",
    "should ",
    "must ",
    "don't ",
    "dont ",
    "do not ",
    "avoid ",
    "we use ",
    "in this project ",
    "use ",
];

const CORRECTIONS: &[&str] = &["instead of ", "correction:", "fix:"];

const RETIREMENTS: &[&str] = &[
    "no longer ",
    "we no longer ",
    "stop using ",
    "forget that ",
    "forget about ",
    "ignore the earlier ",
];

const STOP: &[&str] = &[
    "always", "never", "prefer", "please", "should", "would", "could", "these", "those", "their",
    "there", "before", "after", "about", "using", "ensure", "instead", "without", "with", "from",
    "this", "that", "have", "only", "when", "must", "still", "work", "works", "next", "just",
    "then", "already", "continue", "thanks", "make", "sure", "remember", "avoid", "stop", "longer",
    "anymore", "forget", "dont", "earlier", "ignore", "project",
];

pub(super) fn phrases(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 4 && w.len() <= 60 && !STOP.contains(w))
        .filter(|w| seen.insert(w.to_string()))
        .take(8)
        .map(str::to_string)
        .collect()
}

/// Whether a statement forbids rather than asks for something.
pub(super) fn negative(text: &str) -> bool {
    let text = words(text);
    [
        " never ",
        " don t ",
        " dont ",
        " do not ",
        " avoid ",
        " not ",
        " no longer ",
        " stop ",
    ]
    .iter()
    .any(|word| text.contains(word))
}

fn similarity(a: &str, b: &str) -> f64 {
    let a: HashSet<_> = phrases(a).into_iter().collect();
    let b: HashSet<_> = phrases(b).into_iter().collect();
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    a.intersection(&b).count() as f64 / a.union(&b).count() as f64
}

/// The same subject with the opposite instruction.
pub(super) fn contradicts(existing: &str, statement: &str) -> bool {
    similarity(existing, statement) >= 0.5 && negative(existing) != negative(statement)
}

fn statement_lesson(line: &str, observation: &Observation, correction: bool) -> Lesson {
    let (kind, title, content) = if correction {
        (
            "correction",
            "Correction",
            format!("The user corrected earlier work: {line}\nApply when relevant; newer instructions take precedence."),
        )
    } else {
        (
            "preference",
            "User preference",
            format!("Previously requested by the user: {line}\nApply when relevant to future tasks in this project; newer instructions take precedence."),
        )
    };
    Lesson {
        key: format!("{kind}:{}", words(line).trim()),
        kind: kind.into(),
        title: title.into(),
        statement: line.into(),
        content,
        keywords: phrases(line),
        reference: observation.reference.clone(),
        excerpt: line.into(),
        run_id: observation.run_id.clone(),
    }
}

fn lessons(observation: &Observation) -> Vec<(Lesson, bool)> {
    match &observation.kind {
        ObservationKind::Statement => {
            let mut found = vec![];
            let mut in_code = false;
            for line in observation.text.lines().take(200) {
                let trimmed = line.trim();
                if trimmed.starts_with("```") {
                    in_code = !in_code;
                    continue;
                }
                if in_code {
                    continue;
                }
                let line = trimmed.trim_start_matches(['-', '*', ' ', '•']).trim();
                let lower = line.to_lowercase();
                if RETIREMENTS.iter().any(|prefix| lower.starts_with(prefix))
                    || lower.ends_with(" anymore")
                    || lower.ends_with(" anymore.")
                {
                    let mut lesson = statement_lesson(line, observation, false);
                    lesson.kind = "retirement".into();
                    found.push((lesson, true));
                } else if DIRECTIVES.iter().any(|prefix| lower.starts_with(prefix)) {
                    found.push((statement_lesson(line, observation, false), false));
                } else if CORRECTIONS.iter().any(|prefix| lower.starts_with(prefix))
                    || lower.contains(" instead of ")
                    || lower.contains("that broke")
                {
                    found.push((statement_lesson(line, observation, true), false));
                }
            }
            found
        }
        ObservationKind::Answer { question } => {
            let answer = observation.text.trim();
            let question = question.trim();
            vec![(
                Lesson {
                    key: format!("answer:{}:{}", words(question).trim(), words(answer).trim()),
                    kind: "clarification".into(),
                    title: format!(
                        "Clarification: {}",
                        question.chars().take(60).collect::<String>()
                    ),
                    statement: answer.into(),
                    content: format!(
                        "Asked \"{}\", the user answered: {answer}\nApply when relevant to future work in this project.",
                        question.chars().take(200).collect::<String>()
                    ),
                    keywords: phrases(&format!("{question} {answer}")),
                    reference: observation.reference.clone(),
                    excerpt: answer.into(),
                    run_id: observation.run_id.clone(),
                },
                false,
            )]
        }
        ObservationKind::Check => {
            let command = observation.text.trim();
            vec![(
                Lesson {
                    key: format!("check:{command}"),
                    kind: "verification".into(),
                    title: "Verified check command".into(),
                    statement: format!("The check command {command} passed for this project."),
                    content: format!("The check command {command} passed in a recent task. Consider it when testing similar changes after inspecting its current definition; past checks do not verify new files."),
                    keywords: vec![
                        "test".into(),
                        "tests".into(),
                        "verify".into(),
                        "check".into(),
                        "verification".into(),
                    ],
                    reference: observation.reference.clone(),
                    excerpt: command.into(),
                    run_id: observation.run_id.clone(),
                },
                false,
            )]
        }
    }
}

/// Proposals for the observations, judged against the project's entries.
/// Only lessons the loop owns are named as merge, patch or retire targets.
pub fn reflect(observations: &[Observation], existing: &[KnowledgeEntry]) -> Vec<Proposal> {
    let candidates: Vec<(&KnowledgeEntry, &str)> = existing
        .iter()
        .filter(|entry| owned(entry))
        .filter_map(|entry| lifecycle(entry).map(|state| (entry, state.statement.as_str())))
        .collect();
    let mut proposals = vec![];
    let mut seen = HashSet::new();
    for observation in observations {
        for (lesson, retirement) in lessons(observation) {
            if !seen.insert(lesson.key.clone()) {
                continue;
            }
            // Check commands match only by their exact command, through the lesson id.
            if lesson.kind == "verification" {
                proposals.push(Proposal::Add(lesson));
                continue;
            }
            let best = candidates
                .iter()
                .filter(|(entry, _)| {
                    entry.automatic.as_ref().map(|source| source.kind.as_str())
                        != Some("verification")
                })
                .map(|(entry, statement)| {
                    (similarity(statement, &lesson.statement), *entry, *statement)
                })
                .filter(|(score, _, _)| *score > 0.0)
                .max_by(|a, b| a.0.total_cmp(&b.0));
            if retirement {
                if let Some((score, entry, _)) = best {
                    if score >= 0.5 {
                        proposals.push(Proposal::Retire {
                            target: entry.id.clone(),
                            reason: "The user said this no longer applies.".into(),
                            reference: lesson.reference,
                            excerpt: lesson.excerpt,
                        });
                    }
                }
                continue;
            }
            match best {
                Some((score, entry, statement))
                    if score >= 0.5 && negative(statement) != negative(&lesson.statement) =>
                {
                    proposals.push(Proposal::Patch {
                        target: entry.id.clone(),
                        lesson,
                    })
                }
                Some((score, entry, _)) if score >= 0.75 => proposals.push(Proposal::Merge {
                    target: entry.id.clone(),
                    lesson,
                }),
                _ => proposals.push(Proposal::Add(lesson)),
            }
        }
    }
    proposals
}
