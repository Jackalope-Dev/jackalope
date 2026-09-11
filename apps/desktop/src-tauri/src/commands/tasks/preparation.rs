use super::*;
use crate::commands::process_control::CommandResult;

/// Dependency manifests worth fingerprinting. A workspace whose manifests are byte-identical
/// to the ones a successful setup command already saw does not need that command run again,
/// which is what makes a retry (or a resumed worktree) start in seconds instead of minutes.
const MANIFESTS: [&str; 10] = [
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "npm-shrinkwrap.json",
    "Cargo.lock",
    "poetry.lock",
    "uv.lock",
    "requirements.txt",
    "go.sum",
];

const MARKER: &str = ".jackalope/prepared.json";

/// The step a run is on right now, shown while it is happening rather than only in hindsight.
/// Summaries keep this, so the task list can report live progress without the full activity log.
#[derive(Clone, Debug, Default, Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepProgress {
    /// Stable key for styling and tests: `workspace`, `dependencies`, `routing`, `agent`.
    pub step: String,
    /// Operator-facing name of the step, for example "Installing dependencies".
    pub label: String,
    /// The newest concrete signal from the step, usually the command's latest output line.
    pub detail: String,
    pub started_at: String,
    /// 1 for the first try; higher while an automatic retry is running.
    pub attempt: u32,
}

impl StepProgress {
    pub fn new(step: &str, label: &str, attempt: u32) -> Self {
        Self {
            step: step.into(),
            label: label.into(),
            detail: String::new(),
            started_at: Utc::now().to_rfc3339(),
            attempt,
        }
    }
}

/// What the setup command actually did, kept so a failure can say why instead of only that it failed.
#[derive(Clone, Debug, Default, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationRecord {
    pub command: String,
    /// True when the manifests already matched a completed run and the command was not needed.
    pub skipped: bool,
    /// Why it was skipped, or the interruption that ended the last attempt.
    pub reason: Option<String>,
    pub attempts: u32,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub success: bool,
    /// Last few KiB of combined output, enough to diagnose without carrying the whole log.
    pub output_tail: String,
    pub finished_at: String,
}

impl PreparationRecord {
    pub fn skipped(command: &str, reason: String) -> Self {
        Self {
            command: command.into(),
            skipped: true,
            reason: Some(reason),
            attempts: 0,
            success: true,
            finished_at: Utc::now().to_rfc3339(),
            ..Default::default()
        }
    }

    pub fn from_result(command: &str, attempts: u32, result: &CommandResult) -> Self {
        Self {
            command: command.into(),
            skipped: false,
            reason: result.interruption(),
            attempts,
            duration_ms: result.duration_ms,
            exit_code: result.exit_code,
            success: result.success,
            output_tail: tail(&format!("{}\n{}", result.stdout, result.stderr), 4000),
            finished_at: Utc::now().to_rfc3339(),
        }
    }
}

/// Keep the end of a long log; the tail holds the error, the head holds boilerplate.
pub fn tail(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    let count = trimmed.chars().count();
    if count <= limit {
        return trimmed.to_owned();
    }
    trimmed.chars().skip(count - limit).collect()
}

