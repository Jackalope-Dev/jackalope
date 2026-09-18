use super::*;
use sha2::{Digest, Sha256, Sha512};
use std::io::Write;

struct Temporary(PathBuf);
impl Temporary {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("jackalope-runner-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn archive(directory: &Path, entries: &[(&str, &[u8], tar::EntryType)]) {
    let gzip = flate2::write::GzEncoder::new(
        File::create(directory.join("download.tgz")).unwrap(),
        flate2::Compression::fast(),
    );
    let mut archive = tar::Builder::new(gzip);
    for (path, bytes, kind) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o755);
        header.set_entry_type(*kind);
        header.set_cksum();
        archive.append_data(&mut header, path, *bytes).unwrap();
    }
    archive.into_inner().unwrap().finish().unwrap();
}

fn activate(root: &Path, bytes: &[u8]) -> PathBuf {
    let id = uuid::Uuid::new_v4().to_string();
    let path = root.join(&id).join(BINARY);
    fs::create_dir(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let pin = asset().unwrap();
    let receipt = receipt::Receipt {
        version: VERSION.into(),
        platform: pin.platform,
        archive_sha512: pin.sha512,
        installation: id,
        binary_sha256: hex(Sha256::digest(bytes)),
        binary_bytes: bytes.len() as u64,
    };
    history::write_atomic(
        &root.join("active.json"),
        &serde_json::to_vec(&receipt).unwrap(),
    )
    .unwrap();
    path
}

#[test]
fn manifest_pins_all_six_platforms_to_the_exact_registry_release() {
    let assets: Vec<Asset> = serde_json::from_str(include_str!("assets.json")).unwrap();
    let platforms: std::collections::HashSet<_> = assets.iter().map(|a| &a.platform).collect();
    assert_eq!(assets.len(), 6);
    assert_eq!(platforms.len(), 6);
    for asset in assets {
        assert_eq!(
            asset.url,
            format!(
                "https://registry.npmjs.org/opencode-{0}/-/opencode-{0}-{VERSION}.tgz",
                asset.platform
            )
        );
        assert_eq!(asset.sha512.len(), 128);
        assert!(asset.sha512.bytes().all(|b| b.is_ascii_hexdigit()));
        assert!(asset.unpacked_bytes < MAX_BINARY);
    }
}

#[test]
fn cancellation_is_owned_and_a_second_setup_cannot_replace_it() {
    let service = ManagedRuntime::default();
    let id = uuid::Uuid::new_v4().to_string();
    assert!(service.begin("../bad").is_err());
    let first = service.begin(&id).unwrap();
    assert!(service.begin(&uuid::Uuid::new_v4().to_string()).is_err());
    service.cancel("someone-else");
    assert!(check_cancel(&first.canceled).is_ok());
    service.cancel(&id);
    assert!(check_cancel(&first.canceled).is_err());
    drop(first);
    assert!(service.begin(&uuid::Uuid::new_v4().to_string()).is_ok());
}

#[test]
fn extracts_only_the_exact_regular_executable_and_rejects_duplicates_links_and_missing_files() {
    let expected = format!("package/bin/{BINARY}");
    let pin = asset().unwrap();
    for entries in [
        vec![("package/other", b"keep".as_slice(), tar::EntryType::Regular)],
        vec![(expected.as_str(), b"".as_slice(), tar::EntryType::Symlink)],
        vec![
            (
                expected.as_str(),
                b"first".as_slice(),
                tar::EntryType::Regular,
            ),
            (
                expected.as_str(),
                b"again".as_slice(),
                tar::EntryType::Regular,
            ),
        ],
    ] {
        let temp = Temporary::new();
        archive(&temp.0, &entries);
        assert!(install::extract(&pin, &temp.0, &AtomicBool::new(false)).is_err());
    }
    let temp = Temporary::new();
    archive(
        &temp.0,
        &[
            ("package/unrelated", b"ignored", tar::EntryType::Regular),
            (&expected, b"runner", tar::EntryType::Regular),
        ],
    );
    let (hash, size) = install::extract(&pin, &temp.0, &AtomicBool::new(false)).unwrap();
    assert_eq!(size, 6);
    assert_eq!(hash, hex(Sha256::digest(b"runner")));
    assert!(!temp.0.join("unrelated").exists());
    assert!(install::extract(&pin, &temp.0, &AtomicBool::new(true)).is_err());
}

#[test]
fn receipt_checks_pin_paths_size_and_hash_instead_of_falling_back() {
    let temp = Temporary::new();
    assert_eq!(receipt::resolve(&temp.0).unwrap(), None);
    let path = activate(&temp.0, b"original");
    assert_eq!(receipt::resolve(&temp.0).unwrap(), Some(path.clone()));
    fs::write(&path, b"tampered-content").unwrap();
    assert!(receipt::resolve(&temp.0).is_err());
    let path = activate(&temp.0, b"second");
    fs::write(&path, b"broken").unwrap();
    assert!(receipt::resolve(&temp.0).is_err());
    activate(&temp.0, b"valid");
    let active = temp.0.join("active.json");
    let original: serde_json::Value = serde_json::from_slice(&fs::read(&active).unwrap()).unwrap();
    for (field, value) in [
        ("installation", "../escape"),
        ("version", "0.0.0"),
        ("archiveSha512", "unknown"),
        ("binarySha256", "bad"),
    ] {
        let mut invalid = original.clone();
        invalid[field] = value.into();
        fs::write(&active, invalid.to_string()).unwrap();
        assert!(receipt::resolve(&temp.0).is_err(), "{field}");
    }
}

#[tokio::test]
async fn valid_runner_reuses_offline_and_competing_installs_cannot_activate() {
    let temp = Temporary::new();
    let path = activate(&temp.0, b"cached");
    let events = Arc::new(Mutex::new(Vec::new()));
    let seen = events.clone();
    prepare(
        &temp.0,
        Arc::new(AtomicBool::new(false)),
        Arc::new(move |p| seen.lock().unwrap().push(p.phase)),
    )
    .await
    .unwrap();
    assert_eq!(*events.lock().unwrap(), ["ready"]);
    assert_eq!(receipt::resolve(&temp.0).unwrap(), Some(path));
    let lock = FileLock::try_new(
        File::options()
            .read(true)
            .write(true)
            .open(temp.0.join("install.lock"))
            .unwrap(),
    )
    .unwrap();
    assert!(
        prepare(&temp.0, Arc::new(AtomicBool::new(false)), Arc::new(|_| {}))
            .await
            .unwrap_err()
            .contains("Another Jackalope")
    );
    drop(lock);
    assert!(
        prepare(&temp.0, Arc::new(AtomicBool::new(true)), Arc::new(|_| {}))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn downloads_verify_hash_and_reject_bad_content_without_activation() {
    use std::io::Read;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/fixture", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = stream.read(&mut [0; 4096]);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\narchive",
                )
                .unwrap();
        }
    });
    let mut pin = asset().unwrap();
    pin.url = url;
    let temp = Temporary::new();
    let reporter: Reporter = Arc::new(|_| {});
    assert!(
        install::download(&pin, &temp.0, &AtomicBool::new(false), &reporter)
            .await
            .unwrap_err()
            .contains("integrity")
    );
    assert!(!temp.0.join("active.json").exists());
    let good = Temporary::new();
    pin.sha512 = hex(Sha512::digest(b"archive"));
    install::download(&pin, &good.0, &AtomicBool::new(false), &reporter)
        .await
        .unwrap();
    server.join().unwrap();
}

