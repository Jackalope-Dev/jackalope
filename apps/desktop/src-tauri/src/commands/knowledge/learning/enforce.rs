//! Lesson enforcement: "Make it a check" drafts a task that turns a lesson
//! into something the repository enforces. When that task is accepted the
//! lesson records the reported command or file, and a lesson Jackalope wrote
//! and nobody edited is retired. A later pass watches that the enforcing file
//! or script still exists.

use super::*;
use crate::commands::tasks::TaskRun;
use std::path::Path;

/// The check that enforces a lesson, as the accepted task reported it.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Enforcement {
    /// The command or file the task named in its `Enforced by:` line.
    pub by: String,
    /// The accepted attempt and its task.
    pub run_id: String,
    #[serde(default)]
    pub task_id: String,
    pub at: String,
    /// Something `by` names that the project no longer has. Set only on
    /// lessons Jackalope does not change; theirs are unmarked instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing: Option<String>,
}

const MARKER: &str = "enforced by:";
const BY_CHARS: usize = 200;

/// The command or file a result names on its last `Enforced by:` line.
pub fn reported_enforcer(result: &str) -> Option<String> {
    result.lines().rev().find_map(|line| {
        let line = line
            .trim()
            .trim_start_matches(['-', '*', '>', ' ', '•'])
            .trim_start_matches(['*', '_'])
            .trim();
        let rest = line.get(..MARKER.len())?;
        if !rest.eq_ignore_ascii_case(MARKER) {
            return None;
        }
        let value = line[MARKER.len()..]
            .trim()
            .trim_start_matches(['*', '_'])
            .trim()
            .trim_matches(|c: char| "`'\"".contains(c))
            .trim()
            .trim_end_matches(['*', '_', '.'])
            .trim_matches('`')
            .trim();
        let value: String = redact(value).chars().take(BY_CHARS).collect();
        (!value.is_empty() && !value.starts_with('<')).then_some(value)
    })
}

/// Keeps quoted text inside its fence.
fn quoted(text: &str) -> String {
    text.replace("```", "'''")
}

/// Redacted instances of the mistake from the lesson's history: restatements
/// after it was supplied first, then where it was learned, newest first.
fn instances(entry: &KnowledgeEntry, history: &[LedgerRecord], limit: usize) -> Vec<String> {
    let mut found: Vec<String> = vec![];
    for actions in [&["missed"][..], &["born", "merged", "patched"][..]] {
        for record in history
            .iter()
            .rev()
            .filter(|record| actions.contains(&record.action.as_str()))
        {
            for line in &record.evidence {
                if found.len() < limit && !found.contains(line) {
                    found.push(line.clone());
                }
            }
        }
    }
    if found.is_empty() {
        let references = entry
            .automatic
            .as_ref()
            .map(|source| source.evidence.clone())
            .unwrap_or_default();
        for reference in references.into_iter().rev() {
            let line = redact(&reference);
            if found.len() < limit && !line.is_empty() && !found.contains(&line) {
                found.push(line);
            }
        }
    }
    if let Some(run) = entry.source_run_id.as_ref() {
        let line = format!("Task {run}: where this lesson was saved");
        if found.len() < limit && !found.iter().any(|item| item.contains(run.as_str())) {
            found.push(line);
        }
    }
    found
}

