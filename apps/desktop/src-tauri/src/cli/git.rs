//! Git state read locally: the command runs beside the directory.
//!
//! A repository gives each conversation its own worktree. When the current
//! directory has none, the command creates one after an explicit yes or
//! `--init`. Declining, or a non-interactive run without `--init`, edits the
//! folder directly. A home directory or drive root is refused either way.

use std::io::{BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

/// Written when a new repository has files and no ignore file of its own, so
/// the initial commit does not absorb dependency trees or common secret files.
const STARTER_IGNORE: &str = "\
# Added by jackalope --init so dependency and secret files stay untracked.
.env
.env.*
*.pem
*.key
id_rsa
id_rsa.*
credentials.json
node_modules/
target/
dist/
.next/
.DS_Store
";

/// The checked-out branch, or `None` outside a repository.
pub fn branch(path: &str) -> Option<String> {
    let output = git(Path::new(path), &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !name.is_empty()).then_some(name)
}

/// Makes sure the current directory can host a conversation. Creates a repository
/// when `initialize` is set or the user agrees. Otherwise the conversation edits
/// the folder directly. `Some` is the notice to print.
pub fn prepare(initialize: bool) -> Result<Option<String>, String> {
    let directory = std::env::current_dir().map_err(|error| error.to_string())?;
    if toplevel(&directory)?.is_some() {
        return Ok(None);
    }
    if refuses_init(&directory) {
        return Err(
            "This is a home directory or drive root. Move to a project directory first.".into(),
        );
    }
    let create = if initialize {
        true
    } else if interactive() {
        confirm()?
    } else {
        false
    };
    if !create {
        return Ok(Some(
            "This directory is not a Git repository. Jackalope will edit files here directly. Run jackalope --init to create a repository and keep the work in a separate copy."
                .into(),
        ));
    }
    Ok(Some(initialize_repository(&directory)?))
}

/// Home directories and filesystem roots are too broad to turn into a project.
pub fn refuses_init(directory: &Path) -> bool {
    let candidate = directory
        .canonicalize()
        .unwrap_or_else(|_| directory.to_path_buf());
    if candidate.parent().is_none() {
        return true;
    }
    home_dir()
        .and_then(|path| path.canonicalize().ok())
        .is_some_and(|home| candidate == home)
}

/// Creates a repository in `directory` and an initial commit, so a worktree
/// contains the project rather than an empty tree.
pub fn initialize_repository(directory: &Path) -> Result<String, String> {
    if directory.join(".git").exists() {
        return Err(
            "This directory has a .git entry but is not a usable repository. Fix it with Git, then run jackalope again."
                .into(),
        );
    }
    init_repo(directory)?;
    let wrote_ignore = write_starter_ignore(directory)?;
    let staged = stage_all(directory)?;
    let placeholder = !has_identity(directory);
    commit(directory, staged, placeholder)?;
    Ok(notice(wrote_ignore, staged, placeholder))
}

fn interactive() -> bool {
    std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal()
        && std::io::stderr().is_terminal()
}

fn confirm() -> Result<bool, String> {
    eprintln!("This directory is not a Git repository.");
    eprintln!(
        "Jackalope can edit files here directly, or create a repository so each conversation gets its own copy."
    );
    eprintln!(
        "Creating a repository here commits the current files, and adds a .gitignore for dependency and secret files when you do not have one."
    );
    eprintln!();
    loop {
        eprint!("Create a repository here? [y/N] ");
        std::io::stderr()
            .flush()
            .map_err(|error| error.to_string())?;
        let mut line = String::new();
        if std::io::stdin()
            .lock()
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            return Ok(false);
        }
        match line.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => return Ok(true),
            "n" | "no" | "" => return Ok(false),
            _ => eprintln!("Please answer y or n."),
        }
    }
}

fn toplevel(directory: &Path) -> Result<Option<PathBuf>, String> {
    let output = git(directory, &["rev-parse", "--show-toplevel"])?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!path.is_empty()).then(|| PathBuf::from(path)));
    }
    let error = stderr_text(&output);
    if output.status.code() == Some(128) || error.to_lowercase().contains("not a git repository") {
        return Ok(None);
    }
    Err(error)
}

