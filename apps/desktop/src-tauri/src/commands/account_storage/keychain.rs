use std::{path::Path, sync::Mutex};

const PREFIX: &str = "jackalope-keyring-v1:";
const SERVICE: &str = "dev.jackalope.desktop";
static STORAGE: Mutex<()> = Mutex::new(());

fn unavailable(_: keyring::Error) -> String {
    if cfg!(target_os = "macos") {
        "Unlock your login Keychain and allow Jackalope to access its saved account, then retry."
            .into()
    } else {
        "Unlock a desktop Secret Service keyring (such as GNOME Keyring or KWallet) in this login session, then retry. Jackalope does not save credentials as plaintext.".into()
    }
}

fn record(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::File::open(path) {
        Ok(file) => {
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(16385)
                .read_to_end(&mut bytes)
                .map_err(|_| "The secure account record could not be read.")?;
            if bytes.len() > 16384 {
                return Err("The secure account record is invalid.".into());
            }
            Ok(Some(bytes))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("The secure account record could not be read.".into()),
    }
}

fn identifier(bytes: &[u8]) -> Result<&str, String> {
    let value = std::str::from_utf8(bytes)
        .ok()
        .and_then(|text| text.strip_prefix(PREFIX))
        .ok_or("The secure account record is invalid. Reconnect this account.")?;
    uuid::Uuid::parse_str(value).map_err(|_| "The secure account reference is invalid.")?;
    Ok(value)
}

pub(in crate::commands) fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let _guard = STORAGE
        .lock()
        .map_err(|_| "Secure storage is unavailable.")?;
    let Some(bytes) = record(path)? else {
        return Ok(None);
    };
    let entry = keyring::Entry::new(SERVICE, identifier(&bytes)?).map_err(unavailable)?;
    let secret = entry.get_secret().map_err(unavailable)?;
    if secret.len() > 16384 {
        return Err("The secure account record is invalid.".into());
    }
    Ok(Some(secret))
}

pub(in crate::commands) fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let _guard = STORAGE
        .lock()
        .map_err(|_| "Secure storage is unavailable.")?;
    if bytes.len() > 16384 {
        return Err("The secure account record is too large.".into());
    }
    let previous = record(path)?;
    let existing = previous.as_deref().and_then(|bytes| identifier(bytes).ok());
    let id = existing
        .map(str::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let entry = keyring::Entry::new(SERVICE, &id).map_err(unavailable)?;
    save_record(path, bytes, &id, existing.is_some(), &entry)
}

fn save_record(
    path: &Path,
    bytes: &[u8],
    id: &str,
    existing: bool,
    entry: &keyring::Entry,
) -> Result<(), String> {
    entry.set_secret(bytes).map_err(unavailable)?;
    if !existing {
        if let Err(error) =
            super::super::history::write_atomic(path, format!("{PREFIX}{id}").as_bytes())
        {
            let _ = entry.delete_credential();
            return Err(error);
        }
    }
    Ok(())
}

pub(in crate::commands) fn remove(path: &Path) -> Result<(), String> {
    let _guard = STORAGE
        .lock()
        .map_err(|_| "Secure storage is unavailable.")?;
    let Some(bytes) = record(path)? else {
        return Ok(());
    };
    if bytes.starts_with(PREFIX.as_bytes()) {
        let entry = keyring::Entry::new(SERVICE, identifier(&bytes)?).map_err(unavailable)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => (),
            Err(error) => return Err(unavailable(error)),
        }
    }
    std::fs::remove_file(path)
        .map_err(|_| "The saved account could not be removed. Please retry.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_file_contains_only_a_reference_and_failed_writes_remove_secret() {
        use keyring::credential::CredentialBuilderApi;
        let id = uuid::Uuid::new_v4().to_string();
        let entry = keyring::Entry::new_with_credential(
            keyring::mock::MockCredentialBuilder {}
                .build(None, SERVICE, &id)
                .unwrap(),
        );
        let directory = std::env::temp_dir().join(format!("jl-keyring-{id}"));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("account.bin");
        save_record(&path, b"fixture-secret", &id, false, &entry).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(identifier(&bytes).unwrap(), id);
        assert!(!bytes.windows(14).any(|part| part == b"fixture-secret"));
        assert_eq!(entry.get_secret().unwrap(), b"fixture-secret");
        assert!(save_record(&directory, b"fixture-secret", &id, false, &entry).is_err());
        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn malformed_and_plaintext_records_are_rejected() {
        assert!(identifier(b"plaintext-secret").is_err());
        assert!(identifier(b"jackalope-keyring-v1:not-an-id").is_err());
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "Requires an unlocked native Keychain or Secret Service in the current desktop session"]
    fn native_keyring_round_trip_update_and_delete() {
        let directory = std::env::temp_dir().join(format!("jl-keyring-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("account.bin");
        assert!(read(&path).unwrap().is_none());
        write(&path, b"first-fixture-secret").unwrap();
        let marker = std::fs::read(&path).unwrap();
        assert_eq!(read(&path).unwrap().unwrap(), b"first-fixture-secret");
        write(&path, b"second-fixture-secret").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), marker);
        assert_eq!(read(&path).unwrap().unwrap(), b"second-fixture-secret");
        let entry = keyring::Entry::new(SERVICE, identifier(&marker).unwrap()).unwrap();
        remove(&path).unwrap();
        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
        assert!(read(&path).unwrap().is_none());
        remove(&path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
