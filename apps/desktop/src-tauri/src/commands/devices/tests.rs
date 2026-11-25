//! Fixtures under `fixtures/` are `devicectl` 651.32 JSON output: the error, install,
//! launch and app-list files and the iPhone in the list files were recorded on a Mac
//! (the install and launches against a Simulator), with identifiers and serial numbers
//! replaced. The connected iPad in `list-two.json` is the recorded iPhone with the
//! values a ready device reports.

use super::build::{self, ProjectKind, Signing, XcodeProject};
use super::console::Log;
use super::devicectl::{self, Connection, DeveloperMode};
use super::grant::{self, Attached, Level, Need, RememberedDevice};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn fixture(name: &str) -> Value {
    let text = match name {
        "list-none" => include_str!("fixtures/list-none.json"),
        "list-one" => include_str!("fixtures/list-one.json"),
        "list-two" => include_str!("fixtures/list-two.json"),
        "error-not-found" => include_str!("fixtures/error-not-found.json"),
        "error-unavailable" => include_str!("fixtures/error-unavailable.json"),
        "error-terminate" => include_str!("fixtures/error-terminate.json"),
        "install" => include_str!("fixtures/install.json"),
        "launch" => include_str!("fixtures/launch.json"),
        "launch-console-exit" => include_str!("fixtures/launch-console-exit.json"),
        "apps" => include_str!("fixtures/apps.json"),
        _ => panic!("no fixture {name}"),
    };
    serde_json::from_str(text).unwrap()
}

