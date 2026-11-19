//! Console-window, process-group and inherited-environment setup for child
//! processes, shared with the `jackalope` command.

use std::ffi::OsString;
use std::process::Command;

/// Windows `CREATE_NO_WINDOW`: a console child gets no console window.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Keeps a console child from opening a window on Windows and from inheriting
/// Jackalope's own credentials ([`inherited_credentials`]).
pub fn hidden(command: &mut Command) -> &mut Command {
    let set: Vec<OsString> = command
        .get_envs()
        .map(|(name, _)| name.to_os_string())
        .collect();
    for name in inherited_credentials() {
        if !set.contains(&name) {
            command.env_remove(name);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// [`hidden`], and on Unix the leader of its own process group, so a
/// [`ProcessTree`] can contain it and everything it starts.
pub fn isolated(command: &mut Command) -> &mut Command {
    hidden(command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

/// Whether an environment variable holds a credential: a key, token, secret
/// or password.
pub fn credential_variable(name: &str) -> bool {
    let name = name.to_ascii_uppercase();
    ["_KEY", "_TOKEN", "_SECRET", "_PASSWORD"]
        .iter()
        .any(|suffix| name.ends_with(suffix))
}

/// Jackalope's own credentials in this process's environment, such as the
/// bridge token of an attempt whose agent started this app, or a test key. A
/// child receives one only when it is set for that child.
pub fn inherited_credentials() -> Vec<OsString> {
    std::env::vars_os()
        .map(|(name, _)| name)
        .filter(|name| {
            name.to_str().is_some_and(|name| {
                name.to_ascii_uppercase().starts_with("JACKALOPE_") && credential_variable(name)
            })
        })
        .collect()
}
