//! Recent commit history with Git's branch graph, for the Changes page.

use super::git_command::{command, Policy};
use serde::Serialize;
use std::path::Path;

const SEPARATOR: char = '\u{1f}';
const MAX_COMMITS: usize = 200;

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLine {
    /// Git's graph drawing for this line (for example `* |` or `|/`).
    pub graph: String,
    /// Absent on connector-only lines.
    pub commit: Option<GraphCommit>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub when: String,
    pub refs: Vec<String>,
}

fn parse(output: &str) -> Vec<GraphLine> {
    output
        .lines()
        .map(|line| match line.split_once(SEPARATOR) {
            None => GraphLine {
                graph: line.trim_end().to_string(),
                commit: None,
            },
            Some((graph, rest)) => {
                let mut fields = rest.split(SEPARATOR);
                let mut next = || fields.next().unwrap_or_default().to_string();
                let hash = next();
                let subject = next();
                let author = next();
                let when = next();
                let refs = next()
                    .split(", ")
                    .map(|name| name.trim().trim_start_matches("HEAD -> ").to_string())
                    .filter(|name| !name.is_empty() && name != "HEAD")
                    .collect();
                GraphLine {
                    graph: graph.trim_end().to_string(),
                    commit: Some(GraphCommit {
                        hash,
                        subject,
                        author,
                        when,
                        refs,
                    }),
                }
            }
        })
        .collect()
}

fn read(project: &Path, limit: usize) -> Result<Vec<GraphLine>, String> {
    if !project.is_dir() {
        return Err("The project folder is no longer available".into());
    }
    let count = format!("-n{}", limit.clamp(1, MAX_COMMITS));
    let format =
        format!("--format={SEPARATOR}%h{SEPARATOR}%s{SEPARATOR}%an{SEPARATOR}%cr{SEPARATOR}%D");
    let output = command(
        project,
        &[
            "log",
            "--graph",
            "--date-order",
            "--branches",
            &count,
            &format,
        ],
        Policy::Inspection,
    )
    .output()
    .map_err(|e| format!("Git is unavailable: {e}"))?;
    // A repository without commits succeeds with no output; the caller shows it as empty.
    if !output.status.success() {
        return Err("History needs a Git repository".into());
    }
    Ok(parse(&String::from_utf8_lossy(&output.stdout)))
}

/// Recent commits across local branches, newest first, with graph drawing.
#[tauri::command]
pub async fn project_commit_graph(
    project_path: String,
    limit: Option<usize>,
) -> Result<Vec<GraphLine>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read(Path::new(&project_path), limit.unwrap_or(40))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_commits_refs_and_connector_lines() {
        let sep = SEPARATOR;
        let output = format!(
            "* {sep}abc123{sep}Add notes{sep}Ada{sep}2 hours ago{sep}HEAD -> main, origin/main\n|\\\n| * {sep}def456{sep}Try a branch{sep}Bo{sep}3 days ago{sep}\n"
        );
        let lines = parse(&output);
        assert_eq!(lines.len(), 3);
        let first = lines[0].commit.as_ref().unwrap();
        assert_eq!(lines[0].graph, "*");
        assert_eq!(first.hash, "abc123");
        assert_eq!(first.refs, vec!["main", "origin/main"]);
        assert_eq!(
            lines[1],
            GraphLine {
                graph: "|\\".into(),
                commit: None
            }
        );
        assert!(lines[2].commit.as_ref().unwrap().refs.is_empty());
    }

    #[test]
    fn reads_a_real_repository_and_reports_missing_ones() {
        let root = std::env::temp_dir().join(format!("jackalope-graph-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| {
            assert!(command(&root, args, Policy::Isolated)
                .output()
                .unwrap()
                .status
                .success())
        };
        run(&["init", "-q", "-b", "main"]);
        assert!(read(&root, 10).unwrap().is_empty());
        std::fs::write(root.join("a.txt"), "a").unwrap();
        run(&["add", "."]);
        run(&[
            "-c",
            "user.name=Ada",
            "-c",
            "user.email=a@a",
            "commit",
            "-qm",
            "First",
        ]);
        let lines = read(&root, 10).unwrap();
        let commit = lines[0].commit.as_ref().unwrap();
        assert_eq!(commit.subject, "First");
        assert_eq!(commit.author, "Ada");
        assert_eq!(commit.refs, vec!["main"]);
        std::fs::remove_dir_all(&root).unwrap();
        assert!(read(&root, 10).is_err());
    }
}
