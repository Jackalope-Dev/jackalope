#[cfg(windows)]
use std::path::Path;

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
    use std::io::Read;
    let bytes = std::fs::File::open(path).and_then(|file| {
        let mut bytes = Vec::new();
        file.take(16385).read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    match bytes {
        Ok(bytes) if bytes.len() <= 16384 => transform(&bytes, false).map(Some),
        Ok(_) => Err("The secure account record is invalid.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("The secure account record could not be read.".into()),
    }
}
#[cfg(unix)]
pub(super) use keychain::{read, remove, write};

#[cfg(windows)]
pub(super) fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    super::history::write_atomic(path, &transform(bytes, true)?)
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
        let path = folder.join("account.bin");
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
        std::fs::remove_dir(folder).unwrap();
    }
}