fn init_repo(directory: &Path) -> Result<(), String> {
    let branched = git(directory, &["init", "-b", "main"])?;
    if branched.status.success() {
        return Ok(());
    }
    let output = git(directory, &["init"])?;
    if output.status.success() {
        return Ok(());
    }
    Err(stderr_text(&output))
}

fn write_starter_ignore(directory: &Path) -> Result<bool, String> {
    if directory.join(".gitignore").exists() || !has_project_files(directory) {
        return Ok(false);
    }
    std::fs::write(directory.join(".gitignore"), STARTER_IGNORE)
        .map_err(|error| format!("Could not write .gitignore: {error}"))?;
    Ok(true)
}

fn has_project_files(directory: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return false;
    };
    entries.flatten().any(|entry| entry.file_name() != ".git")
}

fn stage_all(directory: &Path) -> Result<bool, String> {
    let added = git(directory, &["add", "-A"])?;
    if !added.status.success() {
        return Err(stderr_text(&added));
    }
    let cached = git(directory, &["diff", "--cached", "--name-only"])?;
    if !cached.status.success() {
        return Err(stderr_text(&cached));
    }
    Ok(!String::from_utf8_lossy(&cached.stdout).trim().is_empty())
}

fn has_identity(directory: &Path) -> bool {
    let set = |key: &str| {
        git(directory, &["config", "--get", key])
            .ok()
            .is_some_and(|output| {
                output.status.success()
                    && !output.stdout.iter().all(|byte| byte.is_ascii_whitespace())
            })
    };
    set("user.name") && set("user.email")
}

fn commit(directory: &Path, staged: bool, placeholder: bool) -> Result<(), String> {
    let mut args = Vec::new();
    if placeholder {
        args.extend_from_slice(&[
            "-c",
            "user.name=Jackalope",
            "-c",
            "user.email=jackalope@local",
        ]);
    }
    args.push("commit");
    args.push("--no-gpg-sign");
    if !staged {
        args.push("--allow-empty");
    }
    args.extend_from_slice(&["-m", "Initial commit"]);
    let output = git(directory, &args)?;
    if output.status.success() {
        return Ok(());
    }
    Err(stderr_text(&output))
}

