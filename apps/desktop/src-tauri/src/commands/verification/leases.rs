use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

static WORKSPACES: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(Default::default);
static CHECKS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

pub(super) struct CheckSlot;

pub(super) fn check_slot(canceled: impl Fn() -> bool) -> Result<CheckSlot, String> {
    use std::sync::atomic::Ordering;
    let started = std::time::Instant::now();
    loop {
        if canceled() || started.elapsed().as_secs() >= super::QUEUE_TIMEOUT_SECS {
            return Err("Verification was canceled or timed out waiting for a check slot.".into());
        }
        if CHECKS
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                (count < 2).then_some(count + 1)
            })
            .is_ok()
        {
            return Ok(CheckSlot);
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

impl Drop for CheckSlot {
    fn drop(&mut self) {
        CHECKS.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

pub(super) struct Lease(PathBuf);

// Call under the execution guard so launch, integration and cleanup cannot race reservation.
pub(super) fn reserve(workspace: &str) -> Result<Lease, String> {
    let path = std::fs::canonicalize(workspace).map_err(|e| e.to_string())?;
    if !WORKSPACES
        .lock()
        .map_err(|e| e.to_string())?
        .insert(path.clone())
    {
        return Err("This workspace already has a verification running.".into());
    }
    Ok(Lease(path))
}

pub fn ensure_idle(workspace: &str) -> Result<(), String> {
    let Ok(path) = std::fs::canonicalize(workspace) else {
        return Ok(());
    };
    if WORKSPACES
        .lock()
        .map_err(|e| e.to_string())?
        .contains(&path)
    {
        return Err("Wait for this workspace's verification to finish before changing it.".into());
    }
    Ok(())
}

pub fn ensure_all_idle() -> Result<(), String> {
    if !WORKSPACES.lock().map_err(|e| e.to_string())?.is_empty() {
        return Err("Wait for active verification commands to finish.".into());
    }
    Ok(())
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut workspaces) = WORKSPACES.lock() {
            workspaces.remove(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canceled_queue_wait_does_not_claim_capacity() {
        assert!(check_slot(|| true).is_err());
        let slot = check_slot(|| false).unwrap();
        drop(slot);
        assert!(
            super::super::BRIDGE_TIMEOUT_SECS
                > super::super::CHECK_TIMEOUT_SECS + super::super::QUEUE_TIMEOUT_SECS
        );
    }
    #[test]
    fn reservations_exclude_only_the_owned_workspace_and_release_on_drop() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::create_dir_all(root.join("b")).unwrap();
        let a = root.join("a").to_string_lossy().into_owned();
        let b = root.join("b").to_string_lossy().into_owned();
        let guard = crate::commands::integration::execution_guard().unwrap();
        let lease = reserve(&a).unwrap();
        drop(guard);
        assert!(ensure_idle(&a).is_err());
        assert!(reserve(&a).is_err());
        assert!(ensure_idle(&b).is_ok());
        assert!(crate::commands::integration::execution_guard().is_ok());
        drop(lease);
        assert!(ensure_idle(&a).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
}
