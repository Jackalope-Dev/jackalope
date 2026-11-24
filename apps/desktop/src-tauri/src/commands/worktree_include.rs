//! `.worktreeinclude`: a file at the project root, in gitignore syntax, naming Git-ignored files
//! to copy from the project checkout into each new task worktree, such as `.env` files and local
//! configuration a fresh checkout lacks.
//!
//! Only files that Git ignores and a pattern matches are copied, so tracked files are never
//! duplicated. Links are recreated only when they point inside the worktree, existing files are
//! never replaced, and the total is bounded. Copies are copy-on-write clones where the volume
//! supports them and ordinary copies elsewhere.

use std::{collections::HashSet, io::Write, path::Path};

use ignore::gitignore::{Gitignore, GitignoreBuilder};

use super::{dependency_clone, repo, workspace_setup::no_links};

pub(super) const FILE: &str = ".worktreeinclude";
const MAX_PATTERN_BYTES: u64 = 64 * 1024;
/// Files and bytes copied one by one. A folder cloned whole shares storage with the checkout
/// and is bounded by the entry limit of its link check instead.
const MAX_FILES: usize = 10_000;
pub(super) const MAX_BYTES: u64 = 256 * 1024 * 1024;
/// Entries looked at inside ignored folders while searching for matches.
const MAX_SCANNED: usize = 200_000;
/// Skipped paths kept by name; the rest are counted.
const MAX_REPORTED: usize = 50;
/// Folders Jackalope keeps its own state in, never copied between checkouts.
const OWN_FOLDERS: [&str; 3] = [".git", ".worktrees", ".jackalope"];

#[derive(Debug, Default, PartialEq)]
pub(super) struct IncludeOutcome {
    /// Whether the project has a `.worktreeinclude`.
    pub present: bool,
    /// Workspace-relative paths now present as copies; a folder cloned whole ends in `/`.
    pub copied: Vec<String>,
    /// Bytes copied file by file.
    pub bytes: u64,
    /// At least one copy shares storage with the checkout (copy-on-write).
    pub cloned: bool,
    /// Matched paths that were not copied, with the reason.
    pub skipped: Vec<(String, String)>,
    /// Skipped paths beyond [`MAX_REPORTED`].
    pub more_skipped: usize,
    /// Why nothing could be copied, such as an unreadable pattern file.
    pub error: Option<String>,
}

impl IncludeOutcome {
    fn skip(&mut self, path: impl Into<String>, reason: impl Into<String>) {
        if self.skipped.len() < MAX_REPORTED {
            self.skipped.push((path.into(), reason.into()));
        } else {
            self.more_skipped += 1;
        }
    }
}

/// One thing to copy: a file (or link), or a folder matched as a whole.
#[derive(Debug, PartialEq)]
enum Candidate {
    File(String),
    Folder(String),
}

impl Candidate {
    fn path(&self) -> &str {
        match self {
            Candidate::File(path) | Candidate::Folder(path) => path,
        }
    }
}

/// The parsed pattern file: the matcher plus the literal folder prefixes of anchored patterns,
/// which decide which folders Git ignores as a whole are searched.
struct Patterns {
    matcher: Gitignore,
    anchored: Vec<String>,
    negated: bool,
}

fn parse(root: &Path, text: &str) -> Result<Patterns, String> {
    let mut builder = GitignoreBuilder::new(root);
    let mut anchored = Vec::new();
    let mut negated = false;
    for (number, line) in text.lines().enumerate() {
        builder
            .add_line(None, line)
            .map_err(|error| format!("{FILE} line {}: {error}", number + 1))?;
        let pattern = line.trim_end();
        if pattern.is_empty() || pattern.starts_with('#') {
            continue;
        }
        if pattern.starts_with('!') {
            negated = true;
            continue;
        }
        let pattern = pattern.trim_start_matches('/').trim_end_matches('/');
        if !pattern.contains('/') {
            continue;
        }
        let literal = &pattern[..pattern.find(['*', '?', '[', '\\']).unwrap_or(pattern.len())];
        if let Some(end) = literal.rfind('/') {
            anchored.push(format!("{}/", &literal[..end]));
        }
    }
    Ok(Patterns {
        matcher: builder.build().map_err(|error| error.to_string())?,
        anchored,
        negated,
    })
}

