//! Seeds a fresh task worktree with the project checkout's installed dependency folders
//! as copy-on-write clones, so the setup command that follows finds them current.
//!
//! Cloning never falls back to copying bytes: a volume or platform without block cloning
//! leaves the worktree untouched and the setup command installs in full. The tree cloning
//! adapts oh-my-pi's `crates/iso` (MIT); see `public/licenses/oh-my-pi.txt`.

use std::{
    io,
    path::{Component, Path, PathBuf},
};

use super::tasks::preparation;

/// Which installed folder a manifest marks, and the rules that make its clone safe.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    /// `node_modules` beside `package.json`.
    Node,
    /// CocoaPods' `Pods` beside `Podfile.lock`. Its project and configuration files name
    /// paths relative to `${PODS_ROOT}`, which a check confirms before the clone is kept.
    Pods,
    /// Carthage's built frameworks beside `Cartfile.resolved`.
    Carthage,
    /// A Swift package's resolved checkouts beside `Package.resolved` and `Package.swift`.
    /// Only SwiftPM's resolution state is cloned: `.build`'s build products record the
    /// path they were built at.
    SwiftPackage,
}

struct Cacheable {
    manifest: &'static str,
    folder: &'static str,
    kind: Kind,
}

/// Installed folders that are safe to seed. Python environments and build trees such as
/// Cargo's `target/` record absolute paths or are fingerprinted by location, so they are
/// left to the setup command.
const TABLE: [Cacheable; 4] = [
    Cacheable {
        manifest: "package.json",
        folder: "node_modules",
        kind: Kind::Node,
    },
    Cacheable {
        manifest: "Podfile.lock",
        folder: "Pods",
        kind: Kind::Pods,
    },
    Cacheable {
        manifest: "Cartfile.resolved",
        folder: "Carthage/Build",
        kind: Kind::Carthage,
    },
    Cacheable {
        manifest: "Package.resolved",
        folder: ".build",
        kind: Kind::SwiftPackage,
    },
];
/// Caches inside a cloned `node_modules` that may record the checkout's absolute paths and
/// are rebuilt on demand.
const CACHES: [&str; 4] = [".cache", ".vite", ".vite-temp", ".tmp"];
/// Files that mark a directory whose contents only work at the path they were made at.
const NON_RELOCATABLE: [&str; 2] = ["pyvenv.cfg", "CMakeCache.txt"];
/// Generated project and script files in `Pods` that would carry an absolute path.
const PODS_TEXT: [&str; 7] = [
    "pbxproj",
    "xcconfig",
    "sh",
    "xcfilelist",
    "modulemap",
    "json",
    "lock",
];
const MAX_ENTRIES: usize = 2_000_000;
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;
/// The parts of a SwiftPM scratch folder (`.build`, or Xcode's `SourcePackages`) that
/// hold resolution rather than build output.
const SWIFTPM_STATE: [&str; 5] = [
    "checkouts",
    "repositories",
    "artifacts",
    "prebuilts",
    "workspace-state.json",
];

#[derive(Debug, Default, PartialEq)]
pub(super) struct DependencyClone {
    /// Workspace-relative folders now present as clones.
    pub cloned: Vec<String>,
    /// Folders that could not be cloned, or were removed after cloning, with the reason.
    pub refused: Vec<(String, String)>,
    /// The volume or platform cannot clone, so nothing was attempted after the first try.
    pub unsupported: bool,
}

/// Clones each installed folder in [`TABLE`] that the project checkout has beside its
/// manifest into the same place in `workspace`, but only when both checkouts' dependency
/// manifests fingerprint the same for `command`. Existing folders, linked paths and trees
/// whose links or generated files lead back into the project checkout or outside the
/// workspace are never used.
pub(super) fn clone_dependencies(project: &str, workspace: &str, command: &str) -> DependencyClone {
    let mut outcome = DependencyClone::default();
    let (Ok(root), Ok(destination)) =
        (dunce::canonicalize(project), dunce::canonicalize(workspace))
    else {
        return outcome;
    };
    if root == destination
        || preparation::fingerprint(&root, command)
            != preparation::fingerprint(&destination, command)
    {
        return outcome;
    }
    let Some(inputs) = preparation::dependency_inputs(&destination) else {
        return outcome;
    };
    let checkout = [root.as_path(), Path::new(project)];
    for manifest in inputs {
        for entry in &TABLE {
            let Some(prefix) = manifest
                .strip_suffix(entry.manifest)
                .filter(|prefix| prefix.is_empty() || prefix.ends_with('/'))
            else {
                continue;
            };
            if entry.kind == Kind::SwiftPackage
                && !destination.join(format!("{prefix}Package.swift")).is_file()
            {
                continue;
            }
            let relative = PathBuf::from(format!("{prefix}{}", entry.folder));
            let name = relative.to_string_lossy().replace('\\', "/");
            match clone_one(entry.kind, &checkout, &destination, prefix, &relative) {
                Ok(true) => outcome.cloned.push(name),
                Ok(false) => {}
                Err(Refusal::Unsupported) => {
                    outcome.unsupported = true;
                    return outcome;
                }
                Err(Refusal::Reason(reason)) => outcome.refused.push((name, reason)),
            }
        }
    }
    outcome
}

