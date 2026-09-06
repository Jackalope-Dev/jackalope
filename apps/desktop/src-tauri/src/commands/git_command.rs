use std::{path::Path, process::Command};

#[derive(Clone, Copy)]
pub(super) enum Policy {
    Inherited,
    Isolated,
    Inspection,
}

pub(super) fn command(path: &Path, args: &[&str], policy: Policy) -> Command {
    let mut command = Command::new("git");
    command.current_dir(path).args(args);
    if !matches!(policy, Policy::Inherited) {
        for key in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] {
            command.env_remove(key);
        }
    }
    if matches!(policy, Policy::Inspection) {
        command
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_NO_REPLACE_OBJECTS", "1");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    if matches!(policy, Policy::Inherited) {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}
