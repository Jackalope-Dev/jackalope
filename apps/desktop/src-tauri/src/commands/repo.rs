//! Git plumbing shared by the app and the `jackalope` command: running Git under
//! one of `git_command`'s environment policies, private index files, synthetic
//! commits and the parsers for Git's `-z` machine formats.
//!
//! The CLI compiles this file directly (it does not link `jackalope_lib`), so it
//! stays on `std`.

pub(super) use super::git_command::{command, Policy};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

/// Runs Git and returns its output whatever the exit status.
pub(super) fn output(path: &Path, args: &[&str], policy: Policy) -> Result<Output, String> {
    spawn(command(path, args, policy))
}

/// Git's standard output with trailing whitespace removed, or its trimmed
/// standard error when it fails. Leading whitespace is kept because porcelain
/// formats start lines with a blank status column.
pub(super) fn git(path: &Path, args: &[&str], policy: Policy) -> Result<String, String> {
    checked(output(path, args, policy)?).map(|text| text.trim_end().to_string())
}

/// Like [`git`], with standard output exactly as Git wrote it.
pub(super) fn git_exact(path: &Path, args: &[&str], policy: Policy) -> Result<String, String> {
    checked(output(path, args, policy)?)
}

/// Runs a prepared Git command, with [`git`]'s output and errors.
pub(super) fn run(command: Command) -> Result<String, String> {
    checked(spawn(command)?).map(|text| text.trim_end().to_string())
}

/// Whether Git exits successfully. A failure to start Git counts as `false`.
pub(super) fn succeeds(path: &Path, args: &[&str], policy: Policy) -> bool {
    output(path, args, policy).is_ok_and(|output| output.status.success())
}

fn spawn(mut command: Command) -> Result<Output, String> {
    command
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))
}

fn checked(output: Output) -> Result<String, String> {
    checked_bytes(output).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn checked_bytes(output: Output) -> Result<Vec<u8>, String> {
    if output.status.success() {
        return Ok(output.stdout);
    }
    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if error.is_empty() {
        format!("Git exited with {}", output.status)
    } else {
        error
    })
}

/// Which untracked files make a checkout count as changed.
#[derive(Clone, Copy)]
pub(super) enum Untracked {
    /// Tracked changes only.
    No,
    /// New files and, for a new folder, the folder itself.
    Normal,
    /// Every new file, including those inside new folders.
    All,
}

impl Untracked {
    fn flag(self) -> &'static str {
        match self {
            Self::No => "--untracked-files=no",
            Self::Normal => "--untracked-files=normal",
            Self::All => "--untracked-files=all",
        }
    }
}

/// Whether the checkout has uncommitted changes, counting untracked files as
/// `untracked` says. Ignored files never count.
pub(super) fn is_dirty(path: &Path, untracked: Untracked, policy: Policy) -> Result<bool, String> {
    Ok(!git(path, &["status", "--porcelain", untracked.flag()], policy)?.is_empty())
}

/// What a private index starts from.
#[derive(Clone, Copy)]
pub(super) enum Seed {
    /// No file: start it with `read-tree`.
    Empty,
    /// A copy of the checkout's own index, staged entries included.
    CurrentIndex,
}

/// A private index file that Git commands read and write instead of the
/// checkout's own. Removed, with any lock Git left beside it, when dropped.
pub(super) struct Index<'a> {
    repo: &'a Path,
    file: PathBuf,
    policy: Policy,
}

impl Index<'_> {
    pub(super) fn command(&self, args: &[&str]) -> Command {
        let mut command = command(self.repo, args, self.policy);
        command.env("GIT_INDEX_FILE", &self.file);
        command
    }

    /// [`git`] against this index.
    pub(super) fn git(&self, args: &[&str]) -> Result<String, String> {
        run(self.command(args))
    }

    pub(super) fn file(&self) -> &Path {
        &self.file
    }
}

impl Drop for Index<'_> {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.file);
        let mut lock = self.file.clone().into_os_string();
        lock.push(".lock");
        let _ = std::fs::remove_file(lock);
    }
}

static NEXT_INDEX: AtomicU64 = AtomicU64::new(0);

/// Runs `work` with a private index for `repo` kept in `directory`, which is
/// created when missing. The index is removed however `work` ends.
pub(super) fn with_temp_index<T>(
    repo: &Path,
    directory: &Path,
    seed: Seed,
    policy: Policy,
    work: impl FnOnce(&Index) -> Result<T, String>,
) -> Result<T, String> {
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Cannot prepare a private Git index: {error}"))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let index = Index {
        repo,
        file: directory.join(format!(
            "jackalope-{}-{nanos}-{}.index",
            std::process::id(),
            NEXT_INDEX.fetch_add(1, Ordering::Relaxed)
        )),
        policy,
    };
    if matches!(seed, Seed::CurrentIndex) {
        let source = git(
            repo,
            &["rev-parse", "--path-format=absolute", "--git-path", "index"],
            policy,
        )?;
        std::fs::copy(&source, &index.file)
            .map_err(|error| format!("Cannot snapshot the Git index: {error}"))?;
    }
    work(&index)
}