enum Refusal {
    Unsupported,
    Reason(String),
}

impl From<String> for Refusal {
    fn from(reason: String) -> Self {
        Self::Reason(reason)
    }
}

/// Clones one folder. `Ok(false)` means there was nothing to clone or something already
/// occupies the place; on a refusal nothing is left behind in the workspace.
fn clone_one(
    kind: Kind,
    checkout: &[&Path; 2],
    destination: &Path,
    prefix: &str,
    relative: &Path,
) -> Result<bool, Refusal> {
    let root = checkout[0];
    let (Ok(source), Ok(target)) = (
        super::workspace_setup::no_links(root, relative),
        super::workspace_setup::no_links(destination, relative),
    ) else {
        return Ok(false);
    };
    let is_dir =
        |path: &Path| std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir());
    let Some(parent) = target.parent() else {
        return Ok(false);
    };
    let package = destination.join(prefix);
    if !is_dir(&source) || !is_dir(&package) || std::fs::symlink_metadata(&target).is_ok() {
        return Ok(false);
    }
    if kind == Kind::Pods {
        let manifest = std::fs::read(source.join("Manifest.lock")).ok();
        if manifest.is_none()
            || manifest != std::fs::read(root.join(prefix).join("Podfile.lock")).ok()
        {
            return Err("it does not match Podfile.lock; run pod install there"
                .to_string()
                .into());
        }
    }
    if kind == Kind::SwiftPackage {
        swiftpm_portable(&source)?;
    }
    // A parent such as `Carthage/` may be ignored as a whole and so absent from a checkout.
    let created = if is_dir(parent) {
        None
    } else {
        let first = parent
            .ancestors()
            .take_while(|path| !path.exists())
            .last()
            .map(Path::to_path_buf);
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        first
    };
    let discard = |target: &Path| {
        let _ = std::fs::remove_dir_all(target);
        if let Some(created) = &created {
            let _ = std::fs::remove_dir_all(created);
        }
    };
    let cloned = if kind == Kind::SwiftPackage {
        clone_swiftpm_state(&source, &target, &target)
    } else {
        clone_tree(&source, &target)
    };
    if let Err(error) = cloned {
        discard(&target);
        return Err(if is_unsupported(&error) {
            Refusal::Unsupported
        } else {
            Refusal::Reason(error.to_string())
        });
    }
    if kind == Kind::Node {
        for cache in CACHES {
            let path = target.join(cache);
            if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir()) {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
    let checked = relocatable(checkout, destination, &target).and_then(|()| match kind {
        Kind::Pods => no_recorded_paths(checkout, destination, &target, &PODS_TEXT),
        _ => Ok(()),
    });
    if let Err(reason) = checked {
        discard(&target);
        return Err(reason.into());
    }
    Ok(true)
}

/// Whether a SwiftPM scratch folder's resolution can move: every dependency comes from a
/// remote repository or registry, and every absolute path in its state points inside the
/// folder itself (prebuilt macro libraries and binary artifacts do; local packages point
/// elsewhere). Returns the spellings of the folder's path the state records.
pub(super) fn swiftpm_portable(scratch: &Path) -> Result<Vec<String>, String> {
    let text = std::fs::read(scratch.join("workspace-state.json"))
        .map_err(|_| "it has no resolved packages".to_string())?;
    let state: serde_json::Value =
        serde_json::from_slice(&text).map_err(|_| "its package state is unreadable".to_string())?;
    let remote = state["object"]["dependencies"]
        .as_array()
        .is_some_and(|dependencies| {
            dependencies.iter().all(|dependency| {
                matches!(
                    dependency["packageRef"]["kind"].as_str(),
                    Some("remoteSourceControl" | "registry")
                )
            })
        });
    let refused = || "it includes local packages, which record their paths".to_string();
    if !remote {
        return Err(refused());
    }
    let actual = dunce::canonicalize(scratch).map_err(|error| error.to_string())?;
    let mut roots: Vec<String> = Vec::new();
    let mut paths = Vec::new();
    strings(&state, &mut |text| {
        if text.starts_with('/') || text.starts_with('\\') {
            paths.push(text.to_string());
        }
    });
    for path in paths {
        if roots
            .iter()
            .any(|root| path == *root || path.starts_with(&format!("{root}/")))
        {
            continue;
        }
        // The folder's own path is whichever prefix of `path` ending before a SwiftPM
        // subfolder resolves to it; the recorded spelling may differ (`/tmp` vs `/private/tmp`).
        let root = [
            "/checkouts/",
            "/prebuilts/",
            "/artifacts/",
            "/repositories/",
        ]
        .iter()
        .flat_map(|marker| path.match_indices(marker).map(|(index, _)| &path[..index]))
        .find(|prefix| dunce::canonicalize(prefix).is_ok_and(|resolved| resolved == actual))
        .ok_or_else(refused)?;
        roots.push(root.to_string());
    }
    Ok(roots)
}

fn strings(value: &serde_json::Value, visit: &mut impl FnMut(&str)) {
    match value {
        serde_json::Value::String(text) => visit(text),
        serde_json::Value::Array(items) => items.iter().for_each(|item| strings(item, visit)),
        serde_json::Value::Object(fields) => fields.values().for_each(|item| strings(item, visit)),
        _ => {}
    }
}

/// Clones SwiftPM's resolution state from the scratch folder `source` into a new folder
/// `target`, then rewrites the absolute paths SwiftPM recorded (in its state and in each
/// checkout's Git metadata) for the folder's final place `home`, usually `target` itself.
/// On failure nothing is left at `target`.
pub(super) fn clone_swiftpm_state(source: &Path, target: &Path, home: &Path) -> io::Result<()> {
    let roots = swiftpm_portable(source).map_err(io::Error::other)?;
    std::fs::create_dir(target)?;
    let result = (|| {
        for name in SWIFTPM_STATE {
            let from = source.join(name);
            if std::fs::symlink_metadata(&from).is_ok() {
                imp::clone_entry(&from, &target.join(name))?;
            }
        }
        relocate_state(target, &roots, home)?;
        relocate_checkouts(target, home)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(target);
    }
    result
}

/// Rewrites `workspace-state.json` paths under any of `roots` to the same place under `home`.
fn relocate_state(scratch: &Path, roots: &[String], home: &Path) -> io::Result<()> {
    if roots.is_empty() {
        return Ok(());
    }
    let file = scratch.join("workspace-state.json");
    let mut state: serde_json::Value = serde_json::from_slice(&std::fs::read(&file)?)?;
    let home = home.to_string_lossy();
    fn rewrite(value: &mut serde_json::Value, roots: &[String], home: &str) {
        match value {
            serde_json::Value::String(text) => {
                if let Some(rest) = roots.iter().find_map(|root| {
                    (text == root).then_some("").or_else(|| {
                        text.strip_prefix(root.as_str())
                            .filter(|rest| rest.starts_with('/'))
                    })
                }) {
                    *text = format!("{home}{rest}");
                }
            }
            serde_json::Value::Array(items) => {
                items.iter_mut().for_each(|item| rewrite(item, roots, home))
            }
            serde_json::Value::Object(fields) => fields
                .values_mut()
                .for_each(|item| rewrite(item, roots, home)),
            _ => {}
        }
    }
    rewrite(&mut state, roots, &home);
    replace_file(&file, &serde_json::to_string_pretty(&state)?)
}

/// Rewrites the absolute repository paths in each `checkouts/*/.git` (its object
/// alternates and `origin` URL) to the repositories under `home`.
fn relocate_checkouts(scratch: &Path, home: &Path) -> io::Result<()> {
    let repositories = home.join("repositories");
    let Ok(checkouts) = std::fs::read_dir(scratch.join("checkouts")) else {
        return Ok(());
    };
    let moved = |value: &str| -> io::Result<Option<String>> {
        let value = value.trim();
        if !Path::new(value).is_absolute() {
            return Ok(None);
        }
        let rest = value.rsplit_once("/repositories/").map(|(_, rest)| rest);
        match rest.filter(|rest| !rest.is_empty() && !rest.split('/').any(|part| part == "..")) {
            Some(rest) => Ok(Some(repositories.join(rest).to_string_lossy().into_owned())),
            None => Err(io::Error::other(format!(
                "a package checkout refers to {value} outside its repositories"
            ))),
        }
    };
    for checkout in checkouts {
        let git = checkout?.path().join(".git");
        if !std::fs::symlink_metadata(&git).is_ok_and(|metadata| metadata.is_dir()) {
            continue;
        }
        let alternates = git.join("objects/info/alternates");
        if let Ok(text) = std::fs::read_to_string(&alternates) {
            let mut lines = Vec::new();
            for line in text.lines() {
                lines.push(moved(line)?.unwrap_or_else(|| line.to_string()));
            }
            replace_file(&alternates, &(lines.join("\n") + "\n"))?;
        }
        let config = git.join("config");
        if let Ok(text) = std::fs::read_to_string(&config) {
            let mut lines = Vec::new();
            for line in text.lines() {
                let rewritten = match line.trim_start().strip_prefix("url = ") {
                    Some(url) => moved(url)?.map(|url| format!("\turl = {url}")),
                    None => None,
                };
                lines.push(rewritten.unwrap_or_else(|| line.to_string()));
            }
            replace_file(&config, &(lines.join("\n") + "\n"))?;
        }
    }
    Ok(())
}

/// Replaces a cloned file with new content without writing through to the extents it
/// still shares with its source.
fn replace_file(path: &Path, content: &str) -> io::Result<()> {
    if std::fs::read_to_string(path).is_ok_and(|current| current == content) {
        return Ok(());
    }
    std::fs::remove_file(path)?;
    std::fs::write(path, content)
}

/// Refuses a cloned tree whose generated text files (by extension) name the project
/// checkout's path, which would send a build in the workspace back into the checkout.
fn no_recorded_paths(
    project: &[&Path],
    workspace: &Path,
    tree: &Path,
    extensions: &[&str],
) -> Result<(), String> {
    let needles: Vec<Vec<u8>> = project
        .iter()
        .map(|root| root.to_string_lossy().into_owned().into_bytes())
        .filter(|needle| needle.len() > 1)
        .collect();
    let mut pending = vec![tree.to_path_buf()];
    let mut bytes = 0u64;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            let path = entry.path();
            if kind.is_dir() {
                pending.push(path);
                continue;
            }
            let text = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extensions.contains(&extension));
            if !kind.is_file() || !text {
                continue;
            }
            bytes += entry.metadata().map_err(|error| error.to_string())?.len();
            if bytes > MAX_TEXT_BYTES {
                return Err("it is too large to check".into());
            }
            let content = std::fs::read(&path).map_err(|error| error.to_string())?;
            if needles.iter().any(|needle| {
                content
                    .windows(needle.len())
                    .any(|window| window == needle.as_slice())
            }) {
                return Err(format!(
                    "{} records the project checkout's path",
                    display(workspace, &path)
                ));
            }
        }
    }
    Ok(())
}