/// The editable task text for "Make it a check". Lines outside fences avoid
/// the words reflection treats as preferences, so the draft is never learned
/// back as a new lesson.
pub(super) fn check_draft(
    entry: &KnowledgeEntry,
    history: &[LedgerRecord],
    thresholds: &Thresholds,
) -> String {
    let instances = instances(entry, history, thresholds.check_draft_instances);
    let mut text = format!(
        "Turn this project lesson into something the repository enforces, so the mistake fails a check rather than depending on someone remembering it.\n\nThe lesson:\n```text\n{}\n{}\n```\n",
        quoted(&entry.title.replace(['\n', '\r'], " ")),
        quoted(&entry.content),
    );
    if instances.is_empty() {
        text.push_str("\nNo past instance of the mistake is recorded. Find one in Git history, or reproduce it in a scratch change and revert that change afterwards.\n");
    } else {
        text.push_str("\nRecorded instances of the mistake, redacted as stored:\n```text\n");
        for line in &instances {
            text.push_str(&quoted(line));
            text.push('\n');
        }
        text.push_str("```\n");
    }
    text.push_str(
        "\nPick the highest level that works, in this order:\n\
1. Architecture: one owner and one supported path for this behavior. Delete the old way so it cannot be copied.\n\
2. Types: the wrong state fails to compile or cannot be represented.\n\
3. A lint rule or CI check whose error message names the fix.\n\
4. A test that fails on the mistake.\n\
Written guidance comes last, and only for the parts that need judgment.\n\
\nBefore finishing:\n\
- Show the new check failing on a real past instance of the mistake, using the instances above or one from Git history. Revert anything changed only to show the failure.\n\
- Show it passing on the current tree.\n\
- Keep the change focused on this lesson.\n\
\nEnd the result with one line naming the command or file that now enforces the lesson, in exactly this form:\n\
Enforced by: <command or file path>\n",
    );
    text
}

/// Paths, scripts and make targets an enforcer names. The whole value is a
/// command, and a single word with a source extension is a root-level file.
fn enforcer_references(root: &Path, by: &str, limit: usize) -> Vec<stale::Reference> {
    let words: Vec<&str> = by.split_whitespace().collect();
    let mut found = vec![];
    for word in &words {
        let word = stale::clean(word);
        if let Some(path) = stale::path_reference(root, word) {
            found.push(stale::Reference::Path(path));
        } else if words.len() == 1
            && !word.contains(['/', '\\'])
            && word.rsplit_once('.').is_some_and(|(name, extension)| {
                !name.is_empty() && stale::EXTENSIONS.contains(&extension.to_lowercase().as_str())
            })
        {
            found.push(stale::Reference::Path(word.to_string()));
        }
    }
    stale::commands(&words, true, &mut found);
    let mut unique = vec![];
    for reference in found {
        if !unique.contains(&reference) {
            unique.push(reference);
        }
    }
    unique.truncate(limit);
    unique
}

impl KnowledgeStore {
    /// The "Make it a check" task text for one lesson in the project.
    pub fn check_draft(
        &self,
        project_id: &str,
        project_path: &str,
        entry_id: &str,
    ) -> Result<String, String> {
        let entry = self
            .list(project_id, project_path)?
            .into_iter()
            .find(|entry| entry.id == entry_id && entry.kind == KnowledgeKind::Memory)
            .ok_or("This lesson no longer exists.")?;
        let history = self.history(project_id, entry_id, 50);
        Ok(check_draft(&entry, &history, &THRESHOLDS))
    }

    /// Records that an accepted task made the lesson a check. A lesson
    /// Jackalope wrote and nobody edited is then retired; any other lesson
    /// stays as it is until a person retires it. Returns one line per change.
    pub fn mark_enforced(
        &self,
        project_id: &str,
        project_path: &str,
        entry_id: &str,
        by: &str,
        run: &TaskRun,
    ) -> Result<Vec<String>, String> {
        let path = canonical(project_path)?;
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let entry = entries
            .iter_mut()
            .find(|entry| {
                entry.id == entry_id
                    && in_project(entry, project_id, &path)
                    && !entry.dismissed
                    && entry.kind == KnowledgeKind::Memory
            })
            .ok_or("The lesson this task enforces no longer exists.")?;
        if entry
            .enforced
            .as_ref()
            .is_some_and(|e| e.run_id == run.id && e.by == by && e.missing.is_none())
        {
            return Ok(vec![]);
        }
        entry.enforced = Some(Enforcement {
            by: by.into(),
            run_id: run.id.clone(),
            task_id: run.task_id.clone(),
            at: Utc::now().to_rfc3339(),
            missing: None,
        });
        let mut records = vec![with_evidence(
            record(
                entry,
                "enforced",
                format!("An accepted task made it a check: {by}."),
                "user",
            ),
            &format!("Task {}", run.id),
            "",
        )];
        let mut applied = vec![format!("Enforced: {}", entry.title)];
        if owned(entry) && live(entry) {
            archive(entry, ENFORCED);
            records.push(record(
                entry,
                "retired",
                format!("The repository now enforces it with {by}, so it is no longer supplied to tasks."),
                "lifecycle",
            ));
            applied.push(format!("Retired: {}", entry.title));
        }
        self.write(&entries)?;
        self.append_ledger(&records);
        Ok(applied)
    }

