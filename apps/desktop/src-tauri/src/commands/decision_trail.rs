//! The decision trail: an append-only record of the forks, pivots, reverts, blockers and
//! completed units an agent reports during an attempt. Each attempt keeps its own trail,
//! so a retry or continuation starts a new run of entries. When the attempt ends,
//! Jackalope checks every evidence pointer locally, without model calls, and marks the
//! ones it cannot find so a reviewer can see which claims lack backing.

use super::{
    coordination::Coordinator,
    git_command::{command as git, Policy},
    tasks::{TaskRun, TaskRuntime},
};
use axum::{
    extract::State as WebState,
    http::{HeaderMap, StatusCode},
    Json,
};
use rmcp::schemars;
use serde::{Deserialize, Deserializer, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::Path,
    process::Stdio,
};

/// Appended to every attempt's harness instructions.
pub const CONTRACT: &str = "In long work, call record_decision (HTTP: POST /v1/decisions) only at real forks, pivots, reverts, blockers and finished units with their check result. Evidence is pointers (commit, path:line, check:<name>), not prose; supersede a wrong entry, never rewrite it.\n";

/// Entries one attempt may record. Retries and continuations start their own trail.
const MAX_ENTRIES: usize = 100;
const MAX_POINTERS: usize = 4;
/// Files larger than this are only checked for existence, not line counts.
const LINE_CHECK_BYTES: u64 = 8_000_000;

pub const FOUND: &str = "found";
pub const MISSING: &str = "missing";
/// Links and issue numbers Jackalope does not fetch.
pub const EXTERNAL: &str = "external";

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct RecordDecisionInput {
    #[schemars(
        description = "Phase or workstream, such as setup, api or verify. Up to 40 characters"
    )]
    pub phase: String,
    #[schemars(description = "What was chosen or done, in one line of up to 240 characters")]
    pub decision: String,
    #[schemars(description = "Why, in plain words, up to 240 characters")]
    pub why: String,
    #[schemars(
        description = "Up to four pointers that back the entry: a commit SHA, path or path:line, check:<name>, screenshot:<name> or an artifact path. Pointers only, never prose"
    )]
    #[schemars(with = "Vec<String>")]
    #[serde(default, deserialize_with = "one_or_many")]
    pub evidence: Vec<String>,
    #[schemars(
        description = "Outcome, such as tests pass, reverted, blocked or open. Up to 120 characters"
    )]
    pub result: String,
    #[schemars(
        description = "Optional id of an earlier entry from this task that this one corrects"
    )]
    #[serde(default)]
    pub supersedes: Option<String>,
}

