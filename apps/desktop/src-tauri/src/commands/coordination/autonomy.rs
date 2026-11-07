//! Project autonomy policy: which verified changes may merge without a person.
//!
//! The policy lives at `.jackalope/autonomy.json` and is always read from the
//! target branch commit an integration starts from, never from an agent's
//! worktree, so work cannot loosen the rules it is judged by. A change that
//! touches the policy itself, CI configuration or a protected path, or that is
//! larger than the policy allows, stays in review. A policy that cannot be read
//! holds every change for review.

use crate::commands::evidence::EvidenceLevel;
use crate::commands::git_command::{self, Policy};
use crate::commands::outcomes::{AssessmentStatus, OutcomeReceipt};
use crate::commands::previews::features::glob_matches;
use crate::commands::tasks::{TaskRun, TaskRuntime};
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutcomeAcceptance {
    /// A person accepts each required outcome.
    #[default]
    Review,
    /// An outcome the agent proved by running something counts as accepted
    /// once the saved check passed on the same files after that report.
    Evidence,
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
    #[serde(default)]
    pub accept_outcomes: OutcomeAcceptance,
    /// Deploys the branch each time it moves, when automatic merging is on.
    #[serde(default)]
    pub deploy: Option<DeployPolicy>,
    /// Limits what agents may decide for the person. Absent, the project's own
    /// Autonomy settings apply unchanged; it can only make them stricter.
    #[serde(default)]
    pub decide: Option<DecidePolicy>,
}

/// Who answers one kind of decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decider {
    Person,
    Agent,
}

/// The committed `decide` section. Each field left out keeps the project's
/// setting; `person` turns that kind of agent decision off for everyone.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecidePolicy {
    #[serde(default)]
    pub questions: Option<Decider>,
    #[serde(default)]
    pub rounds: Option<Decider>,
    #[serde(default)]
    pub deviations: Option<Decider>,
    /// Added to the categories that always reach the person.
    #[serde(default)]
    pub escalate: Vec<crate::commands::question_risk::QuestionCategory>,
    /// Lowers the project's per-plan limit on agent decisions.
    #[serde(default)]
    pub max_agent_decisions: Option<u32>,
    /// `auto` or an agent ID; replaces the project's choice when set.
    #[serde(default)]
    pub decider: Option<String>,
}