impl Patterns {
    fn matches(&self, relative: &str, is_dir: bool) -> bool {
        self.matcher
            .matched_path_or_any_parents(relative, is_dir)
            .is_ignore()
    }

    /// Whether an anchored pattern names something inside `folder` (which ends in `/`). A
    /// pattern without a slash, such as `.env`, does not reach into folders Git ignores as a
    /// whole: those hold dependencies and build output far more often than local settings.
    fn reaches_into(&self, folder: &str) -> bool {
        self.anchored
            .iter()
            .any(|prefix| prefix.starts_with(folder) || folder.starts_with(prefix.as_str()))
    }
}

/// A plain relative path Git reported, or `None` for anything that must not be touched.
fn plain(name: &str) -> Option<&str> {
    let relative = name.trim_end_matches('/');
    let mut parts = relative.split('/');
    let first = parts.clone().next()?;
    (!relative.is_empty()
        && !OWN_FOLDERS.contains(&first)
        && Path::new(relative)
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)))
        && !parts.any(|part| part.eq_ignore_ascii_case(".git")))
    .then_some(relative)
}

/// Copies what the project checkout's `.worktreeinclude` names into `workspace`, a new worktree
/// of the same repository. Problems with single paths are reported in the outcome rather than
/// failing the copy; nothing in the checkout is changed.
pub(super) fn copy_included(project: &str, workspace: &str) -> IncludeOutcome {
    let mut outcome = IncludeOutcome::default();
    let (Ok(root), Ok(destination)) =
        (dunce::canonicalize(project), dunce::canonicalize(workspace))
    else {
        return outcome;
    };
    if root == destination {
        return outcome;
    }
    let patterns = match read_patterns(&root) {
        Ok(Some(patterns)) => patterns,
        Ok(None) => return outcome,
        Err(error) => {
            outcome.present = true;
            outcome.error = Some(error);
            return outcome;
        }
    };
    outcome.present = true;
    let candidates = match candidates(&root, &patterns, &mut outcome) {
        Ok(candidates) => candidates,
        Err(error) => {
            outcome.error = Some(error);
            return outcome;
        }
    };
    let ignored = match ignored_in(&destination, &root, &candidates) {
        Ok(ignored) => ignored,
        Err(error) => {
            outcome.error = Some(error);
            return outcome;
        }
    };
    let mut copier = Copier {
        root: &root,
        destination: &destination,
        files: 0,
        clone_files: true,
    };
    for candidate in candidates {
        let path = candidate.path().to_string();
        if !ignored.contains(&path) {
            outcome.skip(path, "it is not ignored on the task's branch");
            continue;
        }
        match candidate {
            Candidate::File(path) => copier.file(&path, &mut outcome),
            Candidate::Folder(path) => copier.folder(&path, &patterns, &mut outcome),
        }
    }
    outcome
}

fn read_patterns(root: &Path) -> Result<Option<Patterns>, String> {
    let path = match no_links(root, Path::new(FILE)) {
        Ok(path) => path,
        Err(_) => return Err(format!("{FILE} cannot be a link.")),
    };
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("{FILE} could not be read: {error}")),
    };
    if !metadata.is_file() {
        return Err(format!("{FILE} must be a file."));
    }
    let bytes = super::history::read_bounded(&path, MAX_PATTERN_BYTES)
        .map_err(|_| format!("{FILE} must be smaller than 64 KiB."))?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{FILE} must be UTF-8 text."))?;
    parse(root, &text).map(Some)
}