fn notice(wrote_ignore: bool, staged: bool, placeholder: bool) -> String {
    let mut lines = vec!["Created a Git repository in this directory.".to_string()];
    if staged {
        lines.push(
            "Made an initial commit of the current files so an agent works from a copy.".into(),
        );
    } else {
        lines.push("Made an empty initial commit.".into());
    }
    if wrote_ignore {
        lines.push(
            "Added .gitignore for dependency folders and secret files. Edit it before you publish."
                .into(),
        );
    }
    if placeholder {
        lines.push(
            "Git has no user.name and user.email, so the initial commit used a placeholder author. Set them before you commit yourself."
                .into(),
        );
    }
    lines.join("\n")
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// A file a conversation's checkout changed, with its line counts. Counts are
/// `None` for binary files.
#[derive(Debug, Clone, PartialEq)]
pub struct FileChange {
    pub path: String,
    /// `M`odified, `A`dded, `D`eleted, `R`enamed or `?` untracked.
    pub status: char,
    pub added: Option<usize>,
    pub removed: Option<usize>,
}

/// Lines of one file's diff kept for display.
const DIFF_LINES: usize = 600;

/// What `workspace` changed since it left `project`'s checked-out commit,
/// committed or not, plus untracked files. A conversation working in the
/// project itself compares against `HEAD`. `None` outside a repository.
pub fn changes(workspace: &str, project: &str) -> Option<Vec<FileChange>> {
    let directory = Path::new(workspace);
    let base = base(workspace, project)?;
    let text = |args: &[&str]| -> Option<String> {
        let output = git(directory, args).ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    };
    let statuses = text(&["diff", "--name-status", "-M", "-z", &base])?;
    let counts = text(&["diff", "--numstat", "-M", "-z", &base])?;
    let mut changes = parse_name_status(&statuses);
    for (path, added, removed) in parse_numstat(&counts) {
        if let Some(change) = changes.iter_mut().find(|change| change.path == path) {
            change.added = added;
            change.removed = removed;
        }
    }
    let untracked = text(&["ls-files", "--others", "--exclude-standard", "-z"])?;
    for path in untracked.split('\0').filter(|path| !path.is_empty()) {
        let lines = std::fs::read(directory.join(path))
            .ok()
            .filter(|bytes| !bytes.contains(&0))
            .map(|bytes| bytes.iter().filter(|byte| **byte == b'\n').count());
        changes.push(FileChange {
            path: path.to_string(),
            status: '?',
            added: lines,
            removed: lines.map(|_| 0),
        });
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Some(changes)
}

/// The diff of one changed file, as `changes` measured it.
pub fn file_diff(workspace: &str, project: &str, change: &FileChange) -> Vec<String> {
    let directory = Path::new(workspace);
    let output = if change.status == '?' {
        // Exits 1 when the files differ, which they always do here.
        git(
            directory,
            &["diff", "--no-index", "--", "/dev/null", &change.path],
        )
    } else {
        match base(workspace, project) {
            Some(base) => git(directory, &["diff", "-M", &base, "--", &change.path]),
            None => return Vec::new(),
        }
    };
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .skip_while(|line| !line.starts_with("@@") && !line.starts_with("Binary"))
        .take(DIFF_LINES)
        .map(|line| line.replace('\t', "    "))
        .collect()
}

/// The commit a checkout's changes are measured from.
fn base(workspace: &str, project: &str) -> Option<String> {
    let directory = Path::new(workspace);
    let head = |path: &Path| -> Option<String> {
        let output = git(path, &["rev-parse", "HEAD"]).ok()?;
        let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (output.status.success() && !sha.is_empty()).then_some(sha)
    };
    let own = head(directory)?;
    if Path::new(workspace) == Path::new(project) {
        return Some(own);
    }
    let Some(theirs) = head(Path::new(project)) else {
        return Some(own);
    };
    let output = git(directory, &["merge-base", &own, &theirs]).ok()?;
    let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Some(if output.status.success() && !sha.is_empty() {
        sha
    } else {
        own
    })
}

/// `git diff --name-status -z`: a status, then one path or, for renames and
/// copies, the old path and the new.
fn parse_name_status(text: &str) -> Vec<FileChange> {
    let mut fields = text.split('\0').filter(|field| !field.is_empty());
    let mut changes = Vec::new();
    while let Some(code) = fields.next() {
        let status = code.chars().next().unwrap_or('M');
        let mut path = fields.next().unwrap_or_default().to_string();
        if matches!(status, 'R' | 'C') {
            path = fields.next().unwrap_or_default().to_string();
        }
        changes.push(FileChange {
            path,
            status: if status == 'C' { 'A' } else { status },
            added: None,
            removed: None,
        });
    }
    changes
}

/// `git diff --numstat -z`: counts and a path, or for a rename counts, an
/// empty path, then the old and new paths. Binary files count as `-`.
fn parse_numstat(text: &str) -> Vec<(String, Option<usize>, Option<usize>)> {
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
        counts.push((path, added.parse().ok(), removed.parse().ok()));
    }
    counts
}

fn git(directory: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .current_dir(directory)
        .args(args)
        .stdin(Stdio::null())
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .env_remove("GIT_COMMON_DIR")
        .env_remove("GIT_PREFIX")
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "Git is not installed, so Jackalope cannot keep a separate copy of this work."
                    .into()
            } else {
                format!("Could not run git: {error}")
            }
        })
}

