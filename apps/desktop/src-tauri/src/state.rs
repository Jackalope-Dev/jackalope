use portable_pty::{Child, MasterPty};
use std::collections::HashMap;
use std::sync::Mutex;

/// A single live PTY-backed agent process: the pieces needed to write
/// stdin, resize the pty, or kill the process after `commands::pty::pty_spawn`
/// has moved reading + event-emission onto its own thread.
pub struct PtySession {
    pub writer: Box<dyn std::io::Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub tree: Option<crate::commands::process_control::ProcessTree>,
}

impl PtySession {
    pub fn stop(&mut self) -> std::io::Result<()> {
        if let Some(tree) = &self.tree { tree.terminate(); }
        self.child.kill()?;
        self.child.wait()?;
        Ok(())
    }
}

#[derive(Default)]
pub struct AppState {
    pub active_project_path: Mutex<Option<String>>,
    pub pty_sessions: Mutex<HashMap<String, PtySession>>,
}

impl AppState {
    /// Kills every live pty-backed agent process. Without this, closing the
    /// app window only drops Jackalope's handle to each `PtySession` — the
    /// child process itself (an agent CLI, potentially mid-task) has no
    /// parent left to reap it and keeps running orphaned in the background.
    pub fn kill_all_pty_sessions(&self) {
        if let Ok(mut sessions) = self.pty_sessions.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.stop();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! Verifies the actual OS process is gone, not just that our own map
    //! entry disappeared — `drain()` empties the map regardless of whether
    //! `kill()` did anything, so that alone wouldn't catch a broken kill.
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::time::{Duration, Instant};

    fn process_is_alive(pid: u32) -> bool {
        #[cfg(windows)]
        {
            let output = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH"])
                .output()
                .expect("failed to run tasklist");
            String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .is_ok_and(|status| status.success())
        }
    }

    #[test]
    fn kill_all_pty_sessions_terminates_the_real_child_process() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("failed to allocate a pty");

        #[cfg(windows)]
        let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(windows)]
        cmd.args(["/C", "ping", "-t", "127.0.0.1"]);
        #[cfg(not(windows))]
        let mut cmd = CommandBuilder::new("sleep");
        #[cfg(not(windows))]
        cmd.arg("30");

        let child = pair
            .slave
            .spawn_command(cmd)
            .expect("failed to spawn command in pty");
        drop(pair.slave);
        let pid = child.process_id().expect("spawned child has no pid");
        let tree = crate::commands::process_control::ProcessTree::attach_pid(pid).unwrap();
        let writer = pair
            .master
            .take_writer()
            .expect("failed to take pty writer");

        let state = AppState::default();
        state.pty_sessions.lock().unwrap().insert(
            "test-session".into(),
            PtySession {
                writer,
                master: pair.master,
                child,
                tree: Some(tree),
            },
        );
        assert!(
            process_is_alive(pid),
            "process should be running before kill"
        );

        state.kill_all_pty_sessions();
        assert!(state.pty_sessions.lock().unwrap().is_empty());

        let deadline = Instant::now() + Duration::from_secs(5);
        while process_is_alive(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            !process_is_alive(pid),
            "process should be killed, not orphaned"
        );
    }
}