/// Ignored paths in the project checkout that a pattern matches. Git lists a folder it ignores
/// as a whole once, so only folders a pattern names are walked.
fn candidates(
    root: &Path,
    patterns: &Patterns,
    outcome: &mut IncludeOutcome,
) -> Result<Vec<Candidate>, String> {
    let listing = repo::git_exact(
        root,
        &[
            "ls-files",
            "-z",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "--no-empty-directory",
        ],
        repo::Policy::Inspection,
    )?;
    let mut found = Vec::new();
    let mut unmatched = Vec::new();
    for name in listing.split('\0').filter(|name| !name.is_empty()) {
        let Some(relative) = plain(name) else {
            continue;
        };
        let folder = name.ends_with('/');
        if patterns.matches(relative, folder) {
            found.push(if folder {
                Candidate::Folder(relative.to_string())
            } else {
                Candidate::File(relative.to_string())
            });
        } else if folder {
            unmatched.push(relative.to_string());
        }
    }
    // Git also lists an untracked folder holding only ignored files as one entry. Unlike a
    // folder its rules ignore as a whole, such as `node_modules/`, that one is searched.
    let whole = check_ignore(
        root,
        unmatched
            .iter()
            .map(|folder| (folder.clone(), folder.clone())),
    )?;
    let mut scanned = 0usize;
    for folder in unmatched {
        let everything = !whole.contains(&folder);
        if everything || patterns.reaches_into(&format!("{folder}/")) {
            search(
                root,
                &folder,
                patterns,
                everything,
                &mut scanned,
                &mut found,
                outcome,
            );
        }
    }
    Ok(found)
}

