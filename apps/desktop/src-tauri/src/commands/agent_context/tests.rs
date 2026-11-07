use super::*;
use std::io::Seek;
use std::path::PathBuf;
use std::process::Command;

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scratch() -> Scratch {
    let path = std::env::temp_dir().join(format!("jackalope-context-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    Scratch(dunce::canonicalize(&path).unwrap())
}

fn git(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "core.autocrlf=false",
        ])
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn manifest(resources: &[(&str, &str, &str)]) -> String {
    let resources: Vec<serde_json::Value> = resources
        .iter()
        .map(|(kind, name, binding)| serde_json::json!({"kind": kind, "name": name, "binding": binding}))
        .collect();
    serde_json::json!({
        "version": 1,
        "accountId": "account",
        "prefix": "shop",
        "resources": resources,
        "wrangler": "{}",
        "dashboard": "https://dash.cloudflare.com/account",
        "updatedAt": "2026-11-06T00:00:00Z",
    })
    .to_string()
}

/// A project with one commit, its Jackalope context and a task worktree.
fn project_with_worktree() -> (Scratch, PathBuf, PathBuf) {
    let root = scratch();
    let project = root.0.join("project");
    std::fs::create_dir_all(project.join(".jackalope/attachments")).unwrap();
    git(&project, &["init", "-q", "-b", "main"]);
    std::fs::write(project.join("README.md"), "hello\n").unwrap();
    git(&project, &["add", "README.md"]);
    git(&project, &["commit", "-qm", "base"]);
    // Pasting an image or writing the manifest excludes .jackalope locally.
    crate::commands::tasks::preparation::exclude_marker(&project);
    std::fs::write(
        project.join(".jackalope/cloudflare.json"),
        manifest(&[("r2", "shop-assets", "ASSETS"), ("d1", "shop-db", "DB")]),
    )
    .unwrap();
    std::fs::write(
        project.join(".jackalope/attachments/named.png"),
        b"\x89PNG named",
    )
    .unwrap();
    std::fs::write(
        project.join(".jackalope/attachments/other.png"),
        b"\x89PNG other",
    )
    .unwrap();
    let workspace = project.join(".worktrees/task");
    git(
        &project,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "jackalope/task",
            workspace.to_str().unwrap(),
        ],
    );
    (root, project, workspace)
}

#[test]
fn context_reaches_a_worktree_stays_out_of_git_and_is_refreshed_each_attempt() {
    let (_root, project, workspace) = project_with_worktree();
    let prompt = format!(
        "Match this.\nAttached image: {}",
        project.join(".jackalope/attachments/named.png").display()
    );
    assert!(!workspace.join(".jackalope/cloudflare.json").exists());
    let placed = place(&project, &workspace, &prompt).unwrap();
    assert_eq!(
        placed,
        [
            ".jackalope/cloudflare.json",
            ".jackalope/attachments/named.png"
        ]
    );
    assert_eq!(
        std::fs::read(workspace.join(".jackalope/attachments/named.png")).unwrap(),
        b"\x89PNG named"
    );
    assert!(
        !workspace.join(".jackalope/attachments/other.png").exists(),
        "only attachments the prompt names are copied"
    );
    // Nothing for the agent to notice, commit or snapshot.
    assert_eq!(
        git(
            &workspace,
            &["status", "--porcelain", "--untracked-files=all"]
        ),
        ""
    );
    git(&workspace, &["add", "-A"]);
    assert_eq!(git(&workspace, &["diff", "--cached", "--name-only"]), "");

    // The next attempt replaces an edited copy and follows the project.
    std::fs::write(workspace.join(".jackalope/cloudflare.json"), "{}").unwrap();
    let current = manifest(&[("kv", "shop-config", "CONFIG")]);
    std::fs::write(project.join(".jackalope/cloudflare.json"), &current).unwrap();
    place(&project, &workspace, "No attachments").unwrap();
    assert_eq!(
        std::fs::read_to_string(workspace.join(".jackalope/cloudflare.json")).unwrap(),
        current
    );
    std::fs::remove_file(project.join(".jackalope/cloudflare.json")).unwrap();
    assert!(place(&project, &workspace, "").unwrap().is_empty());
    assert!(
        !workspace.join(".jackalope/cloudflare.json").exists(),
        "a manifest the project removed is removed from the workspace"
    );
}