fn scratch() -> PathBuf {
    let path = std::env::temp_dir().join(format!("jackalope-devices-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    path
}

// ---- device lists ----

#[test]
fn an_empty_list_has_no_devices() {
    assert!(devicectl::parse_devices(&fixture("list-none")).is_empty());
}

#[test]
fn simulators_are_left_out_and_an_unreachable_phone_says_why() {
    let devices = devicectl::parse_devices(&fixture("list-one"));
    assert_eq!(devices.len(), 1);
    let phone = &devices[0];
    assert_eq!(phone.name, "Test iPhone");
    assert_eq!(phone.id, "11111111-2222-3333-4444-555555555555");
    assert_eq!(phone.udid.as_deref(), Some("00008130-0000000000000001"));
    assert_eq!(phone.model.as_deref(), Some("iPhone 15 Pro"));
    assert_eq!(phone.kind.as_deref(), Some("iPhone"));
    assert_eq!(phone.os_version.as_deref(), Some("27.3"));
    assert_eq!(phone.connection, Connection::Unavailable);
    assert!(phone.paired);
    assert_eq!(phone.developer_mode, DeveloperMode::Disabled);
    assert!(!phone.ddi_services);
    assert!(phone
        .problem
        .as_deref()
        .unwrap()
        .starts_with("Not connected"));
    assert_eq!(phone.destination(), "id=00008130-0000000000000001");
}

#[test]
fn ready_devices_come_first() {
    let devices = devicectl::parse_devices(&fixture("list-two"));
    let names: Vec<&str> = devices.iter().map(|device| device.name.as_str()).collect();
    assert_eq!(names, ["Test iPad", "Test iPhone"]);
    let ipad = &devices[0];
    assert_eq!(ipad.connection, Connection::Usb);
    assert_eq!(ipad.developer_mode, DeveloperMode::Enabled);
    assert!(ipad.ddi_services);
    assert_eq!(ipad.problem, None);
    assert_eq!(ipad.os_version.as_deref(), Some("27.1"));
    assert!(ipad.named("test ipad"));
    assert!(ipad.named("00008142-0000000000000002"));
    assert!(!ipad.named(""));
}

/// The phone from `list-one`, adjusted.
fn phone(change: impl FnOnce(&mut Value)) -> devicectl::Device {
    let mut list = fixture("list-one");
    change(&mut list["result"]["devices"][0]);
    devicectl::parse_devices(&list).remove(0)
}

#[test]
fn each_problem_names_what_to_do() {
    let connected = |device: &mut Value| {
        device["properties"]["connection"]["state"] = json!("connected");
        device["properties"]["connection"]["transportType"] = json!("localNetwork");
    };
    let developer = phone(connected);
    assert_eq!(developer.connection, Connection::Network);
    assert!(developer
        .problem
        .as_deref()
        .unwrap()
        .contains("Settings → Privacy & Security → Developer Mode"));

    let untrusted = phone(|device| {
        connected(device);
        device["properties"]["connection"]["pairingState"] = json!("unpaired");
        device["connectionProperties"]["pairingState"] = json!("unpaired");
    });
    assert!(!untrusted.paired);
    assert!(untrusted.problem.as_deref().unwrap().contains("tap Trust"));

    let ready = phone(|device| {
        connected(device);
        device["properties"]["state"]["developerModeStatus"] = json!({"enabled":{}});
        device["deviceProperties"]["developerModeStatus"] = Value::Null;
    });
    assert_eq!(ready.developer_mode, DeveloperMode::Enabled);
    assert_eq!(ready.problem, None);

    let unnamed_transport = phone(|device| {
        device["properties"]["connection"]["state"] = json!("disconnected");
        device["connectionProperties"]["tunnelState"] = json!("disconnected");
    });
    assert_eq!(unnamed_transport.connection, Connection::Available);
}

// ---- errors ----

#[test]
fn recorded_errors_become_specific_messages_with_what_devicectl_said() {
    let missing =
        devicectl::outcome(&fixture("error-not-found"), "Test iPhone", "list apps").unwrap_err();
    assert!(
        missing.starts_with("Test iPhone was not found."),
        "{missing}"
    );
    assert!(missing.contains("The specified device was not found."));
    assert!(missing.contains("(com.apple.dt.CoreDeviceError 1000)"));

    let unreachable =
        devicectl::outcome(&fixture("error-unavailable"), "Test iPhone", "list apps").unwrap_err();
    assert!(
        unreachable.starts_with("Test iPhone is not reachable."),
        "{unreachable}"
    );
    assert!(unreachable.contains("4016"));

    let ended =
        devicectl::outcome(&fixture("error-terminate"), "Test iPhone", "stop the app").unwrap_err();
    assert!(
        ended.starts_with("The process had already ended."),
        "{ended}"
    );
    assert!(ended.contains("No such process"));
}

fn nested(description: &str) -> Value {
    json!({
        "code": 3,
        "domain": "com.apple.dt.CoreDeviceError",
        "userInfo": {
            "NSLocalizedDescription": {"string": "The operation couldn't be completed."},
            "NSUnderlyingError": {"error": {
                "code": -402653030,
                "domain": "com.apple.dt.MobileDeviceErrorDomain",
                "userInfo": {"NSLocalizedDescription": {"string": description}}
            }}
        }
    })
}

#[test]
fn underlying_errors_decide_the_message() {
    let message = |description: &str| {
        devicectl::describe_error(&nested(description), "Test iPhone", "install the app")
    };
    assert!(message("The device is locked.").starts_with("Test iPhone is locked."));
    assert!(
        message("Developer Mode is disabled.").starts_with("Developer Mode is off on Test iPhone.")
    );
    assert!(message("The device is not paired with this host.").contains("tap Trust"));
    assert!(
        message("Failed to verify code signature (ApplicationVerificationFailed)")
            .contains("-allowProvisioningUpdates")
    );
    let other = message("Something new.");
    assert!(other.starts_with("Could not install the app on Test iPhone."));
    assert!(other.contains("The operation couldn't be completed."));
    assert!(
        devicectl::describe_error(&Value::Null, "Test iPhone", "launch the app")
            .contains("gave no reason")
    );
}

// ---- results ----

#[test]
fn recorded_results_are_read() {
    let install = devicectl::outcome(&fixture("install"), "d", "install").unwrap();
    assert_eq!(
        devicectl::installed_bundle(&install).as_deref(),
        Some("digital.jackalope.Host")
    );
    let launch = devicectl::outcome(&fixture("launch"), "d", "launch").unwrap();
    assert_eq!(devicectl::launched_pid(&launch), Some(21642));
    assert_eq!(devicectl::termination(&launch), None);
    let exited = devicectl::outcome(&fixture("launch-console-exit"), "d", "launch").unwrap();
    assert_eq!(
        devicectl::termination(&exited).as_deref(),
        Some("The app ended with signal 9.")
    );
    assert_eq!(
        devicectl::termination(&json!({"terminationResult":{"exitCode":2}})).as_deref(),
        Some("The app exited with code 2.")
    );

    let apps = devicectl::parse_apps(&devicectl::outcome(&fixture("apps"), "d", "list").unwrap());
    let ids: Vec<&str> = apps.iter().map(|app| app.bundle_id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "dev.jackalope.companion",
            "digital.jackalope.Driver.xctrunner"
        ]
    );
    assert!(apps.iter().all(|app| app.developer));
    let url = apps[0].url.clone().unwrap();
    let processes = json!({"runningProcesses": [
        {"processIdentifier": 1},
        {"processIdentifier": 812, "executable": format!("{url}Jackalope")},
        {"processIdentifier": 813, "executable": "file:///private/var/containers/Bundle/Application/X/Other.app/Other"},
    ]});
    assert_eq!(devicectl::pids_from(&processes, &url), [812]);
}

// ---- commands ----

fn strings(args: Vec<std::ffi::OsString>) -> Vec<String> {
    args.into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn commands_put_json_output_before_positional_arguments() {
    let json = Path::new("/tmp/out.json");
    assert_eq!(
        strings(devicectl::list_args(json)),
        ["list", "devices", "--json-output", "/tmp/out.json"]
    );
    assert_eq!(
        strings(devicectl::install_args("D", Path::new("/b/App.app"), json)),
        [
            "device",
            "install",
            "app",
            "--device",
            "D",
            "--json-output",
            "/tmp/out.json",
            "/b/App.app"
        ]
    );
    assert_eq!(
        strings(devicectl::launch_args(
            "D",
            "com.example.App",
            true,
            &["-flag".into(), "x".into()],
            json
        )),
        [
            "device",
            "process",
            "launch",
            "--device",
            "D",
            "--terminate-existing",
            "--console",
            "--json-output",
            "/tmp/out.json",
            "com.example.App",
            "--",
            "-flag",
            "x"
        ]
    );
    assert_eq!(
        strings(devicectl::launch_args(
            "D",
            "com.example.App",
            false,
            &[],
            json
        )),
        [
            "device",
            "process",
            "launch",
            "--device",
            "D",
            "--terminate-existing",
            "--json-output",
            "/tmp/out.json",
            "com.example.App"
        ]
    );
    assert_eq!(
        strings(devicectl::terminate_args("D", 42, json)),
        [
            "device",
            "process",
            "terminate",
            "--device",
            "D",
            "--pid",
            "42",
            "--json-output",
            "/tmp/out.json"
        ]
    );
    assert_eq!(
        strings(devicectl::apps_args("D", json))[..5],
        ["device", "info", "apps", "--device", "D"]
    );
}

#[test]
fn device_builds_name_the_destination_and_a_valid_team_only() {
    let project = XcodeProject {
        kind: ProjectKind::Workspace,
        path: PathBuf::from("/w/App.xcworkspace"),
    };
    let derived = Path::new("/data/device-builds/ab");
    assert_eq!(
        strings(build::device_build_args(
            &project,
            "App",
            "id=UDID",
            derived,
            Some("ABCDE12345")
        )),
        [
            "-workspace",
            "/w/App.xcworkspace",
            "-scheme",
            "App",
            "-configuration",
            "Debug",
            "-destination",
            "id=UDID",
            "-derivedDataPath",
            "/data/device-builds/ab",
            "-allowProvisioningUpdates",
            "DEVELOPMENT_TEAM=ABCDE12345",
            "build"
        ]
    );
    let without = strings(build::device_build_args(
        &project,
        "App",
        "id=UDID",
        derived,
        Some("abc; rm"),
    ));
    assert!(!without
        .iter()
        .any(|arg| arg.starts_with("DEVELOPMENT_TEAM")));
    assert!(build::valid_team("ABCDE12345"));
    assert!(!build::valid_team("abcde12345"));
    assert!(!build::valid_team("ABCDE1234"));
}

#[test]
fn schemes_prefer_the_project_name_then_an_app_scheme() {
    let list = json!({"project": {"name": "App", "schemes": ["AppTests", "App", "Widget"]}});
    let schemes = build::schemes(&list);
    assert_eq!(build::pick_scheme(&schemes, "App").as_deref(), Some("App"));
    assert_eq!(
        build::pick_scheme(&schemes, "Other").as_deref(),
        Some("App")
    );
    let workspace = json!({"workspace": {"name": "W", "schemes": ["Core-Package", "Shop"]}});
    assert_eq!(
        build::pick_scheme(&build::schemes(&workspace), "W").as_deref(),
        Some("Shop")
    );
    assert_eq!(build::pick_scheme(&[], "W"), None);
}

#[test]
fn build_failures_keep_xcodebuild_errors_and_explain_signing() {
    let output = "Build settings...\n/w/App.xcodeproj: error: Signing for \"App\" requires a development team. Select a development team in the Signing & Capabilities editor. (in target 'App' from project 'App')\n** BUILD FAILED **\n";
    let message = build::build_failure(output, None);
    assert!(message.contains("Project settings → Commands → Development team"));
    assert!(message.contains("requires a development team"));
    let signed_in = build::build_failure(
        "error: No Accounts: Add a new account in Accounts settings.",
        Some("ABCDE12345"),
    );
    assert!(signed_in.contains("Xcode → Settings → Accounts"));
    assert!(build::build_failure("** BUILD FAILED **", None).ends_with("** BUILD FAILED **"));
}

// ---- signing ----

#[test]
fn signing_is_read_from_codesign() {
    let unsigned = "/b/Jackalope.app: code object is not signed at all\n";
    assert_eq!(build::parse_signing(unsigned, false), Signing::Unsigned);
    let adhoc = "Format=app bundle with Mach-O thin (arm64)\nSignature=adhoc\nInfo.plist=not bound\nTeamIdentifier=not set\n";
    assert_eq!(build::parse_signing(adhoc, false), Signing::AdHoc);
    let signed = "Authority=Apple Development: Example Person (AB12CD34EF)\nAuthority=Apple Worldwide Developer Relations Certification Authority\nTeamIdentifier=ABCDE12345\n";
    assert_eq!(
        build::parse_signing(signed, true),
        Signing::Signed {
            team: "ABCDE12345".into(),
            authority: Some("Apple Development: Example Person (AB12CD34EF)".into()),
        }
    );
    assert_eq!(
        build::parse_signing(signed, false),
        Signing::NoProfile {
            team: Some("ABCDE12345".into())
        }
    );
}

#[test]
fn builds_that_cannot_run_on_a_device_say_how_to_build_one() {
    let product = |platform: &str, signing: Signing| build::Product {
        path: PathBuf::from("/b/Debug-iphoneos/App.app"),
        bundle_id: Some("com.example.App".into()),
        platform: Some(platform.into()),
        signing,
    };
    let simulator = product("iphonesimulator", Signing::AdHoc)
        .problem("id=UDID", None)
        .unwrap();
    assert!(simulator.contains("iphonesimulator build"), "{simulator}");
    assert!(simulator.contains("-destination id=UDID"));
    let adhoc = product("iphoneos", Signing::AdHoc)
        .problem("id=UDID", Some("ABCDE12345"))
        .unwrap();
    assert!(adhoc.contains("only ad hoc signed"));
    assert!(adhoc.contains("-allowProvisioningUpdates DEVELOPMENT_TEAM=ABCDE12345"));
    let unsigned = product("iphoneos", Signing::Unsigned)
        .problem("id=UDID", None)
        .unwrap();
    assert!(unsigned.contains("DEVELOPMENT_TEAM=<your team ID>"));
    let signed = Signing::Signed {
        team: "ABCDE12345".into(),
        authority: None,
    };
    assert_eq!(product("iphoneos", signed).problem("id=UDID", None), None);
}

// ---- finding projects and builds ----

#[test]
fn projects_prefer_a_shallow_workspace() {
    let root = scratch();
    std::fs::create_dir_all(root.join("ios/App.xcodeproj")).unwrap();
    std::fs::create_dir_all(root.join("ios/App.xcworkspace")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/dep/Dep.xcodeproj")).unwrap();
    std::fs::create_dir_all(root.join("ios/App.xcodeproj/project.xcworkspace")).unwrap();
    let found = build::find_project(&root).unwrap();
    assert_eq!(found.kind, ProjectKind::Workspace);
    assert_eq!(found.path, root.join("ios/App.xcworkspace"));
    assert_eq!(found.name(), "App");
    assert_eq!(build::find_project(&scratch()), None);
}

#[test]
fn the_newest_device_app_is_found_and_runners_are_skipped() {
    let derived = scratch();
    let device = derived.join("Build/Products/Debug-iphoneos");
    std::fs::create_dir_all(device.join("AppUITests-Runner.app")).unwrap();
    std::fs::create_dir_all(derived.join("Build/Products/Debug-iphonesimulator/App.app")).unwrap();
    assert_eq!(build::newest_product(&derived), None);
    std::fs::create_dir_all(device.join("App.app")).unwrap();
    assert_eq!(
        build::newest_product(&derived),
        Some(device.join("App.app"))
    );
    assert_eq!(
        build::default_product(&[scratch(), derived.clone()]),
        Some(device.join("App.app"))
    );
}

#[test]
fn named_builds_must_belong_to_the_workspace() {
    let workspace = scratch();
    let derived = scratch();
    std::fs::create_dir_all(workspace.join("build/App.app")).unwrap();
    std::fs::create_dir_all(derived.join("Build/Products/Debug-iphoneos/App.app")).unwrap();
    let elsewhere = scratch().join("Other.app");
    std::fs::create_dir_all(&elsewhere).unwrap();
    let folders = vec![derived.clone()];
    assert!(build::allowed_product(Path::new("build/App.app"), &workspace, &folders).is_ok());
    assert!(build::allowed_product(
        &derived.join("Build/Products/Debug-iphoneos/App.app"),
        &workspace,
        &folders
    )
    .is_ok());
    assert!(build::allowed_product(&elsewhere, &workspace, &folders)
        .unwrap_err()
        .contains("only builds of this workspace"));
    assert!(build::allowed_product(Path::new("build"), &workspace, &folders).is_err());
    assert!(build::allowed_product(Path::new("missing.app"), &workspace, &folders).is_err());
}

#[test]
// Reads plists with macOS tools and expects macOS paths, as the feature runs only there.
#[cfg(target_os = "macos")]
fn xcode_derived_data_counts_when_its_workspace_is_inside() {
    let workspace = scratch();
    let root = scratch();
    let plist = |path: &str| {
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\">\n<dict>\n\t<key>WorkspacePath</key>\n\t<string>{path}</string>\n</dict>\n</plist>\n")
    };
    let canonical = dunce::canonicalize(&workspace).unwrap();
    std::fs::create_dir_all(root.join("App-mine")).unwrap();
    std::fs::write(
        root.join("App-mine/info.plist"),
        plist(&canonical.join("ios/App.xcodeproj").to_string_lossy()),
    )
    .unwrap();
    std::fs::create_dir_all(root.join("App-other")).unwrap();
    std::fs::write(
        root.join("App-other/info.plist"),
        plist("/elsewhere/App.xcodeproj"),
    )
    .unwrap();
    let own = Path::new("/data/device-builds/ab");
    let folders = build::derived_folders(&workspace, own, Some(&root));
    assert_eq!(folders[0], own);
    assert!(folders.contains(&root.join("App-mine")));
    assert!(!folders.contains(&root.join("App-other")));
}

// ---- grants ----

fn attached(level: Level) -> Attached {
    Attached {
        device_id: "phone".into(),
        name: "Test iPhone".into(),
        level,
    }
}

fn remembered(id: &str, name: &str, level: Level) -> RememberedDevice {
    RememberedDevice {
        id: format!("grant-{id}"),
        project_id: "project".into(),
        device_id: id.into(),
        name: name.into(),
        level,
        created_at: String::new(),
    }
}

#[test]
fn nothing_is_allowed_without_the_person() {
    let refused = grant::resolve(None, &[], None, Need::See).unwrap_err();
    assert!(refused.contains("request_human_action"));
    assert!(refused.contains("iPhone or iPad → Attach"));
}

#[test]
fn see_only_allows_the_app_list_and_logs() {
    let see = attached(Level::See);
    assert!(grant::resolve(Some(&see), &[], None, Need::See).is_ok());
    let refused = grant::resolve(Some(&see), &[], None, Need::Control).unwrap_err();
    assert!(refused.contains("seeing only"));
    let control = attached(Level::Control);
    let grant = grant::resolve(Some(&control), &[], None, Need::Control).unwrap();
    assert_eq!(grant.device_id, "phone");
    assert!(!grant.remembered);
}

#[test]
fn the_attached_device_wins_and_project_devices_answer_without_it() {
    let project = vec![remembered("ipad", "Test iPad", Level::Control)];
    let see = attached(Level::See);
    assert_eq!(
        grant::resolve(Some(&see), &project, None, Need::See)
            .unwrap()
            .device_id,
        "phone"
    );
    let named = grant::resolve(Some(&see), &project, Some("test ipad"), Need::Control).unwrap();
    assert_eq!(named.device_id, "ipad");
    assert!(named.remembered);
    assert_eq!(
        grant::resolve(None, &project, None, Need::Control)
            .unwrap()
            .name,
        "Test iPad"
    );
    let unknown = grant::resolve(None, &project, Some("Other"), Need::See).unwrap_err();
    assert!(unknown.starts_with("Other is not attached"));
}

#[test]
fn several_project_devices_need_a_name_and_unknown_levels_allow_nothing() {
    let project = vec![
        remembered("ipad", "Test iPad", Level::Control),
        remembered("phone", "Test iPhone", Level::See),
    ];
    let several = grant::resolve(None, &project, None, Need::See).unwrap_err();
    assert!(several.contains("Test iPad, Test iPhone"));
    assert_eq!(
        grant::resolve(None, &project, Some("phone"), Need::See)
            .unwrap()
            .device_id,
        "phone"
    );
    let newer: RememberedDevice = serde_json::from_value(json!({
        "id": "g", "projectId": "project", "deviceId": "x", "name": "X",
        "level": "everything", "createdAt": ""
    }))
    .unwrap();
    assert_eq!(newer.level, Level::Unknown);
    assert!(grant::resolve(None, &[newer], None, Need::See).is_err());
}

#[test]
fn remembered_devices_are_per_project_replace_their_level_and_can_be_removed() {
    let path = grant::store_path(&scratch());
    let first = grant::remember(&path, "project", "phone", "Test iPhone", Level::See).unwrap();
    grant::remember(&path, "other", "phone", "Test iPhone", Level::Control).unwrap();
    let second = grant::remember(&path, "project", "phone", "Test iPhone", Level::Control).unwrap();
    let saved = grant::remembered(&path, "project");
    assert_eq!(saved, vec![second.clone()]);
    assert!(grant::forget(&path, "project", &first.id).is_err());
    assert!(grant::forget(&path, "other", &second.id).is_err());
    grant::forget(&path, "project", &second.id).unwrap();
    assert!(grant::remembered(&path, "project").is_empty());
    assert_eq!(grant::remembered(&path, "other").len(), 1);
    assert!(grant::remember(&path, "project", "", "X", Level::See).is_err());
}

#[test]
fn attachments_belong_to_one_conversation() {
    let key = format!("conversation-{}", uuid::Uuid::new_v4());
    grant::attach(&key, attached(Level::Control));
    assert_eq!(grant::attached(&key), Some(attached(Level::Control)));
    assert_eq!(grant::attached("another"), None);
    assert_eq!(grant::detach(&key), Some(attached(Level::Control)));
    assert_eq!(grant::attached(&key), None);
}

// ---- console logs ----

#[test]
fn console_logs_split_lines_and_stay_bounded() {
    let mut log = Log::default();
    log.push(b"first\nsec", 0);
    log.push(b"[err] boom\n", 1);
    log.push(b"ond\r\n", 0);
    log.push(b"tail", 0);
    log.flush();
    let (lines, first, dropped) = log.read(None, 10);
    assert_eq!(lines, ["first", "[err] boom", "second", "tail"]);
    assert_eq!((first, dropped), (0, false));
    let (lines, first, _) = log.read(Some(2), 1);
    assert_eq!((lines, first), (vec!["second".to_owned()], 2));
    assert_eq!(log.read(None, 2).0, ["second", "tail"]);

    for index in 0..5000 {
        log.line(format!("line {index}"));
    }
    let (lines, first, dropped) = log.read(Some(0), 3);
    assert!(dropped);
    assert!(first > 0);
    assert_eq!(lines.len(), 3);
    assert_eq!(log.next(), 5004);
    log.line("x".repeat(10_000));
    assert_eq!(log.read(None, 1).0[0].len(), 2000);
}

// ---- this Mac ----

/// Runs the real `devicectl list devices`, which works with no device connected:
/// `cargo test devices::tests::real_devicectl -- --ignored`.
#[test]
#[ignore = "needs macOS with Xcode 15 or later"]
fn real_devicectl_lists_devices() {
    let devices = super::list().expect("devicectl list devices");
    for device in &devices {
        assert!(!device.id.is_empty());
    }
}

/// Installs, launches, captures and stops an app with `devicectl` on a Simulator you
/// created, which accepts the same commands as a physical device:
/// `JACKALOPE_DEVICECTL_TARGET=<simulator udid> JACKALOPE_DEVICECTL_APP=<simulator .app>
/// cargo test devices::tests::real_devicectl_drives_a_simulator -- --ignored`.
#[test]
#[ignore = "needs a booted Simulator and an app built for it"]
fn real_devicectl_drives_a_simulator() {
    let target = std::env::var("JACKALOPE_DEVICECTL_TARGET").expect("JACKALOPE_DEVICECTL_TARGET");
    let app =
        PathBuf::from(std::env::var("JACKALOPE_DEVICECTL_APP").expect("JACKALOPE_DEVICECTL_APP"));
    let installed = devicectl::run(
        |json| devicectl::install_args(&target, &app, json),
        std::time::Duration::from_secs(300),
        "the Simulator",
        "install the app",
    )
    .expect("install");
    let bundle = devicectl::installed_bundle(&installed).expect("bundle");
    let apps = devicectl::run(
        |json| devicectl::apps_args(&target, json),
        std::time::Duration::from_secs(60),
        "the Simulator",
        "list apps",
    )
    .expect("apps");
    assert!(devicectl::parse_apps(&apps)
        .iter()
        .any(|app| app.bundle_id == bundle));

    let key = format!("test-{}", uuid::Uuid::new_v4());
    let session = super::console::launch(
        &key,
        &target,
        "the Simulator",
        &bundle,
        Vec::new(),
        30,
        || {},
    );
    session.wait(std::time::Duration::from_secs(5));
    assert!(session.running(), "{:?}", session.ended());
    super::console::stop(&key);
    session.wait(std::time::Duration::from_secs(10));
    let ended = session.ended().expect("stopped");
    assert!(!ended.failed, "{}", ended.message);
    assert!(ended.message.contains("keeps running"), "{}", ended.message);
    let (lines, _, _) = session.log.lock().unwrap().read(None, 10);
    assert!(!lines.is_empty());

    let missing = devicectl::run(
        |json| devicectl::apps_args("00000000-0000-0000-0000-000000000000", json),
        std::time::Duration::from_secs(60),
        "Missing iPhone",
        "list apps",
    )
    .unwrap_err();
    assert!(
        missing.starts_with("Missing iPhone was not found."),
        "{missing}"
    );
}