/// Walks one ignored folder for matching files without following links. Unless `everything`,
/// only subfolders an anchored pattern names are entered.
fn search(
    root: &Path,
    folder: &str,
    patterns: &Patterns,
    everything: bool,
    scanned: &mut usize,
    found: &mut Vec<Candidate>,
    outcome: &mut IncludeOutcome,
) {
    let mut pending = vec![folder.to_string()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(root.join(&directory)) else {
            continue;
        };
        for entry in entries.flatten() {
            *scanned += 1;
            if *scanned > MAX_SCANNED {
                outcome.skip(
                    folder,
                    "searching it stopped after 200,000 entries; name the files more precisely",
                );
                return;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let relative = format!("{directory}/{name}");
            if plain(&relative).is_none() {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                if patterns.matches(&relative, true) {
                    found.push(Candidate::Folder(relative));
                } else if everything || patterns.reaches_into(&format!("{relative}/")) {
                    pending.push(relative);
                }
            } else if patterns.matches(&relative, false) {
                found.push(Candidate::File(relative));
            }
        }
    }
}

/// The candidates the worktree's own ignore rules also ignore, so a copy never shows up as a
/// change. A folder is checked through a path inside it, since it does not exist there yet and
/// Git only knows a missing path is a folder from its children.
fn ignored_in(
    workspace: &Path,
    root: &Path,
    candidates: &[Candidate],
) -> Result<HashSet<String>, String> {
    let probes = candidates.iter().filter_map(|candidate| match candidate {
        Candidate::File(path) => Some((path.clone(), path.clone())),
        Candidate::Folder(path) => std::fs::read_dir(root.join(path))
            .ok()
            .and_then(|mut entries| entries.find_map(Result::ok))
            .and_then(|entry| entry.file_name().to_str().map(str::to_string))
            .map(|child| (format!("{path}/{child}"), path.clone())),
    });
    check_ignore(workspace, probes)
}

/// Asks Git in `checkout` which of the `(probe, name)` probes its rules ignore, returning the
/// names of those that are.
fn check_ignore(
    checkout: &Path,
    probes: impl IntoIterator<Item = (String, String)>,
) -> Result<HashSet<String>, String> {
    let probes: Vec<(String, String)> = probes.into_iter().collect();
    let mut ignored = HashSet::new();
    if probes.is_empty() {
        return Ok(ignored);
    }
    let mut child = repo::command(
        checkout,
        &["check-ignore", "-z", "--stdin"],
        repo::Policy::Inspection,
    )
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .spawn()
    .map_err(|error| format!("Could not run Git: {error}"))?;
    let mut input = Vec::new();
    for (probe, _) in &probes {
        input.extend_from_slice(probe.as_bytes());
        input.push(0);
    }
    let mut stdin = child.stdin.take().ok_or("Cannot open Git input.")?;
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    let _ = writer.join();
    // check-ignore exits 1 when it matched nothing; anything else is a real failure.
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!(
            "Git could not check ignore rules: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let matched: HashSet<String> = String::from_utf8_lossy(&output.stdout)
        .split('\0')
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
    for (probe, name) in probes {
        if matched.contains(&probe) {
            ignored.insert(name);
        }
    }
    Ok(ignored)
}

struct Copier<'a> {
    root: &'a Path,
    destination: &'a Path,
    files: usize,
    /// Cleared after the volume refuses one file clone, so the rest copy without retrying.
    clone_files: bool,
}

impl Copier<'_> {
    fn file(&mut self, path: &str, outcome: &mut IncludeOutcome) {
        if let Err(reason) = self.copy_file(path, outcome) {
            outcome.skip(path, reason);
        }
    }

    fn copy_file(&mut self, path: &str, outcome: &mut IncludeOutcome) -> Result<(), String> {
        let relative = Path::new(path);
        let parent = relative.parent().unwrap_or(Path::new(""));
        no_links(self.root, parent).map_err(|_| "a folder on its path is a link".to_string())?;
        no_links(self.destination, parent)
            .map_err(|_| "a folder on its path in the worktree is a link".to_string())?;
        let (source, target) = (self.root.join(relative), self.destination.join(relative));
        let metadata = std::fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
        if std::fs::symlink_metadata(&target).is_ok() {
            return Err("the worktree already has it".into());
        }
        if metadata.file_type().is_symlink() {
            return self.link(&source, &target, path, outcome);
        }
        if !metadata.is_file() {
            return Err("it is not a regular file".into());
        }
        if self.files >= MAX_FILES {
            return Err(format!("more than {MAX_FILES} files matched"));
        }
        if outcome.bytes.saturating_add(metadata.len()) > MAX_BYTES {
            return Err("the copies would exceed 256 MiB".into());
        }
        self.parent(&target, relative)?;
        let mut cloned = false;
        if self.clone_files {
            match dependency_clone::clone_file(&source, &target) {
                Ok(()) => cloned = true,
                Err(error) if dependency_clone::is_unsupported(&error) => self.clone_files = false,
                Err(error) => return Err(error.to_string()),
            }
        }
        if !cloned {
            copy_new(&source, &target).map_err(|error| error.to_string())?;
        }
        self.files += 1;
        outcome.bytes += metadata.len();
        outcome.cloned |= cloned;
        outcome.copied.push(path.to_string());
        Ok(())
    }

    /// Recreates a relative link whose target stays inside the worktree. Links that leave it,
    /// or name an absolute path, are not followed or copied.
    fn link(
        &self,
        source: &Path,
        target: &Path,
        path: &str,
        outcome: &mut IncludeOutcome,
    ) -> Result<(), String> {
        let link = std::fs::read_link(source).map_err(|error| error.to_string())?;
        let parent = target.parent().ok_or("it has no parent folder")?;
        if link.is_absolute()
            || !dependency_clone::normalize(&parent.join(&link))
                .is_some_and(|resolved| resolved.starts_with(self.destination))
        {
            return Err("it is a link that leads outside the worktree".into());
        }
        if cfg!(windows) {
            return Err("links are not copied on Windows".into());
        }
        self.parent(target, Path::new(path))?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(&link, target).map_err(|error| error.to_string())?;
        outcome.copied.push(path.to_string());
        Ok(())
    }

    fn parent(&self, target: &Path, relative: &Path) -> Result<(), String> {
        std::fs::create_dir_all(target.parent().ok_or("it has no parent folder")?)
            .map_err(|error| error.to_string())?;
        // Creating the folders must not have raced a link into the path.
        no_links(self.destination, relative.parent().unwrap_or(Path::new("")))
            .map(|_| ())
            .map_err(|_| "a folder on its path in the worktree is a link".to_string())
    }

    /// A folder matched as a whole is cloned in one step where the volume can, then checked like
    /// a dependency clone. Otherwise, or with negated patterns that may exclude part of it, its
    /// files are copied one by one within the limits.
    fn folder(&mut self, path: &str, patterns: &Patterns, outcome: &mut IncludeOutcome) {
        let relative = Path::new(path);
        let (Ok(source), Ok(target)) = (
            no_links(self.root, relative),
            no_links(self.destination, relative),
        ) else {
            outcome.skip(format!("{path}/"), "a folder on its path is a link");
            return;
        };
        if std::fs::symlink_metadata(&target).is_ok() {
            outcome.skip(format!("{path}/"), "the worktree already has it");
            return;
        }
        if !patterns.negated && self.parent(&target, relative).is_ok() {
            match dependency_clone::clone_tree(&source, &target) {
                Ok(()) => {
                    match dependency_clone::relocatable(&[self.root], self.destination, &target) {
                        Ok(()) => {
                            outcome.cloned = true;
                            outcome.copied.push(format!("{path}/"));
                            return;
                        }
                        Err(_) => {
                            let _ = std::fs::remove_dir_all(&target);
                        }
                    }
                }
                Err(error) if dependency_clone::is_unsupported(&error) => {}
                Err(error) => {
                    outcome.skip(format!("{path}/"), error.to_string());
                    return;
                }
            }
        }
        let mut pending = vec![path.to_string()];
        while let Some(directory) = pending.pop() {
            let Ok(entries) = std::fs::read_dir(self.root.join(&directory)) else {
                continue;
            };
            for entry in entries.flatten() {
                let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                let child = format!("{directory}/{name}");
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if plain(&child).is_none() {
                    continue;
                }
                if kind.is_dir() {
                    pending.push(child);
                } else if patterns.matches(&child, false) {
                    self.file(&child, outcome);
                }
            }
        }
    }
}

