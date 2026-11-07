use std::{path::Path, process::Command};

#[derive(Clone, Copy)]
pub(super) enum Policy {
    /// The caller's environment unchanged; on Unix Git gets its own process group.
    Inherited,
    /// Ignores repository overrides such as `GIT_DIR` inherited from the environment.
    Isolated,
    /// Isolated, and reads the real object graph without replace refs, so a
    /// snapshot or review commit matches what is stored.
    Snapshot,
    /// Snapshot, and takes no optional locks, so reading cannot disturb a concurrent writer.
    Inspection,
}

/// Overrides that would point Git at another repository, index or object store.
const REPOSITORY_OVERRIDES: [&str; 7] = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_PREFIX",
];

pub(super) fn command(path: &Path, args: &[&str], policy: Policy) -> Command {
    let mut command = Command::new("git");
    command.current_dir(path).args(args);
    if !matches!(policy, Policy::Inherited) {
        for key in REPOSITORY_OVERRIDES {
            command.env_remove(key);
        }
    }
    if matches!(policy, Policy::Snapshot | Policy::Inspection) {
        command.env("GIT_NO_REPLACE_OBJECTS", "1");
    }
    if matches!(policy, Policy::Inspection) {
        command.env("GIT_OPTIONAL_LOCKS", "0");
    }
    super::process_control::hidden(&mut command);
    #[cfg(unix)]
    if matches!(policy, Policy::Inherited) {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}