fn stderr_text(output: &Output) -> String {
    let text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if text.is_empty() {
        format!("Git exited with status {}", output.status)
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "jackalope-cli-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_nanos())
                    .unwrap_or(0)
            ));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn home_and_drive_roots_are_refused() {
        let home = home_dir().expect("home");
        assert!(refuses_init(&home));
        let scratch = TempDir::new("root-check");
        assert!(!refuses_init(&scratch.0));
    }

    #[test]
    fn initialize_commits_project_files_and_leaves_secrets_untracked() {
        let scratch = TempDir::new("init");
        std::fs::write(scratch.0.join("main.txt"), "hello").unwrap();
        std::fs::write(scratch.0.join(".env"), "SECRET=1").unwrap();
        std::fs::create_dir(scratch.0.join("src")).unwrap();
        std::fs::write(scratch.0.join("src").join("lib.rs"), "fn main() {}\n").unwrap();

        let notice = initialize_repository(&scratch.0).unwrap();
        assert!(notice.contains("initial commit"));
        assert!(notice.contains(".gitignore"));
        assert!(toplevel(&scratch.0).unwrap().is_some());

        let listed = git(&scratch.0, &["ls-files"]).unwrap();
        let files = String::from_utf8_lossy(&listed.stdout);
        assert!(files.lines().any(|line| line == "main.txt"));
        assert!(files
            .lines()
            .any(|line| line.replace('\\', "/") == "src/lib.rs"));
        assert!(files.lines().any(|line| line == ".gitignore"));
        assert!(!files.lines().any(|line| line == ".env"));

        let head = git(&scratch.0, &["rev-parse", "--verify", "HEAD"]).unwrap();
        assert!(head.status.success(), "a worktree needs a commit");
    }

    #[test]
    fn changes_list_edits_renames_and_new_files_with_counts() {
        let scratch = TempDir::new("changes");
        std::fs::write(scratch.0.join("keep.txt"), "one\ntwo\n").unwrap();
        std::fs::write(scratch.0.join("old.txt"), "same\nlines\nhere\n").unwrap();
        initialize_repository(&scratch.0).unwrap();
        std::fs::write(scratch.0.join("keep.txt"), "one\n2\nthree\n").unwrap();
        git(&scratch.0, &["mv", "old.txt", "new.txt"]).unwrap();
        std::fs::write(scratch.0.join("fresh.txt"), "a\nb\n").unwrap();

        let path = scratch.0.to_string_lossy().into_owned();
        let changes = changes(&path, &path).unwrap();
        let find = |name: &str| changes.iter().find(|change| change.path == name).unwrap();
        assert_eq!(
            (
                find("keep.txt").status,
                find("keep.txt").added,
                find("keep.txt").removed
            ),
            ('M', Some(2), Some(1))
        );
        assert_eq!(find("new.txt").status, 'R');
        assert_eq!(
            (find("fresh.txt").status, find("fresh.txt").added),
            ('?', Some(2))
        );

        let diff = file_diff(&path, &path, find("keep.txt"));
        assert!(diff[0].starts_with("@@"));
        assert!(diff.iter().any(|line| line == "+three"));
        let fresh = file_diff(&path, &path, find("fresh.txt"));
        assert!(fresh.iter().any(|line| line == "+b"));
    }

    #[test]
    fn an_empty_directory_gets_an_empty_commit_and_no_ignore_file() {
        let scratch = TempDir::new("empty");
        let notice = initialize_repository(&scratch.0).unwrap();
        assert!(notice.contains("empty initial commit"));
        assert!(!scratch.0.join(".gitignore").exists());
        assert!(git(&scratch.0, &["rev-parse", "--verify", "HEAD"])
            .unwrap()
            .status
            .success());
    }

    #[test]
    fn an_existing_ignore_file_is_left_alone() {
        let scratch = TempDir::new("ignore");
        std::fs::write(scratch.0.join(".gitignore"), "custom\n").unwrap();
        std::fs::write(scratch.0.join("keep.txt"), "ok").unwrap();
        initialize_repository(&scratch.0).unwrap();
        let ignore = std::fs::read_to_string(scratch.0.join(".gitignore")).unwrap();
        assert_eq!(ignore, "custom\n");
    }
}
