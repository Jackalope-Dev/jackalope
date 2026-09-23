use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) struct Directory {
    parent: PathBuf,
    path: PathBuf,
}

impl Directory {
    pub fn create(parent: &Path) -> Result<Self, String> {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
        let path = parent.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&path).map_err(|e| e.to_string())?;
        Ok(Self { parent, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        if self.path.is_absolute() && self.path.parent() == Some(self.parent.as_path()) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
