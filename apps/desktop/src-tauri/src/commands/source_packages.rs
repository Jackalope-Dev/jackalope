//! Swift package checkouts for Xcode projects, shared between a project's task worktrees.
//!
//! Xcode resolves packages into `DerivedData/<project>-<hash>/SourcePackages`, keyed by the
//! checkout's path, so every worktree fetches every package again. Task commands get a
//! per-worktree folder for those checkouts in `JACKALOPE_SPM_CACHE` (and a DerivedData folder
//! in `JACKALOPE_DERIVED_DATA`). After a successful setup or check, Jackalope keeps a
//! copy-on-write snapshot of that folder in its data directory, keyed by the project's
//! `Package.resolved` files, and seeds the next fresh worktree whose pins match from it.
//! Each worktree owns its clone, so concurrent builds never share one checkout folder.

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Mutex,
};

use sha2::{Digest, Sha256};

use super::{dependency_clone, tasks::preparation};

/// Workspace-relative folder exported as `JACKALOPE_DERIVED_DATA`.
pub(in crate::commands) const DERIVED_DATA: &str = ".jackalope/DerivedData";
/// Workspace-relative folder exported as `JACKALOPE_SPM_CACHE`. It is where
/// `-derivedDataPath "$JACKALOPE_DERIVED_DATA"` puts packages too, so either flag reuses it.
pub(in crate::commands) const SOURCE_PACKAGES: &str = ".jackalope/DerivedData/SourcePackages";
/// Snapshots kept per project; older ones are removed when a new one is saved.
const KEPT: usize = 3;

/// Serializes snapshot writes, reads and pruning inside this process.
static STORE: Mutex<()> = Mutex::new(());

