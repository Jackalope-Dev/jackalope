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