#[tokio::test]
#[ignore = "downloads the pinned runtime and runs it in an explicitly supplied isolated directory"]
async fn installed_runtime_trial() {
    let root = PathBuf::from(
        std::env::var_os("JACKALOPE_RUNTIME_TRIAL_DIR")
            .expect("Set an absolute isolated trial directory"),
    );
    assert!(root.is_absolute());
    assert!(!root.exists(), "Use a fresh isolated directory");
    let canceled_root = root.with_file_name(format!(
        "{}-canceled",
        root.file_name().unwrap().to_string_lossy()
    ));
    assert!(!canceled_root.exists());
    let canceled = Arc::new(AtomicBool::new(false));
    let signal = canceled.clone();
    let error = prepare(
        &canceled_root,
        canceled,
        Arc::new(move |event| {
            if event.phase == "download" {
                signal.store(true, Ordering::SeqCst);
            }
        }),
    )
    .await
    .unwrap_err();
    assert!(error.contains("canceled"));
    assert!(!canceled_root.join("active.json").exists());
    assert_eq!(
        fs::read_dir(&canceled_root).unwrap().count(),
        1,
        "Only the install lock should remain"
    );
    let events = Arc::new(Mutex::new(Vec::new()));
    let seen = events.clone();
    let started = std::time::Instant::now();
    prepare(
        &root,
        Arc::new(AtomicBool::new(false)),
        Arc::new(move |p| seen.lock().unwrap().push(serde_json::to_value(p).unwrap())),
    )
    .await
    .unwrap();
    let elapsed = started.elapsed().as_millis();
    initialize(root.clone());
    let binary = super::super::tasks::executable("opencode").unwrap();
    assert!(binary.starts_with(&root));
    let mut command = std::process::Command::new(&binary);
    command.arg("--version");
    configure(&mut command);
    assert!(command.get_envs().any(
        |(k, v)| k == "OPENCODE_DISABLE_AUTOUPDATE" && v == Some(std::ffi::OsStr::new("true"))
    ));
    let output =
        super::super::process_control::run(command, std::time::Duration::from_secs(30)).unwrap();
    assert!(output.success);
    assert_eq!(output.stdout.trim(), VERSION);
    let reused = std::time::Instant::now();
    prepare(&root, Arc::new(AtomicBool::new(false)), Arc::new(|_| {}))
        .await
        .unwrap();
    let mut policy = super::super::agent_policy::AgentPolicy::default();
    policy.runner_options.insert(
        "opencode".into(),
        super::super::agent_policy::RunnerOptions {
            command: Some(
                std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
            ),
            ..Default::default()
        },
    );
    assert_eq!(
        policy.resolve("opencode").unwrap().1,
        std::env::current_exe().unwrap()
    );
    fs::write(root.join("trial.json"), serde_json::to_vec_pretty(&serde_json::json!({"version":VERSION,"binary":binary,"downloadAndExtractMs":elapsed,"reuseMs":reused.elapsed().as_millis(),"progress":*events.lock().unwrap(),"realModelInference":false})).unwrap()).unwrap();
}