/// How a branch reaches production. Each command runs in a clean checkout of
/// the commit being deployed, with the person's own environment and tools.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeployPolicy {
    /// The only branch that deploys.
    pub branch: String,
    pub command: String,
    /// Run after a deploy; failing it counts as a failed deploy.
    #[serde(default)]
    pub check: Option<String>,
    /// Run when the check fails, to restore the previous release.
    #[serde(default)]
    pub rollback: Option<String>,
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
        if let Some(decider) = policy.decide.as_ref().and_then(|d| d.decider.as_deref()) {
            if decider.trim().is_empty()
                || decider.len() > 80
                || decider.chars().any(|c| c.is_whitespace() || c.is_control())
            {
                return Err(format!("{POLICY_PATH} needs a valid decide.decider agent."));
            }
        }
        if let Some(deploy) = &policy.deploy {
            let branch = deploy.branch.trim();
            if branch.is_empty()
                || branch.starts_with('-')
                || branch
                    .chars()
                    .any(|c| c.is_whitespace() || c.is_control() || c == ':')
            {
                return Err(format!("{POLICY_PATH} needs a valid deploy branch."));
            }
            let commands = [
                Some(&deploy.command),
                deploy.check.as_ref(),
                deploy.rollback.as_ref(),
            ];
            if commands.into_iter().flatten().any(|command| {
                command.trim().is_empty()
                    || command.chars().count() > 4000
                    || command.contains('\0')
            }) {
                return Err(format!(
                    "{POLICY_PATH} deploy commands must be 1 to 4,000 characters."
                ));
            }
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

    /// Every path glob only the person may approve changes to.
    pub fn protected_globs(&self) -> Vec<String> {
        always_protected()
            .into_iter()
            .chain(self.protected.iter().cloned())
            .collect()
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

/// The paths that need a person in every project, with or without a policy.
pub fn always_protected() -> Vec<String> {
    ALWAYS_PROTECTED
        .iter()
        .map(|glob| glob.to_string())
        .collect()
}

fn git(project: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    git_command::command(project, args, Policy::Isolated)
        .output()
        .map_err(|e| format!("Could not run Git: {e}"))
}

/// The commit a local branch points at.
pub fn branch_head(project: &Path, branch: &str) -> Result<String, String> {
    let output = git(
        project,
        &[
            "rev-parse",
            "--verify",
            &format!("refs/heads/{branch}^{{commit}}"),
        ],
    )?;
    if !output.status.success() {
        return Err(format!("The target branch {branch} could not be read."));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
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

fn reported_before(report: &str, check: &str) -> bool {
    match (
        chrono::DateTime::parse_from_rfc3339(report),
        chrono::DateTime::parse_from_rfc3339(check),
    ) {
        (Ok(report), Ok(check)) => report <= check,
        _ => false,
    }
}

/// Outcomes the policy may accept for one attempt at `tree`, as requirement
/// index and the report that proved it, or why a person must review instead.
/// Workflow checkpoints and anything a person rejected always need a person.
pub fn provable_outcomes(run: &TaskRun, tree: &str) -> Result<Vec<(usize, String)>, String> {
    let check = run
        .verification
        .as_ref()
        .filter(|check| check.result.success && check.tree.as_deref() == Some(tree))
        .ok_or("Checks have not passed on the current files. Held for review.")?;
    let mut accepted = vec![];
    for (index, requirement) in run.contract.requirements.iter().enumerate() {
        match &requirement.receipt {
            Some(receipt) if receipt.accepted && receipt.tree == tree => continue,
            Some(receipt) if !receipt.accepted => {
                return Err(format!(
                    "A person did not accept ‘{}’. Held for review.",
                    requirement.title
                ))
            }
            _ => {}
        }
        if requirement.checkpoint {
            return Err(format!(
                "Workflow step ‘{}’ needs a person. Held for review.",
                requirement.title
            ));
        }
        let proof = run.validation_steps.iter().rev().find_map(|step| {
            step.requirements
                .iter()
                .find(|a| a.requirement_id == requirement.id)
                .map(|a| (step, a))
        });
        match proof {
            Some((step, assessment))
                if matches!(assessment.status, AssessmentStatus::Met)
                    && assessment
                        .checked_level
                        .is_some_and(|level| level >= EvidenceLevel::Ran)
                    && reported_before(&step.timestamp, &check.checked_at) =>
            {
                accepted.push((index, format!("report:{}", step.id)));
            }
            _ => {
                return Err(format!(
                    "‘{}’ was not shown to be met by a command run or a reproduction before the last passing check. Held for review.",
                    requirement.title
                ))
            }
        }
    }
    Ok(accepted)
}

/// Records policy acceptance for every proven outcome of the selected
/// attempts, or returns why a person must review. Nothing is recorded unless
/// every attempt can be accepted.
pub fn accept_outcomes(
    runtime: &TaskRuntime,
    directory: &Path,
    runs: &[TaskRun],
    ids: &[String],
) -> Result<Option<String>, String> {
    let mut accepted = vec![];
    for run in runs.iter().filter(|run| ids.contains(&run.id)) {
        let tree = crate::commands::integration::workspace_tree(run, directory)?;
        if run.contract.require_accepted(&tree).is_ok() {
            continue;
        }
        match provable_outcomes(run, &tree) {
            Ok(items) => accepted.push((run.id.clone(), tree, items)),
            Err(reason) => return Ok(Some(reason)),
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    for (id, tree, items) in accepted {
        runtime.update_checked(&id, |run| {
            for (index, evidence) in items {
                run.contract.requirements[index].receipt = Some(OutcomeReceipt {
                    accepted: true,
                    evidence,
                    note: "Accepted by the project's autonomy policy.".into(),
                    tree: tree.clone(),
                    recorded_at: now.clone(),
                });
            }
        })?;
    }
    Ok(None)
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

/// Lets the policy committed at `target_head` accept the proven outcomes of
/// the attempts `ids` before their merge is prepared. Returns why a person
/// must review, or `None` when there is no policy or nothing is left to accept.
/// Acceptance is recorded per outcome; the path and size check still runs on
/// the prepared result afterwards.
pub fn accept_before_merge(
    runtime: &TaskRuntime,
    directory: &Path,
    project: &Path,
    target_head: &str,
    runs: &[TaskRun],
    ids: &[String],
) -> Option<String> {
    if let Some(reason) = super::deploy::halted(directory, project) {
        return Some(reason);
    }
    let policy = match load(project, target_head) {
        Ok(None) => return None,
        Ok(Some(policy)) => policy,
        Err(error) => return Some(format!("{error} Held for review.")),
    };
    match policy.accept_outcomes {
        OutcomeAcceptance::Review => runs
            .iter()
            .filter(|run| ids.contains(&run.id))
            .find_map(
                |run| match crate::commands::integration::workspace_tree(run, directory) {
                    Ok(tree) => run.contract.require_accepted(&tree).err(),
                    Err(error) => Some(error),
                },
            )
            .map(|reason| format!("{reason} Held for review.")),
        OutcomeAcceptance::Evidence => accept_outcomes(runtime, directory, runs, ids)
            .unwrap_or_else(|error| Some(format!("{error} Held for review."))),
    }
}

/// Why the prepared integration from `base` to `head` must wait for a person,
/// or `None` when the project has no policy or its paths and size allow it.
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

    /// An attempt with one required outcome, a check that passed on `tree`
    /// at 12:00 and a report on that outcome.
    fn proven(level: &str, status: &str, reported_at: &str) -> TaskRun {
        let mut run = TaskRun {
            id: "run".into(),
            ..Default::default()
        };
        run.contract.requirements.push(serde_json::from_value(serde_json::json!({"id":"requirement-0","title":"Saves drafts","checkpoint":false,"receipt":null})).unwrap());
        run.verification = Some(serde_json::from_value(serde_json::json!({"command":"check","checkedAt":"2026-11-02T12:00:00Z","tree":"tree","result":{"success":true,"exitCode":0,"stdout":"","stderr":"","durationMs":1,"timedOut":false,"truncated":false}})).unwrap());
        run.validation_steps.push(serde_json::from_value(serde_json::json!({"id":"step","step":"final","status":"passed","timestamp":reported_at,"requirements":[{"requirementId":"requirement-0","status":status,"summary":"Drafts save","checkedLevel":level}]})).unwrap());
        run
    }

    #[test]
    fn outcomes_need_run_or_reproduced_proof_before_a_check_on_the_same_files() {
        let early = "2026-11-02T11:59:00Z";
        assert_eq!(
            provable_outcomes(&proven("ran", "met", early), "tree").unwrap(),
            vec![(0, "report:step".to_string())]
        );
        assert!(provable_outcomes(&proven("reproduced", "met", early), "tree").is_ok());
        for (run, tree) in [
            (proven("cited", "met", early), "tree"),
            (proven("ran", "partial", early), "tree"),
            (proven("ran", "met", "2026-11-02T12:01:00Z"), "tree"),
            (proven("ran", "met", "not a time"), "tree"),
            (proven("ran", "met", early), "edited"),
        ] {
            assert!(provable_outcomes(&run, tree).is_err());
        }
        let mut step = proven("ran", "met", early);
        step.contract.requirements[0].checkpoint = true;
        assert!(provable_outcomes(&step, "tree")
            .unwrap_err()
            .contains("needs a person"));
        let receipt = |accepted: bool| OutcomeReceipt {
            accepted,
            evidence: "manual".into(),
            note: String::new(),
            tree: "tree".into(),
            recorded_at: "now".into(),
        };
        let mut rejected = proven("ran", "met", early);
        rejected.contract.requirements[0].receipt = Some(receipt(false));
        assert!(provable_outcomes(&rejected, "tree")
            .unwrap_err()
            .contains("did not accept"));
        let mut accepted = proven("stated", "met", early);
        accepted.contract.requirements[0].receipt = Some(receipt(true));
        assert!(provable_outcomes(&accepted, "tree").unwrap().is_empty());
    }

    #[test]
    fn the_decide_section_is_optional_and_strictly_typed() {
        let bare = policy(r#"{"version":1}"#);
        assert!(bare.decide.is_none());
        let decide = policy(
            r#"{"version":1,"decide":{"questions":"agent","rounds":"person","escalate":["payment"],"maxAgentDecisions":10,"decider":"claude"}}"#,
        )
        .decide
        .unwrap();
        assert_eq!(decide.questions, Some(Decider::Agent));
        assert_eq!(decide.rounds, Some(Decider::Person));
        assert_eq!(decide.deviations, None);
        assert_eq!(decide.max_agent_decisions, Some(10));
        assert_eq!(decide.decider.as_deref(), Some("claude"));
        for bad in [
            r#"{"version":1,"decide":{"questions":"bot"}}"#,
            r#"{"version":1,"decide":{"escalate":["everything"]}}"#,
            r#"{"version":1,"decide":{"answers":"agent"}}"#,
            r#"{"version":1,"decide":{"decider":"two words"}}"#,
        ] {
            assert!(AutonomyPolicy::parse(bad.as_bytes()).is_err(), "{bad}");
        }
        let globs = policy(r#"{"version":1,"protected":["migrations/**"]}"#).protected_globs();
        assert!(globs.contains(&".jackalope/**".to_string()));
        assert!(globs.contains(&"migrations/**".to_string()));
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
