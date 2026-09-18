use super::*;
use sha2::{Digest, Sha256};
use std::{io::Read, time::SystemTime};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Receipt {
    pub version: String,
    pub platform: String,
    pub archive_sha512: String,
    pub installation: String,
    pub binary_sha256: String,
    pub binary_bytes: u64,
}

#[derive(PartialEq)]
struct Fingerprint {
    path: PathBuf,
    modified: SystemTime,
    bytes: u64,
    hash: String,
}
static VERIFIED: Mutex<Option<Fingerprint>> = Mutex::new(None);

pub(super) fn resolve(root: &Path) -> Result<Option<PathBuf>, String> {
    let active = root.join("active.json");
    if !active.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let receipt: Receipt = serde_json::from_slice(&history::read_bounded(&active, 8192)?)
        .map_err(|e| e.to_string())?;
    let pin = asset()?;
    let id = uuid::Uuid::parse_str(&receipt.installation).map_err(|e| e.to_string())?;
    if id.to_string() != receipt.installation
        || receipt.version != VERSION
        || receipt.platform != pin.platform
        || receipt.archive_sha512 != pin.sha512
        || receipt.binary_bytes == 0
        || receipt.binary_bytes > MAX_BINARY
    {
        return Err("Runner receipt does not match the pinned release.".into());
    }
    let directory = root.join(&receipt.installation);
    let path = directory.join(BINARY);
    if fs::symlink_metadata(&directory)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Runner directory is a link.".into());
    }
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || metadata.len() != receipt.binary_bytes
        || !super::super::platform::is_executable(&path)
    {
        return Err("Runner executable is missing or changed.".into());
    }
    let fingerprint = Fingerprint {
        path: path.clone(),
        modified: metadata.modified().map_err(|e| e.to_string())?,
        bytes: metadata.len(),
        hash: receipt.binary_sha256.clone(),
    };
    let mut verified = VERIFIED.lock().map_err(|e| e.to_string())?;
    if verified.as_ref() != Some(&fingerprint) {
        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        if hex(hasher.finalize()) != receipt.binary_sha256 {
            return Err("Runner executable integrity check failed.".into());
        }
        *verified = Some(fingerprint);
    }
    Ok(Some(path))
}
