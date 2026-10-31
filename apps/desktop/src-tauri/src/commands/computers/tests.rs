use super::*;
use sha2::Digest;

fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("jackalope-computers-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn bot(root: &Path, owner: &str) -> Computer {
    configure(
        root,
        BOT,
        owner,
        "Scout computer",
        LOCAL_DOCKER,
        None,
        ComputerSettings::default(),
        &format!("bot:{owner}"),
    )
    .unwrap()
}

#[test]
fn each_owner_gets_one_computer_and_kind_changes_need_a_delete() {
    let root = root();
    let first = bot(&root, "b1");
    let again = configure(
        &root,
        BOT,
        "b1",
        "Renamed",
        LOCAL_DOCKER,
        None,
        ComputerSettings {
            cpus: 4.0,
            ..Default::default()
        },
        "bot:b1",
    )
    .unwrap();
    assert_eq!(again.id, first.id);
    assert_eq!(again.name, "Renamed");
    assert_eq!(again.settings.cpus, 4.0);
    assert_eq!(find(&root, BOT, "b1").unwrap().decisions, "bot:b1");
    assert!(
        find(&root, TASK, "b1").is_none(),
        "a bot's ID never reaches a task computer"
    );
    assert!(configure(
        &root,
        BOT,
        "b1",
        "x",
        REMOTE_MACHINE,
        Some("m".into()),
        ComputerSettings::default(),
        ""
    )
    .is_err());
    assert!(configure(
        &root,
        BOT,
        "b2",
        "x",
        HOSTED,
        None,
        ComputerSettings::default(),
        ""
    )
    .unwrap_err()
    .contains("not available yet"));
    assert!(configure(
        &root,
        "team",
        "b3",
        "x",
        LOCAL_DOCKER,
        None,
        ComputerSettings::default(),
        ""
    )
    .is_err());
    assert_eq!(list(&root).unwrap().len(), 1);
}

#[test]
fn settings_are_bounded_and_mounts_must_be_folders() {
    let mut settings = ComputerSettings::default();
    assert!(settings.validate().is_ok());
    settings.cpus = 0.1;
    assert!(settings.validate().is_err());
    settings = ComputerSettings {
        memory_mb: 512,
        ..Default::default()
    };
    assert!(settings.validate().is_err());
    settings = ComputerSettings {
        project_mount: Some("relative/path".into()),
        ..Default::default()
    };
    assert!(settings.validate().is_err());
    settings.project_mount = Some(root().to_string_lossy().into_owned());
    assert!(settings.validate().is_ok());
}

#[test]
fn saved_records_from_other_versions_still_load() {
    let root = root();
    std::fs::write(
        root.join("computers.json"),
        r#"{"computers":[
            {"id":"a","name":"Old","ownerKind":"bot","ownerId":"b","provider":"local-docker","createdAt":"2026-01-01T00:00:00Z"},
            {"id":"n","name":"Newer","ownerKind":"bot","ownerId":"c","provider":"some-cloud","createdAt":"2026-01-01T00:00:00Z","futureField":1}
        ]}"#,
    )
    .unwrap();
    let saved = list(&root).unwrap();
    assert_eq!(saved.len(), 2);
    assert_eq!(saved[0].settings, ComputerSettings::default());
    assert_eq!(saved[0].settings.idle_stop_minutes, 10);
    assert!(provider(&saved[1].provider).is_err());
    let status = status(&root, saved[1].clone());
    assert_eq!(status.state, "unavailable");
    assert!(!status.viewer);

    std::fs::write(root.join("computers.json"), b"{not json").unwrap();
    assert!(list(&root).is_err());
    assert!(configure(
        &root,
        BOT,
        "z",
        "Z",
        LOCAL_DOCKER,
        None,
        ComputerSettings::default(),
        ""
    )
    .is_err());
    assert_eq!(
        std::fs::read(root.join("computers.json")).unwrap(),
        b"{not json"
    );
}

