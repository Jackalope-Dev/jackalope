use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// The most replies a windowed conversation snapshot can ask to carry in full.
pub(super) const MAX_WINDOW_REPLIES: usize = 1_000;
/// Characters of reply text one `live_session_results` call returns at most.
pub(super) const REPLY_PAGE_CHARS: usize = 512 * 1024;
/// Runs one `live_session_results` call may name.
pub(super) const REPLY_PAGE_RUNS: usize = 500;

/// 64 bits of SHA-256: the renderer echoes every revision on each refresh, so a short
/// fingerprint halves that traffic. A stale match needs a 64-bit collision on one record.
fn fingerprint(value: &impl Serialize) -> Result<String, String> {
    Ok(
        Sha256::digest(serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .iter()
            .take(8)
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

/// What a windowed snapshot keeps of a run outside its window: enough for the transcript
/// row, conversation status, cost and attention. The task list's own snapshot still holds
/// the full summary of every run, which readers of other fields use.
const COMPACT_FIELDS: &[&str] = &[
    "id",
    "taskId",
    "liveSessionId",
    "projectId",
    "projectName",
    "agent",
    "account",
    "model",
    "status",
    "startedAt",
    "endedAt",
    "error",
    "persistenceError",
    "verificationError",
    "verification",
    "exitCode",
    "usage",
    "decisions",
    "archivedAt",
    "resultOmitted",
    "resultChars",
];

fn compact(run: &TaskRun) -> Result<serde_json::Value, String> {
    let serde_json::Value::Object(fields) = serde_json::to_value(run).map_err(|e| e.to_string())?
    else {
        return Err("A run did not serialize as an object.".into());
    };
    Ok(serde_json::Value::Object(
        fields
            .into_iter()
            .filter(|(key, value)| {
                COMPACT_FIELDS.contains(&key.as_str())
                    && !value.is_null()
                    && value.as_array().is_none_or(|items| !items.is_empty())
            })
            .collect(),
    ))
}

/// Bounds a snapshot to what the open conversation shows. Its newest `replies` finished
/// replies and every active run stay whole; older replies leave their text out, recording
/// each one's length. Every other conversation keeps its newest run whole. All other runs
/// move to `compact_runs`, trimmed to `COMPACT_FIELDS`.
pub(super) fn window_runs(
    mut snapshot: SessionSnapshot,
    focused: Option<&str>,
    replies: usize,
) -> Result<SessionSnapshot, String> {
    let mut whole = std::collections::HashSet::new();
    let mut owned = std::collections::HashSet::new();
    for session in &snapshot.sessions {
        let keep = if Some(session.id.as_str()) == focused {
            replies
        } else {
            1
        };
        owned.insert(session.id.clone());
        whole.extend(
            session
                .batches
                .iter()
                .rev()
                .take(keep)
                .map(|batch| batch.run_id.clone()),
        );
    }
    let runs = std::mem::take(&mut snapshot.runs);
    for mut run in runs {
        let session = run.live_session_id.clone().unwrap_or_default();
        if run.status.is_active() || whole.contains(&run.id) || !owned.contains(&session) {
            snapshot.runs.push(run);
            continue;
        }
        if Some(session.as_str()) == focused && !run.result.is_empty() {
            run.result_chars = Some(run.result.chars().count());
            run.result_omitted = true;
        }
        run.result.clear();
        snapshot.compact_runs.push(compact(&run)?);
    }
    Ok(snapshot)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReply {
    pub id: String,
    pub result: String,
}

/// The replies of conversation `id` named in `run_ids`, in that order, until about
/// `REPLY_PAGE_CHARS` characters; the first always fits. Callers ask again for the rest.
pub(super) fn reply_page(runs: &[TaskRun], id: &str, run_ids: &[String]) -> Vec<SessionReply> {
    let by_id: std::collections::HashMap<&str, &TaskRun> = runs
        .iter()
        .filter(|run| run.live_session_id.as_deref() == Some(id))
        .map(|run| (run.id.as_str(), run))
        .collect();
    let mut total = 0;
    let mut page = Vec::new();
    for run_id in run_ids {
        let Some(run) = by_id.get(run_id.as_str()) else {
            continue;
        };
        let chars = run.result.chars().count();
        if !page.is_empty() && total + chars > REPLY_PAGE_CHARS {
            break;
        }
        total += chars;
        page.push(SessionReply {
            id: run.id.clone(),
            result: run.result.clone(),
        });
    }
    page
}

/// Lowercases when that keeps every character, matching the renderer's find.
fn fold(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    (lower.chars().count() == text.chars().count()).then_some(lower)
}

/// How often `query` occurs in each reply of conversation `id`, case-insensitively and
/// without overlaps, so find can count replies whose text the renderer has not loaded.
pub(super) fn search_replies(runs: &[TaskRun], id: &str, query: &str) -> BTreeMap<String, usize> {
    let needle = query.trim();
    let mut counts = BTreeMap::new();
    if needle.is_empty() {
        return counts;
    }
    let folded = fold(needle);
    for run in runs
        .iter()
        .filter(|run| run.live_session_id.as_deref() == Some(id) && !run.result.is_empty())
    {
        let count = match (fold(&run.result), &folded) {
            (Some(text), Some(needle)) => text.matches(needle.as_str()).count(),
            _ => run.result.matches(needle).count(),
        };
        if count > 0 {
            counts.insert(run.id.clone(), count);
        }
    }
    counts
}
fn compact_id(run: &serde_json::Value) -> &str {
    run.get("id").and_then(|id| id.as_str()).unwrap_or_default()
}

pub(super) fn changed_snapshot(
    mut snapshot: SessionSnapshot,
    known: &BTreeMap<String, String>,
) -> Result<SessionSnapshot, String> {
    if known.len() > 20000
        || known
            .iter()
            .any(|(key, value)| key.len() > 100 || value.len() > 64)
    {
        return Err("Session revision list is too large.".into());
    }
    let mut revisions = BTreeMap::new();
    for session in &snapshot.sessions {
        revisions.insert(format!("session:{}", session.id), fingerprint(session)?);
    }
    for run in &snapshot.runs {
        revisions.insert(format!("run:{}", run.id), fingerprint(run)?);
    }
    for run in &snapshot.compact_runs {
        revisions.insert(format!("run:{}", compact_id(run)), fingerprint(run)?);
    }
    snapshot.sessions.retain(|session| {
        let key = format!("session:{}", session.id);
        known.get(&key) != revisions.get(&key)
    });
    snapshot.runs.retain(|run| {
        let key = format!("run:{}", run.id);
        known.get(&key) != revisions.get(&key)
    });
    snapshot.compact_runs.retain(|run| {
        let key = format!("run:{}", compact_id(run));
        known.get(&key) != revisions.get(&key)
    });
    snapshot.revisions = Some(revisions);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unchanged_history_transfers_revisions_instead_of_transcripts() {
        let snapshot = || SessionSnapshot {
            revisions: None,
            compact_runs: vec![],
            sessions: vec![],
            runs: (0..500)
                .map(|index| TaskRun {
                    id: format!("run-{index}"),
                    result: "result ".repeat(1000),
                    ..Default::default()
                })
                .collect(),
            error: None,
        };
        let initial = changed_snapshot(snapshot(), &BTreeMap::new()).unwrap();
        let bytes_before = serde_json::to_vec(&initial).unwrap().len();
        let next = changed_snapshot(snapshot(), initial.revisions.as_ref().unwrap()).unwrap();
        let bytes_after = serde_json::to_vec(&next).unwrap().len();
        assert!(next.runs.is_empty());
        assert_eq!(next.revisions.as_ref().unwrap().len(), 500);
        assert!(bytes_after < bytes_before / 20);
    }
    const MESSAGES: usize = 2_000;
    const REPLY_CHARS: usize = 4_000;
    const WINDOW: usize = 40;

    /// A conversation of 2,000 messages, each answered by a 4,000-character reply; the
    /// last reply is still streaming.
    fn long_conversation() -> SessionSnapshot {
        let session: LiveSession = serde_json::from_value(serde_json::json!({
            "id": "long", "title": "Long", "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z", "paused": false, "closed": false,
            "draft": {"text": "", "revision": 0}, "error": null,
            "request": {"id": "request", "projectId": "fixture", "projectName": "Fixture",
                "projectPath": "/fixture", "agent": "codex", "model": null, "prompt": "Long",
                "isolated": true, "previousRunId": null},
            "messages": (0..MESSAGES).map(|index| serde_json::json!({
                "id": format!("message-{index}"), "text": format!("Message {index}: check the retry window."),
                "createdAt": "2026-01-01T00:00:00Z", "runId": format!("run-{index}"), "canceled": false,
            })).collect::<Vec<_>>(),
            "batches": (0..MESSAGES).map(|index| serde_json::json!({
                "runId": format!("run-{index}"), "messageIds": [format!("message-{index}")],
                "prompt": "", "previousRunId": null, "error": null, "settled": true,
            })).collect::<Vec<_>>(),
        }))
        .unwrap();
        let runs = (0..MESSAGES)
            .map(|index| {
                // As the snapshot carries them: summaries of runs with real paths and prompts.
                let mut run = TaskRun {
                    id: format!("run-{index}"),
                    task_id: format!("task-{index}"),
                    live_session_id: Some("long".into()),
                    project_id: "fixture".into(),
                    project_name: "Fixture".into(),
                    project_path: "/Users/someone/Code/fixture".into(),
                    workspace: "/Users/someone/Code/fixture/.worktrees/long".into(),
                    branch: "session/long".into(),
                    agent: "codex".into(),
                    prompt: "Live session: Long\n".repeat(40),
                    started_at: "2026-01-01T00:00:00Z".into(),
                    ended_at: Some("2026-01-01T00:01:00Z".into()),
                    ..Default::default()
                }
                .summary();
                run.result =
                    format!("{:<20}", format!("Reply {index} needle")).repeat(REPLY_CHARS / 20);
                run.status = if index + 1 == MESSAGES {
                    serde_json::from_value(serde_json::json!("running")).unwrap()
                } else {
                    serde_json::from_value(serde_json::json!("review")).unwrap()
                };
                run
            })
            .collect();
        SessionSnapshot {
            revisions: None,
            sessions: vec![session],
            runs,
            compact_runs: vec![],
            error: None,
        }
    }

    fn bytes(snapshot: &SessionSnapshot) -> usize {
        serde_json::to_vec(snapshot).unwrap().len()
    }

    fn windowed(snapshot: SessionSnapshot) -> SessionSnapshot {
        window_runs(snapshot, Some("long"), WINDOW).unwrap()
    }

    /// The first open of a 2,000-message conversation stays near a fixed budget: the
    /// conversation's own messages (about 0.66 MB here), whole records for the newest
    /// replies, a few hundred bytes per older run and no older reply text.
    const OPEN_BUDGET: usize = 1_600_000;

    #[test]
    fn conversation_snapshots_stay_within_their_transfer_budget() {
        let full = bytes(&changed_snapshot(long_conversation(), &BTreeMap::new()).unwrap());
        let opened = changed_snapshot(windowed(long_conversation()), &BTreeMap::new()).unwrap();
        assert!(
            bytes(&opened) <= OPEN_BUDGET,
            "opening sent {} bytes (unwindowed {full}), budget {OPEN_BUDGET}",
            bytes(&opened),
        );
        assert!(full > bytes(&opened) * 5);
        assert_eq!(opened.runs.len(), WINDOW);
        assert_eq!(opened.compact_runs.len(), MESSAGES - WINDOW);
        // Older runs carry no reply text and only the compact fields, a few hundred bytes each.
        let per_compact = opened
            .compact_runs
            .iter()
            .map(|run| serde_json::to_vec(run).unwrap().len())
            .max()
            .unwrap();
        assert!(per_compact <= 400, "a compact run took {per_compact} bytes");
        assert!(opened.compact_runs.iter().all(|run| {
            run["resultOmitted"] == true
                && run["resultChars"] == REPLY_CHARS
                && run.get("result").is_none()
                && run.get("prompt").is_none()
        }));

        // A refresh with nothing changed sends only the revision inventory.
        let known = opened.revisions.clone().unwrap();
        assert_eq!(known.len(), MESSAGES + 1);
        let idle = changed_snapshot(windowed(long_conversation()), &known).unwrap();
        assert!(idle.sessions.is_empty() && idle.runs.is_empty() && idle.compact_runs.is_empty());
        let per_record = 48;
        assert!(
            bytes(&idle) <= known.len() * per_record + 256,
            "an idle refresh sent {} bytes for {} records",
            bytes(&idle),
            known.len()
        );

        // A streaming reply growing sends that reply and the inventory, nothing else.
        let mut streamed = long_conversation();
        streamed
            .runs
            .last_mut()
            .unwrap()
            .result
            .push_str(" more streamed text");
        let update = changed_snapshot(windowed(streamed), &known).unwrap();
        assert_eq!(update.runs.len(), 1);
        assert!(update.sessions.is_empty() && update.compact_runs.is_empty());
        assert!(bytes(&update) <= known.len() * per_record + REPLY_CHARS + 4096);
    }

    #[test]
    fn windowing_keeps_active_and_newest_runs_whole_in_every_conversation() {
        let mut snapshot = long_conversation();
        let mut other: LiveSession = serde_json::from_value(serde_json::json!({
            "id": "other", "title": "Other", "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z", "paused": false, "closed": false,
            "draft": {"text": "", "revision": 0}, "error": null,
            "request": {"id": "request", "projectId": "fixture", "projectName": "Fixture",
                "projectPath": "/fixture", "agent": "codex", "model": null, "prompt": "Other",
                "isolated": true, "previousRunId": null},
            "messages": [], "batches": [],
        }))
        .unwrap();
        for id in ["old", "new"] {
            other.batches.push(
                serde_json::from_value(serde_json::json!({
                    "runId": id, "messageIds": [], "prompt": "", "previousRunId": null,
                    "error": null, "settled": true,
                }))
                .unwrap(),
            );
            snapshot.runs.push(TaskRun {
                id: id.into(),
                live_session_id: Some("other".into()),
                ..Default::default()
            });
        }
        snapshot.runs.push(TaskRun {
            id: "unowned".into(),
            live_session_id: Some("gone".into()),
            ..Default::default()
        });
        snapshot.sessions.push(other);
        let windowed = window_runs(snapshot, Some("long"), 2).unwrap();
        let whole = |id: &str| windowed.runs.iter().find(|run| run.id == id);
        let compacted = |id: &str| windowed.compact_runs.iter().any(|run| run["id"] == id);
        assert!(!whole("run-1999").unwrap().result.is_empty());
        assert!(!whole("run-1998").unwrap().result.is_empty());
        assert!(compacted("run-1997"));
        assert!(whole("new").is_some() && compacted("old"));
        assert!(whole("unowned").is_some());
        // Without a focused conversation every conversation keeps only its newest run whole.
        let unfocused = window_runs(long_conversation(), None, 40).unwrap();
        assert_eq!(unfocused.runs.len(), 1);
        assert!(unfocused
            .compact_runs
            .iter()
            .all(|run| run.get("resultOmitted").is_none()));
        // Older readers see the new fields only when something was left out.
        let json = serde_json::to_value(whole("run-1999").unwrap()).unwrap();
        assert!(json.get("resultOmitted").is_none() && json.get("resultChars").is_none());
        let plain = changed_snapshot(long_conversation(), &BTreeMap::new()).unwrap();
        assert!(serde_json::to_value(&plain)
            .unwrap()
            .get("compactRuns")
            .is_none());
    }

    #[test]
    fn reply_pages_follow_the_requested_order_within_a_size_cap() {
        let snapshot = long_conversation();
        let ids: Vec<String> = (0..300).rev().map(|index| format!("run-{index}")).collect();
        let page = reply_page(&snapshot.runs, "long", &ids);
        assert_eq!(page[0].id, "run-299");
        assert_eq!(page.len(), REPLY_PAGE_CHARS / REPLY_CHARS);
        assert!(page.iter().map(|reply| reply.result.len()).sum::<usize>() <= REPLY_PAGE_CHARS);
        // Runs of other conversations and unknown ids are skipped.
        assert!(reply_page(&snapshot.runs, "other", &ids).is_empty());
        let one = reply_page(&snapshot.runs, "long", &["missing".into(), "run-5".into()]);
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].id, "run-5");
    }

    #[test]
    fn reply_search_counts_occurrences_case_insensitively() {
        let snapshot = long_conversation();
        let counts = search_replies(&snapshot.runs, "long", "  NEEDLE ");
        assert_eq!(counts.len(), MESSAGES);
        assert_eq!(counts["run-0"], REPLY_CHARS / 20);
        assert_eq!(
            search_replies(&snapshot.runs, "long", "Reply 1234 ").len(),
            1
        );
        assert!(search_replies(&snapshot.runs, "long", "   ").is_empty());
        assert!(search_replies(&snapshot.runs, "other", "needle").is_empty());
    }

    #[test]
    fn fingerprints_detect_same_length_edits() {
        assert_ne!(fingerprint(&"one").unwrap(), fingerprint(&"two").unwrap());
        assert_eq!(fingerprint(&"same").unwrap(), fingerprint(&"same").unwrap());
    }
    #[test]
    fn empty_snapshot_drops_stale_revisions() {
        let result = changed_snapshot(
            SessionSnapshot {
                revisions: None,
                sessions: vec![],
                runs: vec![],
                compact_runs: vec![],
                error: None,
            },
            &BTreeMap::from([("session:removed".into(), "old".into())]),
        )
        .unwrap();
        assert!(result.revisions.unwrap().is_empty());
    }
}