/// Checks a cloned tree in its new place: every relative link must resolve inside the
/// workspace (so a workspace package link reaches the workspace's own copy), no absolute link
/// may point into the project checkout, and no directory may record its original location.
pub(super) fn relocatable(project: &[&Path], workspace: &Path, tree: &Path) -> Result<(), String> {
    let mut pending = vec![tree.to_path_buf()];
    let mut entries = 0usize;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            entries += 1;
            if entries > MAX_ENTRIES {
                return Err("it is too large to check".into());
            }
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            let path = entry.path();
            if kind.is_symlink() {
                let link = std::fs::read_link(&path).map_err(|error| error.to_string())?;
                if link.is_absolute() {
                    if project.iter().any(|root| link.starts_with(root)) {
                        return Err(format!(
                            "{} links to the project checkout",
                            display(workspace, &path)
                        ));
                    }
                } else if !normalize(&directory.join(&link))
                    .is_some_and(|resolved| resolved.starts_with(workspace))
                {
                    return Err(format!(
                        "{} links outside the workspace",
                        display(workspace, &path)
                    ));
                }
            } else if kind.is_dir() {
                pending.push(path);
            } else if NON_RELOCATABLE
                .iter()
                .any(|name| entry.file_name() == std::ffi::OsStr::new(name))
            {
                return Err(format!(
                    "{} records the path it was built at",
                    display(workspace, &directory)
                ));
            }
        }
    }
    Ok(())
}

