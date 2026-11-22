use super::{installed_path, partial_path, Model};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::Duration,
};
use tokio::io::AsyncWriteExt;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: &'static str,
    pub received: u64,
    pub total: u64,
    /// `downloading`, then `verifying` while the checksum is computed.
    pub stage: &'static str,
}

/// Downloads in progress by model id, each with its cancel flag.
static ACTIVE: LazyLock<Mutex<HashMap<&'static str, Arc<AtomicBool>>>> =
    LazyLock::new(Default::default);

struct Registration(&'static str);

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            active.remove(self.0);
        }
    }
}

pub(super) fn cancel(model: &Model) {
    if let Some(flag) = ACTIVE
        .lock()
        .ok()
        .and_then(|active| active.get(model.id).cloned())
    {
        flag.store(true, Ordering::SeqCst);
    }
}

pub(super) async fn run(
    model: &'static Model,
    directory: &Path,
    mut emit: impl FnMut(Progress),
) -> Result<(), String> {
    let flag = Arc::new(AtomicBool::new(false));
    let _registration = {
        let mut active = ACTIVE.lock().map_err(|error| error.to_string())?;
        if active.contains_key(model.id) {
            return Err(format!("The {} model is already downloading.", model.label));
        }
        active.insert(model.id, flag.clone());
        Registration(model.id)
    };
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;
    let target = Target {
        url: model.url(),
        bytes: model.bytes,
        sha256: model.sha256,
        part: partial_path(directory, model),
        done: installed_path(directory, model),
    };
    fetch(&target, &flag, |received, stage| {
        emit(Progress {
            id: model.id,
            received,
            total: model.bytes,
            stage,
        })
    })
    .await
}

struct Target<'a> {
    url: String,
    bytes: u64,
    sha256: &'a str,
    part: PathBuf,
    done: PathBuf,
}

/// Reports at most this often while downloading, so the webview is not flooded.
const STEP: u64 = 512 * 1024;

