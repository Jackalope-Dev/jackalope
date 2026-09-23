use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn fingerprint(value: &impl Serialize) -> Result<String, String> {
    Ok(
        Sha256::digest(serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
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
        println!("Unchanged 500-attempt snapshot: {bytes_before} bytes full, {bytes_after} bytes incremental");
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