#[test]
fn a_paired_machine_belongs_to_one_bot() {
    let root = root();
    std::fs::write(
        root.join("machines.json"),
        r#"{"machines":[{"id":"m1","name":"VM","url":"https://vm.example.com","createdAt":"2026-01-01T00:00:00Z"}]}"#,
    )
    .unwrap();
    let first = configure(
        &root,
        BOT,
        "b1",
        "One",
        REMOTE_MACHINE,
        Some("m1".into()),
        ComputerSettings::default(),
        "bot:b1",
    )
    .unwrap();
    assert_eq!(first.machine_id.as_deref(), Some("m1"));
    assert!(configure(
        &root,
        BOT,
        "b2",
        "Two",
        REMOTE_MACHINE,
        Some("m1".into()),
        ComputerSettings::default(),
        "bot:b2"
    )
    .unwrap_err()
    .contains("already"));
    assert!(configure(
        &root,
        BOT,
        "b3",
        "Three",
        REMOTE_MACHINE,
        Some("gone".into()),
        ComputerSettings::default(),
        ""
    )
    .is_err());
    assert!(remote::remove(&root, "m1")
        .unwrap_err()
        .contains("uses this machine"));
}

#[test]
fn hosted_computers_refuse_every_operation() {
    let root = root();
    let mut computer = bot(&root, "b1");
    computer.provider = HOSTED.into();
    let hosted = provider(HOSTED).unwrap();
    assert!(hosted.available(&root, &computer).is_err());
    assert!(hosted.start(&root, &computer, &|_| {}).is_err());
    assert!(hosted.transport(&root, &computer).is_err());
    assert!(hosted.delete(&root, &computer).is_ok());
}

