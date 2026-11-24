use super::*;
use std::{fs, path::PathBuf};

const BASE: &str = include_str!("../pbxproj/fixtures/base.pbxproj");
const CORE: &str = include_str!("../pbxproj/fixtures/core.pbxproj");
const NETWORK: &str = include_str!("../pbxproj/fixtures/network.pbxproj");
const BOTH: &str = include_str!("../pbxproj/fixtures/core_and_network.pbxproj");
const ALPHA: &str = include_str!("../pbxproj/fixtures/bundle_alpha.pbxproj");
const BETA: &str = include_str!("../pbxproj/fixtures/bundle_beta.pbxproj");
const PROJECT: &str = "Demo.xcodeproj/project.pbxproj";

fn git(path: &Path, args: &[&str]) -> String {
    repo::git(path, args, Policy::Isolated).unwrap()
}

/// A repository whose `main` holds the base project and whose `ours` and
/// `theirs` branches each write `files` over it.
fn repository(ours: &[(&str, &str)], theirs: &[(&str, &str)]) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "jackalope-merge-tree-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(path.join("Demo.xcodeproj")).unwrap();
    git(&path, &["init", "--initial-branch=main"]);
    git(&path, &["config", "user.name", "Fixture"]);
    git(&path, &["config", "user.email", "fixture@example.invalid"]);
    git(&path, &["config", "core.autocrlf", "false"]);
    fs::write(path.join(PROJECT), BASE).unwrap();
    fs::write(path.join("README.md"), "base\n").unwrap();
    git(&path, &["add", "."]);
    git(&path, &["commit", "-m", "base"]);
    for (branch, files) in [("ours", ours), ("theirs", theirs)] {
        git(&path, &["switch", "-c", branch, "main"]);
        for (file, text) in files {
            fs::write(path.join(file), text).unwrap();
        }
        git(&path, &["add", "."]);
        git(&path, &["commit", "--allow-empty", "-m", branch]);
    }
    git(&path, &["switch", "ours"]);
    path
}

fn file_at(path: &Path, tree: &str, file: &str) -> String {
    git(path, &["show", &format!("{tree}:{file}")])
}

#[test]
fn concurrent_project_changes_merge_cleanly_where_git_alone_conflicts() {
    let path = repository(
        &[(PROJECT, CORE), ("Settings.swift", "struct Settings {}\n")],
        &[(PROJECT, NETWORK), ("Profile.swift", "struct Profile {}\n")],
    );
    let plain = repo::output(
        &path,
        &[
            "merge-tree",
            "--write-tree",
            "--name-only",
            "ours",
            "theirs",
        ],
        Policy::Isolated,
    )
    .unwrap();
    assert_eq!(plain.status.code(), Some(1));
    let merged = merge_tree(
        &path,
        &["-c", "merge.conflictStyle=diff3"],
        "ours",
        "theirs",
        Policy::Inspection,
    )
    .unwrap();
    assert!(merged.conflicts.is_empty(), "{:?}", merged.conflicts);
    assert_eq!(
        file_at(&path, &merged.tree, PROJECT).trim_end(),
        BOTH.trim_end()
    );
    assert_eq!(
        file_at(&path, &merged.tree, "Profile.swift"),
        "struct Profile {}"
    );
    assert_eq!(
        file_at(&path, &merged.tree, "Settings.swift"),
        "struct Settings {}"
    );
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn real_project_conflicts_keep_gits_result_and_other_paths_still_conflict() {
    let path = repository(&[(PROJECT, ALPHA)], &[(PROJECT, BETA)]);
    let merged = merge_tree(
        &path,
        &["-c", "merge.conflictStyle=diff3"],
        "ours",
        "theirs",
        Policy::Inspection,
    )
    .unwrap();
    assert_eq!(merged.conflicts, [PROJECT]);
    assert!(file_at(&path, &merged.tree, PROJECT).contains("\n||||||| "));
    fs::remove_dir_all(path).unwrap();

    // Beside another conflict, the project file still merges and only the other remains.
    let path = repository(
        &[(PROJECT, CORE), ("README.md", "ours\n")],
        &[(PROJECT, NETWORK), ("README.md", "theirs\n")],
    );
    let merged = merge_tree(&path, &[], "ours", "theirs", Policy::Inspection).unwrap();
    assert_eq!(merged.conflicts, ["README.md"]);
    assert_eq!(
        file_at(&path, &merged.tree, PROJECT).trim_end(),
        BOTH.trim_end()
    );
    assert!(file_at(&path, &merged.tree, "README.md").contains("<<<<<<< "));
    fs::remove_dir_all(path).unwrap();

    // A project file deleted on one side keeps Git's modify/delete conflict.
    let path = repository(&[(PROJECT, CORE)], &[]);
    git(&path, &["switch", "theirs"]);
    git(&path, &["rm", "-q", PROJECT]);
    git(&path, &["commit", "-m", "remove the project"]);
    let merged = merge_tree(&path, &[], "ours", "theirs", Policy::Inspection).unwrap();
    assert_eq!(merged.conflicts, [PROJECT]);
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn a_stopped_git_merge_finishes_with_the_structured_project() {
    let path = repository(&[(PROJECT, CORE)], &[(PROJECT, NETWORK)]);
    assert!(!repo::succeeds(
        &path,
        &["merge", "--no-ff", "--no-edit", "theirs"],
        Policy::Isolated
    ));
    assert!(resolve_project_files(&path).unwrap());
    assert_eq!(fs::read_to_string(path.join(PROJECT)).unwrap(), BOTH);
    git(&path, &["commit", "--no-edit"]);
    assert_eq!(file_at(&path, "HEAD", PROJECT).trim_end(), BOTH.trim_end());
    assert_eq!(
        git(&path, &["rev-list", "--count", "--merges", "HEAD"]),
        "1"
    );
    fs::remove_dir_all(path).unwrap();

    let path = repository(&[(PROJECT, ALPHA)], &[(PROJECT, BETA)]);
    assert!(!repo::succeeds(
        &path,
        &["merge", "--no-ff", "--no-edit", "theirs"],
        Policy::Isolated
    ));
    assert!(!resolve_project_files(&path).unwrap());
    assert!(fs::read_to_string(path.join(PROJECT))
        .unwrap()
        .contains("<<<<<<< "));
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn conflicted_entries_read_mode_object_stage_and_path() {
    assert_eq!(
        parse_stage("100644 0123abcd 2\tA B/project.pbxproj"),
        Some(Stage {
            mode: "100644".into(),
            object: "0123abcd".into(),
            stage: 2,
            path: "A B/project.pbxproj".into(),
        })
    );
    assert_eq!(parse_stage("100644 0123abcd\tfile"), None);
    assert_eq!(parse_stage("100644 0123abcd 2\t"), None);
}
