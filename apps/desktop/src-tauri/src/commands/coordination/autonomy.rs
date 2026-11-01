//! Project autonomy policy: which verified changes may merge without a person.
//!
//! The policy lives at `.jackalope/autonomy.json` and is always read from the
//! target branch commit an integration starts from, never from an agent's
//! worktree, so work cannot loosen the rules it is judged by. A change that
//! touches the policy itself, CI configuration or a protected path, or that is
//! larger than the policy allows, stays in review. A policy that cannot be read
//! holds every change for review.

use crate::commands::git_command::{self, Policy};
use crate::commands::previews::features::glob_matches;
use serde::Deserialize;
use std::path::Path;

pub const POLICY_PATH: &str = ".jackalope/autonomy.json";
const MAX_POLICY_BYTES: usize = 64 * 1024;
const MAX_PATTERNS: usize = 200;
const DEFAULT_MAX_FILES: usize = 25;
const DEFAULT_MAX_CHANGED_LINES: usize = 500;
/// Always reviewed by a person, whatever the policy says.
const ALWAYS_PROTECTED: &[&str] = &[
    ".jackalope/**",
    ".github/workflows/**",
    ".gitlab-ci.yml",
    ".circleci/**",
    ".buildkite/**",
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    /// A person reviews and merges.
    #[default]
    Review,
    /// Verified work may merge into the local target branch automatically.
    Merge,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub paths: Vec<String>,
    pub level: Level,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutonomyPolicy {
    pub version: u32,
    #[serde(default)]
    pub default: Level,
    /// Later rules win, like `.gitignore`.
    #[serde(default)]
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub protected: Vec<String>,
    #[serde(default)]
    pub max_files: Option<usize>,
    #[serde(default)]
    pub max_changed_lines: Option<usize>,
}

/// One changed file with added plus removed lines; binary files count as zero lines.
pub struct ChangedFile {
    pub path: String,
    pub lines: usize,
}

impl AutonomyPolicy {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_POLICY_BYTES {
            return Err(format!("{POLICY_PATH} is larger than 64 KB."));
        }
        let policy: Self = serde_json::from_slice(bytes)
            .map_err(|e| format!("{POLICY_PATH} could not be read: {e}."))?;
        if policy.version != 1 {
            return Err(format!("{POLICY_PATH} must use version 1."));
        }
        let patterns = policy
            .rules
            .iter()
            .flat_map(|r| &r.paths)
            .chain(&policy.protected);
        let mut count = 0;
        for pattern in patterns {
            count += 1;
            if pattern.trim().is_empty() || pattern.len() > 300 || pattern.contains('\0') {
                return Err(format!(
                    "{POLICY_PATH} has an empty or over-long path pattern."
                ));
            }
        }
        if count > MAX_PATTERNS {
            return Err(format!(
                "{POLICY_PATH} has more than {MAX_PATTERNS} path patterns."
            ));
        }
        Ok(policy)
    }

    fn level(&self, path: &str) -> Level {
        if ALWAYS_PROTECTED
            .iter()
            .copied()
            .chain(self.protected.iter().map(String::as_str))
            .any(|glob| glob_matches(glob, path))
        {
            return Level::Review;
        }
        self.rules
            .iter()
            .rev()
            .find(|rule| rule.paths.iter().any(|glob| glob_matches(glob, path)))
            .map_or(self.default, |rule| rule.level)
    }

    /// Why this change must be reviewed by a person, or `None` when it may merge.
    pub fn hold_reason(&self, files: &[ChangedFile]) -> Option<String> {
        let max_files = self.max_files.unwrap_or(DEFAULT_MAX_FILES);
        if files.len() > max_files {
            return Some(format!(
                "Changes {} files; the autonomy policy merges at most {max_files}.",
                files.len()
            ));
        }
        let lines: usize = files.iter().map(|f| f.lines).sum();
        let max_lines = self.max_changed_lines.unwrap_or(DEFAULT_MAX_CHANGED_LINES);
        if lines > max_lines {
            return Some(format!(
                "Changes {lines} lines; the autonomy policy merges at most {max_lines}."
            ));
        }
        let held: Vec<&str> = files
            .iter()
            .filter(|f| self.level(&f.path) != Level::Merge)
            .map(|f| f.path.as_str())
            .collect();
        match held.as_slice() {
            [] => None,
            [one] => Some(format!("The autonomy policy keeps {one} in review.")),
            [first, rest @ ..] => Some(format!(
                "The autonomy policy keeps {first} and {} other files in review.",
                rest.len()
            )),
        }
    }
}

fn git(project: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    git_command::command(project, args, Policy::Isolated)
        .output()
        .map_err(|e| format!("Could not run Git: {e}"))
}

/// The policy committed at `commit`, or `None` when that commit has none.
pub fn load(project: &Path, commit: &str) -> Result<Option<AutonomyPolicy>, String> {
    let spec = format!("{commit}:{POLICY_PATH}");
    let exists = git(project, &["cat-file", "-e", &spec])?;
    if !exists.status.success() {
        return Ok(None);
    }
    let output = git(project, &["cat-file", "blob", &spec])?;
    if !output.status.success() {
        return Err(format!(
            "{POLICY_PATH} could not be read from the target branch."
        ));
    }
    AutonomyPolicy::parse(&output.stdout).map(Some)
}

