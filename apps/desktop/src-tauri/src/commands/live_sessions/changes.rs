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

/// Leaves the text of all but the newest `replies` finished replies in conversation `id`
/// out of the snapshot, recording each one's length instead. Active runs keep their text.
pub(super) fn window_replies(
    mut snapshot: SessionSnapshot,
    id: &str,
    replies: usize,
) -> SessionSnapshot {
    let Some(session) = snapshot.sessions.iter().find(|session| session.id == id) else {
        return snapshot;
    };
    let kept: std::collections::HashSet<String> = session
        .batches
        .iter()
        .rev()
        .take(replies)
        .map(|batch| batch.run_id.clone())
        .collect();
    for run in &mut snapshot.runs {
        if run.live_session_id.as_deref() != Some(id)
            || run.result.is_empty()
            || run.status.is_active()
            || kept.contains(&run.id)
        {
            continue;
        }
        run.result_chars = Some(run.result.chars().count());
        run.result.clear();
        run.result_omitted = true;
    }
    snapshot
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
    snapshot.sessions.retain(|session| {
        let key = format!("session:{}", session.id);
        known.get(&key) != revisions.get(&key)
    });
    snapshot.runs.retain(|run| {
        let key = format!("run:{}", run.id);
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
                let mut run = TaskRun {
                    id: format!("run-{index}"),
                    live_session_id: Some("long".into()),
                    result: format!("{:<20}", format!("Reply {index} needle"))
                        .repeat(REPLY_CHARS / 20),
                    ..Default::default()
                };
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
            error: None,
        }
    }

    fn bytes(snapshot: &SessionSnapshot) -> usize {
        serde_json::to_vec(snapshot).unwrap().len()
    }

    #[test]
    fn conversation_snapshots_stay_within_their_transfer_budget() {
        let mut without_text = long_conversation();
        for run in &mut without_text.runs {
            run.result.clear();
        }
        let structure = bytes(&changed_snapshot(without_text, &BTreeMap::new()).unwrap());
        // Opening the conversation: its records plus the newest replies, not every reply.
        let opened = changed_snapshot(
            window_replies(long_conversation(), "long", WINDOW),
            &BTreeMap::new(),
        )
        .unwrap();
        let reply_budget = WINDOW * (REPLY_CHARS + 64) + MESSAGES * 48;
        assert!(
            bytes(&opened) <= structure + reply_budget,
            "opening sent {} bytes, budget {}",
            bytes(&opened),
            structure + reply_budget
        );
        // Reply text no longer scales with the conversation; run records still do.
        let full = bytes(&changed_snapshot(long_conversation(), &BTreeMap::new()).unwrap());
        assert!(full - structure >= MESSAGES * REPLY_CHARS);
        let omitted = opened.runs.iter().filter(|run| run.result_omitted).count();
        assert_eq!(omitted, MESSAGES - WINDOW);
        assert!(opened
            .runs
            .iter()
            .filter(|run| run.result_omitted)
            .all(|run| run.result.is_empty() && run.result_chars == Some(REPLY_CHARS)));

        // A refresh with nothing changed sends only the revision inventory.
        let known = opened.revisions.clone().unwrap();
        let idle =
            changed_snapshot(window_replies(long_conversation(), "long", WINDOW), &known).unwrap();
        assert!(idle.sessions.is_empty() && idle.runs.is_empty());
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
        let update = changed_snapshot(window_replies(streamed, "long", WINDOW), &known).unwrap();
        assert_eq!(update.runs.len(), 1);
        assert!(update.sessions.is_empty());
        assert!(bytes(&update) <= known.len() * per_record + REPLY_CHARS + 4096);
    }

    #[test]
    fn windowing_keeps_active_and_newest_replies_and_other_conversations() {
        let mut snapshot = long_conversation();
        snapshot.runs.push(TaskRun {
            id: "elsewhere".into(),
            live_session_id: Some("other".into()),
            result: "kept".into(),
            ..Default::default()
        });
        let windowed = window_replies(snapshot, "long", 2);
        let result = |id: &str| windowed.runs.iter().find(|run| run.id == id).unwrap();
        assert!(!result("run-1999").result.is_empty());
        assert!(!result("run-1998").result.is_empty());
        assert!(result("run-1997").result_omitted);
        assert_eq!(result("elsewhere").result, "kept");
        // Unknown conversations are left whole, as are callers that do not window.
        let whole = window_replies(long_conversation(), "missing", 2);
        assert!(whole.runs.iter().all(|run| !run.result_omitted));
        // Older readers see the fields only when something was left out.
        let json = serde_json::to_value(&result("run-1999")).unwrap();
        assert!(json.get("resultOmitted").is_none() && json.get("resultChars").is_none());
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
                error: None,
            },
            &BTreeMap::from([("session:removed".into(), "old".into())]),
        )
        .unwrap();
        assert!(result.revisions.unwrap().is_empty());
    }
}