fn display(workspace: &Path, path: &Path) -> String {
    path.strip_prefix(workspace)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Resolves `.` and `..` without touching the filesystem; `None` if it climbs above the root.
fn normalize(path: &Path) -> Option<PathBuf> {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                if !resolved.pop() {
                    return None;
                }
            }
            Component::CurDir => {}
            other => resolved.push(other),
        }
    }
    Some(resolved)
}

/// Whether `error` from a clone means the volume or platform cannot clone, rather
/// than an I/O failure a byte copy would hit too.
pub(super) fn is_unsupported(error: &io::Error) -> bool {
    if error.kind() == io::ErrorKind::Unsupported {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        error
            .raw_os_error()
            .is_some_and(|code| matches!(code, libc::ENOTSUP | libc::EOPNOTSUPP | libc::EXDEV))
    }
    #[cfg(target_os = "linux")]
    {
        error.raw_os_error().is_some_and(|code| {
            matches!(
                code,
                libc::EXDEV | libc::EOPNOTSUPP | libc::ENOTTY | libc::EINVAL | libc::ENOSYS
            )
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        false
    }
}

/// Makes `destination`, which must not exist, a copy-on-write clone of the directory
/// `source`, keeping links as links. On failure nothing is left at `destination`.
pub(super) fn clone_tree(source: &Path, destination: &Path) -> io::Result<()> {
    let result = imp::clone_entry(source, destination);
    if result.is_err() && std::fs::symlink_metadata(destination).is_ok() {
        let _ = std::fs::remove_dir_all(destination);
    }
    result
}

#[cfg(target_os = "macos")]
mod imp {
    use std::{ffi::CString, io, os::unix::ffi::OsStrExt, path::Path};

    /// Clones a link itself rather than what it names. Darwin's `clonefile.h` defines it.
    const CLONE_NOFOLLOW: u32 = 0x0001;

    /// A directory source clones its whole tree in one call. `clonefile` refuses an existing
    /// destination, so it can never overwrite one.
    pub fn clone_entry(source: &Path, destination: &Path) -> io::Result<()> {
        let source = CString::new(source.as_os_str().as_bytes())?;
        let destination = CString::new(destination.as_os_str().as_bytes())?;
        // SAFETY: both strings are NUL-terminated and outlive the call, which keeps neither.
        if unsafe { libc::clonefile(source.as_ptr(), destination.as_ptr(), CLONE_NOFOLLOW) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::{
        fs::{self, File},
        io,
        os::{
            fd::AsRawFd,
            unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
        },
        path::Path,
    };

    // `libc::Ioctl` is `c_int` on musl and `c_ulong` on glibc; the value fits both.
    const FICLONE: libc::Ioctl = 0x4004_9409;

    /// Walks the tree, recreating directories and links and sharing each file's extents with
    /// `FICLONE`. `copy_file_range` is deliberately not used: it silently copies bytes on
    /// filesystems that cannot share extents.
    pub fn clone_entry(source: &Path, destination: &Path) -> io::Result<()> {
        let metadata = fs::symlink_metadata(source)?;
        if metadata.is_file() {
            return clone_file(source, destination);
        }
        if metadata.file_type().is_symlink() {
            return std::os::unix::fs::symlink(fs::read_link(source)?, destination);
        }
        fs::DirBuilder::new()
            .mode(metadata.permissions().mode() & 0o7777)
            .create(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let from = entry.path();
            let to = destination.join(entry.file_name());
            if kind.is_dir() || kind.is_symlink() || kind.is_file() {
                clone_entry(&from, &to)?;
            }
        }
        Ok(())
    }

    fn clone_file(from: &Path, to: &Path) -> io::Result<()> {
        let input = File::open(from)?;
        let metadata = input.metadata()?;
        let output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(metadata.permissions().mode() & 0o7777)
            .open(to)?;
        // SAFETY: both descriptors belong to files open for the call; the kernel keeps neither.
        if metadata.len() > 0
            && unsafe { libc::ioctl(output.as_raw_fd(), FICLONE, input.as_raw_fd()) } != 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod imp {
    use std::{io, path::Path};

    pub fn clone_entry(_source: &Path, _destination: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "copy-on-write folder clones are not available on this platform",
        ))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!("jackalope-clone-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        dunce::canonicalize(path).unwrap()
    }

    fn git(directory: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
            .args(args)
            .current_dir(directory)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
    }

    /// A project with a root package and one workspace package, both installed, and a task
    /// worktree of it at `.worktrees/task`.
    fn project() -> (PathBuf, PathBuf) {
        let root = scratch();
        std::fs::create_dir_all(root.join("packages/lib")).unwrap();
        std::fs::write(root.join(".gitignore"), "node_modules/\n.worktrees/\n").unwrap();
        std::fs::write(root.join("package.json"), "{\"name\":\"root\"}").unwrap();
        std::fs::write(root.join("pnpm-lock.yaml"), "packages: {}").unwrap();
        std::fs::write(root.join("packages/lib/package.json"), "{\"name\":\"lib\"}").unwrap();
        git(&root, &["init", "--quiet", "--initial-branch=main"]);
        git(&root, &["add", "."]);
        git(&root, &["commit", "--quiet", "-m", "fixture"]);
        std::fs::create_dir_all(root.join("node_modules/.pnpm/dep@1/node_modules/dep")).unwrap();
        std::fs::write(
            root.join("node_modules/.pnpm/dep@1/node_modules/dep/index.js"),
            "module.exports = 1",
        )
        .unwrap();
        symlink(
            ".pnpm/dep@1/node_modules/dep",
            root.join("node_modules/dep"),
        )
        .unwrap();
        symlink("../packages/lib", root.join("node_modules/lib")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/.cache/tool")).unwrap();
        std::fs::write(
            root.join("node_modules/.cache/tool/state"),
            root.to_str().unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(root.join("packages/lib/node_modules")).unwrap();
        symlink(
            "../../../node_modules/.pnpm/dep@1/node_modules/dep",
            root.join("packages/lib/node_modules/dep"),
        )
        .unwrap();
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

    fn clone(root: &Path, workspace: &Path) -> DependencyClone {
        clone_dependencies(
            root.to_str().unwrap(),
            workspace.to_str().unwrap(),
            "pnpm install --frozen-lockfile",
        )
    }

    #[test]
    fn clones_installed_folders_whose_links_still_resolve_inside_the_worktree() {
        let (root, workspace) = project();
        let outcome = clone(&root, &workspace);
        if outcome.unsupported {
            assert!(!workspace.join("node_modules").exists());
            std::fs::remove_dir_all(root).unwrap();
            return;
        }
        assert_eq!(
            outcome.cloned,
            ["node_modules", "packages/lib/node_modules"]
        );
        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(
            dunce::canonicalize(workspace.join("node_modules/lib")).unwrap(),
            workspace.join("packages/lib"),
            "a workspace package link must reach the worktree's own copy"
        );
        assert_eq!(
            std::fs::read_to_string(workspace.join("packages/lib/node_modules/dep/index.js"))
                .unwrap(),
            "module.exports = 1"
        );
        assert!(
            !workspace.join("node_modules/.cache").exists(),
            "caches that may record the checkout's path are not carried over"
        );
        std::fs::write(workspace.join("node_modules/dep/index.js"), "changed").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("node_modules/dep/index.js")).unwrap(),
            "module.exports = 1",
            "writing the clone must leave the project checkout untouched"
        );
        assert_eq!(
            clone(&root, &workspace),
            DependencyClone::default(),
            "existing folders are never replaced"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn different_manifests_or_folders_tied_to_the_checkout_are_not_used() {
        let (root, workspace) = project();
        std::fs::write(root.join("pnpm-lock.yaml"), "packages: {changed: 1}").unwrap();
        assert_eq!(clone(&root, &workspace), DependencyClone::default());
        assert!(!workspace.join("node_modules").exists());
        std::fs::write(root.join("pnpm-lock.yaml"), "packages: {}").unwrap();

        symlink(
            root.join("README"),
            root.join("packages/lib/node_modules/back"),
        )
        .unwrap();
        std::fs::create_dir_all(root.join("node_modules/.pnpm/tool/venv")).unwrap();
        std::fs::write(
            root.join("node_modules/.pnpm/tool/venv/pyvenv.cfg"),
            "home = /",
        )
        .unwrap();
        let outcome = clone(&root, &workspace);
        if outcome.unsupported {
            std::fs::remove_dir_all(root).unwrap();
            return;
        }
        assert!(outcome.cloned.is_empty(), "{:?}", outcome.cloned);
        assert_eq!(outcome.refused.len(), 2);
        assert!(
            outcome.refused[0].1.contains("records the path"),
            "{:?}",
            outcome.refused
        );
        assert!(
            outcome.refused[1].1.contains("project checkout"),
            "{:?}",
            outcome.refused
        );
        assert!(!workspace.join("node_modules").exists());
        assert!(!workspace.join("packages/lib/node_modules").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    /// An Xcode project with CocoaPods and Carthage installs and a pure Swift package beside
    /// it, all resolved in the checkout, and a task worktree of it at `.worktrees/task`.
    fn apple_project() -> (PathBuf, PathBuf) {
        let root = scratch();
        std::fs::create_dir_all(root.join("Kit")).unwrap();
        std::fs::write(
            root.join(".gitignore"),
            "Pods/\nCarthage/\n.build/\n.worktrees/\n",
        )
        .unwrap();
        std::fs::write(
            root.join("Podfile"),
            "target 'App' do\n  pod 'SwiftyJSON'\nend\n",
        )
        .unwrap();
        std::fs::write(root.join("Podfile.lock"), "PODS:\n  - SwiftyJSON (5.0.2)\n").unwrap();
        std::fs::write(root.join("Cartfile.resolved"), "github \"a/b\" \"1.0\"\n").unwrap();
        std::fs::write(
            root.join("Kit/Package.swift"),
            "// swift-tools-version:5.9\n",
        )
        .unwrap();
        std::fs::write(
            root.join("Kit/Package.resolved"),
            "{\"pins\":[],\"version\":3}",
        )
        .unwrap();
        git(&root, &["init", "--quiet", "--initial-branch=main"]);
        git(&root, &["add", "."]);
        git(&root, &["commit", "--quiet", "-m", "fixture"]);
        let pods = root.join("Pods");
        std::fs::create_dir_all(pods.join("Pods.xcodeproj")).unwrap();
        std::fs::create_dir_all(pods.join("Headers/Public/SwiftyJSON")).unwrap();
        std::fs::create_dir_all(pods.join("SwiftyJSON/Source")).unwrap();
        std::fs::create_dir_all(pods.join("Target Support Files/Pods-App")).unwrap();
        std::fs::copy(root.join("Podfile.lock"), pods.join("Manifest.lock")).unwrap();
        std::fs::write(pods.join("SwiftyJSON/Source/SwiftyJSON.h"), "// header").unwrap();
        std::fs::write(
            pods.join("Pods.xcodeproj/project.pbxproj"),
            "path = SwiftyJSON/Source/SwiftyJSON.swift; sourceTree = \"<group>\";",
        )
        .unwrap();
        std::fs::write(
            pods.join("Target Support Files/Pods-App/Pods-App.debug.xcconfig"),
            "PODS_ROOT = ${SRCROOT}/Pods\n",
        )
        .unwrap();
        symlink(
            "../../../SwiftyJSON/Source/SwiftyJSON.h",
            pods.join("Headers/Public/SwiftyJSON/SwiftyJSON.h"),
        )
        .unwrap();
        std::fs::create_dir_all(root.join("Carthage/Build/B.xcframework")).unwrap();
        std::fs::write(root.join("Carthage/Build/.b.version"), "{}").unwrap();
        let build = root.join("Kit/.build");
        std::fs::create_dir_all(build.join("repositories/dep-1234/objects")).unwrap();
        std::fs::create_dir_all(build.join("checkouts/dep/.git/objects/info")).unwrap();
        std::fs::create_dir_all(build.join("arm64-apple-macosx/debug")).unwrap();
        std::fs::write(
            build.join("arm64-apple-macosx/debug/description.json"),
            root.to_str().unwrap(),
        )
        .unwrap();
        std::fs::write(
            build.join("checkouts/dep/.git/objects/info/alternates"),
            format!(
                "{}\n",
                build.join("repositories/dep-1234/objects").display()
            ),
        )
        .unwrap();
        std::fs::write(
            build.join("workspace-state.json"),
            r#"{"object":{"artifacts":[],"dependencies":[{"packageRef":{"identity":"dep","kind":"remoteSourceControl","location":"https://example.com/dep","name":"dep"},"state":{"checkoutState":{"revision":"abc"},"name":"sourceControlCheckout"},"subpath":"dep"}]},"version":7}"#,
        )
        .unwrap();
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

    #[test]
    fn pods_carthage_builds_and_swift_package_checkouts_are_cloned_by_their_own_rules() {
        let (root, workspace) = apple_project();
        let outcome = clone_dependencies(
            root.to_str().unwrap(),
            workspace.to_str().unwrap(),
            "pod install",
        );
        if outcome.unsupported {
            std::fs::remove_dir_all(root).unwrap();
            return;
        }
        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        let mut cloned = outcome.cloned.clone();
        cloned.sort();
        assert_eq!(cloned, ["Carthage/Build", "Kit/.build", "Pods"]);
        assert_eq!(
            std::fs::read_to_string(workspace.join("Pods/Headers/Public/SwiftyJSON/SwiftyJSON.h"))
                .unwrap(),
            "// header"
        );
        assert!(workspace.join("Carthage/Build/B.xcframework").is_dir());
        let build = workspace.join("Kit/.build");
        assert!(
            !build.join("arm64-apple-macosx").exists(),
            "build products record the path they were built at"
        );
        assert_eq!(
            std::fs::read_to_string(build.join("checkouts/dep/.git/objects/info/alternates"))
                .unwrap()
                .trim(),
            build
                .join("repositories/dep-1234/objects")
                .to_string_lossy()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_pods_or_ones_naming_the_checkout_and_local_swift_packages_are_refused() {
        let (root, workspace) = apple_project();
        let clone = || {
            clone_dependencies(
                root.to_str().unwrap(),
                workspace.to_str().unwrap(),
                "pod install",
            )
        };
        std::fs::write(root.join("Pods/Manifest.lock"), "PODS:\n  - Old (1.0)\n").unwrap();
        let state = root.join("Kit/.build/workspace-state.json");
        let text = std::fs::read_to_string(&state).unwrap();
        std::fs::write(&state, text.replace("remoteSourceControl", "fileSystem")).unwrap();
        std::fs::remove_dir_all(root.join("Carthage")).unwrap();
        let outcome = clone();
        assert!(outcome.cloned.is_empty(), "{:?}", outcome.cloned);
        assert_eq!(outcome.refused.len(), 2, "{:?}", outcome.refused);
        assert!(outcome.refused[0].1.contains("local packages"));
        assert!(outcome.refused[1].1.contains("Podfile.lock"));

        std::fs::copy(root.join("Podfile.lock"), root.join("Pods/Manifest.lock")).unwrap();
        std::fs::write(
            root.join("Pods/Target Support Files/Pods-App/Pods-App.debug.xcconfig"),
            format!("PODS_ROOT = {}/Pods\n", root.display()),
        )
        .unwrap();
        let outcome = clone();
        if !outcome.unsupported {
            assert_eq!(outcome.refused.len(), 2, "{:?}", outcome.refused);
            assert!(
                outcome.refused[1]
                    .1
                    .contains("records the project checkout's path"),
                "{:?}",
                outcome.refused
            );
        }
        assert!(!workspace.join("Pods").exists());
        assert!(!workspace.join("Kit/.build").exists());
        assert!(!workspace.join("Carthage").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn links_must_stay_inside_the_workspace_wherever_the_tree_was_made() {
        let workspace = scratch();
        let tree = workspace.join("node_modules");
        std::fs::create_dir_all(tree.join("pkg")).unwrap();
        symlink("pkg", tree.join("ok")).unwrap();
        symlink("/usr/lib", tree.join("system")).unwrap();
        assert!(relocatable(&[Path::new("/elsewhere")], &workspace, &tree).is_ok());
        symlink("../../../outside", tree.join("pkg/escape")).unwrap();
        assert!(relocatable(&[Path::new("/elsewhere")], &workspace, &tree)
            .unwrap_err()
            .contains("node_modules/pkg/escape links outside"));
        assert_eq!(
            normalize(Path::new("/a/b/../c/./d")),
            Some(PathBuf::from("/a/c/d"))
        );
        assert_eq!(normalize(Path::new("/a/../..")), None);
        std::fs::remove_dir_all(workspace).unwrap();
    }
}
