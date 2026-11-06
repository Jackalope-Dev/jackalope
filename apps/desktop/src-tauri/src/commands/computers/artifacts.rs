//! Content-addressed transfers with a computer's runner (capability
//! `artifacts`), over the run's own [`Transport`](super::Transport).
//!
//! An artifact is named by its SHA-256 and moves in [`CHUNK`]-byte pieces, so
//! no single request comes near the agent's 1 MB body limit whatever the size.
//! An upload first asks what the runner already holds (`artifact_stat`): a
//! stored artifact is not sent again and a partial one resumes at its last
//! byte. A download appends to a `.part` file beside its destination, so it
//! resumes the same way. Both check the digest before the artifact is used.

use super::runs::{Session, CALL_TIMEOUT, CHUNK};
use base64::Engine;
use serde_json::json;
use sha2::{Digest as _, Sha256};
use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

/// Interrupted transfers are resumed this many times before giving up.
const ATTEMPTS: u32 = 4;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Digest {
    pub sha256: String,
    pub size: u64,
}

impl Digest {
    /// A digest reported by the computer, validated.
    pub fn parse(value: &serde_json::Value) -> Result<Self, String> {
        let sha256 = value["sha256"].as_str().unwrap_or_default();
        let size = value["size"].as_u64();
        match size {
            Some(size) if is_sha256(sha256) => Ok(Self {
                sha256: sha256.into(),
                size,
            }),
            _ => Err("The computer named an artifact without a valid digest.".into()),
        }
    }
}

pub(crate) fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn digest_reader(reader: &mut impl Read) -> Result<Digest, String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut size = 0u64;
    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    Ok(Digest {
        sha256: hex(&hasher.finalize()),
        size,
    })
}

pub(crate) fn digest_file(path: &Path) -> Result<Digest, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    digest_reader(&mut file)
}

fn partial(destination: &Path) -> PathBuf {
    let mut name = destination.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    destination.with_file_name(name)
}

/// Errors that a retry cannot fix.
fn permanent(error: &str) -> bool {
    error.contains("SHA-256 mismatch")
        || error.contains("not on this computer")
        || error.contains("limited to")
        || error.contains("larger than announced")
}

impl Session {
    /// Uploads everything `reader` holds as one artifact and returns its digest.
    pub fn put_artifact(
        &mut self,
        reader: &mut (impl Read + Seek),
        progress: &dyn Fn(u64, u64),
    ) -> Result<Digest, String> {
        reader.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let digest = digest_reader(reader)?;
        let mut failures = 0;
        loop {
            match self.resume_put(reader, &digest, progress) {
                Ok(()) => return Ok(digest),
                Err(error) => {
                    failures += 1;
                    if permanent(&error) || failures >= ATTEMPTS {
                        return Err(error);
                    }
                }
            }
        }
    }

    pub fn put_artifact_file(
        &mut self,
        path: &Path,
        progress: &dyn Fn(u64, u64),
    ) -> Result<Digest, String> {
        let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        self.put_artifact(&mut file, progress)
    }

    fn resume_put(
        &mut self,
        reader: &mut (impl Read + Seek),
        digest: &Digest,
        progress: &dyn Fn(u64, u64),
    ) -> Result<(), String> {
        let stat = self.call(
            json!({"action":"artifact_stat","sha256":digest.sha256}),
            CALL_TIMEOUT,
        )?;
        if stat["complete"] == true {
            progress(digest.size, digest.size);
            return Ok(());
        }
        let mut offset = stat["received"].as_u64().unwrap_or(0).min(digest.size);
        reader
            .seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut buffer = vec![0u8; CHUNK];
        loop {
            let length = (digest.size - offset).min(CHUNK as u64) as usize;
            reader
                .read_exact(&mut buffer[..length])
                .map_err(|e| e.to_string())?;
            let result = self.call(
                json!({
                    "action": "artifact_put",
                    "sha256": digest.sha256,
                    "size": digest.size,
                    "offset": offset,
                    "data": base64::engine::general_purpose::STANDARD.encode(&buffer[..length]),
                }),
                CALL_TIMEOUT,
            )?;
            offset += length as u64;
            progress(offset, digest.size);
            if result["complete"] == true {
                return Ok(());
            }
            if offset >= digest.size {
                return Err("The computer did not accept the whole artifact.".into());
            }
        }
    }

    /// Downloads an artifact to `destination`, resuming a partial download
    /// left beside it, and checks its digest before moving it into place.
    pub fn fetch_artifact(&mut self, digest: &Digest, destination: &Path) -> Result<(), String> {
        let part = partial(destination);
        let mut failures = 0;
        loop {
            match self.resume_fetch(digest, &part) {
                Ok(()) => break,
                Err(error) => {
                    failures += 1;
                    if permanent(&error) || failures >= ATTEMPTS {
                        return Err(error);
                    }
                }
            }
        }
        if digest_file(&part)? != *digest {
            let _ = std::fs::remove_file(&part);
            return Err(
                "The artifact from the computer was corrupted in transfer (SHA-256 mismatch)."
                    .into(),
            );
        }
        std::fs::rename(&part, destination).map_err(|e| e.to_string())
    }