async fn fetch(
    target: &Target<'_>,
    canceled: &AtomicBool,
    mut progress: impl FnMut(u64, &'static str),
) -> Result<(), String> {
    if target.done.is_file() {
        return Ok(());
    }
    let mut have = std::fs::metadata(&target.part).map_or(0, |meta| meta.len());
    if have > target.bytes {
        remove(&target.part)?;
        have = 0;
    }
    if have < target.bytes {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .read_timeout(Duration::from_secs(60))
            .build()
            .map_err(|error| error.to_string())?;
        let mut request = client.get(&target.url);
        if have > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let mut response = request
            .send()
            .await
            .map_err(|error| format!("Could not download the voice model: {error}"))?;
        let status = response.status();
        let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT && have > 0;
        if !status.is_success() {
            return Err(format!("The model download server returned {status}."));
        }
        if !resumed {
            have = 0;
        }
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(resumed)
            .truncate(!resumed)
            .open(&target.part)
            .await
            .map_err(|error| format!("Could not write {}: {error}", target.part.display()))?;
        progress(have, "downloading");
        let mut reported = have;
        while let Some(chunk) = response.chunk().await.map_err(|error| {
            format!("The download was interrupted: {error}. Try again to resume.")
        })? {
            if canceled.load(Ordering::SeqCst) {
                file.flush().await.map_err(|error| error.to_string())?;
                return Err("Download canceled.".into());
            }
            if have + chunk.len() as u64 > target.bytes {
                drop(file);
                remove(&target.part)?;
                return Err(
                    "The model download was larger than expected, so it was removed.".into(),
                );
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("Could not write {}: {error}", target.part.display()))?;
            have += chunk.len() as u64;
            if have - reported >= STEP || have == target.bytes {
                reported = have;
                progress(have, "downloading");
            }
        }
        file.flush().await.map_err(|error| error.to_string())?;
        if have < target.bytes {
            return Err("The download stopped early. Try again to resume.".into());
        }
    }
    progress(target.bytes, "verifying");
    let part = target.part.clone();
    let digest = tokio::task::spawn_blocking(move || sha256(&part))
        .await
        .map_err(|error| error.to_string())??;
    if digest != target.sha256 {
        remove(&target.part)?;
        return Err("The downloaded model did not match its published checksum, so it was removed. Try again.".into());
    }
    std::fs::rename(&target.part, &target.done)
        .map_err(|error| format!("Could not install {}: {error}", target.done.display()))
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn remove(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("Could not remove {}: {error}", path.display()))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        extract::State,
        http::{header, HeaderMap, StatusCode},
        response::Response,
        routing::get,
        Router,
    };

    #[derive(Clone)]
    struct Served {
        body: Arc<Vec<u8>>,
        ranges: Arc<Mutex<Vec<Option<String>>>>,
    }

    async fn serve(State(served): State<Served>, headers: HeaderMap) -> Response {
        let range = headers
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        served.ranges.lock().unwrap().push(range.clone());
        let start = range
            .as_deref()
            .and_then(|value| value.strip_prefix("bytes="))
            .and_then(|value| value.strip_suffix('-'))
            .and_then(|value| value.parse::<usize>().ok());
        match start {
            Some(start) => Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .body(Body::from(served.body[start..].to_vec()))
                .unwrap(),
            None => Response::new(Body::from(served.body.to_vec())),
        }
    }

    async fn server(body: Vec<u8>) -> (String, Served) {
        let served = Served {
            body: Arc::new(body),
            ranges: Default::default(),
        };
        let app = Router::new()
            .route("/model", get(serve))
            .with_state(served.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{address}/model"), served)
    }

    fn folder() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("jackalope-voice-dl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn digest(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn target<'a>(url: &str, body: &[u8], sha: &'a str, folder: &Path) -> Target<'a> {
        Target {
            url: url.into(),
            bytes: body.len() as u64,
            sha256: sha,
            part: folder.join("model.bin.part"),
            done: folder.join("model.bin"),
        }
    }

    #[tokio::test]
    async fn a_download_resumes_from_its_partial_file_and_installs_only_when_verified() {
        let body: Vec<u8> = (0..2_000_000u32).map(|n| (n % 251) as u8).collect();
        let (url, served) = server(body.clone()).await;
        let folder = folder();
        let sha = digest(&body);
        let target = target(&url, &body, &sha, &folder);
        std::fs::write(&target.part, &body[..700_000]).unwrap();

        let mut stages = Vec::new();
        fetch(&target, &AtomicBool::new(false), |received, stage| {
            stages.push((received, stage))
        })
        .await
        .unwrap();
        assert_eq!(std::fs::read(&target.done).unwrap(), body);
        assert!(!target.part.exists());
        assert_eq!(
            served.ranges.lock().unwrap().as_slice(),
            [Some("bytes=700000-".to_string())]
        );
        assert_eq!(stages.first(), Some(&(700_000, "downloading")));
        assert_eq!(stages.last(), Some(&(body.len() as u64, "verifying")));
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[tokio::test]
    async fn a_checksum_mismatch_removes_the_download_and_cancel_keeps_it_for_resuming() {
        let body = vec![7u8; 1_200_000];
        let (url, _) = server(body.clone()).await;
        let folder = folder();
        let wrong = "0".repeat(64);
        let target = target(&url, &body, &wrong, &folder);
        let error = fetch(&target, &AtomicBool::new(false), |_, _| {})
            .await
            .unwrap_err();
        assert!(error.contains("checksum"), "{error}");
        assert!(!target.part.exists() && !target.done.exists());

        let sha = digest(&body);
        let target = Target {
            sha256: &sha,
            ..target
        };
        let error = fetch(&target, &AtomicBool::new(true), |_, _| {})
            .await
            .unwrap_err();
        assert_eq!(error, "Download canceled.");
        assert!(!target.done.exists());
        let _ = std::fs::remove_dir_all(&folder);
    }
}
