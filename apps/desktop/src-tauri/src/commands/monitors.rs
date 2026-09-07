use super::{git_command, process_control};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MonitorAction {
    Notify,
    Run,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeMonitor {
    pub path: String,
    pub action: MonitorAction,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorChange {
    #[serde(default)]
    pub project_path: String,
    pub before: String,
    pub after: String,
    pub path: String,
    pub branch: String,
}

impl ChangeMonitor {
    pub fn validate(&self) -> Result<(), String> {
        if self.path.len() > 500
            || self.path.contains(['\\', ':', '\0', '\n', '\r'])
            || self.path.starts_with('/')
            || self.path.split('/').any(|p| p == ".." || p == ".")
        {
            return Err(
                "Choose a tracked path relative to the project, using forward slashes.".into(),
            );
        }
        Ok(())
    }

    pub fn observe(&self, project: &str, branch: &str) -> Result<String, String> {
        self.validate()?;
        let root = Path::new(project);
        let reference = format!("refs/heads/{branch}");
        let valid = process_control::run(
            git_command::command(
                root,
                &["check-ref-format", &reference],
                git_command::Policy::Inspection,
            ),
            Duration::from_secs(5),
        )?;
        if !valid.success {
            return Err("The monitor's target branch is invalid.".into());
        }
        let target = format!("{reference}^{{tree}}");
        let result = process_control::run(
            git_command::command(
                root,
                &["rev-parse", "--verify", &target],
                git_command::Policy::Inspection,
            ),
            Duration::from_secs(5),
        )?;
        let hash = result.stdout.trim();
        if !result.success
            || result.truncated
            || !(hash.len() == 40 || hash.len() == 64)
            || !hash.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Cannot read the monitored path on the saved local branch. Check that the branch and tracked path still exist.".into());
        }
        if self.path.is_empty() {
            return Ok(hash.into());
        }
        let target = format!("{hash}:{}", self.path);
        let result = process_control::run(
            git_command::command(
                root,
                &["rev-parse", "--verify", &target],
                git_command::Policy::Inspection,
            ),
            Duration::from_secs(5),
        )?;
        if result.timed_out || result.truncated {
            return Err("The monitored path could not be read within the check limits.".into());
        }
        if !result.success {
            return Ok("absent".into());
        }
        let hash = result.stdout.trim();
        if !(hash.len() == 40 || hash.len() == 64) || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Git returned an invalid content revision.".into());
        }
        Ok(hash.into())
    }
}

pub fn inspect(project: &str, change: &MonitorChange) -> Result<String, String> {
    let valid =
        |s: &str| (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit());
    if change.before == "absent" || change.after == "absent" {
        return Ok(format!(
            "{} was {} on {}. Inspect the tracked path in your repository.",
            change.path,
            if change.after == "absent" {
                "removed"
            } else {
                "added"
            },
            change.branch
        ));
    }
    if !valid(&change.before) || !valid(&change.after) {
        return Err("Invalid saved monitor revisions".into());
    }
    let result = process_control::run(
        git_command::command(
            Path::new(project),
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                &change.before,
                &change.after,
            ],
            git_command::Policy::Inspection,
        ),
        Duration::from_secs(5),
    )?;
    if !result.success {
        return Err("The saved revisions are no longer available locally.".into());
    }
    Ok(format!(
        "{}{}",
        result.stdout,
        if result.truncated {
            "\n[Preview truncated]"
        } else {
            ""
        }
    ))
}