    fn resume_fetch(&mut self, digest: &Digest, part: &Path) -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(part)
            .map_err(|e| e.to_string())?;
        let mut have = file.metadata().map_err(|e| e.to_string())?.len();
        if have > digest.size {
            file.set_len(0).map_err(|e| e.to_string())?;
            have = 0;
        }
        while have < digest.size {
            let page = self.call(
                json!({"action":"artifact_get","sha256":digest.sha256,"offset":have}),
                CALL_TIMEOUT,
            )?;
            if page["size"].as_u64() != Some(digest.size) {
                return Err("The computer's copy of the artifact has a different size.".into());
            }
            let data = base64::engine::general_purpose::STANDARD
                .decode(page["data"].as_str().unwrap_or_default())
                .map_err(|_| "The computer returned an unreadable artifact.".to_string())?;
            if data.is_empty() || have + data.len() as u64 > digest.size {
                return Err("The computer's artifact ended early.".into());
            }
            file.write_all(&data).map_err(|e| e.to_string())?;
            have += data.len() as u64;
        }
        file.flush().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::commands::computers::Transport;
    use serde_json::Value;
    use std::{
        collections::HashMap,
        sync::{atomic::AtomicBool, Arc, Mutex},
        time::Duration,
    };

    /// A runner's artifact store in memory. `fail_put_at` drops the connection
    /// once at that chunk number; `corrupt` serves altered bytes.
    #[derive(Default)]
    pub(crate) struct Store {
        pub stored: HashMap<String, Vec<u8>>,
        pub partial: HashMap<String, Vec<u8>>,
        pub puts: Vec<u64>,
        pub fail_put_at: Option<usize>,
        pub fail_get_at: Option<usize>,
        pub gets: usize,
        pub corrupt: bool,
        pub other: Vec<Value>,
    }

    pub(crate) struct Fake(pub Arc<Mutex<Store>>);

    impl Fake {
        pub fn answer(store: &mut Store, payload: &Value) -> Option<Result<Value, String>> {
            let engine = base64::engine::general_purpose::STANDARD;
            let sha = payload["sha256"].as_str().unwrap_or_default().to_string();
            Some(match payload["action"].as_str()? {
                "artifact_stat" => Ok(match store.stored.get(&sha) {
                    Some(data) => json!({"complete": true, "received": data.len()}),
                    None => {
                        json!({"complete": false, "received": store.partial.get(&sha).map_or(0, Vec::len)})
                    }
                }),
                "artifact_put" => {
                    if store.fail_put_at == Some(store.puts.len()) {
                        store.fail_put_at = None;
                        store.puts.push(u64::MAX);
                        return Some(Err("connection reset".into()));
                    }
                    let offset = payload["offset"].as_u64().unwrap();
                    store.puts.push(offset);
                    let data = engine.decode(payload["data"].as_str().unwrap()).unwrap();
                    assert!(data.len() <= CHUNK);
                    let part = store.partial.entry(sha.clone()).or_default();
                    if offset == 0 {
                        part.clear();
                    }
                    if offset != part.len() as u64 {
                        return Some(Err(format!("Artifact offset {offset} does not follow")));
                    }
                    part.extend(data);
                    let size = payload["size"].as_u64().unwrap() as usize;
                    if part.len() < size {
                        return Some(Ok(json!({"complete": false, "received": part.len()})));
                    }
                    let part = store.partial.remove(&sha).unwrap();
                    if hex(&Sha256::digest(&part)) != sha {
                        return Some(Err("The artifact was corrupted in transfer (SHA-256 mismatch). Send it again.".into()));
                    }
                    store.stored.insert(sha, part);
                    Ok(json!({"complete": true, "received": size}))
                }
                "artifact_get" => {
                    store.gets += 1;
                    if store.fail_get_at == Some(store.gets) {
                        store.fail_get_at = None;
                        return Some(Err("connection reset".into()));
                    }
                    let Some(data) = store.stored.get(&sha) else {
                        return Some(Err("That artifact is not on this computer.".into()));
                    };
                    let offset = payload["offset"].as_u64().unwrap() as usize;
                    // Small pages, to exercise resuming.
                    let mut page = data[offset..(offset + 5).min(data.len())].to_vec();
                    if store.corrupt && !page.is_empty() {
                        page[0] ^= 1;
                    }
                    Ok(json!({"data": engine.encode(page), "size": data.len()}))
                }
                _ => return None,
            })
        }
    }