#[test]
fn a_committed_manifest_is_left_to_git() {
    let (_root, project, workspace) = project_with_worktree();
    std::fs::create_dir_all(workspace.join(".jackalope")).unwrap();
    let committed = manifest(&[("workers", "shop", "")]);
    std::fs::write(workspace.join(".jackalope/cloudflare.json"), &committed).unwrap();
    git(&workspace, &["add", "-f", ".jackalope/cloudflare.json"]);
    git(&workspace, &["commit", "-qm", "manifest"]);
    let placed = place(&project, &workspace, "").unwrap();
    assert_eq!(placed, [".jackalope/cloudflare.json"]);
    assert_eq!(
        std::fs::read_to_string(workspace.join(".jackalope/cloudflare.json")).unwrap(),
        committed,
        "placing context never creates a change to a tracked file"
    );
    assert_eq!(git(&workspace, &["status", "--porcelain"]), "");
}

#[test]
fn the_project_checkout_itself_needs_no_copy() {
    let (_root, project, _workspace) = project_with_worktree();
    let prompt = "Attached image: .jackalope/attachments/named.png";
    assert_eq!(
        place(&project, &project, prompt).unwrap(),
        [
            ".jackalope/cloudflare.json",
            ".jackalope/attachments/named.png"
        ]
    );
}

