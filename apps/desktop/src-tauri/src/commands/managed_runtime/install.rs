use super::*;
use sha2::{Digest, Sha256, Sha512};
use std::{
    io::{Read, Write},
    time::Duration,
};

pub(super) async fn download(
    asset: &Asset,
    directory: &Path,
    canceled: &AtomicBool,
    progress: &Reporter,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let request = client.get(&asset.url).send();
    tokio::pin!(request);
    let mut response = loop {
        tokio::select! {
            result = &mut request => break result.map_err(|_| "Runner download failed. Check your connection and retry.".to_string())?.error_for_status().map_err(|e| format!("Runner download failed: {}", e.status().map(|s| s.to_string()).unwrap_or_default()))?,
            _ = tokio::time::sleep(Duration::from_millis(100)) => check_cancel(canceled)?,
        }
    };
    let total = response.content_length();
    if total.is_some_and(|n| n > MAX_ARCHIVE) {
        return Err("Runner download exceeds its size limit.".into());
    }
    let mut file = File::create_new(directory.join("download.tgz")).map_err(|e| e.to_string())?;
    let mut hasher = Sha512::new();
    let mut completed = 0u64;
    let mut last = std::time::Instant::now();
    report(
        progress,
        "download",
        "Downloading the private OpenCode runner",
        0,
        total,
    );
    loop {
        check_cancel(canceled)?;
        let next = response.chunk();
        tokio::pin!(next);
        let chunk = loop {
            tokio::select! {
                result = &mut next => break result.map_err(|_| "Runner download interrupted. Retry to start again.".to_string())?,
                _ = tokio::time::sleep(Duration::from_millis(100)) => check_cancel(canceled)?,
            }
        };
        let Some(chunk) = chunk else {
            break;
        };
        completed += chunk.len() as u64;
        if completed > MAX_ARCHIVE {
            return Err("Runner download exceeds its size limit.".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        if last.elapsed() >= Duration::from_millis(100) {
            report(
                progress,
                "download",
                "Downloading the private OpenCode runner",
                completed,
                total,
            );
            last = std::time::Instant::now();
        }
    }
    check_cancel(canceled)?;
    if hex(hasher.finalize()) != asset.sha512 {
        return Err(
            "Runner integrity check failed. Nothing was installed; retry the download.".into(),
        );
    }
    file.sync_all().map_err(|e| e.to_string())?;
    report(
        progress,
        "download",
        "Runner download verified",
        completed,
        total,
    );
    Ok(())
}

pub(super) fn extract(
    asset: &Asset,
    directory: &Path,
    canceled: &AtomicBool,
) -> Result<(String, u64), String> {
    let archive = File::open(directory.join("download.tgz")).map_err(|e| e.to_string())?;
    let decoder =
        flate2::read::GzDecoder::new(archive).take(asset.unpacked_bytes.saturating_add(2_000_000));
    let mut archive = tar::Archive::new(decoder);
    let mut result = None;
    let expected = format!("package/bin/{BINARY}");
    for entry in archive.entries().map_err(|e| e.to_string())? {
        check_cancel(canceled)?;
        let mut entry = entry.map_err(|e| e.to_string())?;
        if entry.path_bytes().as_ref() != expected.as_bytes() {
            continue;
        }
        if result.is_some()
            || !entry.header().entry_type().is_file()
            || entry.size() == 0
            || entry.size() > MAX_BINARY
        {
            return Err("Runner archive has an invalid executable.".into());
        }
        let mut file = File::create_new(directory.join(BINARY)).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut size = 0;
        loop {
            check_cancel(canceled)?;
            let count = entry.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            file.write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
            hasher.update(&buffer[..count]);
            size += count as u64;
        }
        if size != entry.size() {
            return Err("Runner archive is incomplete.".into());
        }
        file.sync_all().map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
        result = Some((hex(hasher.finalize()), size));
    }
    result.ok_or_else(|| "Runner archive is missing its executable.".into())
}

pub(super) fn verify_launch(directory: &Path, canceled: &AtomicBool) -> Result<(), String> {
    check_cancel(canceled)?;
    let mut command = std::process::Command::new(directory.join(BINARY));
    command
        .arg("--version")
        .current_dir(directory)
        .env("OPENCODE_DISABLE_AUTOUPDATE", "true");
    let result =
        super::super::process_control::run_cancellable(command, Duration::from_secs(30), || {
            canceled.load(Ordering::SeqCst)
        })?;
    check_cancel(canceled)?;
    if !result.success || result.stdout.trim() != VERSION {
        return Err("The downloaded runner could not start on this computer. Check platform requirements or configure an installed OpenCode executable.".into());
    }
    Ok(())
}
