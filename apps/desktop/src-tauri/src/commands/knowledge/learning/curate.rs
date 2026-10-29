//! The curator: folds near-duplicate learned lessons of one project into the
//! most used of them. Deterministic word overlap, no model calls. Only lessons
//! Jackalope wrote and nobody edited are touched; a folded lesson is archived,
//! never deleted, and restoring it keeps it apart from later passes.

use super::*;

/// `archived_reason` of a lesson the curator folded into another.
pub const FOLDED: &str = "merged";

/// Pairs of (kept, folded) entry ids for one pass.
fn plan(
    entries: &[KnowledgeEntry],
    project_id: &str,
    path: &str,
    thresholds: &Thresholds,
) -> Vec<(String, String)> {
    let mut candidates: Vec<&KnowledgeEntry> = entries
        .iter()
        .filter(|entry| in_project(entry, project_id, path) && live(entry) && owned(entry))
        .filter(|entry| {
            entry.automatic.as_ref().map(|source| source.kind.as_str()) != Some("verification")
                && lifecycle(entry).is_some_and(|state| !state.distinct)
        })
        .collect();
    // The kept lesson is the most used, then the oldest.
    candidates.sort_by(|a, b| {
        let (sa, sb) = (lifecycle(a).unwrap(), lifecycle(b).unwrap());
        sb.deliveries
            .cmp(&sa.deliveries)
            .then_with(|| sa.born_at.cmp(&sb.born_at))
            .then_with(|| a.id.cmp(&b.id))
    });
    let mut folded = std::collections::HashSet::new();
    let mut pairs = vec![];
    for (index, keep) in candidates.iter().enumerate() {
        if folded.contains(&keep.id) {
            continue;
        }
        let statement = &lifecycle(keep).unwrap().statement;
        for other in &candidates[index + 1..] {
            if pairs.len() >= thresholds.folds_per_curation {
                return pairs;
            }
            if folded.contains(&other.id) {
                continue;
            }
            let other_statement = &lifecycle(other).unwrap().statement;
            let same_kind = keep.automatic.as_ref().map(|source| &source.kind)
                == other.automatic.as_ref().map(|source| &source.kind);
            if same_kind
                && reflect::negative(statement) == reflect::negative(other_statement)
                && reflect::similarity(statement, other_statement) >= thresholds.fold_similarity
            {
                folded.insert(other.id.clone());
                pairs.push((keep.id.clone(), other.id.clone()));
            }
        }
    }
    pairs
}

impl KnowledgeStore {
    /// One curator pass over a project. Returns one line per fold.
    pub fn curate(
        &self,
        project_id: &str,
        project_path: &str,
        thresholds: &Thresholds,
    ) -> Result<Vec<String>, String> {
        let path = canonical(project_path)?;
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let pairs = plan(&entries, project_id, &path, thresholds);
        if pairs.is_empty() {
            return Ok(vec![]);
        }
        let mut records = vec![];
        let mut applied = vec![];
        for (keep, fold) in pairs {
            let (Some(keep_index), Some(fold_index)) = (
                entries.iter().position(|entry| entry.id == keep),
                entries.iter().position(|entry| entry.id == fold),
            ) else {
                continue;
            };
            let folded = entries[fold_index].clone();
            let folded_statement = lifecycle(&folded)
                .map(|state| state.statement.clone())
                .unwrap_or_default();
            let kept = &mut entries[keep_index];
            let mut keywords = kept.keywords.clone();
            keywords.extend(folded.keywords.iter().cloned());
            keywords.sort();
            keywords.dedup();
            keywords.truncate(10);
            kept.keywords = keywords;
            for reference in folded
                .automatic
                .as_ref()
                .map(|source| source.evidence.clone())
                .unwrap_or_default()
            {
                push_reference(kept, &reference);
            }
            touch(kept);
            let kept_statement = lifecycle(kept)
                .map(|state| state.statement.clone())
                .unwrap_or_default();
            records.push(record(
                kept,
                "merged",
                format!("Folded in a near-duplicate: {folded_statement}"),
                "curator",
            ));
            archive(&mut entries[fold_index], FOLDED);
            records.push(record(
                &entries[fold_index],
                "curated",
                format!("Folded into a near-duplicate lesson: {kept_statement}"),
                "curator",
            ));
            applied.push(format!("Folded: {folded_statement}"));
        }
        self.write(&entries)?;
        self.append_ledger(&records);
        Ok(applied)
    }
}

#[cfg(test)]
mod tests;