#[test]
fn the_computer_upload_carries_context_but_not_other_ignored_files() {
    let (_root, project, workspace) = project_with_worktree();
    let prompt = "Attached image: .jackalope/attachments/named.png";
    place(&project, &workspace, prompt).unwrap();
    std::fs::write(workspace.join(".jackalope/prepared.json"), "{}").unwrap();
    std::fs::create_dir_all(workspace.join(".jackalope/artifacts/screenshots")).unwrap();
    std::fs::write(
        workspace.join(".jackalope/artifacts/screenshots/a.png"),
        b"x",
    )
    .unwrap();
    let mut file = crate::commands::computers::runs::archive(&workspace, &[]).unwrap();
    file.seek(std::io::SeekFrom::Start(0)).unwrap();
    let mut names: Vec<String> = tar::Archive::new(file)
        .entries()
        .unwrap()
        .map(|entry| {
            entry
                .unwrap()
                .path()
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    names.sort();
    assert_eq!(
        names,
        [
            ".jackalope/attachments/named.png",
            ".jackalope/cloudflare.json",
            "README.md"
        ]
    );
}

#[test]
fn changes_from_a_computer_keep_new_output_and_drop_context_edits() {
    let (_root, project, workspace) = project_with_worktree();
    place(&project, &workspace, "").unwrap();
    // The computer's copy: every uploaded file committed as the base, as agent.py does.
    let remote = project.parent().unwrap().join("remote");
    std::fs::create_dir_all(remote.join(".jackalope")).unwrap();
    std::fs::write(remote.join("README.md"), "hello\n").unwrap();
    std::fs::copy(
        workspace.join(".jackalope/cloudflare.json"),
        remote.join(".jackalope/cloudflare.json"),
    )
    .unwrap();
    git(&remote, &["init", "-q"]);
    git(&remote, &["add", "-A", "-f"]);
    git(&remote, &["commit", "-qm", "base"]);
    std::fs::write(remote.join("README.md"), "hello\nworld\n").unwrap();
    std::fs::write(remote.join(".jackalope/cloudflare.json"), "{}").unwrap();
    std::fs::create_dir_all(remote.join(".jackalope/artifacts/screenshots")).unwrap();
    std::fs::write(
        remote.join(".jackalope/artifacts/screenshots/s.png"),
        b"\x89PNG",
    )
    .unwrap();
    std::fs::create_dir_all(remote.join(".jackalope/attachments")).unwrap();
    std::fs::write(remote.join(".jackalope/attachments/new.png"), b"\x89PNG").unwrap();
    git(&remote, &["add", "-A"]);
    let patch = Command::new("git")
        .args(["diff", "--cached", "--binary", "--full-index", "HEAD"])
        .current_dir(&remote)
        .output()
        .unwrap()
        .stdout;
    let before = std::fs::read(workspace.join(".jackalope/cloudflare.json")).unwrap();
    let only_context = Command::new("git")
        .args(["diff", "--cached", "--binary", "--full-index", "HEAD", "--"])
        .arg(".jackalope/cloudflare.json")
        .current_dir(&remote)
        .output()
        .unwrap()
        .stdout;
    assert!(!only_context.is_empty());
    crate::commands::computers::runs::apply(&workspace, &only_context)
        .expect("a patch that only touches context applies as nothing");
    crate::commands::computers::runs::apply(&workspace, &patch).unwrap();
    assert_eq!(
        std::fs::read_to_string(workspace.join("README.md"))
            .unwrap()
            .replace("\r\n", "\n"),
        "hello\nworld\n"
    );
    assert!(workspace
        .join(".jackalope/artifacts/screenshots/s.png")
        .is_file());
    assert_eq!(
        std::fs::read(workspace.join(".jackalope/cloudflare.json")).unwrap(),
        before,
        "an agent's edit to context does not come back"
    );
    assert!(!workspace.join(".jackalope/attachments/new.png").exists());
    // Output under .jackalope stays out of the attempt's commit.
    git(&workspace, &["add", "-A"]);
    assert_eq!(
        git(&workspace, &["diff", "--cached", "--name-only"]),
        "README.md"
    );
}

#[test]
fn the_launch_summary_names_resources_within_its_budget() {
    let root = scratch();
    let workspace = &root.0;
    assert_eq!(summary(workspace), "");
    std::fs::create_dir_all(workspace.join(".jackalope")).unwrap();
    std::fs::write(
        workspace.join(".jackalope/cloudflare.json"),
        manifest(&[
            ("r2", "shop-assets", "ASSETS"),
            ("d1", "shop-db", "DB"),
            ("workers", "shop", ""),
        ]),
    )
    .unwrap();
    let text = summary(workspace);
    assert!(
        text.contains(
            "R2 bucket shop-assets bound as ASSETS; D1 database shop-db bound as DB; Worker shop."
        ),
        "{text}"
    );
    assert!(text.contains(".jackalope/cloudflare.json"));
    assert!(text.len() <= SUMMARY_LIMIT);

    let many: Vec<(String, String)> = (0..200)
        .map(|index| {
            (
                format!("shop-bucket-{index}-{}", "x".repeat(40)),
                format!("BUCKET_{index}"),
            )
        })
        .collect();
    let resources: Vec<(&str, &str, &str)> = many
        .iter()
        .map(|(name, binding)| ("r2", name.as_str(), binding.as_str()))
        .collect();
    std::fs::write(
        workspace.join(".jackalope/cloudflare.json"),
        manifest(&resources),
    )
    .unwrap();
    let text = summary(workspace);
    assert!(text.len() <= SUMMARY_LIMIT, "{}", text.len());
    assert!(text.contains(" more."), "{text}");
    assert!(text.ends_with("snippet: .jackalope/cloudflare.json.\n"));

    std::fs::write(workspace.join(".jackalope/cloudflare.json"), "not json").unwrap();
    assert_eq!(summary(workspace), "");
}

#[test]
fn project_instructions_join_the_launch_once_and_bounded() {
    let root = scratch();
    let workspace = &root.0;
    assert_eq!(launch_section(workspace, None, "Fix it"), "");
    assert_eq!(launch_section(workspace, Some("  "), "Fix it"), "");
    let section = launch_section(workspace, Some(" Use pnpm. "), "Fix it");
    assert_eq!(
        section,
        "\nProject instructions from the person:\nUse pnpm.\n"
    );
    assert_eq!(
        launch_section(
            workspace,
            Some("Use pnpm."),
            "Fix it\n\n[Project Guidelines]:\nUse pnpm."
        ),
        "",
        "instructions a schedule or remote task already added are not repeated"
    );
    let long = "y".repeat(INSTRUCTIONS_LIMIT + 50);
    let section = launch_section(workspace, Some(&long), "Fix it");
    assert!(section.contains(&"y".repeat(INSTRUCTIONS_LIMIT)));
    assert!(!section.contains(&"y".repeat(INSTRUCTIONS_LIMIT + 1)));
    assert!(section.contains("(shortened)"));
}

#[test]
fn prompts_point_at_the_workspace_copy_of_pasted_images() {
    let windows = Path::new("C:\\Users\\me\\Shop");
    assert_eq!(
        portable_prompt(
            "Fix\nAttached image: c:\\users\\me\\shop\\.jackalope\\attachments\\a.png\nAttached file: C:\\Users\\me\\notes.txt",
            windows
        ),
        "Fix\nAttached image: .jackalope/attachments/a.png\nAttached file: C:\\Users\\me\\notes.txt"
    );
    assert_eq!(
        portable_prompt(
            "Attached image: /home/me/shop/.jackalope/attachments/b.png",
            Path::new("/home/me/shop/")
        ),
        "Attached image: .jackalope/attachments/b.png"
    );
    assert_eq!(portable_prompt("Plain", windows), "Plain");
}

#[test]
fn context_paths_are_recognised_for_permission_checks() {
    assert!(is_context_path(".jackalope/cloudflare.json"));
    assert!(is_context_path("./.jackalope\\attachments\\a.png"));
    assert!(is_context_path(".JACKALOPE/Cloudflare.json"));
    assert!(!is_context_path(".jackalope/artifacts/screenshots/a.png"));
    assert!(!is_context_path(".jackalope/autonomy.json"));
    assert!(!is_context_path("src/cloudflare.json"));
}
