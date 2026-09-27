//! `@` mentions: the workspace's files, matched fuzzily as the user types.

use std::process::{Command, Stdio};

/// More files than this and the list stops growing; matching stays instant.
const MOST: usize = 50_000;

/// Tracked and untracked files that Git does not ignore, relative to
/// `directory`, with `/` separators on every platform.
pub fn list(directory: &str) -> Vec<String> {
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
    let Some(output) = output.ok().filter(|output| output.status.success()) else {
        return Vec::new();
    };
    let mut files: Vec<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .take(MOST)
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .collect();
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
    fn a_mention_is_the_at_word_under_the_cursor() {
        assert_eq!(mention_at("@src", 4), Some((0, "src".into())));
        assert_eq!(mention_at("look at @ui now", 11), Some((8, "ui".into())));
        assert_eq!(mention_at("look at @ui now", 15), None);
        assert_eq!(mention_at("mail me@host", 12), None);
        assert_eq!(mention_at("@", 1), Some((0, String::new())));
    }
}