    impl Transport for Fake {
        fn call(&mut self, payload: &Value, _: Duration, _: &AtomicBool) -> Result<Value, String> {
            let mut store = self.0.lock().unwrap();
            match Self::answer(&mut store, payload) {
                Some(result) => result,
                None => {
                    store.other.push(payload.clone());
                    Ok(json!({"delivered": true}))
                }
            }
        }
    }

    fn session(store: &Arc<Mutex<Store>>) -> Session {
        Session::with_transport(Box::new(Fake(store.clone())), "w1".into())
    }

    fn scratch() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("jackalope-artifacts-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn uploads_chunk_resume_and_skip_stored_artifacts() {
        let store = Arc::new(Mutex::new(Store {
            fail_put_at: Some(1),
            ..Store::default()
        }));
        let data: Vec<u8> = (0..CHUNK * 2 + 7).map(|n| (n % 253) as u8).collect();
        let mut session = session(&store);
        let digest = session
            .put_artifact(&mut std::io::Cursor::new(&data), &|_, _| {})
            .unwrap();
        assert_eq!(digest.size, data.len() as u64);
        {
            let store = store.lock().unwrap();
            assert_eq!(store.stored[&digest.sha256], data);
            // The second chunk was lost; the upload resumed there, not at zero.
            let chunk = CHUNK as u64;
            assert_eq!(store.puts, [0, u64::MAX, chunk, chunk * 2]);
        }
        store.lock().unwrap().puts.clear();
        session
            .put_artifact(&mut std::io::Cursor::new(&data), &|_, _| {})
            .unwrap();
        assert!(
            store.lock().unwrap().puts.is_empty(),
            "stored artifacts are not sent again"
        );
        let empty = session
            .put_artifact(&mut std::io::Cursor::new(Vec::new()), &|_, _| {})
            .unwrap();
        assert_eq!(store.lock().unwrap().stored[&empty.sha256], b"");
    }

    #[test]
    fn downloads_resume_and_refuse_a_hash_mismatch() {
        let data = b"a screenshot that is longer than one page".to_vec();
        let digest = Digest {
            sha256: hex(&Sha256::digest(&data)),
            size: data.len() as u64,
        };
        let store = Arc::new(Mutex::new(Store {
            fail_get_at: Some(3),
            ..Store::default()
        }));
        store
            .lock()
            .unwrap()
            .stored
            .insert(digest.sha256.clone(), data.clone());
        let dir = scratch();
        let destination = dir.join("shot.png");
        let mut session = session(&store);
        session.fetch_artifact(&digest, &destination).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), data);
        assert!(!partial(&destination).exists());
        // Nine pages of five bytes, one of them sent twice after the failure.
        assert_eq!(store.lock().unwrap().gets, data.len().div_ceil(5) + 1);

        store.lock().unwrap().corrupt = true;
        let other = dir.join("other.png");
        let error = session.fetch_artifact(&digest, &other).unwrap_err();
        assert!(error.contains("SHA-256 mismatch"), "{error}");
        assert!(!other.exists() && !partial(&other).exists());

        let missing = Digest {
            sha256: "0".repeat(64),
            size: 3,
        };
        let error = session.fetch_artifact(&missing, &other).unwrap_err();
        assert!(error.contains("not on this computer"), "{error}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn upload_hash_mismatch_is_not_retried() {
        let store = Arc::new(Mutex::new(Store::default()));
        let mut session = session(&store);
        let digest = Digest {
            sha256: "1".repeat(64),
            size: 4,
        };
        let error = session
            .resume_put(
                &mut std::io::Cursor::new(b"data".to_vec()),
                &digest,
                &|_, _| {},
            )
            .unwrap_err();
        assert!(permanent(&error), "{error}");
        assert!(Digest::parse(&json!({"sha256": "x", "size": 1})).is_err());
        assert!(Digest::parse(&json!({"sha256": digest.sha256, "size": 4})).is_ok());
    }

    #[test]
    fn large_bridge_answers_travel_as_artifacts() {
        let store = Arc::new(Mutex::new(Store::default()));
        let mut session = session(&store);
        session.capabilities = crate::commands::computers::runner::RunnerCapabilities {
            protocol: 4,
            capabilities: vec!["artifacts".into()],
        };
        let large = crate::commands::computers::relay::Answer {
            call: "c1".into(),
            status: 200,
            content_type: "application/json".into(),
            body: vec![b'x'; crate::commands::computers::relay::ANSWER_LIMIT + 1],
        };
        session.answer(&large).unwrap();
        let small = crate::commands::computers::relay::Answer {
            body: b"{}".to_vec(),
            ..large.clone()
        };
        session.answer(&small).unwrap();
        let store = store.lock().unwrap();
        let sent = &store.other;
        let digest = sent[0]["artifact"].as_str().unwrap();
        assert_eq!(store.stored[digest], large.body);
        assert!(sent[0]["body"].is_null());
        assert!(sent[1]["artifact"].is_null());
        assert_eq!(sent[1]["body"], "e30=");
    }
}