/// Files and line counts between the target commit and the combined result.
pub fn changed_files(project: &Path, base: &str, head: &str) -> Result<Vec<ChangedFile>, String> {
    let output = git(
        project,
        &["diff", "--numstat", "-z", "--no-renames", base, head, "--"],
    )?;
    if !output.status.success() {
        return Err("Could not measure the combined change.".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let mut parts = entry.splitn(3, '\t');
            let added = parts.next()?;
            let removed = parts.next()?;
            let path = parts.next()?.to_string();
            let count = |n: &str| n.parse::<usize>().unwrap_or(0);
            Some(ChangedFile {
                path,
                lines: count(added) + count(removed),
            })
        })
        .collect())
}

/// Why the prepared integration must wait for a person, or `None` when the
/// project has no policy or the policy lets it merge.
pub fn hold_reason(project: &Path, base: &str, head: &str) -> Option<String> {
    match load(project, base) {
        Ok(None) => None,
        Ok(Some(policy)) => match changed_files(project, base, head) {
            Ok(files) => policy.hold_reason(&files),
            Err(error) => Some(error),
        },
        Err(error) => Some(format!("{error} Held for review.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, lines: usize) -> ChangedFile {
        ChangedFile {
            path: path.into(),
            lines,
        }
    }

    fn policy(json: &str) -> AutonomyPolicy {
        AutonomyPolicy::parse(json.as_bytes()).unwrap()
    }

    #[test]
    fn later_rules_win_and_unmatched_paths_use_the_default() {
        let p = policy(
            r#"{"version":1,"rules":[{"paths":["docs/**"],"level":"merge"},{"paths":["docs/legal/**"],"level":"review"}]}"#,
        );
        assert!(p.hold_reason(&[file("docs/guide.md", 4)]).is_none());
        assert!(p.hold_reason(&[file("docs/legal/terms.md", 1)]).is_some());
        assert!(p.hold_reason(&[file("src/main.rs", 1)]).is_some());
        let open = policy(r#"{"version":1,"default":"merge"}"#);
        assert!(open.hold_reason(&[file("src/main.rs", 1)]).is_none());
    }

    #[test]
    fn protected_paths_and_the_policy_itself_always_need_review() {
        let p = policy(r#"{"version":1,"default":"merge","protected":["migrations/**"]}"#);
        for path in [
            "migrations/0001_init.sql",
            ".jackalope/autonomy.json",
            ".github/workflows/ci.yml",
        ] {
            let reason = p.hold_reason(&[file(path, 1)]).unwrap();
            assert!(reason.contains(path), "{reason}");
        }
    }

    #[test]
    fn size_limits_hold_large_changes() {
        let p = policy(r#"{"version":1,"default":"merge","maxFiles":2,"maxChangedLines":10}"#);
        assert!(p.hold_reason(&[file("a", 5), file("b", 5)]).is_none());
        assert!(p
            .hold_reason(&[file("a", 1), file("b", 1), file("c", 1)])
            .unwrap()
            .contains("3 files"));
        assert!(p
            .hold_reason(&[file("a", 11)])
            .unwrap()
            .contains("11 lines"));
        let defaults = policy(r#"{"version":1,"default":"merge"}"#);
        assert!(defaults.hold_reason(&[file("a", 501)]).is_some());
    }

    #[test]
    fn malformed_or_unknown_policies_are_rejected() {
        for bad in [
            "{",
            r#"{"version":2}"#,
            r#"{"version":1,"level":"merge"}"#,
            r#"{"version":1,"default":"deploy"}"#,
            r#"{"version":1,"rules":[{"paths":[""],"level":"merge"}]}"#,
        ] {
            assert!(AutonomyPolicy::parse(bad.as_bytes()).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_policy_is_read_from_the_target_commit_not_the_worktree() {
        let dir = std::env::temp_dir().join(format!("jackalope-autonomy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let root = dir.as_path();
        let run = |args: &[&str]| {
            let out = git_command::command(root, args, Policy::Isolated)
                .output()
                .unwrap();
            assert!(out.status.success(), "{args:?}: {out:?}");
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        run(&["init", "-q"]);
        run(&["config", "user.name", "Fixture"]);
        run(&["config", "user.email", "fixture@example.invalid"]);
        std::fs::write(root.join("readme.md"), "start\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "start"]);
        let bare = run(&["rev-parse", "HEAD"]);
        assert!(load(root, &bare).unwrap().is_none());
        std::fs::create_dir(root.join(".jackalope")).unwrap();
        std::fs::write(
            root.join(POLICY_PATH),
            r#"{"version":1,"rules":[{"paths":["docs/**"],"level":"merge"}]}"#,
        )
        .unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "policy"]);
        let base = run(&["rev-parse", "HEAD"]);
        std::fs::create_dir(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/guide.md"), "one\ntwo\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "docs"]);
        let docs = run(&["rev-parse", "HEAD"]);
        assert!(hold_reason(root, &base, &docs).is_none());
        // Loosening the policy in the change itself does not apply to that change.
        std::fs::write(root.join(POLICY_PATH), r#"{"version":1,"default":"merge"}"#).unwrap();
        std::fs::write(root.join("app.rs"), "fn main() {}\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "loosen"]);
        let loosened = run(&["rev-parse", "HEAD"]);
        let reason = hold_reason(root, &base, &loosened).unwrap();
        assert!(reason.contains("in review"), "{reason}");
        std::fs::write(root.join(POLICY_PATH), "{").unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "broken"]);
        let broken = run(&["rev-parse", "HEAD"]);
        assert!(hold_reason(root, &broken, &broken)
            .unwrap()
            .contains("Held for review"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