/// The author and committer of a commit nobody made by hand.
#[derive(Clone, Copy)]
pub(super) struct Identity {
    pub name: &'static str,
    pub email: &'static str,
}

/// Writes a commit of `tree` with a fixed identity and date, so the same tree
/// and parents always produce the same commit and repeated checks reuse it.
pub(super) fn synthetic_commit(
    repo: &Path,
    tree: &str,
    parents: &[&str],
    message: &str,
    identity: Identity,
    policy: Policy,
) -> Result<String, String> {
    let mut command = command(repo, &["commit-tree", tree], policy);
    for parent in parents {
        command.args(["-p", parent]);
    }
    command
        .args(["-m", message])
        .env("GIT_AUTHOR_DATE", "2000-01-01T00:00:00Z")
        .env("GIT_COMMITTER_DATE", "2000-01-01T00:00:00Z")
        .env("GIT_AUTHOR_NAME", identity.name)
        .env("GIT_COMMITTER_NAME", identity.name)
        .env("GIT_AUTHOR_EMAIL", identity.email)
        .env("GIT_COMMITTER_EMAIL", identity.email);
    run(command)
}

/// A full SHA-1 or SHA-256 object name.
pub(super) fn is_object_id(text: &str) -> bool {
    matches!(text.len(), 40 | 64) && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// An object name, abbreviated or full.
pub(super) fn is_abbreviated_object_id(text: &str) -> bool {
    (7..=64).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// One record of `git diff --numstat -z`. Binary files have no counts.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct LineCounts {
    pub path: String,
    pub added: Option<u64>,
    pub removed: Option<u64>,
}

/// Parses `git diff --numstat -z`: counts and a path, or for a rename or copy
/// counts, an empty path, then the old and new paths. Renames report the new path.
pub(super) fn parse_numstat(text: &str) -> Vec<LineCounts> {
    let mut fields = text.split('\0');
    let mut counts = Vec::new();
    while let Some(record) = fields.next() {
        let mut parts = record.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let path = if path.is_empty() {
            fields.next();
            fields.next().unwrap_or_default().to_string()
        } else {
            path.to_string()
        };
        counts.push(LineCounts {
            path,
            added: added.parse().ok(),
            removed: removed.parse().ok(),
        });
    }
    counts
}

/// One record of `git diff --name-status -z`.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct NameStatus {
    /// `A`, `C`, `D`, `M`, `R`, `T`, `U` or `X`.
    pub status: char,
    pub path: String,
    /// The source path of a rename or copy.
    pub old_path: Option<String>,
}

/// Parses `git diff --name-status -z`: a status, then one path or, for renames
/// and copies, the old path and the new.
pub(super) fn parse_name_status(text: &str) -> Vec<NameStatus> {
    let mut fields = text.split('\0').filter(|field| !field.is_empty());
    let mut changes = Vec::new();
    while let Some(code) = fields.next() {
        let status = code.chars().next().unwrap_or('M');
        let first = fields.next().unwrap_or_default().to_string();
        let (path, old_path) = if matches!(status, 'R' | 'C') {
            (fields.next().unwrap_or_default().to_string(), Some(first))
        } else {
            (first, None)
        };
        changes.push(NameStatus {
            status,
            path,
            old_path,
        });
    }
    changes
}

/// One record of `git status --porcelain=v1 -z`.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct StatusEntry {
    /// The staged (`X`) column.
    pub index: char,
    /// The working-tree (`Y`) column.
    pub worktree: char,
    pub path: String,
    /// The source path of a staged rename or copy.
    pub old_path: Option<String>,
}

/// Parses `git status --porcelain=v1 -z`: `XY path`, followed for a rename or
/// copy by the source path as its own field.
pub(super) fn parse_status(text: &str) -> Vec<StatusEntry> {
    let mut entries = Vec::new();
    let mut fields = text.split('\0').filter(|field| !field.is_empty());
    while let Some(entry) = fields.next() {
        let bytes = entry.as_bytes();
        if bytes.len() < 4 || !entry.is_char_boundary(3) {
            continue;
        }
        let (index, worktree) = (bytes[0] as char, bytes[1] as char);
        let old_path = matches!(index, 'R' | 'C')
            .then(|| fields.next().map(str::to_string))
            .flatten();
        entries.push(StatusEntry {
            index,
            worktree,
            path: entry[3..].to_string(),
            old_path,
        });
    }
    entries
}

/// Untracked files that are not ignored, relative to `path`.
pub(super) fn untracked_files(path: &Path, policy: Policy) -> Result<Vec<String>, String> {
    Ok(git_exact(
        path,
        &["ls-files", "--others", "--exclude-standard", "-z"],
        policy,
    )?
    .split('\0')
    .filter(|name| !name.is_empty())
    .map(str::to_string)
    .collect())
}

