//! Console-window and process-group setup for child processes, shared with
//! the `jackalope` command.

use std::process::Command;

/// Windows `CREATE_NO_WINDOW`: a console child gets no console window.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Keeps a console child from opening a window on Windows. No effect elsewhere.
pub fn hidden(command: &mut Command) -> &mut Command {
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