    /// Retires an enforced lesson for a person: learned lessons are archived,
    /// any other lesson is paused. Text and history are kept.
    pub fn retire_enforced(&self, id: &str, revision: u64) -> Result<KnowledgeEntry, String> {
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let entry = entries
            .iter_mut()
            .find(|entry| entry.id == id && !entry.dismissed)
            .ok_or("This lesson no longer exists.")?;
        if entry.revision != revision {
            return Err("This lesson changed. Reload it first.".into());
        }
        let by = entry
            .enforced
            .as_ref()
            .filter(|e| e.missing.is_none())
            .map(|e| e.by.clone())
            .ok_or("Only a lesson a repository check enforces can be retired here.")?;
        if !entry.enabled {
            return Ok(entry.clone());
        }
        if lifecycle(entry).is_some() {
            archive(entry, ENFORCED);
        } else {
            entry.enabled = false;
            touch(entry);
        }
        let record = record(
            entry,
            "retired",
            format!("Retired by you: the repository now enforces it with {by}."),
            "user",
        );
        let saved = entry.clone();
        self.write(&entries)?;
        self.append_ledger(&[record]);
        Ok(saved)
    }

    /// Checks that each enforced lesson's command or file still exists, with
    /// the stale-lesson check's rules. A lesson Jackalope wrote loses the mark
    /// and, if it was retired for it, is supplied again; any other lesson is
    /// only flagged. Returns one line per lesson changed.
    pub fn check_enforcers(
        &self,
        project_id: &str,
        project_path: &str,
        thresholds: &Thresholds,
    ) -> Result<Vec<String>, String> {
        let mut candidates: Vec<KnowledgeEntry> = self
            .list(project_id, project_path)?
            .into_iter()
            .filter(|entry| entry.enforced.is_some())
            .collect();
        if candidates.is_empty() {
            return Ok(vec![]);
        }
        candidates.sort_by(|a, b| a.id.cmp(&b.id));
        candidates.truncate(thresholds.stale_lessons_per_check);
        let root = PathBuf::from(canonical(project_path)?);
        let project = stale::Project::read(&root);
        let findings: Vec<(String, String, Option<String>)> = candidates
            .iter()
            .filter_map(|entry| {
                let enforcement = entry.enforced.as_ref()?;
                let missing = enforcer_references(
                    &root,
                    &enforcement.by,
                    thresholds.stale_references_per_lesson,
                )
                .into_iter()
                .find(|reference| project.missing(reference))
                .map(|reference| reference.describe());
                (missing != enforcement.missing)
                    .then(|| (entry.id.clone(), enforcement.by.clone(), missing))
            })
            .collect();
        if findings.is_empty() {
            return Ok(vec![]);
        }
        let path = canonical(project_path)?;
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let mut records = vec![];
        let mut applied = vec![];
        for (id, by, missing) in findings {
            // An enforcement recorded again since the check waits for the next pass.
            let Some(entry) = entries.iter_mut().find(|entry| {
                entry.id == id
                    && in_project(entry, project_id, &path)
                    && !entry.dismissed
                    && entry.enforced.as_ref().is_some_and(|e| e.by == by)
            }) else {
                continue;
            };
            let Some(thing) = missing else {
                if let Some(enforcement) = entry.enforced.as_mut() {
                    enforcement.missing = None;
                }
                continue;
            };
            if owned(entry) {
                entry.enforced = None;
                let retired = lifecycle(entry).is_some_and(|state| {
                    state.archived() && state.archived_reason.as_deref() == Some(ENFORCED)
                });
                if retired {
                    restore(entry);
                }
                records.push(record(
                    entry,
                    "unenforced",
                    if retired {
                        format!("The check that enforced it names {thing}, which no longer exists, so it is supplied to tasks again.")
                    } else {
                        format!("The check that enforced it names {thing}, which no longer exists.")
                    },
                    "lifecycle",
                ));
                applied.push(format!("No longer enforced: {}", entry.title));
            } else {
                if let Some(enforcement) = entry.enforced.as_mut() {
                    enforcement.missing = Some(thing.clone());
                }
                records.push(record(
                    entry,
                    "unenforced",
                    format!("The check that enforced it names {thing}, which no longer exists. Flagged only; Jackalope does not change this lesson."),
                    "lifecycle",
                ));
                applied.push(format!("Flagged: {}", entry.title));
            }
        }
        self.write(&entries)?;
        self.append_ledger(&records);
        Ok(applied)
    }
}

