use super::*;
use std::process::Command;

struct Home {
    root: PathBuf,
}

impl Home {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("jackalope-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        Self {
            root: dunce::canonicalize(root).unwrap(),
        }
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    fn git(&self, folder: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(folder)
            .env("GIT_AUTHOR_NAME", "Fixture")
            .env("GIT_AUTHOR_EMAIL", "fixture@example.com")
            .env("GIT_COMMITTER_NAME", "Fixture")
            .env("GIT_COMMITTER_EMAIL", "fixture@example.com")
            .output()
            .unwrap();
        assert!(output.status.success(), "{args:?}: {output:?}");
    }

    /// A repository at `relative`, with one commit unless `empty`.
    fn repository(&self, relative: &str, empty: bool) -> PathBuf {
        let repo = self.path(relative);
        std::fs::create_dir_all(&repo).unwrap();
        self.git(&repo, &["init", "-q", "-b", "main"]);
        if !empty {
            std::fs::write(repo.join("README.md"), "fixture\n").unwrap();
            self.git(&repo, &["add", "."]);
            self.git(&repo, &["commit", "-q", "-m", "Initial"]);
        }
        repo
    }

    fn inputs(&self) -> Inputs {
        Inputs {
            home: self.root.clone(),
            code_folders: ["Code", "code", "Projects", "Documents"]
                .iter()
                .map(|folder| self.path(folder))
                .collect(),
            editor_files: Vec::new(),
            sessions: Vec::new(),
            projects: Vec::new(),
            temporary: vec![self.path("scratch")],
        }
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn found(scan: &DiscoveryScan) -> Vec<(&str, usize, Vec<&str>)> {
    scan.candidates
        .iter()
        .map(|candidate| {
            (
                candidate.name.as_str(),
                candidate.sessions,
                candidate.sources.clone(),
            )
        })
        .collect()
}

#[test]
fn finds_repositories_from_sessions_code_folders_and_editors() {
    let home = Home::new();
    let atlas = home.repository("Code/atlas", false);
    home.git(
        &atlas,
        &[
            "remote",
            "add",
            "origin",
            "git@github.com:fixture/atlas.git",
        ],
    );
    home.git(
        &atlas,
        &["worktree", "add", "-q", "-b", "feature", "../atlas-feature"],
    );
    std::fs::create_dir_all(atlas.join("src")).unwrap();
    home.repository("Code/group/beacon", false);
    home.repository("Code/group/deeper/hidden", false);
    home.repository("Code/node_modules/dependency", false);
    home.repository("Projects/empty", true);
    let editor = home.repository("elsewhere/comet", false);
    // A project already, and one in a folder macOS guards.
    let existing = home.repository("Code/existing", false);
    let guarded = home.repository("Documents/private", false);
    std::fs::write(home.path("Code/not-a-folder"), "file").unwrap();
    let scratch = home.repository("scratch/throwaway", false);

    let editor_file = home.path("editor/storage.json");
    std::fs::create_dir_all(editor_file.parent().unwrap()).unwrap();
    std::fs::write(
        &editor_file,
        serde_json::json!({
            "windowsState": {"lastActiveWindow": {"folder": format!("file://{}", editor.to_string_lossy().replace(' ', "%20"))}},
            "backupWorkspaces": {"folders": [{"folderUri": "vscode-remote://ssh-remote+box/home/x"}]},
        })
        .to_string(),
    )
    .unwrap();

    let mut inputs = home.inputs();
    inputs.editor_files = vec![editor_file, home.path("missing/storage.json")];
    inputs.projects = vec![existing];
    let now = now_ms();
    inputs.sessions = vec![
        // A worktree folds into its main checkout, and a subfolder into its repository.
        (
            home.path("Code/atlas-feature").to_string_lossy().into(),
            now,
        ),
        (home.path("Code/atlas").to_string_lossy().into(), now - 1000),
        (
            home.path("Code/atlas/src").to_string_lossy().into(),
            now - 2000,
        ),
        (guarded.to_string_lossy().into(), now),
        (home.path("gone").to_string_lossy().into(), now),
        (scratch.to_string_lossy().into(), now),
    ];
    let scan = discover(&inputs, Instant::now() + Duration::from_secs(30));
    assert!(!scan.truncated);
    let names: BTreeSet<_> = found(&scan).iter().map(|(name, _, _)| *name).collect();
    assert_eq!(
        names,
        BTreeSet::from(["atlas", "beacon", "comet", "empty"]),
        "{scan:?}"
    );
    let first = &scan.candidates[0];
    assert_eq!(first.name, "atlas");
    assert_eq!(first.path, atlas.to_string_lossy());
    assert_eq!(first.sessions, 3);
    assert_eq!(first.sources, vec!["folders", "sessions"]);
    assert_eq!(first.remote_host.as_deref(), Some("github.com"));
    assert!(first.has_commits && first.last_commit_at.is_some());
    assert!(first.recommended);
    let comet = scan
        .candidates
        .iter()
        .find(|candidate| candidate.name == "comet")
        .unwrap();
    assert_eq!(comet.sources, vec!["editor"]);
    let empty = scan
        .candidates
        .iter()
        .find(|candidate| candidate.name == "empty")
        .unwrap();
    assert!(!empty.has_commits && !empty.recommended);
    assert_eq!(empty.last_commit_at, None);
    // Fresh commits make beacon and comet worth suggesting too, but only a few are.
    assert_eq!(
        scan.candidates
            .iter()
            .filter(|candidate| candidate.recommended)
            .count(),
        3
    );
}

#[test]
fn guarded_folders_are_never_opened() {
    let home = Home::new();
    for path in [
        "Documents/x",
        "Desktop",
        "downloads/y",
        "Library/Mobile Documents/com~apple~CloudDocs/repo",
        "Pictures",
    ] {
        assert!(protected(&home.path(path), &home.root), "{path}");
    }
    assert!(protected(Path::new("/Volumes/USB/repo"), &home.root));
    assert!(protected(Path::new("relative/path"), &home.root));
    for path in ["Code/x", "Developer", "DocumentsArchive/x"] {
        assert!(!protected(&home.path(path), &home.root), "{path}");
    }
    assert!(!protected(Path::new("/opt/src/repo"), &home.root));
}

#[test]
fn editor_uris_decode_to_local_folders() {
    assert_eq!(
        file_path("file:///Users/me/Code/my%20app"),
        Some(PathBuf::from("/Users/me/Code/my app"))
    );
    assert_eq!(file_path("vscode-remote://ssh-remote+box/x"), None);
    assert_eq!(file_path("file:///bad%zz"), None);
    assert_eq!(file_path("file://relative"), None);
    if cfg!(windows) {
        assert_eq!(
            file_path("file:///c%3A/Users/me/repo"),
            Some(PathBuf::from("c:/Users/me/repo"))
        );
    }
    let home = Home::new();
    let file = home.path("storage.json");
    std::fs::write(&file, b"{not json").unwrap();
    assert!(editor_folders(&file).is_empty());
}

#[test]
fn a_spent_deadline_returns_what_it_has() {
    let home = Home::new();
    home.repository("Code/atlas", false);
    let scan = discover(&home.inputs(), Instant::now());
    assert!(scan.truncated);
    assert!(scan.candidates.is_empty());
}

#[test]
fn agent_conversations_outrank_recency_alone() {
    let now = now_ms();
    assert!(score(5, now - 40 * DAY_MS, now) > score(0, now, now));
    assert!(score(0, now, now) > score(0, now - 30 * DAY_MS, now));
    assert_eq!(score(0, now - 400 * DAY_MS, now), 0);
}

/// Runs discovery against this computer's home folder, without session folders, and prints
/// what it found. Reads directory entries and Git metadata only.
#[test]
#[ignore = "Reads this computer's code folders, editor state and Git metadata"]
fn trial_against_this_computer() {
    let home = crate::commands::platform::home_dir().expect("a home directory");
    let inputs = Inputs::for_home(home);
    let started = Instant::now();
    let scan = discover(&inputs, Instant::now() + BUDGET);
    println!(
        "{} candidates in {:?}, truncated {}",
        scan.candidates.len(),
        started.elapsed(),
        scan.truncated
    );
    for candidate in &scan.candidates {
        println!(
            "{} {:?} commits {} last {:?} remote {:?} recommended {}",
            candidate.name,
            candidate.sources,
            candidate.has_commits,
            candidate.last_commit_at,
            candidate.remote_host,
            candidate.recommended
        );
    }
}
