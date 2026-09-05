use std::collections::HashMap;
use std::sync::Mutex;
use portable_pty::{Child, MasterPty};

/// A single live PTY-backed agent process: the pieces needed to write
/// stdin, resize the pty, or kill the process after `commands::pty::pty_spawn`
/// has moved reading + event-emission onto its own thread.
pub struct PtySession {
    pub writer: Box<dyn std::io::Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct AppState {
    pub active_project_path: Mutex<Option<String>>,
    pub pty_sessions: Mutex<HashMap<String, PtySession>>,
}
