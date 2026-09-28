//! `@` mentions: the workspace's files, matched fuzzily as the user types.

use std::process::{Command, Stdio};

/// More files than this and the list stops growing; matching stays instant.
const MOST: usize = 50_000;

/// Files in `directory` that a mention can name, with `/` separators.
/// A Git repository uses its own ignore rules. Any other directory is walked,
/// skipping dependency and build folders.
pub fn list(directory: &str) -> Vec<String> {
    if let Some(files) = git_files(directory) {
        return files;
    }
    walk(directory)
}

/// Directories `@` completion skips. They are large, generated, or not the
/// project the user is naming.
const SKIPPED: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    ".worktrees",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    "coverage",
    ".turbo",
];

fn git_files(directory: &str) -> Option<Vec<String>> {
    let output = Command::new("git")
        .args([
            "-C",
            directory,
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    let output = output.ok().filter(|output| output.status.success())?;
    let mut files: Vec<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .take(MOST)
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .collect();
    files.sort();
    files.dedup();
    Some(files)
}

/// Files under `directory` when it is not a Git repository. Symlinks are not
/// followed, and the list stops at [`MOST`] entries or eight levels down.
fn walk(directory: &str) -> Vec<String> {
    let root = std::path::PathBuf::from(directory);
    let mut files = Vec::new();
    let mut pending = vec![root.clone()];
    while let Some(dir) = pending.pop() {
        if files.len() >= MOST {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if files.len() >= MOST {
                break;
            }
            let path = entry.path();
            if path.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if SKIPPED.contains(&name.as_ref()) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                let depth = path
                    .strip_prefix(&root)
                    .map(|relative| relative.components().count())
                    .unwrap_or(0);
                if depth < 8 {
                    pending.push(path);
                }
            } else if kind.is_file() {
                let Ok(relative) = path.strip_prefix(&root) else {
                    continue;
                };
                let text = relative.to_string_lossy().replace('\\', "/");
                if !text.is_empty() {
                    files.push(text);
                }
            }
        }
    }
    files.sort();
    files.dedup();
    files
}

/// How well `query` matches `path`, or `None` when its characters do not all
/// appear in order. Higher is better: matches in the file name, runs of
/// consecutive characters, and shorter paths rank first.
pub fn score(path: &str, query: &str) -> Option<i64> {
    if query.is_empty() {
        return Some(-(path.len() as i64));
    }
    let lower = path.to_lowercase();
    let name_start = lower.rfind('/').map_or(0, |at| at + 1);
    let mut score = 0i64;
    let mut from = 0;
    let mut previous: Option<usize> = None;
    for wanted in query.to_lowercase().chars() {
        let offset = lower[from..].find(wanted)?;
        let at = from + offset;
        score += 1;
        if previous.is_some_and(|previous| previous + 1 == at) {
            score += 5;
        }
        if at >= name_start {
            score += 3;
        }
        if at == name_start || lower[..at].ends_with(['/', '-', '_', '.']) {
            score += 4;
        }
        previous = Some(at);
        from = at + wanted.len_utf8();
    }
    if lower[name_start..].starts_with(&query.to_lowercase()) {
        score += 20;
    }
    Some(score * 100 - path.len() as i64)
}

/// The best `limit` paths for `query`, best first.
pub fn matches<'a>(files: &'a [String], query: &str, limit: usize) -> Vec<&'a str> {
    let mut scored: Vec<(i64, &str)> = files
        .iter()
        .filter_map(|path| score(path, query).map(|score| (score, path.as_str())))
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(b.1)));
    scored
        .into_iter()
        .take(limit)
        .map(|(_, path)| path)
        .collect()
}

/// The `@` mention the cursor is in, as (character index of the `@`, query).
/// A mention starts the input or follows whitespace and runs to the cursor.
pub fn mention_at(input: &str, cursor: usize) -> Option<(usize, String)> {
    let before: Vec<char> = input.chars().take(cursor).collect();
    let start = before
        .iter()
        .rposition(|character| character.is_whitespace() || *character == '@')?;
    if before[start] != '@' {
        return None;
    }
    if start > 0 && !before[start - 1].is_whitespace() {
        return None;
    }
    Some((start, before[start + 1..].iter().collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_and_runs_outrank_scattered_matches() {
        let files: Vec<String> = [
            "src/cli/ui.rs",
            "src/commands/user_interface.rs",
            "docs/UI-GUIDELINES.md",
            "apps/desktop/src/lib/utils.ts",
        ]
        .map(String::from)
        .to_vec();
        assert_eq!(matches(&files, "ui.rs", 1), ["src/cli/ui.rs"]);
        assert_eq!(matches(&files, "guide", 1), ["docs/UI-GUIDELINES.md"]);
        assert!(score("src/cli/ui.rs", "zz").is_none());
        assert_eq!(matches(&files, "", 10).len(), 4);
    }

    #[test]
    fn a_plain_folder_lists_its_files_and_skips_dependency_trees() {
        let root = std::env::temp_dir().join(format!("jackalope-mentions-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules").join("pkg")).unwrap();
        std::fs::write(root.join("src").join("main.rs"), "fn main() {}\n").unwrap();
        std::fs::write(root.join("notes.txt"), "hello").unwrap();
        std::fs::write(root.join("node_modules").join("pkg").join("index.js"), "").unwrap();
        let files = list(&root.to_string_lossy());
        assert!(files.iter().any(|path| path == "notes.txt"));
        assert!(files
            .iter()
            .any(|path| path.replace('\\', "/") == "src/main.rs"));
        assert!(files.iter().all(|path| !path.contains("node_modules")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_mention_is_the_at_word_under_the_cursor() {
        assert_eq!(mention_at("@src", 4), Some((0, "src".into())));
        assert_eq!(mention_at("look at @ui now", 11), Some((8, "ui".into())));
        assert_eq!(mention_at("look at @ui now", 15), None);
        assert_eq!(mention_at("mail me@host", 12), None);
        assert_eq!(mention_at("@", 1), Some((0, String::new())));
    }
}