fn one_or_many<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Value {
        One(String),
        Many(Vec<String>),
    }
    Ok(match Option::<Value>::deserialize(deserializer)? {
        None => vec![],
        Some(Value::One(value)) => vec![value],
        Some(Value::Many(values)) => values,
    })
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DecisionEntry {
    pub id: String,
    pub at: String,
    pub phase: String,
    pub decision: String,
    pub why: String,
    pub evidence: Vec<String>,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
    /// One result per evidence pointer, filled when the attempt ends. Empty until then.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<PointerCheck>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PointerCheck {
    pub pointer: String,
    /// `found`, `missing` or `external`. A string so later states never break old readers.
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

fn line(value: &str, limit: usize, field: &str) -> Result<String, String> {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let length = text.chars().count();
    if value.contains('\0') || length == 0 || length > limit {
        return Err(format!("Give {field} in 1 to {limit} characters."));
    }
    Ok(text)
}

fn prepare(input: RecordDecisionInput) -> Result<DecisionEntry, String> {
    if input.evidence.len() > MAX_POINTERS {
        return Err(format!(
            "Give at most {MAX_POINTERS} evidence pointers; link one artifact that lists the rest."
        ));
    }
    let mut evidence = Vec::new();
    for pointer in &input.evidence {
        let pointer = line(pointer, 200, "each evidence pointer")?;
        if !evidence.contains(&pointer) {
            evidence.push(pointer);
        }
    }
    Ok(DecisionEntry {
        id: uuid::Uuid::new_v4().to_string(),
        at: chrono::Utc::now().to_rfc3339(),
        phase: line(&input.phase, 40, "phase")?,
        decision: line(&input.decision, 240, "decision")?,
        why: line(&input.why, 240, "why")?,
        evidence,
        result: line(&input.result, 120, "result")?,
        supersedes: input
            .supersedes
            .map(|id| id.trim().to_owned())
            .filter(|id| !id.is_empty()),
        checks: vec![],
    })
}

/// Appends one entry to a running attempt's trail and saves it durably.
pub(in crate::commands) fn record(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: RecordDecisionInput,
) -> Result<DecisionEntry, String> {
    let entry = prepare(input)?;
    if let Some(target) = &entry.supersedes {
        let known = run.decisions.iter().any(|item| &item.id == target)
            || runtime.integration_runs()?.iter().any(|other| {
                other.task_id == run.task_id
                    && other.decisions.iter().any(|item| &item.id == target)
            });
        if !known {
            return Err("supersedes must be the id of an earlier entry from this task.".into());
        }
    }
    let mut outcome = Err("Attempt not found".to_owned());
    runtime.update_checked(&run.id, |current| {
        outcome = if !["starting", "running"].contains(&current.status.as_str()) {
            Err("This attempt has ended; its decision trail is closed.".into())
        } else if current.decisions.len() >= MAX_ENTRIES {
            Err(format!(
                "This attempt already has {MAX_ENTRIES} decisions. Log only forks, pivots, reverts, blockers and completed units."
            ))
        } else {
            current
                .activity
                .push(format!("[Decision: {}] {}", entry.phase, entry.decision));
            current.decisions.push(entry.clone());
            Ok(())
        };
    })?;
    outcome.map(|_| entry)
}

/// POST /v1/decisions: the HTTP form of the record_decision tool.
pub(in crate::commands) async fn bridge_record(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Json(input): Json<RecordDecisionInput>,
) -> Result<Json<DecisionEntry>, (StatusCode, String)> {
    let run = service
        .authorized_run(&headers)
        .map_err(|status| (status, "Unauthorized".into()))?;
    let runtime = service.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || record(&runtime, &run, input))
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .map(Json)
        .map_err(|error| (StatusCode::BAD_REQUEST, error))
}

/// Checks every evidence pointer of an attempt that has just ended and saves the results.
/// Runs only local file reads and one `git cat-file`; no model or network calls.
pub(in crate::commands) fn check_evidence(runtime: &TaskRuntime, id: &str) {
    let Some(run) = runtime.run_snapshot(id) else {
        return;
    };
    if run.decisions.iter().all(|entry| entry.evidence.is_empty()) {
        return;
    }
    let checks = review(&run);
    let _ = runtime.update_checked(id, |current| {
        for entry in &mut current.decisions {
            if let Some(found) = checks.get(&entry.id) {
                entry.checks = found.clone();
            }
        }
    });
}

#[derive(Debug, PartialEq)]
enum Pointer {
    External,
    Commit(String),
    Check(Option<String>),
    Report(String),
    Capture(String),
    File { path: String, line: Option<usize> },
    Unknown,
}

fn is_commit_id(text: &str) -> bool {
    (7..=64).contains(&text.len()) && text.chars().all(|c| c.is_ascii_hexdigit())
}

fn parse(raw: &str) -> Pointer {
    let text = raw.trim().trim_matches('`');
    let lower = text.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || (text.len() > 1
            && text.starts_with('#')
            && text[1..].chars().all(|c| c.is_ascii_digit()))
    {
        return Pointer::External;
    }
    if matches!(
        lower.as_str(),
        "check" | "checks" | "verification" | "saved check"
    ) {
        return Pointer::Check(None);
    }
    if let Some((label, rest)) = text.split_once([':', ' ']) {
        let rest = rest.trim();
        match label.to_ascii_lowercase().as_str() {
            "commit" | "sha" => return Pointer::Commit(rest.to_owned()),
            "check" | "test" | "verification" => return Pointer::Check(Some(rest.to_owned())),
            "report" | "step" => return Pointer::Report(rest.to_owned()),
            "screenshot" | "capture" => return Pointer::Capture(rest.to_owned()),
            "file" | "path" | "artifact" => return file(rest),
            "pr" | "issue" => return Pointer::External,
            _ => {}
        }
    }
    if is_commit_id(text) {
        return Pointer::Commit(text.to_owned());
    }
    if text.contains(char::is_whitespace) && !text.contains(['/', '\\', '.']) {
        return Pointer::Unknown;
    }
    file(text)
}