/// After a person accepts a task, records the lesson it made a check, if
/// any. The `Enforced by:` line is read from the newest attempt that has one.
/// The review itself is already saved, so problems are recorded, never
/// returned.
pub fn accept(runtime: &TaskRuntime, run: &TaskRun, attempts: &[TaskRun]) {
    let Some(lesson) = run.context_receipt.enforces_lesson_id.as_deref() else {
        return;
    };
    let mut attempts: Vec<&TaskRun> = attempts
        .iter()
        .filter(|other| other.task_id == run.task_id && other.id != run.id)
        .collect();
    attempts.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    let by = std::iter::once(run)
        .chain(attempts)
        .find_map(|attempt| reported_enforcer(&attempt.result));
    let result = match by {
        Some(by) => runtime
            .knowledge
            .mark_enforced(&run.project_id, &run.project_path, lesson, &by, run)
            .map(|_| ()),
        None => runtime
            .knowledge
            .note_unreported(&run.project_id, &run.project_path, lesson, run),
    };
    if let Err(error) = result {
        eprintln!("The lesson an accepted task enforces was not updated: {error}");
    }
}

impl KnowledgeStore {
    /// Records that an accepted task did not name what enforces the lesson,
    /// which is left unmarked.
    pub fn note_unreported(
        &self,
        project_id: &str,
        project_path: &str,
        entry_id: &str,
        run: &TaskRun,
    ) -> Result<(), String> {
        let path = canonical(project_path)?;
        let entry = self
            .list(project_id, &path)?
            .into_iter()
            .find(|entry| entry.id == entry_id)
            .ok_or("The lesson this task enforces no longer exists.")?;
        self.append_ledger(&[with_evidence(
            record(
                &entry,
                "unreported",
                "An accepted task did not end with an \"Enforced by:\" line, so the lesson is not marked enforced.".into(),
                "user",
            ),
            &format!("Task {}", run.id),
            "",
        )]);
        Ok(())
    }
}

#[tauri::command]
pub fn knowledge_check_draft(
    project_id: String,
    project_path: String,
    entry_id: String,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    state
        .knowledge
        .check_draft(&project_id, &project_path, &entry_id)
}

#[tauri::command]
pub fn knowledge_retire_enforced(
    id: String,
    revision: u64,
    state: State<'_, TaskRuntime>,
) -> Result<KnowledgeEntry, String> {
    state.knowledge.retire_enforced(&id, revision)
}

#[cfg(test)]
mod tests;
