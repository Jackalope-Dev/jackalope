//! Warm agent processes parked between the turns of a live conversation.
//!
//! A warm process belongs to the attempt running its turn: it is registered in the
//! runtime's process table for that turn, so stopping the attempt kills it. Between turns
//! it is parked here, keyed by the agent's conversation ID, and it is discarded (which
//! stops it) after [`IDLE`], when the next launch would differ, when it is gone, on app
//! exit, or when its account changes.

use super::*;
use sha2::{Digest, Sha256};
use std::time::Instant;

const IDLE: Duration = Duration::from_secs(600);
const MAX_WARM: usize = 4;

/// A parked process. Dropping it stops the process.
pub(super) trait Warm: Send + 'static {
    /// The agent conversation the process continues.
    fn conversation(&self) -> Option<&str>;
    /// The launch identity the process was started with (see [`identity`]).
    fn key(&self) -> &[u8; 32];
    fn workspace(&self) -> &str;
    /// The account directory the process was started with.
    fn account(&self) -> Option<&Path>;
    fn alive(&self) -> bool;
}

/// The launch identity a warm process must share with a follow-up: program, arguments,
/// explicit environment, working directory and `extra`. The bridge token differs per
/// attempt and is aliased instead (see [`super::claude_session::bridge_token`]).
pub(super) fn identity(cmd: &Command, extra: &str) -> [u8; 32] {
    let mut hash = Sha256::new();
    let mut add = |value: &std::ffi::OsStr| {
        let bytes = value.as_encoded_bytes();
        hash.update(bytes.len().to_le_bytes());
        hash.update(bytes);
    };
    add(cmd.get_program());
    for arg in cmd.get_args() {
        add(arg);
    }
    if let Some(path) = cmd.get_current_dir() {
        add(path.as_os_str());
    }
    let mut envs: Vec<_> = cmd
        .get_envs()
        .filter(|(name, _)| *name != "JACKALOPE_BRIDGE_TOKEN")
        .collect();
    envs.sort();
    for (name, value) in envs {
        add(name);
        add(value.unwrap_or_default());
    }
    add(extra.as_ref());
    hash.finalize().into()
}

struct Parked<S> {
    session: S,
    since: Instant,
}

pub(super) struct Pool<S> {
    entries: Arc<Mutex<Vec<Parked<S>>>>,
    reaper: std::sync::OnceLock<()>,
    #[cfg(test)]
    idle: Mutex<Option<Duration>>,
}

impl<S> Default for Pool<S> {
    fn default() -> Self {
        Self {
            entries: Default::default(),
            reaper: Default::default(),
            #[cfg(test)]
            idle: Default::default(),
        }
    }
}

impl<S: Warm> Pool<S> {
    fn idle(&self) -> Duration {
        #[cfg(test)]
        if let Some(idle) = *self.idle.lock().unwrap() {
            return idle;
        }
        IDLE
    }

    fn expired(entries: &mut Vec<Parked<S>>, idle: Duration) -> Vec<Parked<S>> {
        let (keep, gone) = std::mem::take(entries)
            .into_iter()
            .partition(|entry| entry.since.elapsed() < idle && entry.session.alive());
        *entries = keep;
        gone
    }

    /// The parked process continuing `conversation`, when it was launched exactly as `key`
    /// in `workspace`. A mismatched process is dropped, which stops it; the caller resumes
    /// the conversation from disk.
    pub(super) fn take(&self, conversation: &str, key: &[u8; 32], workspace: &str) -> Option<S> {
        self.take_any(conversation, workspace)
            .filter(|session| session.key() == key)
    }

    /// The parked process continuing `conversation` in `workspace`, however it was launched.
    pub(super) fn take_any(&self, conversation: &str, workspace: &str) -> Option<S> {
        let (found, gone) = {
            let mut entries = self.entries.lock().unwrap();
            let gone = Self::expired(&mut entries, self.idle());
            let found = entries
                .iter()
                .position(|entry| entry.session.conversation() == Some(conversation))
                .map(|index| entries.remove(index).session);
            (found, gone)
        };
        drop(gone);
        found.filter(|session| session.workspace() == workspace)
    }

    pub(super) fn park(&self, session: S) {
        let gone = {
            let mut entries = self.entries.lock().unwrap();
            let mut gone = Self::expired(&mut entries, self.idle());
            if let Some(index) = entries
                .iter()
                .position(|entry| entry.session.conversation() == session.conversation())
            {
                gone.push(entries.remove(index));
            }
            entries.push(Parked {
                session,
                since: Instant::now(),
            });
            while entries.len() > MAX_WARM {
                gone.push(entries.remove(0));
            }
            gone
        };
        drop(gone);
        self.reaper.get_or_init(|| {
            let entries = Arc::downgrade(&self.entries);
            let idle = self.idle();
            std::thread::spawn(move || loop {
                std::thread::sleep(idle.min(Duration::from_secs(15)));
                let Some(entries) = entries.upgrade() else {
                    return;
                };
                let gone = Self::expired(&mut entries.lock().unwrap(), idle);
                drop(gone);
            });
        });
    }

    pub(super) fn clear(&self) {
        let gone = std::mem::take(&mut *self.entries.lock().unwrap());
        drop(gone);
    }

    pub(super) fn invalidate_account(&self, directory: &Path) {
        let gone: Vec<_> = {
            let mut entries = self.entries.lock().unwrap();
            let (keep, gone) = std::mem::take(&mut *entries)
                .into_iter()
                .partition(|entry| entry.session.account() != Some(directory));
            *entries = keep;
            gone
        };
        drop(gone);
    }

    #[cfg(test)]
    pub(super) fn warm(&self) -> usize {
        self.entries.lock().unwrap().len()
    }

    #[cfg(test)]
    pub(super) fn set_idle(&self, idle: Duration) {
        *self.idle.lock().unwrap() = Some(idle);
    }
}