/// An ordinary copy that never replaces an existing file.
fn copy_new(source: &Path, target: &Path) -> std::io::Result<()> {
    let mut input = std::fs::File::open(source)?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(input.metadata()?.permissions().mode() & 0o7777);
    }
    let mut output = options.open(target)?;
    let copied = std::io::copy(&mut input, &mut output);
    if copied.is_err() {
        drop(output);
        let _ = std::fs::remove_file(target);
    }
    copied.map(|_| ())
}

/// One line per copied or skipped path for the task's activity, bounded so a large include
/// does not flood it.
pub(super) fn summary(outcome: &IncludeOutcome) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(error) = &outcome.error {
        lines.push(format!("Did not copy files from {FILE}: {error}"));
        return lines;
    }
    if !outcome.copied.is_empty() {
        let shown: Vec<&str> = outcome.copied.iter().take(20).map(String::as_str).collect();
        let more = outcome.copied.len() - shown.len();
        lines.push(format!(
            "Copied {} from {FILE}{}: {}{}.",
            plural(outcome.copied.len(), "ignored path"),
            if outcome.cloned {
                " (copy-on-write where the volume allows)"
            } else {
                ""
            },
            shown.join(", "),
            if more > 0 {
                format!(" and {more} more")
            } else {
                String::new()
            }
        ));
    } else if outcome.skipped.is_empty() {
        lines.push(format!(
            "{FILE} matched no ignored files in the project checkout."
        ));
    }
    for (path, reason) in outcome.skipped.iter().take(10) {
        lines.push(format!("Did not copy {path} from {FILE}: {reason}."));
    }
    let hidden = outcome.skipped.len().saturating_sub(10) + outcome.more_skipped;
    if hidden > 0 {
        lines.push(format!(
            "Did not copy {} more from {FILE}.",
            plural(hidden, "path")
        ));
    }
    lines
}

