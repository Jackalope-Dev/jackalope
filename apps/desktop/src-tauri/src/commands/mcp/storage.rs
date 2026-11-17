use super::*;
use crate::commands::account_storage;

pub(super) fn owned(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name == "mcp_servers.json")
}

pub(super) fn read(path: &Path) -> Result<String, String> {
    let Some(bytes) = read_bytes(path)? else {
        return Ok(String::new());
    };
    if let Ok(text) = std::str::from_utf8(&bytes) {
        if text.is_empty() {
            return Ok(String::new());
        }
        if text.trim_start().starts_with('{') {
            if !serde_json::from_str::<Value>(text).is_ok_and(|value| value.is_object()) {
                return Err(
                    "Invalid legacy MCP configuration; its contents were preserved.".into(),
                );
            }
            write(path, text)?;
            return Ok(text.into());
        }
    }
    let bytes =
        account_storage::read(path)?.ok_or("The protected MCP configuration is missing.")?;
    String::from_utf8(bytes).map_err(|_| "The protected MCP configuration is unreadable.".into())
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    crate::commands::platform::read_capped(path, 1024 * 1024 + 4096).map_err(|error| {
        if error.kind() == std::io::ErrorKind::InvalidData {
            "MCP configuration exceeds its size limit.".to_string()
        } else {
            "Could not read MCP configuration.".to_string()
        }
    })
}

pub(super) fn write(path: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid MCP configuration path.")?)
        .map_err(|_| "Could not create MCP storage.")?;
    // Preserve a legacy backup while removing its plaintext credential storage.
    let backup = path.with_extension("jackalope-backup");
    if let Some(bytes) = read_bytes(&backup)? {
        if std::str::from_utf8(&bytes).is_ok_and(|text| text.trim_start().starts_with('{')) {
            account_storage::write(&backup, &bytes)?;
        }
    }
    account_storage::write(path, text.as_bytes())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn legacy_owned_config_and_backup_become_protected_without_losing_values() {
        let folder = std::env::temp_dir().join(format!("mcp-protection-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("mcp_servers.json");
        let backup = path.with_extension("jackalope-backup");
        let text = r#"{"mcpServers":{"test":{"env":{"API_KEY":"fixture-private-key"}}}}"#;
        fs::write(&path, text).unwrap();
        fs::write(&backup, text).unwrap();
        assert_eq!(read(&path).unwrap(), text);
        write(&path, text).unwrap();
        assert_eq!(read(&path).unwrap(), text);
        for file in [&path, &backup] {
            let bytes = fs::read(file).unwrap();
            assert!(!bytes.windows(19).any(|part| part == b"fixture-private-key"));
            account_storage::remove(file).unwrap();
        }
        fs::remove_dir(folder).unwrap();
    }
}
