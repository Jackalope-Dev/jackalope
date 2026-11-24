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

/// Installed folders that are safe to seed. Python environments and build trees such as
/// Cargo's `target/` record absolute paths or are fingerprinted by location, so they are
/// left to the setup command.
const FOLDER: &str = "node_modules";
/// Caches inside a cloned folder that may record the checkout's absolute paths and are
/// rebuilt on demand.
const CACHES: [&str; 4] = [".cache", ".vite", ".vite-temp", ".tmp"];
/// Files that mark a directory whose contents only work at the path they were made at.
const NON_RELOCATABLE: [&str; 2] = ["pyvenv.cfg", "CMakeCache.txt"];
const MAX_ENTRIES: usize = 2_000_000;

#[derive(Debug, Default, PartialEq)]
pub(super) struct DependencyClone {
    /// Workspace-relative folders now present as clones.
    pub cloned: Vec<String>,
    /// Folders that could not be cloned, or were removed after cloning, with the reason.
    pub refused: Vec<(String, String)>,
    /// The volume or platform cannot clone, so nothing was attempted after the first try.
    pub unsupported: bool,
}

/// Clones each `node_modules` the project checkout has beside a `package.json` into the same
/// place in `workspace`, but only when both checkouts' dependency manifests fingerprint the
/// same for `command`. Existing folders, linked paths and trees whose links lead back into the
/// project checkout or outside the workspace are never used.
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
    for manifest in inputs {
        let Some(package) = manifest
            .strip_suffix("package.json")
            .filter(|prefix| prefix.is_empty() || prefix.ends_with('/'))
        else {
            continue;
        };
        let relative = PathBuf::from(format!("{package}{FOLDER}"));
        let name = relative.to_string_lossy().replace('\\', "/");
        let (Ok(source), Ok(target)) = (
            super::workspace_setup::no_links(&root, &relative),
            super::workspace_setup::no_links(&destination, &relative),
        ) else {
            continue;
        };
        let source_is_dir =
            std::fs::symlink_metadata(&source).is_ok_and(|metadata| metadata.file_type().is_dir());
        let parent_is_dir = target
            .parent()
            .and_then(|parent| std::fs::symlink_metadata(parent).ok())
            .is_some_and(|metadata| metadata.file_type().is_dir());
        if !source_is_dir || !parent_is_dir || std::fs::symlink_metadata(&target).is_ok() {
            continue;
        }
        match clone_tree(&source, &target) {
            Ok(()) => {}
            Err(error) if is_unsupported(&error) => {
                outcome.unsupported = true;
                break;
            }
            Err(error) => {
                outcome.refused.push((name, error.to_string()));
                continue;
            }
        }
        for cache in CACHES {
            let path = target.join(cache);
            if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir()) {
                let _ = std::fs::remove_dir_all(path);
            }
        }
        match relocatable(&[&root, Path::new(project)], &destination, &target) {
            Ok(()) => outcome.cloned.push(name),
            Err(reason) => {
                let _ = std::fs::remove_dir_all(&target);
                outcome.refused.push((name, reason));
            }
        }
    }
    outcome
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
pub(super) fn normalize(path: &Path) -> Option<PathBuf> {
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

/// Whether `error` from [`clone_tree`] means the volume or platform cannot clone, rather
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
/// `source`, keeping links as links. On failure nothing it made is left at `destination`.
pub(super) fn clone_tree(source: &Path, destination: &Path) -> io::Result<()> {
    let result = imp::clone_tree(source, destination);
    if result.as_ref().is_err_and(|error| !existed(error))
        && std::fs::symlink_metadata(destination).is_ok()
    {
        let _ = std::fs::remove_dir_all(destination);
    }
    result
}

/// The clone refused a destination that was already there, which is not the clone's to remove.
fn existed(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::AlreadyExists
}

/// Makes `destination`, which must not exist, a copy-on-write clone of the regular file
/// `source`. [`is_unsupported`] tells a volume that cannot clone from a real failure; on any
/// failure nothing it made is left at `destination`.
pub(super) fn clone_file(source: &Path, destination: &Path) -> io::Result<()> {
    let result = imp::clone_file(source, destination);
    if result.as_ref().is_err_and(|error| !existed(error))
        && std::fs::symlink_metadata(destination).is_ok_and(|m| m.is_file())
    {
        let _ = std::fs::remove_file(destination);
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
    pub fn clone_tree(source: &Path, destination: &Path) -> io::Result<()> {
        let source = CString::new(source.as_os_str().as_bytes())?;
        let destination = CString::new(destination.as_os_str().as_bytes())?;
        // SAFETY: both strings are NUL-terminated and outlive the call, which keeps neither.
        if unsafe { libc::clonefile(source.as_ptr(), destination.as_ptr(), CLONE_NOFOLLOW) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    /// `clonefile` takes a single file the same way, and refuses an existing destination.
    pub fn clone_file(source: &Path, destination: &Path) -> io::Result<()> {
        clone_tree(source, destination)
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
    pub fn clone_tree(source: &Path, destination: &Path) -> io::Result<()> {
        let mode = fs::symlink_metadata(source)?.permissions().mode();
        fs::DirBuilder::new()
            .mode(mode & 0o7777)
            .create(destination)?;
        // Past this point `destination` is the clone's own, so a clash inside it must not read
        // as a destination that already existed.
        fill(source, destination).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                io::Error::other(error)
            } else {
                error
            }
        })
    }

    fn fill(source: &Path, destination: &Path) -> io::Result<()> {
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let from = entry.path();
            let to = destination.join(entry.file_name());
            if kind.is_dir() {
                clone_tree(&from, &to)?;
            } else if kind.is_symlink() {
                std::os::unix::fs::symlink(fs::read_link(&from)?, &to)?;
            } else if kind.is_file() {
                clone_file(&from, &to)?;
            }
        }
        Ok(())
    }

    pub fn clone_file(source: &Path, destination: &Path) -> io::Result<()> {
        let input = File::open(source)?;
        let metadata = input.metadata()?;
        let output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(metadata.permissions().mode() & 0o7777)
            .open(destination)?;
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

    pub fn clone_tree(_source: &Path, _destination: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "copy-on-write folder clones are not available on this platform",
        ))
    }

    pub fn clone_file(_source: &Path, _destination: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "copy-on-write file clones are not available on this platform",
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
    fn a_clone_onto_an_existing_path_fails_without_removing_it() {
        let root = scratch();
        std::fs::write(root.join("source"), "new").unwrap();
        std::fs::write(root.join("existing"), "keep").unwrap();
        assert!(clone_file(&root.join("source"), &root.join("existing")).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("existing")).unwrap(),
            "keep"
        );
        std::fs::create_dir_all(root.join("from")).unwrap();
        std::fs::write(root.join("from/file"), "new").unwrap();
        std::fs::create_dir_all(root.join("to")).unwrap();
        std::fs::write(root.join("to/file"), "keep").unwrap();
        assert!(clone_tree(&root.join("from"), &root.join("to")).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("to/file")).unwrap(),
            "keep"
        );
        let _ = std::fs::remove_dir_all(&root);
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