#[test]
fn docker_detection_explains_each_unavailable_state() {
    let running = r#"{"Client":{"Version":"27.1.1"},"Server":{"Version":"27.1.1","Os":"linux","Arch":"arm64"}}"#;
    let status = docker::interpret(Ok(running), "desktop-linux");
    assert!(status.available);
    assert_eq!(status.engine.as_deref(), Some("docker-desktop"));
    assert_eq!(status.arch.as_deref(), Some("arm64"));
    assert!(status.message.is_none());

    let colima = docker::interpret(Err(r#"{"Client":{"Version":"27.0.0"}}"#), "colima");
    assert!(!colima.available);
    assert!(colima.message.unwrap().contains("colima start"));
    assert_eq!(colima.client_version.as_deref(), Some("27.0.0"));

    let windows = docker::interpret(
        Ok(
            r#"{"Client":{"Version":"27"},"Server":{"Version":"27","Os":"windows","Arch":"amd64"}}"#,
        ),
        "desktop-windows",
    );
    assert!(!windows.available);
    assert!(windows.message.unwrap().contains("Linux containers"));

    let stopped = docker::interpret(Ok(r#"{"Client":{"Version":"27"}}"#), "default");
    assert!(!stopped.available);
    assert!(stopped.install_url.is_some());
}

#[test]
fn containers_are_locked_down_and_publish_only_to_loopback() {
    let root = root();
    let mut computer = bot(&root, "b1");
    let args = docker::create_args(&computer, "jackalope-computer:abc");
    let joined = args.join(" ");
    for expected in [
        "--cap-drop ALL",
        "--security-opt no-new-privileges",
        "--init",
        "--cpus 2",
        "--memory 4096m",
        "--memory-swap 4096m",
        "--publish 127.0.0.1::6080",
        "--publish 127.0.0.1::9223",
        "--env JACKALOPE_VNC_PASSWORD --volume",
    ] {
        assert!(joined.contains(expected), "missing {expected} in {joined}");
    }
    assert!(
        !joined.contains("JACKALOPE_VNC_PASSWORD="),
        "the password never reaches arguments"
    );
    assert!(!joined.contains("--privileged") && !joined.contains("/var/run/docker.sock"));
    assert!(
        !joined.contains("--mount"),
        "no host folders unless a task shares its project"
    );
    assert_eq!(args.last().unwrap(), "jackalope-computer:abc");
    assert!(joined.contains(&format!("{}:/home/bot", docker::volume(&computer))));

    computer.settings.network = false;
    computer.settings.project_mount = Some("/work/repo".into());
    let offline = docker::create_args(&computer, "img").join(" ");
    assert!(offline.contains("--network none"));
    assert!(!offline.contains("--publish"));
    assert!(offline.contains("source=/work/repo,target=/workspace/project,readonly"));
    assert_ne!(
        docker::config_digest(&computer, "img"),
        docker::config_digest(&bot(&root, "b2"), "img")
    );
}

#[test]
fn published_ports_and_viewer_addresses_stay_on_loopback() {
    assert_eq!(docker::loopback_port("127.0.0.1:49153\n"), Some(49153));
    assert_eq!(docker::loopback_port("0.0.0.0:49153\n[::]:49153"), None);
    let url = docker::viewer_url(6100, false, "abcd1234");
    assert!(url.starts_with("http://127.0.0.1:6100/vnc_lite.html?"));
    assert!(url.contains("view_only=true"));
    let (page, fragment) = url.split_once('#').unwrap();
    assert!(
        !page.contains("abcd1234"),
        "the password stays out of the request"
    );
    assert!(fragment.contains("password=abcd1234"));
}

#[test]
fn the_image_tag_follows_the_bundled_definition() {
    let directory = image_directory().unwrap();
    let tag = docker::image_tag(&directory).unwrap();
    assert!(tag.starts_with("jackalope-computer:"));
    assert_eq!(tag, docker::image_tag(&directory).unwrap());
    let copy = root();
    for name in ["Dockerfile", "start.sh", "agent.py"] {
        std::fs::copy(directory.join(name), copy.join(name)).unwrap();
    }
    assert_eq!(docker::image_tag(&copy).unwrap(), tag);
    std::fs::write(copy.join("agent.py"), b"changed").unwrap();
    assert_ne!(docker::image_tag(&copy).unwrap(), tag);
    std::fs::remove_file(copy.join("start.sh")).unwrap();
    assert!(docker::image_tag(&copy).is_err());
    let dockerfile = std::fs::read_to_string(directory.join("Dockerfile")).unwrap();
    assert!(
        dockerfile.contains("USER bot"),
        "the computer never runs as root"
    );
}

#[test]
fn remote_addresses_require_https_and_real_secrets() {
    assert_eq!(
        remote::normalize_url("https://vm.example.com/").unwrap(),
        "https://vm.example.com"
    );
    assert_eq!(
        remote::normalize_url("https://example.com/computer/").unwrap(),
        "https://example.com/computer"
    );
    assert!(remote::normalize_url("http://127.0.0.1:8765").is_ok());
    assert!(remote::normalize_url("http://vm.example.com").is_err());
    assert!(remote::normalize_url("https://user:pass@vm.example.com").is_err());
    assert!(remote::normalize_url("https://vm.example.com/?token=x").is_err());
    assert!(remote::normalize_url("ftp://vm.example.com").is_err());
    assert!(remote::validate_secret("short").is_err());
    assert!(remote::validate_secret(&"x".repeat(40)).is_ok());
    assert!(remote::validate_secret(&format!("{} {}", "a".repeat(20), "b".repeat(20))).is_err());
}

#[test]
fn the_idle_stop_is_bounded_and_never_recreates_a_container() {
    let root = root();
    let computer = bot(&root, "b1");
    assert_eq!(computer.settings.idle_stop_minutes, 10);
    for minutes in [0, 5, 10, 30, 60] {
        let updated = set_idle_timeout(&root, &computer.id, minutes).unwrap();
        assert_eq!(updated.settings.idle_stop_minutes, minutes);
    }
    assert!(set_idle_timeout(&root, &computer.id, 7).is_err());
    assert!(set_idle_timeout(&root, "gone", 5).is_err());
    assert_eq!(
        get(&root, &computer.id).unwrap().settings.idle_stop_minutes,
        60
    );

    let mut changed = computer.clone();
    changed.settings.idle_stop_minutes = 0;
    assert_eq!(
        docker::config_digest(&changed, "img"),
        docker::config_digest(&computer, "img")
    );
    let earlier = sha2::Sha256::digest(
        "img
{\"cpus\":2.0,\"memoryMb\":4096,\"network\":true,\"projectMount\":null}"
            .as_bytes(),
    );
    let earlier: String = earlier[..8].iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(
        docker::config_digest(&computer, "img"),
        earlier,
        "containers made before the idle stop keep their configuration"
    );
}

#[test]
fn idle_computers_stop_only_past_their_timeout_and_without_a_lease() {
    let minute = Duration::from_secs(60);
    assert!(!usage::idle_due(10, 9 * minute, false));
    assert!(usage::idle_due(10, 10 * minute, false));
    assert!(
        !usage::idle_due(10, 60 * minute, true),
        "a lease keeps it running"
    );
    assert!(!usage::idle_due(0, 600 * minute, false), "never stops");

    assert_eq!(
        usage::describe("running", true, 10, false, 3 * minute, None).as_deref(),
        Some("idle 3 min · stops in 7 min")
    );
    assert_eq!(
        usage::describe("running", true, 10, false, Duration::from_secs(20), None).as_deref(),
        Some("just used · stops in 10 min")
    );
    assert_eq!(
        usage::describe("running", true, 10, true, 30 * minute, None).as_deref(),
        Some("in use")
    );
    assert_eq!(
        usage::describe("running", true, 0, false, 3 * minute, None).as_deref(),
        Some("idle 3 min")
    );
    assert_eq!(
        usage::describe("running", false, 10, false, 3 * minute, None).as_deref(),
        Some("idle 3 min"),
        "cloud machines are never stopped"
    );
    assert_eq!(
        usage::describe("stopped", true, 10, false, Duration::ZERO, Some(10)).as_deref(),
        Some("Stopped after 10 minutes idle")
    );
    assert_eq!(
        usage::describe("stopped", true, 10, false, Duration::ZERO, None),
        None
    );
}

#[test]
fn open_viewers_hold_a_computer_until_released() {
    let root = root();
    let id = format!("viewer-{}", uuid::Uuid::new_v4().simple());
    assert!(!usage::in_use(&id));
    usage::hold_viewer(&root, &id, "a");
    usage::hold_viewer(&root, &id, "b");
    assert!(usage::in_use(&id));
    usage::release_viewer(&id, "a");
    assert!(usage::in_use(&id));
    usage::release_viewer(&id, "b");
    assert!(!usage::in_use(&id));
}

#[test]
fn quit_preferences_default_to_stopping_sandboxes() {
    let root = root();
    assert!(!usage::preferences(&root).keep_running_on_quit);
    let keep = ComputerPreferences {
        keep_running_on_quit: true,
    };
    usage::save_preferences(&root, &keep).unwrap();
    assert_eq!(usage::preferences(&root), keep);
    std::fs::write(root.join("preferences.json"), b"{not json").unwrap();
    assert!(!usage::preferences(&root).keep_running_on_quit);
}

/// Builds the image and drives a real local sandbox. Needs Docker and network
/// access for the image build; run with `-- --ignored --nocapture`.
#[test]
#[ignore = "Builds the image and runs a real Docker container; needs Docker and network access"]
fn local_docker_computer_round_trip() {
    let root = root();
    assert!(docker::detect().available, "Docker is not available");
    let computer = bot(&root, &format!("trial-{}", uuid::Uuid::new_v4().simple()));
    let docker = provider(LOCAL_DOCKER).unwrap();
    let result = (|| -> Result<(), String> {
        docker.start(&root, &computer, &|line| println!("{line}"))?;
        assert_eq!(docker.state(&root, &computer)?, MachineState::Running);
        let canceled = AtomicBool::new(false);
        let hello = call(
            &root,
            &computer,
            json!({"action":"hello"}),
            Duration::from_secs(30),
            &canceled,
        )?;
        assert_eq!(hello["protocol"], 1);
        let shot = call(
            &root,
            &computer,
            json!({"action":"screenshot","thumb":320}),
            Duration::from_secs(30),
            &canceled,
        )?;
        assert!(shot["png"].as_str().is_some_and(|png| png.len() > 100));
        let snapshot = call(
            &root,
            &computer,
            json!({"action":"snapshot"}),
            Duration::from_secs(30),
            &canceled,
        )?;
        assert!(snapshot["bounds"].is_array());
        let exec = call(
            &root,
            &computer,
            json!({"action":"exec","command":"id -u && echo hi > ~/kept","timeout_ms":10000}),
            Duration::from_secs(30),
            &canceled,
        )?;
        assert_eq!(
            exec["stdout"].as_str().unwrap().lines().next(),
            Some("1000")
        );
        assert!(docker.viewer(&root, &computer, false)?.is_some());
        assert!(docker.devtools(&root, &computer).is_some());
        disconnect(&computer.id);
        docker.stop(&root, &computer)?;
        docker.start(&root, &computer, &|_| {})?;
        let kept = call(
            &root,
            &computer,
            json!({"action":"exec","command":"cat ~/kept"}),
            Duration::from_secs(30),
            &canceled,
        )?;
        assert_eq!(
            kept["stdout"].as_str().unwrap().trim(),
            "hi",
            "the home volume persists"
        );
        Ok(())
    })();
    disconnect(&computer.id);
    let cleanup = delete(&root, &computer.id);
    result.unwrap();
    cleanup.unwrap();
}
