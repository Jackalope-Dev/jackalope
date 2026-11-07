//! Files bundled with the app under `resources/`.

use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

/// Records the app's resource directory; called once at startup.
pub fn set_directory(path: PathBuf) {
    let _ = DIRECTORY.set(path);
}

/// The bundled file at `relative` (such as `resources/computer/Dockerfile`), or in
/// development builds the source tree's copy, when it exists.
pub(crate) fn bundled(relative: &str) -> Option<PathBuf> {
    let relative = Path::new(relative);
    if let Some(path) = DIRECTORY
        .get()
        .map(|root| root.join(relative))
        .filter(|path| path.exists())
    {
        return Some(path);
    }
    if cfg!(any(debug_assertions, test)) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        if path.exists() {
            return Some(path);
        }
    }
    None
}
