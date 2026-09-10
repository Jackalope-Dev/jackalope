use std::fs::{File, TryLockError};

pub(super) struct FileLock(File);

impl FileLock {
    pub(super) fn try_new(file: File) -> Result<Self, TryLockError> {
        file.try_lock()?;
        Ok(Self(file))
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        // A forked child can retain the open file description after this owner closes it.
        let _ = self.0.unlock();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, time::SystemTime};

    #[test]
    fn last_owner_releases_lock_even_with_a_duplicated_unix_descriptor() {
        let path = std::env::temp_dir().join(format!(
            "jackalope-file-lock-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let owner = Arc::new(FileLock::try_new(File::create_new(&path).unwrap()).unwrap());
        let competing = File::options().read(true).write(true).open(&path).unwrap();
        assert!(competing.try_lock().is_err());
        let retained = owner.clone();
        drop(owner);
        assert!(competing.try_lock().is_err());
        #[cfg(unix)]
        let inherited = retained.0.try_clone().unwrap();
        drop(retained);
        competing.try_lock().unwrap();
        competing.unlock().unwrap();
        #[cfg(unix)]
        drop(inherited);
        drop(competing);
        std::fs::remove_file(path).unwrap();
    }
}