/// The variables task commands get for Xcode builds in `workspace`.
pub(in crate::commands) fn environment(workspace: &Path) -> [(&'static str, PathBuf); 2] {
    [
        ("JACKALOPE_DERIVED_DATA", workspace.join(DERIVED_DATA)),
        ("JACKALOPE_SPM_CACHE", workspace.join(SOURCE_PACKAGES)),
    ]
}

#[derive(Debug, PartialEq)]
pub(in crate::commands) enum Restore {
    /// The worktree's package folder is now a clone of a matching snapshot.
    Restored,
    /// No Xcode `Package.resolved`, no matching snapshot, or a folder already there.
    Nothing,
    /// The volume cannot make copy-on-write copies.
    Unsupported,
    Failed(String),
}

/// Seeds `workspace`'s package folder from the snapshot matching its `Package.resolved`
/// files, if there is one and the folder does not exist yet.
pub(in crate::commands) fn restore(data: &Path, project: &Path, workspace: &Path) -> Restore {
    let Some((key, _)) = resolution(workspace) else {
        return Restore::Nothing;
    };
    let target = workspace.join(SOURCE_PACKAGES);
    let _store = STORE.lock();
    let seed = store(data, project).join(&key);
    if !seed.is_dir() || std::fs::symlink_metadata(&target).is_ok() {
        return Restore::Nothing;
    }
    preparation::exclude_marker(workspace);
    if let Err(error) = std::fs::create_dir_all(workspace.join(DERIVED_DATA)) {
        return Restore::Failed(error.to_string());
    }
    match dependency_clone::clone_swiftpm_state(&seed, &target, &target) {
        Ok(()) => {}
        Err(error) if dependency_clone::is_unsupported(&error) => return Restore::Unsupported,
        Err(error) => return Restore::Failed(error.to_string()),
    }
    if let Err(reason) = dependency_clone::relocatable(&[project], workspace, &target) {
        let _ = std::fs::remove_dir_all(&target);
        return Restore::Failed(reason);
    }
    touch(&seed);
    Restore::Restored
}

/// Saves `workspace`'s package folder as the snapshot for its `Package.resolved` files when
/// it holds exactly those pins and no snapshot exists yet. Returns whether one was saved.
pub(in crate::commands) fn capture(data: &Path, project: &Path, workspace: &Path) -> bool {
    let Some((key, pins)) = resolution(workspace) else {
        return false;
    };
    let source = workspace.join(SOURCE_PACKAGES);
    if !std::fs::symlink_metadata(&source).is_ok_and(|metadata| metadata.is_dir())
        || dependency_clone::swiftpm_portable(&source).is_err()
        || checked_out(&source).as_ref() != Some(&pins)
    {
        return false;
    }
    let _store = STORE.lock();
    let folder = store(data, project);
    let seed = folder.join(&key);
    if seed.is_dir() {
        touch(&seed);
        return false;
    }
    if std::fs::create_dir_all(&folder).is_err() {
        return false;
    }
    let staging = folder.join(format!(".staging-{}", uuid::Uuid::new_v4().simple()));
    // Recorded paths name the snapshot's final place before it takes that name.
    if dependency_clone::clone_swiftpm_state(&source, &staging, &seed).is_err() {
        return false;
    }
    if std::fs::rename(&staging, &seed).is_err() {
        let _ = std::fs::remove_dir_all(&staging);
        return false;
    }
    prune(&folder);
    true
}

/// The snapshot folder for one project, named by a digest of its checkout path.
fn store(data: &Path, project: &Path) -> PathBuf {
    let project = dunce::canonicalize(project).unwrap_or_else(|_| project.to_path_buf());
    let digest = Sha256::digest(project.to_string_lossy().as_bytes());
    data.join("source-packages").join(hex(&digest[..8]))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A key for the workspace's Xcode `Package.resolved` files (those inside an `.xcodeproj` or
/// `.xcworkspace`) and the pins they name, as `identity@revision`. `None` when there are none
/// or one cannot be read.
fn resolution(workspace: &Path) -> Option<(String, BTreeSet<String>)> {
    let files: Vec<String> = preparation::dependency_inputs(workspace)?
        .into_iter()
        .filter(|path| {
            path.ends_with("xcshareddata/swiftpm/Package.resolved")
                && (path.contains(".xcodeproj/") || path.contains(".xcworkspace/"))
        })
        .collect();
    if files.is_empty() {
        return None;
    }
    let mut hash = Sha256::new();
    hash.update(b"source-packages-v1\0");
    let mut pins = BTreeSet::new();
    for file in files {
        let bytes = std::fs::read(workspace.join(&file)).ok()?;
        hash.update(file.as_bytes());
        hash.update([0]);
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(&bytes);
        let resolved: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        for pin in resolved["pins"].as_array()? {
            pins.insert(format!(
                "{}@{}",
                pin["identity"].as_str()?.to_ascii_lowercase(),
                pin["state"]["revision"].as_str()?
            ));
        }
    }
    Some((hex(&hash.finalize()[..16]), pins))
}

/// The pins SwiftPM recorded as checked out in a package folder, as `identity@revision`.
fn checked_out(folder: &Path) -> Option<BTreeSet<String>> {
    let text = std::fs::read(folder.join("workspace-state.json")).ok()?;
    let state: serde_json::Value = serde_json::from_slice(&text).ok()?;
    state["object"]["dependencies"]
        .as_array()?
        .iter()
        .map(|dependency| {
            Some(format!(
                "{}@{}",
                dependency["packageRef"]["identity"]
                    .as_str()?
                    .to_ascii_lowercase(),
                dependency["state"]["checkoutState"]["revision"].as_str()?
            ))
        })
        .collect()
}

fn touch(path: &Path) {
    if let Ok(folder) = std::fs::File::open(path) {
        let _ = folder.set_modified(std::time::SystemTime::now());
    }
}

/// Keeps the most recently used snapshots and removes the rest, including staging folders
/// an interrupted save left behind.
fn prune(folder: &Path) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    let mut seeds = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with(".staging-") {
            let _ = std::fs::remove_dir_all(&path);
            continue;
        }
        let used = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        seeds.push((used, path));
    }
    seeds.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in seeds.into_iter().skip(KEPT) {
        let _ = std::fs::remove_dir_all(path);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    const REVISION: &str = "e85f2b4a8dfa0f242889f45236f3867d16e40480";

    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!("jackalope-spm-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        dunce::canonicalize(path).unwrap()
    }

    fn resolved(workspace: &Path, revision: &str) {
        let folder = workspace.join("App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("Package.resolved"),
            serde_json::json!({"pins":[{"identity":"Files","kind":"remoteSourceControl","location":"https://github.com/JohnSundell/Files","state":{"revision":revision,"version":"4.3.0"}}],"version":3}).to_string(),
        )
        .unwrap();
    }

    /// The layout Xcode 27 leaves in `SourcePackages` for one remote package, with the
    /// checkout's Git metadata naming the repository by absolute path.
    fn packages(workspace: &Path, revision: &str) -> PathBuf {
        let folder = workspace.join(SOURCE_PACKAGES);
        let repository = folder.join("repositories/Files-065eb39a");
        let git = folder.join("checkouts/Files/.git");
        std::fs::create_dir_all(repository.join("objects")).unwrap();
        std::fs::create_dir_all(git.join("objects/info")).unwrap();
        std::fs::create_dir_all(folder.join("prebuilts/files/1.0-MacroSupport")).unwrap();
        std::fs::write(
            folder.join("checkouts/Files/Files.swift"),
            "struct Files {}",
        )
        .unwrap();
        std::fs::write(
            git.join("objects/info/alternates"),
            format!("{}\n", repository.join("objects").display()),
        )
        .unwrap();
        std::fs::write(
            git.join("config"),
            format!(
                "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = {}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n",
                repository.display()
            ),
        )
        .unwrap();
        std::fs::write(
            folder.join("workspace-state.json"),
            serde_json::json!({"object":{"artifacts":[],"dependencies":[{"basedOn":null,"packageRef":{"identity":"files","kind":"remoteSourceControl","location":"https://github.com/JohnSundell/Files","name":"Files"},"state":{"checkoutState":{"revision":revision,"version":"4.3.0"},"name":"sourceControlCheckout"},"subpath":"Files"}],"prebuilts":[{"identity":"files","checkoutPath":folder.join("checkouts/Files"),"path":folder.join("prebuilts/files/1.0-MacroSupport")}]},"version":7}).to_string(),
        )
        .unwrap();
        folder
    }

    #[test]
    fn a_resolved_worktree_seeds_the_next_one_with_its_own_repository_paths() {
        let root = scratch();
        let data = root.join("data");
        let project = root.join("project");
        let first = root.join("first");
        let second = root.join("second");
        for workspace in [&project, &first, &second] {
            std::fs::create_dir_all(workspace).unwrap();
            resolved(workspace, REVISION);
        }
        assert_eq!(restore(&data, &project, &first), Restore::Nothing);
        packages(&first, REVISION);
        if !capture(&data, &project, &first) {
            // A volume without copy-on-write clones saves nothing; that is the whole story.
            assert!(dependency_clone::clone_tree(&first, &root.join("probe"))
                .is_err_and(|error| dependency_clone::is_unsupported(&error)));
            std::fs::remove_dir_all(root).unwrap();
            return;
        }
        assert!(
            !capture(&data, &project, &first),
            "one snapshot per resolution"
        );
        assert_eq!(restore(&data, &project, &second), Restore::Restored);
        let restored = second.join(SOURCE_PACKAGES);
        assert_eq!(
            std::fs::read_to_string(restored.join("checkouts/Files/Files.swift")).unwrap(),
            "struct Files {}"
        );
        let alternates =
            std::fs::read_to_string(restored.join("checkouts/Files/.git/objects/info/alternates"))
                .unwrap();
        assert_eq!(
            alternates.trim(),
            restored
                .join("repositories/Files-065eb39a/objects")
                .to_string_lossy()
        );
        let config = std::fs::read_to_string(restored.join("checkouts/Files/.git/config")).unwrap();
        assert!(config.contains(&format!(
            "\turl = {}\n",
            restored.join("repositories/Files-065eb39a").display()
        )));
        assert!(config.contains("fetch = +refs/heads/*"));
        let state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(restored.join("workspace-state.json")).unwrap())
                .unwrap();
        let prebuilt = &state["object"]["prebuilts"][0];
        assert_eq!(
            prebuilt["path"].as_str().unwrap(),
            restored
                .join("prebuilts/files/1.0-MacroSupport")
                .to_string_lossy()
        );
        assert_eq!(
            prebuilt["checkoutPath"].as_str().unwrap(),
            restored.join("checkouts/Files").to_string_lossy()
        );
        assert!(restored.join("prebuilts/files/1.0-MacroSupport").is_dir());
        assert!(
            std::fs::read_to_string(
                first
                    .join(SOURCE_PACKAGES)
                    .join("checkouts/Files/.git/config")
            )
            .unwrap()
            .contains(&first.to_string_lossy().into_owned()),
            "rewriting the clone must leave the source untouched"
        );
        assert_eq!(
            restore(&data, &project, &second),
            Restore::Nothing,
            "an existing folder is never replaced"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_folders_holding_exactly_the_pinned_remote_packages_are_saved() {
        let root = scratch();
        let data = root.join("data");
        let workspace = root.join("work");
        std::fs::create_dir_all(&workspace).unwrap();
        assert!(
            resolution(&workspace).is_none(),
            "no Xcode Package.resolved"
        );
        resolved(&workspace, REVISION);
        let folder = packages(&workspace, "0000000000000000000000000000000000000000");
        assert!(!capture(&data, &root, &workspace), "stale checkouts");
        std::fs::remove_dir_all(&folder).unwrap();
        let folder = packages(&workspace, REVISION);
        let state = folder.join("workspace-state.json");
        let text = std::fs::read_to_string(&state).unwrap();
        std::fs::write(&state, text.replace("remoteSourceControl", "fileSystem")).unwrap();
        assert!(
            !capture(&data, &root, &workspace),
            "local packages record paths"
        );
        std::fs::write(
            &state,
            text.replace(&folder.to_string_lossy().into_owned(), "/elsewhere"),
        )
        .unwrap();
        assert!(
            !capture(&data, &root, &workspace),
            "paths outside the folder cannot move with it"
        );
        assert!(!data.join("source-packages").exists());

        let (key, pins) = resolution(&workspace).unwrap();
        assert_eq!(pins, BTreeSet::from([format!("files@{REVISION}")]));
        resolved(&workspace, "1111111111111111111111111111111111111111");
        assert_ne!(resolution(&workspace).unwrap().0, key);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pruning_keeps_the_most_recent_snapshots() {
        let folder = scratch();
        for (index, name) in ["a", "b", "c", "d"].iter().enumerate() {
            let path = folder.join(name);
            std::fs::create_dir(&path).unwrap();
            let used = std::time::SystemTime::UNIX_EPOCH
                + std::time::Duration::from_secs(1_000 + index as u64);
            std::fs::File::open(&path)
                .unwrap()
                .set_modified(used)
                .unwrap();
        }
        std::fs::create_dir(folder.join(".staging-x")).unwrap();
        prune(&folder);
        let mut left: Vec<_> = std::fs::read_dir(&folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["b", "c", "d"]);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