/// Splits `path:12`, `path:12-20`, `path:12:4` and `path#L12` into a path and first line.
fn file(text: &str) -> Pointer {
    let text = text.trim();
    if let Some((path, rest)) = text.rsplit_once("#L") {
        if let Ok(line) = rest
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>()
            .parse()
        {
            return Pointer::File {
                path: path.to_owned(),
                line: Some(line),
            };
        }
    }
    let bytes = text.as_bytes();
    let start = if bytes.len() > 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        2
    } else {
        0
    };
    if let Some(offset) = text[start..].find(':') {
        let index = start + offset;
        let digits: String = text[index + 1..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        if let Ok(line) = digits.parse() {
            return Pointer::File {
                path: text[..index].to_owned(),
                line: Some(line),
            };
        }
    }
    Pointer::File {
        path: text.to_owned(),
        line: None,
    }
}

fn check(state: &str, pointer: &str, note: Option<String>) -> PointerCheck {
    PointerCheck {
        pointer: pointer.to_owned(),
        state: state.to_owned(),
        note,
    }
}

fn review(run: &TaskRun) -> HashMap<String, Vec<PointerCheck>> {
    let root = Path::new(if run.workspace.is_empty() {
        &run.project_path
    } else {
        &run.workspace
    });
    let parsed: Vec<(&str, Vec<(&str, Pointer)>)> = run
        .decisions
        .iter()
        .map(|entry| {
            (
                entry.id.as_str(),
                entry
                    .evidence
                    .iter()
                    .map(|pointer| (pointer.as_str(), parse(pointer)))
                    .collect(),
            )
        })
        .collect();
    let wanted: HashSet<String> = parsed
        .iter()
        .flat_map(|(_, pointers)| pointers)
        .filter_map(|(_, pointer)| match pointer {
            Pointer::Commit(sha) if is_commit_id(sha) => Some(sha.to_ascii_lowercase()),
            _ => None,
        })
        .collect();
    let commits = existing_commits(root, &wanted);
    parsed
        .into_iter()
        .map(|(id, pointers)| {
            let checks = pointers
                .into_iter()
                .map(|(raw, pointer)| resolve(run, root, &commits, raw, pointer))
                .collect();
            (id.to_owned(), checks)
        })
        .collect()
}

fn resolve(
    run: &TaskRun,
    root: &Path,
    commits: &HashSet<String>,
    raw: &str,
    pointer: Pointer,
) -> PointerCheck {
    let missing = |note: &str| check(MISSING, raw, Some(note.to_owned()));
    let found = || check(FOUND, raw, None);
    let matches = |value: &str, name: &str| value.trim().eq_ignore_ascii_case(name.trim());
    match pointer {
        Pointer::External => check(EXTERNAL, raw, Some("Not checked locally".into())),
        Pointer::Unknown => missing("Not a commit, path, check or capture"),
        Pointer::Commit(sha) if !is_commit_id(&sha) => missing("Not a commit id"),
        Pointer::Commit(sha) if commits.contains(&sha.to_ascii_lowercase()) => found(),
        Pointer::Commit(_) => missing("No such commit in this workspace"),
        Pointer::Check(None) if run.verification.is_some() || !run.validation_steps.is_empty() => {
            found()
        }
        Pointer::Check(None) => missing("No check was recorded"),
        Pointer::Check(Some(name)) => {
            let lower = name.to_lowercase();
            if run
                .validation_steps
                .iter()
                .any(|step| matches(&step.id, &name) || step.step.to_lowercase().contains(&lower))
                || run
                    .verification
                    .as_ref()
                    .is_some_and(|check| check.command.to_lowercase().contains(&lower))
            {
                found()
            } else {
                missing("No recorded check by that name")
            }
        }
        Pointer::Report(name) => {
            if run
                .validation_steps
                .iter()
                .any(|step| matches(&step.id, &name) || matches(&step.step, &name))
            {
                found()
            } else {
                missing("No recorded report by that name")
            }
        }
        Pointer::Capture(name) => {
            let normalized = name.replace('\\', "/");
            let recorded = run.screenshots.iter().any(|shot| {
                matches(&shot.id, &name)
                    || matches(&shot.name, &name)
                    || shot.file_path.replace('\\', "/").ends_with(&normalized)
            }) || run.review_captures.as_ref().is_some_and(|captures| {
                captures
                    .pages
                    .iter()
                    .any(|page| page.path.replace('\\', "/").ends_with(&normalized))
            });
            if recorded {
                found()
            } else {
                match check_file(root, &name, None) {
                    Ok(()) => found(),
                    Err(_) => missing("No recorded capture by that name"),
                }
            }
        }
        Pointer::File { path, line } => match check_file(root, &path, line) {
            Ok(()) => found(),
            Err(note) => missing(&note),
        },
    }
}

