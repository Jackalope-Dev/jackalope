//! Where a profile keeps its data. The host and the `jackalope` command both
//! resolve paths here, so the command finds what the host wrote.

use std::path::{Path, PathBuf};

/// The person's home folder: `USERPROFILE` on Windows, `HOME` elsewhere.
/// Git Bash sets `HOME` on Windows to a folder agents do not run in, so it is
/// not consulted there.
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}

/// `JACKALOPE_PROFILE_DIR`, the explicit profile root, when set.
pub fn explicit_root() -> Option<PathBuf> {
    std::env::var_os("JACKALOPE_PROFILE_DIR").map(PathBuf::from)
}

/// The profile root: the explicit override when it is absolute, else the
/// platform's per-user application data directory, as Tauri resolves it for
/// the host.
pub fn root() -> Option<PathBuf> {
    if let Some(explicit) = explicit_root() {
        return explicit.is_absolute().then_some(explicit);
    }
    let home = home_dir()?;
    #[cfg(target_os = "macos")]
    let root = home.join("Library/Application Support");
    #[cfg(target_os = "linux")]
    let root = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"));
    #[cfg(windows)]
    let root = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData/Roaming"));
    Some(root.join(super::IDENTIFIER))
}

/// The lock the host holds on its task history for as long as it runs.
pub const RUNTIME_LOCK: &str = "runtime.lock";
/// The coordinator's folder in the data directory, and the lock it holds there.
pub const COORDINATION: &str = "coordination";
pub const COORDINATOR_LOCK: &str = "owner.lock";
/// Schedules live beside task history, which skips them when it loads.
pub const SCHEDULES: &str = "schedules.json";

/// The layout of a profile's data directory.
#[derive(Clone, Debug, PartialEq)]
pub struct ProfilePaths {
    data: PathBuf,
}

impl ProfilePaths {
    /// The layout under profile root `root`. Debug builds let
    /// `JACKALOPE_TEST_DATA_DIR` replace the data directory, so native tests
    /// run against an isolated profile.
    pub fn new(root: &Path) -> Self {
        #[cfg(debug_assertions)]
        let test_data = std::env::var_os("JACKALOPE_TEST_DATA_DIR").map(PathBuf::from);
        #[cfg(not(debug_assertions))]
        let test_data = None;
        Self::with_test_data(root, test_data)
    }

    fn with_test_data(root: &Path, test_data: Option<PathBuf>) -> Self {
        Self {
            data: test_data.unwrap_or_else(|| root.join("task-runs-v1")),
        }
    }

    /// The layout of an existing data directory.
    pub fn at(data: PathBuf) -> Self {
        Self { data }
    }

    /// The layout of the active profile, when its root can be found.
    pub fn active() -> Option<Self> {
        root().map(|root| Self::new(&root))
    }

    /// Task history, and every other store the host owns.
    pub fn data(&self) -> &Path {
        &self.data
    }

    pub fn preferences(&self) -> PathBuf {
        self.data.join("preferences")
    }

    pub fn runtime_lock(&self) -> PathBuf {
        self.data.join(RUNTIME_LOCK)
    }

    pub fn coordination(&self) -> PathBuf {
        self.data.join(COORDINATION)
    }

    pub fn coordinator_lock(&self) -> PathBuf {
        self.coordination().join(COORDINATOR_LOCK)
    }

    pub fn schedules(&self) -> PathBuf {
        self.data.join(SCHEDULES)
    }

    /// Where the host advertises itself to the command.
    pub fn handshake(&self) -> PathBuf {
        self.preferences().join("host.json")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_and_command_share_the_test_data_override() {
        let root = std::env::temp_dir().join("jackalope-profile-root");
        let plain = ProfilePaths::with_test_data(&root, None);
        assert_eq!(plain.data(), root.join("task-runs-v1"));
        assert_eq!(
            plain.handshake(),
            plain.data().join("preferences").join("host.json")
        );
        assert_eq!(plain.runtime_lock(), plain.data().join(RUNTIME_LOCK));
        let isolated = std::env::temp_dir().join("jackalope-isolated-data");
        let paths = ProfilePaths::with_test_data(&root, Some(isolated.clone()));
        assert_eq!(paths.data(), isolated);
        assert_eq!(paths.handshake(), isolated.join("preferences/host.json"));
    }
}