/// A stable digest of the workspace's dependency manifests plus the command that consumes them.
/// Missing manifests are recorded as absent so adding one later changes the fingerprint.
pub fn fingerprint(workspace: &Path, command: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    command.hash(&mut hasher);
    for name in MANIFESTS {
        name.hash(&mut hasher);
        match std::fs::read(workspace.join(name)) {
            Ok(bytes) => bytes.hash(&mut hasher),
            Err(_) => b"absent".hash(&mut hasher),
        }
    }
    // Workspace package manifests matter too: a new package changes what a workspace install links.
    if let Ok(text) = std::fs::read_to_string(workspace.join("pnpm-workspace.yaml")) {
        text.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

/// Read the marker a previous successful run left, if it still matches this fingerprint.
pub fn already_prepared(workspace: &Path, fingerprint: &str) -> Option<String> {
    let text = std::fs::read_to_string(workspace.join(MARKER)).ok()?;
    let saved: Value = serde_json::from_str(&text).ok()?;
    (saved["fingerprint"].as_str()? == fingerprint).then(|| {
        saved["completedAt"]
            .as_str()
            .unwrap_or("an earlier attempt")
            .to_owned()
    })
}

/// Record that this workspace is prepared for these manifests. A failure to write is not fatal:
/// the only cost is that the next attempt repeats work it could have skipped.
pub fn record_prepared(workspace: &Path, fingerprint: &str, command: &str) {
    let path = workspace.join(MARKER);
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let _ = std::fs::write(
        path,
        serde_json::json!({
            "fingerprint": fingerprint,
            "command": command,
            "completedAt": Utc::now().to_rfc3339(),
        })
        .to_string(),
    );
}

/// A setup command that was cut off, rather than one that ran and reported a real problem,
/// is worth one more try: the usual causes (a busy disk, a contended lock) pass on their own.
pub fn worth_retrying(result: &CommandResult) -> bool {
    result.timed_out || result.stalled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!("jackalope-prepare-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn the_fingerprint_tracks_manifests_and_the_command_that_consumes_them() {
        let workspace = scratch();
        let empty = fingerprint(&workspace, "pnpm install");
        std::fs::write(workspace.join("pnpm-lock.yaml"), "packages: {}").unwrap();
        let locked = fingerprint(&workspace, "pnpm install");
        assert_ne!(empty, locked, "adding a lockfile must change the digest");
        assert_eq!(locked, fingerprint(&workspace, "pnpm install"));
        assert_ne!(
            locked,
            fingerprint(&workspace, "pnpm install --frozen-lockfile"),
            "a different setup command must not reuse another command's marker"
        );
        std::fs::write(workspace.join("pnpm-lock.yaml"), "packages: {a: 1}").unwrap();
        assert_ne!(
            locked,
            fingerprint(&workspace, "pnpm install"),
            "editing a lockfile must change the digest"
        );
        std::fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn a_marker_is_reused_only_while_the_manifests_still_match() {
        let workspace = scratch();
        std::fs::write(workspace.join("pnpm-lock.yaml"), "packages: {}").unwrap();
        let command = "pnpm install --frozen-lockfile";
        let digest = fingerprint(&workspace, command);
        assert!(already_prepared(&workspace, &digest).is_none());
        record_prepared(&workspace, &digest, command);
        assert!(already_prepared(&workspace, &digest).is_some());
        std::fs::write(workspace.join("pnpm-lock.yaml"), "packages: {b: 2}").unwrap();
        let changed = fingerprint(&workspace, command);
        assert!(
            already_prepared(&workspace, &changed).is_none(),
            "a changed lockfile must force the setup command to run again"
        );
        std::fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn only_interrupted_setup_commands_are_retried_and_the_tail_is_kept() {
        let failed = CommandResult {
            exit_code: Some(1),
            success: false,
            timed_out: false,
            stalled: false,
            stdout: String::new(),
            stderr: "ERR_PNPM_OUTDATED_LOCKFILE".into(),
            truncated: false,
            duration_ms: 400,
        };
        assert!(
            !worth_retrying(&failed),
            "a command that reported a real problem must not be repeated"
        );
        let stalled = CommandResult {
            stalled: true,
            ..failed.clone()
        };
        assert!(worth_retrying(&stalled));
        assert!(worth_retrying(&CommandResult {
            timed_out: true,
            ..failed.clone()
        }));

        let record = PreparationRecord::from_result("pnpm install", 2, &stalled);
        assert_eq!(record.attempts, 2);
        assert!(!record.success);
        assert!(record.reason.unwrap().contains("no output"));
        assert!(record.output_tail.contains("ERR_PNPM_OUTDATED_LOCKFILE"));
        assert_eq!(tail("abcdef", 3), "def");
        assert_eq!(tail("  abc  ", 99), "abc");
    }
}