/// Untracked files that are not ignored, relative to `path`, named exactly as
/// on disk. Git writes names as raw bytes; on Windows they are UTF-8, and a name
/// that is not is refused rather than guessed.
pub(super) fn untracked_paths(path: &Path, policy: Policy) -> Result<Vec<PathBuf>, String> {
    checked_bytes(output(
        path,
        &["ls-files", "--others", "--exclude-standard", "-z"],
        policy,
    )?)?
    .split(|byte| *byte == 0)
    .filter(|name| !name.is_empty())
    .map(path_from_bytes)
    .collect()
}

#[cfg(unix)]
fn path_from_bytes(bytes: &[u8]) -> Result<PathBuf, String> {
    use std::os::unix::ffi::OsStrExt;
    Ok(PathBuf::from(std::ffi::OsStr::from_bytes(bytes)))
}

#[cfg(not(unix))]
fn path_from_bytes(bytes: &[u8]) -> Result<PathBuf, String> {
    std::str::from_utf8(bytes).map(PathBuf::from).map_err(|_| {
        format!(
            "Git listed a file name that is not UTF-8: {}",
            String::from_utf8_lossy(bytes)
        )
    })
}

/// Larger untracked files are not read to count their lines.
pub(super) const UNTRACKED_COUNT_LIMIT: u64 = 2_000_000;

/// The lines a new file adds, counted as Git's diff would: a last line without
/// a newline still counts. `None` for binary files, folders and files over
/// [`UNTRACKED_COUNT_LIMIT`].
pub(super) fn untracked_lines(file: &Path) -> Option<u64> {
    let metadata = std::fs::metadata(file).ok()?;
    if !metadata.is_file() || metadata.len() > UNTRACKED_COUNT_LIMIT {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(file)
        .ok()?
        .take(UNTRACKED_COUNT_LIMIT)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.contains(&0) {
        return None;
    }
    let lines = bytes.iter().filter(|byte| **byte == b'\n').count() as u64;
    Some(lines + u64::from(!bytes.is_empty() && !bytes.ends_with(b"\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numstat_reports_renames_by_their_new_path_and_binary_files_without_counts() {
        let text = "3\t1\tsrc/a.rs\0-\t-\timage.png\02\t0\t\0old.rs\0new.rs\0";
        assert_eq!(
            parse_numstat(text),
            [
                LineCounts {
                    path: "src/a.rs".into(),
                    added: Some(3),
                    removed: Some(1)
                },
                LineCounts {
                    path: "image.png".into(),
                    added: None,
                    removed: None
                },
                LineCounts {
                    path: "new.rs".into(),
                    added: Some(2),
                    removed: Some(0)
                },
            ]
        );
    }

    #[test]
    fn name_status_keeps_the_source_of_a_rename() {
        let parsed = parse_name_status("M\0a.txt\0R100\0old.txt\0new.txt\0D\0gone.txt\0");
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[1].status, 'R');
        assert_eq!(parsed[1].path, "new.txt");
        assert_eq!(parsed[1].old_path.as_deref(), Some("old.txt"));
        assert_eq!(
            (parsed[2].status, parsed[2].path.as_str()),
            ('D', "gone.txt")
        );
    }

    #[test]
    fn status_reads_both_columns_and_rename_sources() {
        let parsed = parse_status(" M a.txt\0R  new.txt\0old.txt\0?? fresh.txt\0");
        assert_eq!(
            parsed
                .iter()
                .map(|entry| (entry.index, entry.worktree, entry.path.as_str()))
                .collect::<Vec<_>>(),
            [
                (' ', 'M', "a.txt"),
                ('R', ' ', "new.txt"),
                ('?', '?', "fresh.txt")
            ]
        );
        assert_eq!(parsed[1].old_path.as_deref(), Some("old.txt"));
    }

    #[test]
    fn object_ids_are_full_or_abbreviated_hex() {
        assert!(is_object_id(&"a".repeat(40)));
        assert!(is_object_id(&"0".repeat(64)));
        assert!(!is_object_id(&"a".repeat(41)));
        assert!(!is_object_id(&"g".repeat(40)));
        assert!(is_abbreviated_object_id("abc1234"));
        assert!(!is_abbreviated_object_id("abc123"));
    }

    #[test]
    fn untracked_lines_count_a_last_line_without_a_newline() {
        let directory = std::env::temp_dir().join(format!(
            "jackalope-repo-lines-{}-{}",
            std::process::id(),
            NEXT_INDEX.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("new.txt");
        std::fs::write(&file, "a\nb").unwrap();
        assert_eq!(untracked_lines(&file), Some(2));
        std::fs::write(&file, "a\nb\n").unwrap();
        assert_eq!(untracked_lines(&file), Some(2));
        std::fs::write(&file, "").unwrap();
        assert_eq!(untracked_lines(&file), Some(0));
        std::fs::write(&file, b"a\0b").unwrap();
        assert_eq!(untracked_lines(&file), None);
        assert_eq!(untracked_lines(&directory), None);
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
