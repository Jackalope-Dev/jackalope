use super::tools::*;
use super::*;
use serde_json::json;
use std::time::{Duration, Instant};

fn scratch(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "jackalope-simulator-{label}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}

fn interact(value: serde_json::Value) -> InteractRequest {
    serde_json::from_value(value).unwrap()
}

#[test]
fn interactions_need_their_targets() {
    let candidates = vec!["com.example.App".to_string()];
    let body = interact_body(&interact(json!({"action":"tap","ref":"@e12"})), &candidates).unwrap();
    assert_eq!(body["ref"], "e12");
    assert_eq!(body["bundleIds"][0], "com.example.App");
    let body = interact_body(
        &interact(json!({"action":"long_press","x":20.5,"y":40,"duration":2})),
        &[],
    )
    .unwrap();
    assert_eq!(
        (body["x"].as_f64(), body["y"].as_f64()),
        (Some(20.5), Some(40.0))
    );
    assert_eq!(body["duration"], 2.0);
    for invalid in [
        json!({"action":"tap"}),
        json!({"action":"tap","x":3}),
        json!({"action":"tap","ref":"@e1","x":3,"y":4}),
        json!({"action":"tap","ref":"button"}),
        json!({"action":"tap","x":-1,"y":4}),
        json!({"action":"long_press","ref":"e1","duration":60}),
        json!({"action":"type"}),
        json!({"action":"clear"}),
        json!({"action":"scroll_to"}),
        json!({"action":"swipe"}),
        json!({"action":"swipe","direction":"sideways"}),
        json!({"action":"scroll","direction":"down","distance":1.5}),
        json!({"action":"scroll","direction":"down","velocity":"warp"}),
        json!({"action":"press_button","button":"volume_up"}),
        json!({"action":"rotate","orientation":"diagonal"}),
        json!({"action":"wait"}),
        json!({"action":"wait","text":"Done","ref":"e2"}),
        json!({"action":"wait","text":"Done","timeout":120}),
        json!({"action":"tap","ref":"e1","bundle_id":"bad id"}),
        json!({"action":"pinch"}),
    ] {
        assert!(
            interact_body(&interact(invalid.clone()), &[]).is_err(),
            "{invalid}"
        );
    }
    let wait = interact_body(
        &interact(json!({"action":"wait","text":"Saved","gone":true})),
        &[],
    )
    .unwrap();
    assert_eq!(
        (wait["text"].as_str(), wait["gone"].as_bool()),
        (Some("Saved"), Some(true))
    );
    let scroll = interact_body(
        &interact(json!({"action":"scroll","direction":"down","distance":0.3,"velocity":"slow"})),
        &[],
    )
    .unwrap();
    assert_eq!(
        (scroll["direction"].as_str(), scroll["velocity"].as_str()),
        (Some("down"), Some("slow"))
    );
    assert!(
        serde_json::from_value::<InteractRequest>(json!({"action":"tap","selector":"x"})).is_err()
    );
}

fn app(value: serde_json::Value) -> AppRequest {
    serde_json::from_value(value).unwrap()
}

#[test]
fn app_actions_build_simctl_commands() {
    let workspace = scratch("app");
    let plan = plan_app(
        "UDID",
        &workspace,
        &app(json!({"action":"launch","bundleId":"com.example.App","args":["-Flag","YES"],"env":{"API_URL":"http://localhost:1"}})),
    )
    .unwrap();
    let AppPlan::Simctl(command) = plan else {
        panic!("launch runs simctl")
    };
    assert_eq!(
        command.args,
        [
            "launch",
            "--terminate-running-process",
            "UDID",
            "com.example.App",
            "-Flag",
            "YES"
        ]
    );
    assert_eq!(
        command.env,
        [(
            "SIMCTL_CHILD_API_URL".to_string(),
            "http://localhost:1".to_string()
        )]
    );
    let open = plan_app(
        "UDID",
        &workspace,
        &app(json!({"action":"open_url","url":"myapp://settings?tab=1"})),
    )
    .unwrap();
    assert_eq!(
        open,
        AppPlan::Simctl(simctl::open_url("UDID", "myapp://settings?tab=1"))
    );
    assert_eq!(
        plan_app(
            "UDID",
            &workspace,
            &app(json!({"action":"activate","bundle_id":"com.apple.Preferences"}))
        )
        .unwrap(),
        AppPlan::Driver("activate", "com.apple.Preferences".into())
    );
    assert_eq!(
        plan_app("UDID", &workspace, &app(json!({"action":"list"}))).unwrap(),
        AppPlan::List
    );
    for invalid in [
        json!({"action":"launch"}),
        json!({"action":"launch","bundle_id":"com.example.App","env":{"1BAD":"x"}}),
        json!({"action":"terminate","bundle_id":"com.example.App; rm -rf /"}),
        json!({"action":"open_url","url":"not a url"}),
        json!({"action":"open_url"}),
        json!({"action":"install","path":"Missing.app"}),
        json!({"action":"install","path":"build"}),
        json!({"action":"reinstall"}),
    ] {
        assert!(
            plan_app("UDID", &workspace, &app(invalid.clone())).is_err(),
            "{invalid}"
        );
    }
    let built = workspace.join("build/Debug-iphonesimulator/Demo.app");
    std::fs::create_dir_all(&built).unwrap();
    std::fs::write(built.join("Info.plist"), "").unwrap();
    assert_eq!(
        plan_app(
            "UDID",
            &workspace,
            &app(json!({"action":"install","path":"build/Debug-iphonesimulator/Demo.app"}))
        )
        .unwrap(),
        AppPlan::Install(built)
    );
    std::fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn configuration_runs_each_setting_in_order() {
    let input: ConfigureRequest = serde_json::from_value(json!({
        "appearance": "dark",
        "contentSize": "accessibility-large",
        "increase_contrast": true,
        "location": {"latitude": 37.33, "longitude": -122.03},
        "privacy": {"action": "grant", "service": "photos", "bundle_id": "com.example.App"},
        "status_bar": "clean",
        "push": {"bundle_id": "com.example.App", "payload": {"aps": {"alert": "Hi"}}},
        "pasteboard": "copied"
    }))
    .unwrap();
    let steps = plan_configure("UDID", &input).unwrap();
    let labels: Vec<&str> = steps.iter().map(|step| step.label.as_str()).collect();
    assert_eq!(
        labels,
        [
            "appearance dark",
            "content size accessibility-large",
            "increase contrast enabled",
            "location 37.33,-122.03",
            "grant photos",
            "clean status bar",
            "push to com.example.App",
            "pasteboard set"
        ]
    );
    assert_eq!(steps[0].command.args, ["ui", "UDID", "appearance", "dark"]);
    assert_eq!(
        steps[3].command.args,
        ["location", "UDID", "set", "37.33,-122.03"]
    );
    assert_eq!(
        steps[4].command.args,
        ["privacy", "UDID", "grant", "photos", "com.example.App"]
    );
    assert!(steps[5]
        .command
        .args
        .windows(2)
        .any(|pair| pair == ["--time", "9:41"]));
    assert_eq!(
        steps[6].command.args,
        ["push", "UDID", "com.example.App", "-"]
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(steps[6].command.input.as_ref().unwrap())
            .unwrap()["aps"]["alert"],
        "Hi"
    );
    assert_eq!(
        steps[7].command.input.as_deref(),
        Some(b"copied".as_slice())
    );
    let reset: ConfigureRequest = serde_json::from_value(
        json!({"privacy": {"action": "reset", "service": "all"}, "clear_location": true}),
    )
    .unwrap();
    let steps = plan_configure("UDID", &reset).unwrap();
    assert_eq!(steps[0].command.args, ["location", "UDID", "clear"]);
    assert_eq!(steps[1].command.args, ["privacy", "UDID", "reset", "all"]);
    for invalid in [
        json!({}),
        json!({"appearance": "sepia"}),
        json!({"content_size": "huge"}),
        json!({"location": {"latitude": 91, "longitude": 0}}),
        json!({"location": {"latitude": 1, "longitude": 1}, "clear_location": true}),
        json!({"privacy": {"action": "grant", "service": "photos"}}),
        json!({"privacy": {"action": "grant", "service": "keychain", "bundle_id": "a.b"}}),
        json!({"status_bar": "fancy"}),
        json!({"push": {"bundle_id": "a.b", "payload": {"alert": "no aps"}}}),
    ] {
        let input: ConfigureRequest = serde_json::from_value(invalid.clone()).unwrap();
        assert!(plan_configure("UDID", &input).is_err(), "{invalid}");
    }
    let read: ConfigureRequest = serde_json::from_value(json!({"read_pasteboard": true})).unwrap();
    assert!(plan_configure("UDID", &read).unwrap().is_empty());
}

fn sample() -> serde_json::Value {
    json!({
        "bundleId": "com.apple.Preferences",
        "state": "foreground",
        "screen": [0, 0, 402, 874],
        "tree": {"ref": "e1", "type": "application", "label": "Settings", "frame": [0, 0, 402, 874], "children": [
            {"ref": "e2", "type": "window", "frame": [0, 0, 402, 874], "children": [
                {"ref": "e3", "type": "other", "frame": [0, 0, 402, 874], "children": [
                    {"ref": "e4", "type": "navigationBar", "label": "Settings", "id": "Settings", "frame": [0, 62, 402, 54]},
                    {"ref": "e5", "type": "table", "id": "list", "frame": [0, 116, 402, 700], "children": [
                        {"ref": "e6", "type": "button", "label": "General", "id": "com.apple.settings.general", "frame": [16, 293, 370, 52], "children": [
                            {"ref": "e7", "type": "staticText", "label": "General", "frame": [34, 305, 101, 28]}
                        ]},
                        {"ref": "e8", "type": "switch", "label": "Airplane Mode", "value": "0", "frame": [16, 345, 370, 52], "disabled": true},
                        {"ref": "e9", "type": "searchField", "label": "Search", "value": "Search", "placeholder": "Search", "frame": [28, 808, 346, 28], "focused": true},
                        {"ref": "e10", "type": "staticText", "label": "Say \"hi\"\nnow", "frame": [0, 0, 10, 10]}
                    ], "more": 3}
                ]}
            ]}
        ]},
        "alerts": [{"ref": "e11", "type": "alert", "label": "Allow “Demo” to use your location?", "frame": [40, 300, 320, 200], "children": [
            {"ref": "e12", "type": "button", "label": "Allow Once", "frame": [40, 420, 320, 44]}
        ]}]
    })
}

#[test]
fn snapshots_render_refs_and_leave_out_structure() {
    let rendered = render::render(&sample(), &render::Options::default()).unwrap();
    let text = rendered.text;
    assert!(!rendered.truncated);
    assert!(
        text.starts_with("Settings (com.apple.Preferences, foreground) screen 402x874 pt\n"),
        "{text}"
    );
    assert!(
        text.contains("- navigationBar \"Settings\" @e4 (0,62 402x54)\n"),
        "{text}"
    );
    assert!(
        text.contains(
            "  - button \"General\" @e6 id=\"com.apple.settings.general\" (16,293 370x52)\n"
        ),
        "{text}"
    );
    assert!(
        !text.contains("@e7"),
        "a label repeated by its own text is left out: {text}"
    );
    assert!(
        !text.contains("@e2") && !text.contains("@e3"),
        "bare containers are left out: {text}"
    );
    assert!(
        text.contains("switch \"Airplane Mode\" @e8 value=\"0\" [disabled]"),
        "{text}"
    );
    assert!(
        text.contains("searchField \"Search\" @e9 placeholder=\"Search\" [focused]"),
        "{text}"
    );
    assert!(
        text.contains("staticText \"Say \\\"hi\\\" now\" @e10"),
        "{text}"
    );
    assert!(
        text.contains("… 3 more elements below this depth"),
        "{text}"
    );
    assert!(
        text.contains("System alerts (shown over the app):\n- alert"),
        "{text}"
    );
    assert!(text.contains("  - button \"Allow Once\" @e12"), "{text}");

    let interactive = render::render(
        &sample(),
        &render::Options {
            interactive: true,
            scope: None,
        },
    )
    .unwrap()
    .text;
    assert!(
        interactive.contains("- button \"General\" @e6"),
        "{interactive}"
    );
    assert!(
        interactive.contains("- switch \"Airplane Mode\" @e8"),
        "{interactive}"
    );
    assert!(
        !interactive.contains("navigationBar") && !interactive.contains("staticText"),
        "{interactive}"
    );

    let scoped = render::render(
        &sample(),
        &render::Options {
            interactive: false,
            scope: Some("list".into()),
        },
    )
    .unwrap()
    .text;
    assert!(scoped.contains("- table @e5 id=\"list\""), "{scoped}");
    assert!(!scoped.contains("navigationBar"), "{scoped}");
    let by_label = render::render(
        &sample(),
        &render::Options {
            interactive: false,
            scope: Some("airplane".into()),
        },
    )
    .unwrap()
    .text;
    assert!(
        by_label.contains("@e8") && !by_label.contains("@e6"),
        "{by_label}"
    );
    assert!(render::render(
        &sample(),
        &render::Options {
            interactive: false,
            scope: Some("Nowhere".into())
        }
    )
    .is_err());
}

#[test]
fn large_snapshots_are_bounded() {
    let children: Vec<serde_json::Value> = (0..5_000)
        .map(|index| json!({"ref": format!("e{index}"), "type": "cell", "label": format!("Row number {index} with some text"), "frame": [0, index, 402, 44]}))
        .collect();
    let tree = json!({"bundleId": "a.b", "state": "foreground", "screen": [0,0,402,874], "tree": {"ref": "e0", "type": "application", "label": "Demo", "children": children}});
    let rendered = render::render(&tree, &render::Options::default()).unwrap();
    assert!(rendered.truncated);
    assert!(
        rendered.text.len() <= render::LIMIT,
        "{}",
        rendered.text.len()
    );
    assert!(rendered
        .text
        .ends_with("Use scope or interactive to read less of the screen.\n"));
}

#[test]
fn driver_answers_and_failures_parse() {
    let (status, value) = driver::parse_response(
        b"HTTP/1.1 400 Bad Request\r\nContent-Length: 17\r\n\r\n{\"error\":\"nope\"}",
    )
    .unwrap();
    assert_eq!((status, value["error"].as_str()), (400, Some("nope")));
    assert!(driver::parse_response(b"HTTP/1.1 200 OK\r\n").is_err());
    assert!(driver::parse_response(b"HTTP/1.1 200 OK\r\n\r\nnot json").is_err());

    let log = "Command line invocation:\n    /usr/bin/xcodebuild build-for-testing\nCompileSwift normal arm64\n/tmp/Driver.swift:11:14: error: cannot find 'x' in scope\n/tmp/Driver.swift:11:14: error: cannot find 'x' in scope\n** TEST BUILD FAILED **\n";
    let tail = driver::failure_tail(log);
    assert_eq!(
        tail,
        "/tmp/Driver.swift:11:14: error: cannot find 'x' in scope"
    );
    let quiet = (0..40)
        .map(|line| format!("line {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(driver::failure_tail(&quiet).starts_with("line 25\n"));
    assert_eq!(driver::tail("abcdef", 3), "…def");
    assert_eq!(driver::tail("abc", 3), "abc");
}

#[test]
// Expects `/` separators in the joined paths.
#[cfg(unix)]
fn driver_runs_are_built_and_started_with_xcodebuild_arguments() {
    let build = driver::build_args(Path::new("/data/source"), Path::new("/data/derived"));
    assert_eq!(build[0], "build-for-testing");
    assert!(build.windows(2).any(|pair| pair
        == [
            "-project",
            "/data/source/JackalopeSimulatorDriver.xcodeproj"
        ]));
    assert!(build
        .windows(2)
        .any(|pair| pair == ["-destination", "generic/platform=iOS Simulator"]));
    assert!(build.contains(&"CODE_SIGNING_ALLOWED=NO".to_string()));
    let run = driver::run_args(
        Path::new("/data/Driver.xctestrun"),
        "UDID",
        Path::new("/data/run.xcresult"),
    );
    assert_eq!(
        run,
        [
            "test-without-building",
            "-xctestrun",
            "/data/Driver.xctestrun",
            "-destination",
            "id=UDID",
            "-resultBundlePath",
            "/data/run.xcresult"
        ]
    );
}

#[test]
fn the_driver_source_ships_a_generated_project() {
    let source = crate::commands::resources::bundled("resources/simulator-driver").unwrap();
    for file in [
        "JackalopeSimulatorDriver.xcodeproj/project.pbxproj",
        "JackalopeSimulatorDriver.xcodeproj/xcshareddata/xcschemes/Driver.xcscheme",
        "Driver/Driver.swift",
        "Driver/Server.swift",
        "Driver/Actions.swift",
        "Host/App.swift",
    ] {
        assert!(source.join(file).is_file(), "{file}");
    }
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
    assert!(config["bundle"]["resources"]
        .as_array()
        .unwrap()
        .contains(&json!("resources/simulator-driver/")));
}

#[test]
fn simctl_output_parses() {
    let apps = parse_apps(&json!({
        "com.apple.Preferences": {"ApplicationType": "System", "CFBundleDisplayName": "Settings"},
        "com.example.App": {"ApplicationType": "User", "CFBundleName": "Demo"},
        "digital.jackalope.SimulatorDriver.xctrunner": {"ApplicationType": "User"}
    }));
    assert_eq!(apps.len(), 2);
    assert_eq!(
        apps[0],
        json!({"bundleId": "com.example.App", "name": "Demo", "type": "User"})
    );
    let show = simctl::log_show("UDID", "Demo", 90, "debug");
    assert!(show
        .args
        .windows(2)
        .any(|pair| pair == ["--predicate", "process == \"Demo\""]));
    assert!(show
        .args
        .ends_with(&["--info".to_string(), "--debug".to_string()]));
    assert!(process_name("Demo App").is_ok());
    assert!(process_name("Demo\" OR 1").is_err());
}

#[test]
fn logs_keep_the_newest_matching_lines() {
    let logs = (0..5_000)
        .map(|line| format!("line {line} {}", if line % 2 == 0 { "even" } else { "odd" }))
        .collect::<Vec<_>>()
        .join("\n");
    let (text, truncated) = filter_logs(&logs, None);
    assert!(truncated && text.ends_with("line 4999 odd") && text.len() <= 40_000);
    let (text, truncated) = filter_logs(&logs, Some("ODD"));
    assert!(!truncated && !text.contains("even") && text.lines().count() == 2_500);
    let (text, truncated) = filter_logs("a\nb\nc", Some("b"));
    assert_eq!((text.as_str(), truncated), ("b", false));
    for (seconds, level, valid) in [
        (Some(0), None, false),
        (Some(601), None, false),
        (None, Some("trace"), false),
        (Some(30), Some("info"), true),
    ] {
        let input = LogsRequest {
            seconds,
            level: level.map(str::to_string),
            ..LogsRequest::default()
        };
        assert_eq!(log_window(&input).is_ok(), valid);
    }
}

#[test]
fn apple_projects_are_found_near_the_workspace_root() {
    let root = scratch("project");
    assert!(!apple_project(&root));
    std::fs::create_dir_all(root.join("ios/Demo.xcodeproj")).unwrap();
    assert!(apple_project(&root));
    let package = scratch("package");
    std::fs::write(package.join("Package.swift"), "").unwrap();
    assert!(apple_project(&package));
    let deep = scratch("deep");
    std::fs::create_dir_all(deep.join("a/b/Demo.xcworkspace")).unwrap();
    assert!(!apple_project(&deep));
    for path in [root, package, deep] {
        std::fs::remove_dir_all(path).unwrap();
    }
}

fn running_attempt(
    label: &str,
) -> (
    PathBuf,
    TaskRuntime,
    crate::commands::coordination::Coordinator,
    TaskRun,
    axum::http::HeaderMap,
) {
    let directory = scratch(label);
    let workspace = directory.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let runtime = TaskRuntime::new(directory.join("runs")).unwrap();
    let run = TaskRun {
        id: format!("simulator-{label}"),
        workspace: workspace.to_string_lossy().into_owned(),
        status: crate::commands::tasks::RunStatus::Running,
        ..TaskRun::default()
    };
    runtime.insert_for_test(run.clone());
    let service =
        crate::commands::coordination::Coordinator::new(directory.join("queue"), runtime.clone())
            .unwrap();
    service.grant_for_test("simulator-token", &run.id);
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("authorization", "Bearer simulator-token".parse().unwrap());
    (directory, runtime, service, run, headers)
}

#[tokio::test]
// Elsewhere every simulator call is refused for needing macOS before input is checked.
#[cfg(target_os = "macos")]
async fn the_bridge_refuses_invalid_requests_before_touching_a_device() {
    let (directory, runtime, service, run, headers) = running_attempt("invalid");
    assign(&run.id, "not-a-device");
    for (tool, input) in [
        ("simulator_interact", json!({"action":"tap"})),
        ("simulator_app", json!({"action":"launch"})),
        ("simulator_configure", json!({"appearance":"sepia"})),
        ("simulator_snapshot", json!({"bundle_id":"not valid"})),
        ("simulator_logs", json!({"seconds":9999})),
    ] {
        let error = crate::commands::bridge::call(&service, &headers, tool, input)
            .await
            .unwrap_err();
        assert_eq!(
            error.code(),
            axum::http::StatusCode::BAD_REQUEST,
            "{tool}: {}",
            error.message()
        );
    }
    let unknown = crate::commands::bridge::call(
        &service,
        &headers,
        "simulator_interact",
        json!({"action":"tap","ref":"e1","selector":"x"}),
    )
    .await
    .unwrap_err();
    assert!(
        unknown.message().starts_with("Invalid arguments"),
        "{}",
        unknown.message()
    );
    let stranger = crate::commands::bridge::call(
        &service,
        &axum::http::HeaderMap::new(),
        "simulator_snapshot",
        json!({}),
    )
    .await
    .unwrap_err();
    assert_eq!(stranger.code(), axum::http::StatusCode::UNAUTHORIZED);
    attempt_ended(&run.id);
    assert!(attempt(&run.id).is_none());
    drop((service, runtime));
    let _ = std::fs::remove_dir_all(directory);
}

/// A simulator this test creates and deletes; the owner's devices are only
/// read as a template.
struct TestDevice(String);

impl Drop for TestDevice {
    fn drop(&mut self) {
        let _ = simctl::run(
            &simctl::Simctl {
                args: vec!["shutdown".into(), self.0.clone()],
                ..Default::default()
            },
            simctl::TIMEOUT,
        );
        let _ = simctl::run(
            &simctl::Simctl {
                args: vec!["delete".into(), self.0.clone()],
                ..Default::default()
            },
            simctl::TIMEOUT,
        );
    }
}

fn line_ref(snapshot: &str, prefix: &str) -> String {
    let line = snapshot
        .lines()
        .find(|line| line.trim_start().starts_with(prefix))
        .unwrap_or_else(|| panic!("no {prefix} in\n{snapshot}"));
    line.split_whitespace()
        .find(|word| word.starts_with("@e"))
        .unwrap()
        .to_string()
}

/// Builds the driver, clones an iPhone simulator, and drives Settings through
/// the bridge tools: launch, snapshot, tap General, wait, screenshot,
/// configure, logs, then stops the driver and deletes the clone. Needs macOS
/// with Xcode; the first run builds the driver (about a minute).
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs macOS with Xcode and an iOS Simulator runtime"]
async fn real_driver_drives_settings_in_a_cloned_simulator() {
    available().unwrap();
    let template = simctl::devices()
        .unwrap()
        .into_iter()
        .find(|device| device.name.starts_with("iPhone") && !device.booted)
        .expect("a shut-down iPhone simulator to clone");
    let udid = simctl::run(
        &simctl::Simctl {
            args: vec![
                "clone".into(),
                template.udid.clone(),
                "Jackalope test simulator tools".into(),
            ],
            ..Default::default()
        },
        simctl::BOOT_TIMEOUT,
    )
    .unwrap()
    .trim()
    .to_string();
    let device = TestDevice(udid.clone());
    let clock = Instant::now();
    simctl::run(&simctl::bootstatus(&udid), simctl::BOOT_TIMEOUT).unwrap();
    eprintln!("booted clone of {} in {:?}", template.name, clock.elapsed());

    let (directory, runtime, service, run, headers) = running_attempt("real");
    assign(&run.id, &udid);
    let call = |tool: &'static str, input: serde_json::Value| {
        let (service, headers) = (service.clone(), headers.clone());
        async move {
            let clock = Instant::now();
            let result = crate::commands::bridge::call(&service, &headers, tool, input).await;
            eprintln!("{tool}: {:?}", clock.elapsed());
            result.unwrap_or_else(|error| panic!("{tool}: {}", error.message()))
        }
    };

    call(
        "simulator_app",
        json!({"action":"launch","bundle_id":"com.apple.Preferences"}),
    )
    .await;
    let first = call("simulator_snapshot", json!({})).await;
    let text = first["snapshot"].as_str().unwrap();
    assert_eq!(first["bundleId"], "com.apple.Preferences", "{text}");
    line_ref(text, "- button \"General\"");
    let again = call("simulator_snapshot", json!({"interactive": true})).await;
    let general = line_ref(again["snapshot"].as_str().unwrap(), "- button \"General\"");
    call("simulator_interact", json!({"action":"tap","ref": general})).await;
    call(
        "simulator_interact",
        json!({"action":"wait","text":"About","timeout":15}),
    )
    .await;
    let shot = call("simulator_screenshot", json!({"name":"settings_general"})).await;
    let file = PathBuf::from(shot["filePath"].as_str().unwrap());
    assert!(file.starts_with(&run.workspace) && file.is_file());
    assert!(shot["width"].as_u64().unwrap() > 300);
    let mut stored = Vec::new();
    runtime.update(&run.id, |run| stored = run.screenshots.clone());
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].url, format!("simulator://{udid}"));
    let configured = call(
        "simulator_configure",
        json!({"appearance":"dark","status_bar":"clean","read_pasteboard":true}),
    )
    .await;
    assert_eq!(configured["applied"].as_array().unwrap().len(), 2);
    let view = view(&run.id).unwrap();
    assert_eq!((view.status, view.frame.is_some()), ("live", true));
    call(
        "simulator_interact",
        json!({"action":"press_button","button":"home"}),
    )
    .await;
    let home = call(
        "simulator_snapshot",
        json!({"bundle_id":"com.apple.springboard","interactive":true}),
    )
    .await;
    assert!(home["snapshot"].as_str().unwrap().contains("springboard"));
    let logs = call(
        "simulator_logs",
        json!({"bundle_id":"com.apple.Preferences","seconds":60}),
    )
    .await;
    assert_eq!(logs["process"], "Preferences");

    attempt_ended(&run.id);
    let clock = Instant::now();
    while driver_running(&udid) && clock.elapsed() < Duration::from_secs(20) {
        std::thread::sleep(Duration::from_millis(200));
    }
    assert!(!driver_running(&udid), "the driver stops with the attempt");
    drop(device);
    drop((service, runtime));
    let _ = std::fs::remove_dir_all(directory);
}

fn driver_running(udid: &str) -> bool {
    simctl::run(&simctl::list_apps(udid), simctl::TIMEOUT).is_ok_and(|_| {
        std::process::Command::new("/usr/bin/pgrep")
            .args(["-f", &format!("id={udid}")])
            .output()
            .is_ok_and(|output| output.status.success())
    })
}