fn check_file(root: &Path, path: &str, line: Option<usize>) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("No path given".into());
    }
    let candidate = Path::new(path.trim());
    let full = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let metadata = std::fs::metadata(&full).map_err(|_| "File not found".to_owned())?;
    let Some(line) = line else {
        return Ok(());
    };
    if metadata.is_dir() {
        return Err("Is a folder, not a file".into());
    }
    if line == 0 {
        return Err("Lines start at 1".into());
    }
    if metadata.len() > LINE_CHECK_BYTES {
        return Ok(());
    }
    let bytes = std::fs::read(&full).map_err(|_| "File could not be read".to_owned())?;
    let mut lines = bytes.iter().filter(|byte| **byte == b'\n').count();
    if bytes.last().is_some_and(|byte| *byte != b'\n') {
        lines += 1;
    }
    if line > lines {
        return Err(format!("The file has {lines} lines"));
    }
    Ok(())
}

/// Returns the requested commit ids that exist in the workspace repository, using one
/// `git cat-file --batch-check` process for the whole trail.
fn existing_commits(root: &Path, wanted: &HashSet<String>) -> HashSet<String> {
    if wanted.is_empty() {
        return HashSet::new();
    }
    let ordered: Vec<&String> = wanted.iter().collect();
    let Ok(mut child) = git(root, &["cat-file", "--batch-check"], Policy::Inspection)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return HashSet::new();
    };
    let input: String = ordered
        .iter()
        .map(|sha| format!("{sha}^{{commit}}\n"))
        .collect();
    let Some(mut stdin) = child.stdin.take() else {
        return HashSet::new();
    };
    // Written from another thread so a full output pipe can never block the input.
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let output = child.wait_with_output();
    let _ = writer.join();
    let Ok(output) = output else {
        return HashSet::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .zip(ordered)
        .filter(|(line, _)| line.split_whitespace().nth(1) == Some("commit"))
        .map(|(_, sha)| sha.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(evidence: serde_json::Value) -> RecordDecisionInput {
        serde_json::from_value(serde_json::json!({
            "phase": "verify", "decision": "Kept the old parser", "why": "The new one\nbroke Windows paths",
            "evidence": evidence, "result": "tests pass"
        }))
        .unwrap()
    }

    #[test]
    fn entries_are_single_line_bounded_and_accept_one_pointer_or_many() {
        let entry = prepare(input(serde_json::json!("src/parse.rs:12"))).unwrap();
        assert_eq!(entry.why, "The new one broke Windows paths");
        assert_eq!(entry.evidence, vec!["src/parse.rs:12"]);
        let repeated = prepare(input(serde_json::json!(["a.rs", " a.rs ", "b.rs"]))).unwrap();
        assert_eq!(repeated.evidence, vec!["a.rs", "b.rs"]);
        assert!(prepare(input(serde_json::json!(["a", "b", "c", "d", "e"]))).is_err());
        assert!(prepare(input(serde_json::json!([""]))).is_err());
        let mut long = input(serde_json::json!([]));
        long.decision = "x".repeat(241);
        assert!(prepare(long).is_err());
        let none: RecordDecisionInput = serde_json::from_value(serde_json::json!({
            "phase": "a", "decision": "b", "why": "c", "result": "d", "supersedes": "  "
        }))
        .unwrap();
        let entry = prepare(none).unwrap();
        assert!(entry.evidence.is_empty() && entry.supersedes.is_none());
    }

    #[test]
    fn saved_entries_load_without_checks_and_unknown_states_survive() {
        let entry: DecisionEntry = serde_json::from_value(serde_json::json!({
            "id": "a", "at": "now", "phase": "p", "decision": "d", "why": "w", "result": "r"
        }))
        .unwrap();
        assert!(entry.checks.is_empty() && entry.evidence.is_empty());
        let value = serde_json::to_value(&entry).unwrap();
        assert!(value.get("checks").is_none() && value.get("supersedes").is_none());
        let later: PointerCheck =
            serde_json::from_value(serde_json::json!({"pointer": "x", "state": "stale"})).unwrap();
        assert_eq!(later.state, "stale");
    }

    #[test]
    fn pointers_are_classified_without_guessing() {
        assert_eq!(parse("https://github.com/o/r/pull/4"), Pointer::External);
        assert_eq!(parse("#42"), Pointer::External);
        assert_eq!(parse("PR 42"), Pointer::External);
        assert_eq!(parse("commit 3a9f1c2"), Pointer::Commit("3a9f1c2".into()));
        assert_eq!(parse("3a9f1c2"), Pointer::Commit("3a9f1c2".into()));
        assert_eq!(parse("check"), Pointer::Check(None));
        assert_eq!(
            parse("check:pnpm test"),
            Pointer::Check(Some("pnpm test".into()))
        );
        assert_eq!(parse("screenshot:home"), Pointer::Capture("home".into()));
        assert_eq!(
            parse("src/a.rs:12-20"),
            Pointer::File {
                path: "src/a.rs".into(),
                line: Some(12)
            }
        );
        assert_eq!(
            parse("src/a.rs#L7"),
            Pointer::File {
                path: "src/a.rs".into(),
                line: Some(7)
            }
        );
        assert_eq!(
            parse(r"C:\work\a.rs:3"),
            Pointer::File {
                path: r"C:\work\a.rs".into(),
                line: Some(3)
            }
        );
        assert_eq!(
            parse(r"C:\work\a.rs"),
            Pointer::File {
                path: r"C:\work\a.rs".into(),
                line: None
            }
        );
        assert_eq!(parse("pixel diff zero"), Pointer::Unknown);
    }

    #[test]
    fn evidence_is_checked_against_files_commits_checks_and_captures() {
        let root = std::env::temp_dir().join(format!("jackalope-trail-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.rs"), "one\ntwo\nthree").unwrap();
        let git_ok = |args: &[&str]| {
            git(&root, args, Policy::Isolated)
                .output()
                .is_ok_and(|output| output.status.success())
        };
        assert!(git_ok(&["init", "-q"]));
        assert!(git_ok(&["add", "."]));
        assert!(git_ok(&[
            "-c",
            "user.name=Trail",
            "-c",
            "user.email=trail@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "-m",
            "start"
        ]));
        let head = String::from_utf8(
            git(&root, &["rev-parse", "HEAD"], Policy::Isolated)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_owned();
        let mut run = TaskRun {
            id: "run".into(),
            workspace: root.to_string_lossy().into(),
            ..Default::default()
        };
        run.validation_steps
            .push(crate::commands::harness::ValidationStep {
                id: "step-1".into(),
                step: "Focused parser tests".into(),
                status: "passed".into(),
                notes: None,
                evidence: vec![],
                timestamp: "now".into(),
                requirements: vec![],
                finding: None,
                safety_fact: None,
            });
        let pointers = [
            "src/a.rs:3",
            "src/a.rs:4",
            "src/missing.rs",
            &head[..10],
            "commit 0000000000",
            "check:parser tests",
            "check:lint",
            "screenshot:home",
            "https://example.invalid/run",
            "looked fine to me",
        ];
        run.decisions = pointers
            .chunks(MAX_POINTERS)
            .enumerate()
            .map(|(index, chunk)| DecisionEntry {
                id: format!("entry-{index}"),
                evidence: chunk.iter().map(|text| text.to_string()).collect(),
                ..Default::default()
            })
            .collect();
        let checks = review(&run);
        let states: Vec<String> = (0..run.decisions.len())
            .flat_map(|index| checks[&format!("entry-{index}")].clone())
            .map(|check| check.state)
            .collect();
        assert_eq!(
            states,
            [FOUND, MISSING, MISSING, FOUND, MISSING, FOUND, MISSING, MISSING, EXTERNAL, MISSING]
        );
        assert_eq!(
            checks["entry-0"][1].note.as_deref(),
            Some("The file has 3 lines")
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
