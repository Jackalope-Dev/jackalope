//! Protected records: small secrets saved with DPAPI on Windows, and in the
//! login keyring elsewhere with only a reference on disk.

use std::path::Path;

const MAX_SECRET_BYTES: usize = 1024 * 1024;
/// The most a record file can hold: an encrypted secret, or a keyring reference.
const MAX_RECORD_FILE: u64 = MAX_SECRET_BYTES as u64 + 4096;

/// Every file name a protected record is saved under. On macOS and Linux the
/// file only names a keyring entry, so deleting it without [`remove`] leaves
/// the secret behind; reset removes these through [`remove`].
const RECORD_NAMES: &[&str] = &[
    "account.bin",
    "agent-credentials.bin",
    "api-key.bin",
    "cloudflare-artifacts.bin",
    "cloudflare-postgres.bin",
    "composio.bin",
    "issue-connections.bin",
    "remote-access.bin",
    "remote-hosts.bin",
    "remote.bin",
    "settings-sync-choice.bin",
    "swarm.bin",
];

/// Whether `path` is a protected record: a registered name, or a project's
/// secrets in `project-secrets/`.
pub(super) fn is_record(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    RECORD_NAMES.contains(&name)
        || (name.ends_with(".bin")
            && path
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|folder| folder == "project-secrets"))
}

/// The record file's own bytes, unprotected: an encrypted blob, a keyring
/// reference, or plaintext an older version wrote.
fn read_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    super::platform::read_capped(path, MAX_RECORD_FILE).map_err(|error| {
        if error.kind() == std::io::ErrorKind::InvalidData {
            "The secure account record is invalid.".to_string()
        } else {
            "The secure account record could not be read.".to_string()
        }
    })
}

/// Reads a protected JSON record; `None` when there is none. `unreadable` is
/// the error when it does not decode.
pub(super) fn read_json<T: serde::de::DeserializeOwned>(
    path: &Path,
    unreadable: &str,
) -> Result<Option<T>, String> {
    read(path)?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| unreadable.to_string()))
        .transpose()
}

/// Saves `value` as a protected JSON record.
pub(super) fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| "Could not prepare the record for secure storage.")?;
    write(path, &bytes)
}

/// Reads a record that older versions saved as plaintext. When `legacy`
/// recognises the file as that plaintext, it is moved into protected storage
/// and returned; otherwise the file is read as a protected record.
pub(super) fn read_or_migrate(
    path: &Path,
    legacy: impl FnOnce(&[u8]) -> bool,
) -> Result<Option<Vec<u8>>, String> {
    match read_file(path)? {
        None => Ok(None),
        Some(bytes) if legacy(&bytes) => {
            write(path, &bytes)?;
            Ok(Some(bytes))
        }
        Some(_) => read(path),
    }
}

#[cfg(windows)]
fn transform(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| "Account record is too large.")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI binds this record to the Windows user; never fall back to plaintext.
    let success = unsafe {
        if protect {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err("Windows could not unlock secure account storage. Use the Windows profile that connected this account.".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}
#[cfg(any(unix, test))]
mod keychain;

#[cfg(windows)]
pub(super) fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let Some(bytes) = read_file(path)? else {
        return Ok(None);
    };
    let plain = transform(&bytes, false)?;
    if plain.len() > MAX_SECRET_BYTES {
        return Err("The secure account record is too large.".into());
    }
    Ok(Some(plain))
}
#[cfg(unix)]
pub(super) use keychain::{read, remove, write};

#[cfg(windows)]
pub(super) fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_SECRET_BYTES {
        return Err("The secure account record is too large.".into());
    }
    let protected = transform(bytes, true)?;
    // Connections save into profile folders that may not exist yet on a new profile.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "The account could not be saved securely. Try connecting again.")?;
    }
    super::history::write_atomic(path, &protected)
        .map_err(|_| "The account could not be saved securely. Try connecting again.".into())
}
#[cfg(windows)]
pub(super) fn remove(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("The saved account could not be removed. Please retry.".into()),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn credentials_round_trip_only_through_protected_storage() {
        let folder =
            std::env::temp_dir().join(format!("jackalope-account-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        // A connection's first save can target a folder the profile has not created yet.
        let path = folder.join("integrations").join("account.bin");
        let plain = b"fixture-device-credential-never-store-as-plaintext";
        write(&path, plain).unwrap();
        let mut encrypted = std::fs::read(&path).unwrap();
        assert!(!encrypted.windows(plain.len()).any(|part| part == plain));
        assert_eq!(read(&path).unwrap().unwrap(), plain);
        let last = encrypted.len() - 1;
        encrypted[last] ^= 1;
        std::fs::write(&path, encrypted).unwrap();
        assert!(read(&path).is_err());
        remove(&path).unwrap();
        assert!(read(&path).unwrap().is_none());
        std::fs::remove_dir_all(folder).unwrap();
    }
}

#[cfg(test)]
mod registry_tests {
    use super::*;

    #[test]
    fn records_are_recognised_by_registered_name_or_project_secrets_folder() {
        let root = Path::new("profile");
        assert!(is_record(&root.join("integrations/composio.bin")));
        assert!(is_record(
            &root.join("agent-profiles/opencode/a/api-key.bin")
        ));
        assert!(is_record(&root.join("project-secrets/project.bin")));
        assert!(!is_record(&root.join("history/run.bin")));
        assert!(!is_record(&root.join("project-secrets/notes.json")));
    }
}