fn plural(count: usize, noun: &str) -> String {
    if count == 1 {
        format!("1 {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;

    fn fixture_root() -> PathBuf {
        let path = std::env::temp_dir().join(format!("jackalope-include-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        dunce::canonicalize(path).unwrap()
    }

    fn git(directory: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
            .args(args)
            .current_dir(directory)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// A repository with ignored local files and a task worktree of it at `.worktrees/task`.
    fn project(include: &str) -> (PathBuf, PathBuf) {
        let root = fixture_root();
        fs::write(
            root.join(".gitignore"),
            ".env\n.env.*\n!.env.example\nconfig/local/\nnode_modules/\n.worktrees/\nbuild/\n",
        )
        .unwrap();
        fs::write(root.join(".env.example"), "KEY=").unwrap();
        fs::write(root.join("tracked.txt"), "tracked").unwrap();
        fs::write(root.join(FILE), include).unwrap();
        git(&root, &["init", "--quiet", "--initial-branch=main"]);
        git(&root, &["add", "."]);
        git(&root, &["commit", "--quiet", "-m", "fixture"]);
        fs::write(root.join(".env"), "SECRET=1").unwrap();
        fs::write(root.join(".env.local"), "LOCAL=1").unwrap();
        fs::create_dir_all(root.join("apps/web")).unwrap();
        fs::write(root.join("apps/web/.env"), "WEB=1").unwrap();
        fs::create_dir_all(root.join("config/local/nested")).unwrap();
        fs::write(root.join("config/local/settings.json"), "{}").unwrap();
        fs::write(root.join("config/local/nested/more.json"), "[]").unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/.env"), "DEPENDENCY=1").unwrap();
        fs::write(root.join("untracked.txt"), "not ignored").unwrap();
        let workspace = root.join(".worktrees/task");
        git(
            &root,
            &[
                "worktree",
                "add",
                "--quiet",
                "-b",
                "task",
                workspace.to_str().unwrap(),
            ],
        );
        (root, workspace)
    }

    fn copy(root: &Path, workspace: &Path) -> IncludeOutcome {
        copy_included(root.to_str().unwrap(), workspace.to_str().unwrap())
    }

    #[test]
    fn copies_only_ignored_files_a_pattern_matches() {
        let (root, workspace) =
            project(".env*\n!.env.example\nconfig/local/\ntracked.txt\nuntracked.txt\n");
        let outcome = copy(&root, &workspace);
        assert!(outcome.error.is_none(), "{:?}", outcome.error);
        let mut copied = outcome.copied.clone();
        copied.sort();
        // A volume without copy-on-write copies the matched folder file by file instead.
        let folder: &[&str] = if outcome.copied.iter().any(|path| path == "config/local/") {
            &["config/local/"]
        } else {
            &[
                "config/local/nested/more.json",
                "config/local/settings.json",
            ]
        };
        assert_eq!(
            copied,
            [&[".env", ".env.local", "apps/web/.env"][..], folder].concat()
        );
        assert_eq!(
            fs::read_to_string(workspace.join(".env")).unwrap(),
            "SECRET=1"
        );
        assert_eq!(
            fs::read_to_string(workspace.join("config/local/nested/more.json")).unwrap(),
            "[]"
        );
        assert!(
            !workspace.join("node_modules").exists(),
            "an unanchored pattern does not reach into a folder Git ignores as a whole"
        );
        assert_eq!(
            fs::read_to_string(workspace.join("tracked.txt")).unwrap(),
            "tracked",
            "tracked files come from Git, never from the include"
        );
        assert!(
            !workspace.join("untracked.txt").exists(),
            "only ignored files are copied"
        );
        let status = std::process::Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&workspace)
            .output()
            .unwrap();
        assert!(status.stdout.is_empty(), "copies never show up as changes");

        fs::write(workspace.join(".env"), "edited in the task").unwrap();
        let again = copy(&root, &workspace);
        assert!(again.copied.is_empty(), "{:?}", again.copied);
        assert_eq!(
            fs::read_to_string(workspace.join(".env")).unwrap(),
            "edited in the task",
            "an existing file is never replaced"
        );
        assert!(again
            .skipped
            .iter()
            .any(|(path, reason)| path == ".env" && reason.contains("already")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn anchored_patterns_reach_inside_ignored_folders_and_negations_apply() {
        let (root, workspace) =
            project("node_modules/pkg/.env\nconfig/local/**\n!config/local/nested/more.json\n");
        let outcome = copy(&root, &workspace);
        let mut copied = outcome.copied.clone();
        copied.sort();
        assert_eq!(
            copied,
            ["config/local/settings.json", "node_modules/pkg/.env"]
        );
        assert!(!workspace.join("config/local/nested/more.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn links_leaving_the_worktree_are_never_followed() {
        let (root, workspace) = project(".env*\nbuild/\n");
        let outside = fixture_root();
        fs::write(outside.join("secret"), "outside").unwrap();
        fs::remove_file(root.join(".env.local")).unwrap();
        symlink(outside.join("secret"), root.join(".env.local")).unwrap();
        symlink(".env", root.join(".env.alias")).unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        symlink("../../outside", root.join("build/escape")).unwrap();
        let outcome = copy(&root, &workspace);
        assert!(outcome
            .skipped
            .iter()
            .any(|(path, reason)| path == ".env.local" && reason.contains("outside")));
        assert!(!workspace.join(".env.local").exists());
        assert_eq!(
            fs::read_link(workspace.join(".env.alias")).unwrap(),
            PathBuf::from(".env"),
            "a link that stays inside the worktree is kept as a link"
        );
        assert!(
            fs::symlink_metadata(workspace.join("build/escape")).is_err(),
            "a folder holding a link out of the worktree is not cloned with it"
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn the_total_size_is_bounded_and_reported() {
        let (root, workspace) = project("build/\n");
        fs::create_dir_all(root.join("build")).unwrap();
        let big = fs::File::create(root.join("build/big.bin")).unwrap();
        big.set_len(MAX_BYTES + 1).unwrap();
        fs::write(root.join("build/small.txt"), "small").unwrap();
        // A negation forces the file-by-file copy, which is the one with a byte limit.
        fs::write(root.join(FILE), "build/\n!build/none\n").unwrap();
        let outcome = copy(&root, &workspace);
        assert_eq!(outcome.copied, ["build/small.txt"]);
        assert!(outcome
            .skipped
            .iter()
            .any(|(path, reason)| path == "build/big.bin" && reason.contains("256 MiB")));
        assert!(!workspace.join("build/big.bin").exists());
        let lines = summary(&outcome);
        assert!(lines[0].starts_with("Copied 1 ignored path from .worktreeinclude"));
        assert!(lines.iter().any(|line| line.contains("build/big.bin")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_or_unreadable_pattern_file_is_reported() {
        let (root, workspace) = project("");
        fs::remove_file(root.join(FILE)).unwrap();
        assert_eq!(copy(&root, &workspace), IncludeOutcome::default());
        fs::create_dir_all(root.join("elsewhere")).unwrap();
        fs::write(root.join("elsewhere/patterns"), ".env\n").unwrap();
        symlink("elsewhere/patterns", root.join(FILE)).unwrap();
        let outcome = copy(&root, &workspace);
        assert!(outcome.present);
        assert!(outcome.error.unwrap().contains("link"));
        assert!(!workspace.join(".env").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn plain_paths_exclude_git_and_jackalope_folders() {
        assert_eq!(plain("config/local/"), Some("config/local"));
        for name in [
            ".git/config",
            ".worktrees/a/.env",
            ".jackalope/x",
            "a/.git/x",
            "../x",
            "",
        ] {
            assert_eq!(plain(name), None, "{name}");
        }
    }
}
