use super::*;

fn scratch(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("jackalope-{label}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn runtime_names_and_agent_guidance() {
    assert_eq!(
        short_runtime("com.apple.CoreSimulator.SimRuntime.iOS-27-2"),
        "iOS 27.2"
    );
    let device = Device {
        udid: "U".into(),
        name: "Jackalope 1a2b3c4d".into(),
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-27-2".into(),
        device_type: "t".into(),
        state: "Shutdown".into(),
    };
    let guidance = device.guidance();
    assert!(guidance.contains("Jackalope 1a2b3c4d (iOS 27.2)"));
    assert!(guidance.contains("$JACKALOPE_SIMULATOR_UDID"));
    assert_eq!(
        device.environment(),
        [
            ("JACKALOPE_SIMULATOR_UDID", "U".to_string()),
            ("JACKALOPE_SIMULATOR_NAME", "Jackalope 1a2b3c4d".to_string()),
        ]
    );
}

#[test]
fn ios_projects_and_commands_naming_the_device_need_one() {
    let root = scratch("sim-needed");
    let workspace = root.to_string_lossy().into_owned();
    assert!(!needed_by_agent(&workspace));
    assert!(!needed_by_command(&workspace, "pnpm test"));
    assert!(needed_by_command(
        &workspace,
        "xcrun simctl getenv $JACKALOPE_SIMULATOR_UDID HOME"
    ));
    std::fs::write(root.join("Package.swift"), "Package(name: \"Core\")").unwrap();
    assert!(!needed_by_agent(&workspace));
    std::fs::write(root.join("project.yml"), "name: App\nplatform: iOS\n").unwrap();
    assert!(needed_by_agent(&workspace));
    assert!(needed_by_command(&workspace, "xcodebuild test -scheme App"));
    assert!(!needed_by_command(&workspace, "pnpm test"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_device_in_use_is_never_idle() {
    let mut saved = ledger::Ledger::default();
    saved.devices.push(ledger::Entry {
        udid: "test-in-use".into(),
        name: "Jackalope test".into(),
        workspace: "/w/running".into(),
        project_id: String::new(),
        runtime: "r".into(),
        device_type: "t".into(),
        created_at: String::new(),
    });
    let none = HashSet::new();
    assert!(idle("test-in-use", &saved, &none, &none));
    let running: HashSet<String> = ["/w/running".to_string()].into();
    assert!(!idle("test-in-use", &saved, &running, &none));
    let booting: HashSet<String> = ["test-in-use".to_string()].into();
    assert!(!idle("test-in-use", &saved, &none, &booting));
    let device = Device {
        udid: "test-in-use".into(),
        name: String::new(),
        runtime: String::new(),
        device_type: String::new(),
        state: String::new(),
    };
    let first = InUse::new(&device);
    let second = InUse::new(&device);
    drop(first);
    assert!(!idle("test-in-use", &saved, &none, &none));
    drop(second);
    assert!(idle("test-in-use", &saved, &none, &none));
}

/// Creates, boots and deletes a real device, and checks a command run with
/// the task environment reaches it. Run on a Mac with Xcode:
/// `cargo test --lib simulators::tests::real_device_lifecycle -- --ignored --nocapture`
#[test]
#[ignore = "boots a real iOS Simulator"]
fn real_device_lifecycle() {
    assert!(xcode::toolchain().is_some(), "needs a full Xcode");
    let root = scratch("sim-native");
    let runtime = TaskRuntime::new(root.join("history")).unwrap();
    initialize(root.join("simulators"), runtime);
    let others = |devices: &[simctl::Listed], ours: &str| -> Vec<(String, String)> {
        let mut found: Vec<_> = devices
            .iter()
            .filter(|device| device.udid != ours)
            .map(|device| (device.udid.clone(), device.name.clone()))
            .collect();
        found.sort();
        found
    };
    let before = simctl::devices().unwrap();

    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let request = Request {
        run_id: format!("test{}", uuid::Uuid::new_v4().simple()),
        workspace: workspace.to_string_lossy().into_owned(),
        project_id: "native".into(),
        base: None,
    };
    let _cleanup = ReleaseOnDrop(workspace_identity(&request.workspace));
    let device = assign_for(&request).unwrap();
    assert!(device.name.starts_with("Jackalope test"));
    let saved = ledger::read(&service().unwrap().root).unwrap();
    assert!(saved.owns(&device.udid));
    // A follow-up in the same workspace gets the same device.
    let again = assign_for(&Request {
        run_id: "followup".into(),
        ..request
    })
    .unwrap();
    assert_eq!(again.udid, device.udid);

    let started = Instant::now();
    let booted = boot(&device, || false).unwrap();
    println!("booted {} in {:?}", booted.udid, started.elapsed());
    assert_eq!(
        assigned(&workspace.to_string_lossy()).unwrap().state,
        "Booted"
    );
    assert!(ensure_idle(&workspace.to_string_lossy()).is_ok());

    // What a check command sees.
    let mut check = Command::new("/bin/sh");
    check
        .args([
            "-c",
            "xcrun simctl getenv \"$JACKALOPE_SIMULATOR_UDID\" HOME",
        ])
        .envs(booted.environment());
    xcode::apply(&mut check);
    let output = crate::commands::process_control::run(check, Duration::from_secs(60)).unwrap();
    println!("simulator HOME: {}", output.stdout.trim());
    assert!(output.success, "{}", output.stderr);
    assert!(output.stdout.contains(&device.udid));

    release(workspace_identity(&workspace.to_string_lossy()));
    let deadline = Instant::now() + Duration::from_secs(120);
    while ledger::read(&service().unwrap().root)
        .unwrap()
        .owns(&device.udid)
    {
        assert!(Instant::now() < deadline, "device was not deleted");
        std::thread::sleep(Duration::from_millis(250));
    }
    let after = simctl::devices().unwrap();
    assert!(after.iter().all(|listed| listed.udid != device.udid));
    assert_eq!(others(&before, ""), others(&after, ""));
    std::fs::remove_dir_all(root).unwrap();
}
