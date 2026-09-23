use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub(super) struct FixtureConfig {
    path: PathBuf,
    directory: PathBuf,
    bytes: Vec<u8>,
    directory_created: bool,
    owned: bool,
}

impl FixtureConfig {
    pub(super) fn install(repo: &Path, servers: &serde_json::Value) -> Result<Self, String> {
        let repo = fs::canonicalize(repo).map_err(|e| e.to_string())?;
        let directory = repo.join(".agents");
        let directory_created = !directory.exists();
        if directory_created {
            fs::create_dir(&directory).map_err(|e| e.to_string())?;
        }
        if fs::symlink_metadata(&directory)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
            || !fs::canonicalize(&directory)
                .map_err(|e| e.to_string())?
                .starts_with(&repo)
        {
            return Err("Fixture MCP directory must stay inside the disposable workspace.".into());
        }
        let path = directory.join("mcp_config.json");
        let bytes = serde_json::to_vec(&serde_json::json!({"mcpServers":servers}))
            .map_err(|e| e.to_string())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| {
                "Fixture MCP configuration already exists or cannot be created.".to_string()
            })?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        Ok(Self {
            path,
            directory,
            bytes,
            directory_created,
            owned: true,
        })
    }

    pub(super) fn finish(&mut self) -> Result<(), String> {
        if !self.owned {
            return Ok(());
        }
        if fs::symlink_metadata(&self.directory)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
            || fs::canonicalize(&self.directory).map_err(|e| e.to_string())? != self.directory
        {
            return Err("Fixture MCP directory changed; retained for inspection.".into());
        }
        if fs::read(&self.path).map_err(|e| e.to_string())? != self.bytes {
            return Err(
                "The agent modified its fixture MCP configuration; retained for inspection.".into(),
            );
        }
        fs::remove_file(&self.path).map_err(|e| e.to_string())?;
        self.owned = false;
        if self.directory_created {
            let _ = fs::remove_dir(self.path.parent().unwrap());
        }
        Ok(())
    }
}

impl Drop for FixtureConfig {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

#[test]
fn fixture_configuration_preserves_existing_and_changed_files() {
    let repo = std::env::temp_dir().join(format!("jackalope-mcp-control-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&repo).unwrap();
    let mut config =
        FixtureConfig::install(&repo, &serde_json::json!({"fixture":{"command":"node"}})).unwrap();
    assert!(FixtureConfig::install(&repo, &serde_json::json!({})).is_err());
    config.finish().unwrap();
    assert!(!repo.join(".agents").exists());
    let mut config = FixtureConfig::install(&repo, &serde_json::json!({})).unwrap();
    fs::write(&config.path, "changed").unwrap();
    assert!(config.finish().is_err());
    drop(config);
    assert_eq!(
        fs::read_to_string(repo.join(".agents/mcp_config.json")).unwrap(),
        "changed"
    );
    fs::remove_dir_all(&repo).unwrap();
}
