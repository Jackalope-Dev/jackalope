use super::*;
use crate::commands::previews::{PreviewKind, PreviewView};

fn project(container: Container, path: &str) -> XcodeProject {
    XcodeProject {
        container,
        path: Some(path.into()),
        generator: None,
        cocoapods: false,
        ios: true,
        scheme: Some("Demo".into()),
    }
}

#[test]
fn views_saved_before_simulator_previews_read_as_web() {
    let old = json!({
        "runId": "run",
        "command": "pnpm dev --port 4100",
        "port": 4100,
        "running": true,
        "ready": true,
        "exitCode": null,
        "output": "ready"
    });
    let view: PreviewView = serde_json::from_value(old).unwrap();
    assert_eq!(view.kind, PreviewKind::Web);
    assert_eq!(view.port, 4100);
    assert!(view.simulator.is_none());
    let written = serde_json::to_value(&view).unwrap();
    assert_eq!(written["kind"], "web");
    assert_eq!(written["port"], 4100);
    assert!(written.get("simulator").is_none());

    let simulator = PreviewView {
        kind: PreviewKind::Simulator,
        port: 0,
        simulator: Some(SimulatorPreview {
            udid: "UDID".into(),
            device: "Jackalope abc".into(),
            bundle_id: Some("com.example.Demo".into()),
            phase: "running".into(),
            ..Default::default()
        }),
        ..view
    };
    let written = serde_json::to_value(&simulator).unwrap();
    assert_eq!(written["kind"], "simulator");
    assert_eq!(written["simulator"]["bundleId"], "com.example.Demo");
    let read: PreviewView = serde_json::from_value(written).unwrap();
    assert_eq!(read.simulator.unwrap().udid, "UDID");
}

#[test]
fn builds_the_detected_scheme_for_the_task_device_into_its_derived_data() {
    let derived = Path::new("/work/.jackalope/DerivedData");
    assert_eq!(
        build_args(
            &project(Container::Workspace, "ios/App.xcworkspace"),
            "Demo",
            "UDID-1",
            derived
        ),
        [
            "build",
            "-workspace",
            "ios/App.xcworkspace",
            "-scheme",
            "Demo",
            "-destination",
            "id=UDID-1",
            "-derivedDataPath",
            "/work/.jackalope/DerivedData"
        ]
    );
    assert_eq!(
        settings_args(
            &project(Container::Project, "Demo.xcodeproj"),
            "Demo",
            "UDID-1",
            derived
        ),
        [
            "-showBuildSettings",
            "-json",
            "-project",
            "Demo.xcodeproj",
            "-scheme",
            "Demo",
            "-destination",
            "id=UDID-1",
            "-derivedDataPath",
            "/work/.jackalope/DerivedData"
        ]
    );
    let shown = shell_text(&build_args(
        &project(Container::Project, "My App.xcodeproj"),
        "My App",
        "$JACKALOPE_SIMULATOR_UDID",
        Path::new("$JACKALOPE_DERIVED_DATA"),
    ));
    assert_eq!(
        shown,
        "build -project 'My App.xcodeproj' -scheme 'My App' -destination \"id=$JACKALOPE_SIMULATOR_UDID\" -derivedDataPath \"$JACKALOPE_DERIVED_DATA\""
    );
}

#[test]
fn the_built_app_comes_from_the_application_target_settings() {
    let output = r#"Command line invocation:
    xcodebuild -showBuildSettings -json
[
  {"target": "DemoTests", "buildSettings": {"PRODUCT_TYPE": "com.apple.product-type.bundle.unit-test", "WRAPPER_EXTENSION": "xctest", "PLATFORM_NAME": "iphonesimulator", "TARGET_BUILD_DIR": "/d/Build/Products/Debug-iphonesimulator", "WRAPPER_NAME": "DemoTests.xctest"}},
  {"target": "Demo", "buildSettings": {"PRODUCT_TYPE": "com.apple.product-type.application", "WRAPPER_EXTENSION": "app", "PLATFORM_NAME": "iphonesimulator", "TARGET_BUILD_DIR": "/d/Build/Products/Debug-iphonesimulator", "WRAPPER_NAME": "Demo.app"}}
]"#;
    assert_eq!(
        app_from_settings(output),
        Some(PathBuf::from(
            "/d/Build/Products/Debug-iphonesimulator/Demo.app"
        ))
    );
    let device = output.replace("iphonesimulator\", \"TARGET", "iphoneos\", \"TARGET");
    assert_eq!(app_from_settings(&device), None);
    assert_eq!(app_from_settings("no json"), None);
}

#[test]
fn the_newest_simulator_app_skips_test_runners_and_device_builds() {
    let root =
        std::env::temp_dir().join(format!("jackalope-sim-products-{}", uuid::Uuid::new_v4()));
    let make = |folder: &str, name: &str| {
        let app = root.join("Build/Products").join(folder).join(name);
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join("Info.plist"), "plist").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        app
    };
    make("Debug-iphoneos", "Device.app");
    let app = make("Debug-iphonesimulator", "Demo.app");
    make("Debug-iphonesimulator", "DemoUITests-Runner.app");
    assert_eq!(newest_app(&root), Some(app));
    assert_eq!(newest_app(&root.join("missing")), None);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn frame_positions_map_to_device_points() {
    assert_eq!(
        device_point(0.5, 0.25, (402.0, 874.0)).unwrap(),
        (201.0, 218.5)
    );
    assert_eq!(device_point(0.0, 0.0, (402.0, 874.0)).unwrap(), (0.0, 0.0));
    // The far edge stays on screen.
    assert_eq!(
        device_point(1.0, 1.0, (402.0, 874.0)).unwrap(),
        (401.5, 873.5)
    );
    for (x, y) in [
        (-0.1, 0.5),
        (0.5, 1.2),
        (f64::NAN, 0.5),
        (0.5, f64::INFINITY),
    ] {
        assert!(device_point(x, y, (402.0, 874.0)).is_err(), "{x}, {y}");
    }
}

fn element(kind: &str, label: &str, frame: [f64; 4]) -> Element {
    Element {
        kind: kind.into(),
        label: label.into(),
        identifier: String::new(),
        value: String::new(),
        frame,
    }
}

#[test]
fn selection_picks_the_smallest_meaningful_element_under_the_point() {
    let elements = vec![
        element("application", "Demo", [0.0, 0.0, 402.0, 874.0]),
        element("window", "", [0.0, 0.0, 402.0, 874.0]),
        element("other", "", [20.0, 100.0, 360.0, 200.0]),
        element("cell", "Profile", [20.0, 100.0, 360.0, 60.0]),
        element("button", "Edit", [300.0, 110.0, 60.0, 40.0]),
        element("staticText", "Title", [20.0, 400.0, 100.0, 20.0]),
    ];
    assert_eq!(hit(&elements, (320.0, 120.0)).unwrap().label, "Edit");
    assert_eq!(hit(&elements, (40.0, 120.0)).unwrap().label, "Profile");
    // Only containers here: the smallest one still answers.
    assert_eq!(hit(&elements, (40.0, 250.0)).unwrap().kind, "other");
    assert_eq!(hit(&elements, (500.0, 900.0)), None);
}

#[test]
fn element_crops_scale_points_to_pixels_and_stay_inside_the_image() {
    // A 3x screen scaled to 1206 pixels wide.
    assert_eq!(
        crop_rect([100.0, 200.0, 50.0, 20.0], (402.0, 874.0), (1206, 2622)),
        Some((282, 582, 186, 96))
    );
    assert_eq!(
        crop_rect([0.0, 0.0, 402.0, 874.0], (402.0, 874.0), (1206, 2622)),
        Some((0, 0, 1206, 2622))
    );
    assert_eq!(
        crop_rect([500.0, 900.0, 10.0, 10.0], (402.0, 874.0), (1206, 2622)),
        None
    );
    assert_eq!(
        crop_rect([0.0, 0.0, 10.0, 10.0], (0.0, 874.0), (1206, 2622)),
        None
    );
}

#[test]
fn snapshots_flatten_to_elements_with_frames() {
    let snapshot = json!({
        "bundleId": "com.example.Demo",
        "screen": [0, 0, 402, 874],
        "tree": {"ref": "e1", "type": "application", "label": "Demo", "frame": [0, 0, 402, 874], "children": [
            {"ref": "e2", "type": "button", "label": "Tap me", "id": "tap", "frame": [150, 400, 100, 44]},
            {"ref": "e3", "type": "other", "frame": [0, 0, 0, 0]},
            {"ref": "e4", "type": "textField", "value": "hi", "frame": [20, 500, 362, 40]}
        ]}
    });
    let elements = flatten(&snapshot);
    assert_eq!(elements.len(), 3);
    assert_eq!(elements[1].identifier, "tap");
    assert_eq!(elements[1].frame, [150.0, 400.0, 100.0, 44.0]);
    assert_eq!(elements[2].value, "hi");
    assert_eq!(screen_of(&snapshot), Some((402.0, 874.0)));
    assert_eq!(screen_of(&json!({"screen": [0, 0, 0, 0]})), None);
}

#[test]
fn actions_become_driver_or_simctl_commands() {
    let screen = Some((400.0, 800.0));
    assert_eq!(
        plan(
            &Action::Tap { x: 0.5, y: 0.5 },
            "U",
            "com.example.Demo",
            screen,
            false
        )
        .unwrap(),
        Plan::Driver(
            json!({"action": "tap", "x": 200.0, "y": 400.0, "bundleId": "com.example.Demo"})
        )
    );
    assert!(plan(&Action::Tap { x: 0.5, y: 0.5 }, "U", "b", None, false).is_err());
    assert!(plan(&Action::Tap { x: 2.0, y: 0.5 }, "U", "b", screen, false).is_err());
    assert_eq!(
        plan(
            &Action::Type {
                text: "hello".into()
            },
            "U",
            "b",
            None,
            false
        )
        .unwrap(),
        Plan::Driver(
            json!({"action": "type", "text": "hello", "bundleId": "b", "bundleIds": ["b"]})
        )
    );
    assert!(plan(
        &Action::Type {
            text: String::new()
        },
        "U",
        "b",
        None,
        false
    )
    .is_err());
    assert!(plan(
        &Action::Type {
            text: "x".repeat(5001)
        },
        "U",
        "b",
        None,
        false
    )
    .is_err());
    assert_eq!(
        plan(&Action::Rotate, "U", "b", None, false).unwrap(),
        Plan::Driver(json!({"action": "rotate", "orientation": "landscape_left"}))
    );
    assert_eq!(
        plan(&Action::Rotate, "U", "b", None, true).unwrap(),
        Plan::Driver(json!({"action": "rotate", "orientation": "portrait"}))
    );
    assert_eq!(
        plan(&Action::Home, "U", "b", None, false).unwrap(),
        Plan::Driver(json!({"action": "press_button", "button": "home"}))
    );
    let Plan::Simctl(dark) = plan(
        &Action::Appearance {
            value: "dark".into(),
        },
        "U",
        "b",
        None,
        false,
    )
    .unwrap() else {
        panic!("appearance runs simctl");
    };
    assert_eq!(dark.args, ["ui", "U", "appearance", "dark"]);
    assert!(plan(
        &Action::Appearance {
            value: "sepia".into()
        },
        "U",
        "b",
        None,
        false
    )
    .is_err());
    let Plan::Simctl(size) = plan(
        &Action::ContentSize {
            value: "accessibility-large".into(),
        },
        "U",
        "b",
        None,
        false,
    )
    .unwrap() else {
        panic!("content size runs simctl");
    };
    assert_eq!(
        size.args,
        ["ui", "U", "content_size", "accessibility-large"]
    );
    assert!(plan(
        &Action::ContentSize {
            value: "increment".into()
        },
        "U",
        "b",
        None,
        false
    )
    .is_err());
    let Plan::Simctl(open) = plan(
        &Action::OpenUrl {
            url: "demo://detail".into(),
        },
        "U",
        "b",
        None,
        false,
    )
    .unwrap() else {
        panic!("links run simctl");
    };
    assert_eq!(open.args, ["openurl", "U", "demo://detail"]);
    assert!(plan(
        &Action::OpenUrl {
            url: "not a url".into()
        },
        "U",
        "b",
        None,
        false
    )
    .is_err());
}

#[test]
fn actions_read_from_the_renderer() {
    let tap: Action =
        serde_json::from_value(json!({"action": "tap", "x": 0.25, "y": 0.75})).unwrap();
    assert_eq!(tap, Action::Tap { x: 0.25, y: 0.75 });
    let size: Action =
        serde_json::from_value(json!({"action": "contentSize", "value": "small"})).unwrap();
    assert_eq!(
        size,
        Action::ContentSize {
            value: "small".into()
        }
    );
    let link: Action =
        serde_json::from_value(json!({"action": "openUrl", "url": "demo://x"})).unwrap();
    assert_eq!(
        link,
        Action::OpenUrl {
            url: "demo://x".into()
        }
    );
    assert!(serde_json::from_value::<Action>(json!({"action": "shake"})).is_err());
}

#[test]
fn build_output_keeps_the_newest_text_on_a_character_boundary() {
    let output = Mutex::new(String::new());
    append_output(&output, &"é".repeat(OUTPUT_LIMIT));
    append_output(&output, "** BUILD SUCCEEDED **\n");
    let text = output.lock().unwrap().clone();
    assert!(text.len() <= OUTPUT_LIMIT + OUTPUT_LIMIT / 4);
    assert!(text.ends_with("** BUILD SUCCEEDED **\n"));
}

#[test]
fn saved_build_commands_are_bounded() {
    assert_eq!(valid_command("  make sim  ").unwrap(), "make sim");
    assert!(valid_command("").is_err());
    assert!(valid_command(&"x".repeat(COMMAND_LIMIT + 1)).is_err());
    assert!(valid_command("a\0b").is_err());
}

#[test]
fn selections_describe_the_element_for_the_note() {
    let selected = Selected {
        png: Vec::new(),
        element: Element {
            kind: "button".into(),
            label: "Save".into(),
            identifier: "save".into(),
            value: String::new(),
            frame: [10.0, 20.0, 80.0, 44.0],
        },
        screen: (402.0, 874.0),
        udid: "UDID".into(),
        bundle: "com.example.Demo".into(),
    };
    let selection = selected.selection("shot");
    assert_eq!(selection["tag"], "button \"Save\"");
    assert_eq!(selection["url"], "simulator://UDID/com.example.Demo");
    assert_eq!(selection["identifier"], "save");
    assert_eq!(selection["frame"], json!([10.0, 20.0, 80.0, 44.0]));
    // The fields the selection notes list reads.
    for field in ["id", "url", "tag", "html"] {
        assert!(selection[field].is_string(), "{field}");
    }
    assert!(selection["styles"].is_object());
}

const DEMO_SPEC: &str = r#"name: PreviewDemo
options:
  bundleIdPrefix: digital.jackalope.test
  deploymentTarget:
    iOS: "17.0"
targets:
  PreviewDemo:
    type: application
    platform: iOS
    sources: [Sources]
    info:
      path: Sources/Info.plist
      properties:
        UILaunchScreen: {}
        CFBundleURLTypes:
          - CFBundleURLSchemes: [jkpreview]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: digital.jackalope.test.PreviewDemo
        CODE_SIGNING_ALLOWED: "NO"
"#;

fn demo_view(title: &str) -> String {
    format!(
        r#"import SwiftUI

@main
struct PreviewDemoApp: App {{
    @State private var detail = false
    var body: some Scene {{
        WindowGroup {{
            ContentView(detail: detail).onOpenURL {{ url in detail = url.host == "detail" }}
        }}
    }}
}}

struct ContentView: View {{
    let detail: Bool
    @State private var tapped = false
    @State private var name = ""
    var body: some View {{
        VStack(spacing: 24) {{
            Text(detail ? "Detail screen" : "{title}").font(.title)
            Text(tapped ? "Tapped" : "Not tapped").accessibilityIdentifier("state")
            Button("Tap me") {{ tapped = true }}
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("tap")
            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("name")
                .padding(.horizontal, 40)
        }}
    }}
}}
"#
    )
}

fn git(folder: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(folder)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// A project checkout at one commit and a task worktree that changes the title.
fn demo_repository(root: &Path) -> (PathBuf, PathBuf, String) {
    let checkout = root.join("checkout");
    std::fs::create_dir_all(checkout.join("Sources")).unwrap();
    std::fs::write(checkout.join("project.yml"), DEMO_SPEC).unwrap();
    std::fs::write(
        checkout.join("Sources/App.swift"),
        demo_view("Preview demo"),
    )
    .unwrap();
    std::fs::write(checkout.join(".gitignore"), ".jackalope/\n").unwrap();
    let generated = Command::new("xcodegen")
        .arg("generate")
        .current_dir(&checkout)
        .output()
        .expect("xcodegen on PATH");
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    git(&checkout, &["init", "-q", "-b", "main"]);
    git(&checkout, &["add", "."]);
    git(
        &checkout,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-qm",
            "Demo",
        ],
    );
    let base = git(&checkout, &["rev-parse", "HEAD"]);
    let workspace = root.join("workspace");
    git(
        &checkout,
        &[
            "worktree",
            "add",
            "-q",
            workspace.to_str().unwrap(),
            "-b",
            "task",
        ],
    );
    std::fs::write(
        workspace.join("Sources/App.swift"),
        demo_view("Preview demo, changed"),
    )
    .unwrap();
    (checkout, workspace, base)
}

fn status(id: &str) -> PreviewView {
    crate::commands::previews::tests_support::status(id)
}

/// Builds a generated SwiftUI app, runs it as a Simulator preview on a
/// Jackalope test simulator, drives it (frame, tap by coordinates, typing,
/// appearance, rotation, a deep link, selection) and captures light, dark and
/// large-text review screenshots before and after a change. Needs macOS with
/// Xcode, an iOS runtime and XcodeGen; the first run also builds the driver.
#[test]
#[ignore = "builds an app and boots a real iOS Simulator"]
fn real_simulator_preview_and_review_captures() {
    use crate::commands::previews::{features::Feature, review};
    assert!(xcode::toolchain().is_some(), "needs a full Xcode");
    let root = std::env::temp_dir().join(format!("jackalope-sim-preview-{}", uuid::Uuid::new_v4()));
    let (checkout, workspace, base) = demo_repository(&root);
    let id = format!("test{}", uuid::Uuid::new_v4().simple());
    let history = root.join("history");
    std::fs::create_dir_all(&history).unwrap();
    let record = json!({ "id": id, "taskId": id, "projectId": "demo", "projectName": "Demo", "projectPath": checkout, "workspace": workspace, "branch": "task", "baseHead": base, "agent": "codex", "account": "test", "model": null, "prompt": "Change the title", "status": "review", "reviewCapturing": true, "startedAt": "2026-11-24T10:00:00Z", "endedAt": null, "sessionId": null, "result": "Changed", "activity": [], "diagnostics": [], "error": null, "persistenceError": null, "exitCode": 0, "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reported": false, "estimatedCostUsd": null } });
    std::fs::write(
        history.join(format!("{id}.json")),
        serde_json::to_vec(&record).unwrap(),
    )
    .unwrap();
    let runtime = TaskRuntime::new(history).unwrap();
    simulators::initialize(root.join("simulators"), runtime.clone());
    let workspace_text = workspace.to_string_lossy().into_owned();
    let _cleanup = simulators::ReleaseOnDrop(simulators::workspace_identity(&workspace_text));
    let clock = Instant::now();
    let wait = |what: &str, limit: Duration, done: &dyn Fn(&PreviewView) -> bool| {
        let started = Instant::now();
        loop {
            let view = status(&id);
            if done(&view) {
                eprintln!("{what} after {:?}", started.elapsed());
                return view;
            }
            let failed = view
                .simulator
                .as_ref()
                .is_some_and(|sim| sim.phase == "failed");
            assert!(!failed && started.elapsed() < limit, "{what}: {view:#?}");
            std::thread::sleep(Duration::from_millis(500));
        }
    };

    crate::commands::previews::tests_support::start(&runtime, &id);
    assert!(crate::commands::previews::ensure_idle(&workspace_text).is_err());
    let running = wait("running", Duration::from_secs(600), &|view| {
        view.simulator
            .as_ref()
            .is_some_and(|sim| sim.phase == "running" && sim.input != "starting")
    });
    let sim = running.simulator.clone().unwrap();
    assert_eq!(sim.input, "ready", "{running:#?}");
    assert_eq!(
        sim.bundle_id.as_deref(),
        Some("digital.jackalope.test.PreviewDemo")
    );
    assert!(sim.device.starts_with("Jackalope test"), "{}", sim.device);
    assert!(
        running.output.contains("BUILD SUCCEEDED"),
        "{}",
        running.output
    );
    eprintln!("built, launched and driver ready in {:?}", clock.elapsed());

    let session = crate::commands::previews::tests_support::session(&id);
    let frame = session.frame().unwrap();
    assert!(
        frame.width > 100 && frame.height > frame.width,
        "{}x{}",
        frame.width,
        frame.height
    );

    let find = |label: &str| {
        let listed = session.elements().unwrap();
        let screen = listed.screen.unwrap();
        listed
            .elements
            .iter()
            .find(|element| element.label == label || element.identifier == label)
            .map(|element| {
                (
                    (element.frame[0] + element.frame[2] / 2.0) / screen[0],
                    (element.frame[1] + element.frame[3] / 2.0) / screen[1],
                    element.clone(),
                )
            })
    };
    let until = |label: &str| {
        let started = Instant::now();
        while find(label).is_none() {
            assert!(
                started.elapsed() < Duration::from_secs(15),
                "{label} never appeared"
            );
            std::thread::sleep(Duration::from_millis(300));
        }
    };
    until("Preview demo, changed");
    let (x, y, _) = find("Tap me").expect("the button");
    session.act(&Action::Tap { x, y }).unwrap();
    until("Tapped");

    let (x, y, field) = find("name").expect("the text field");
    assert_eq!(field.kind, "textField");
    session.act(&Action::Tap { x, y }).unwrap();
    session.act(&Action::Type { text: "Ada".into() }).unwrap();
    // The keyboard can move the field, so select where it is now.
    let (x, y, typed) = find("name").unwrap();
    assert_eq!(typed.value, "Ada");

    let selection = crate::commands::previews::tests_support::select(&runtime, &id, x, y);
    assert!(
        selection["selection"]["tag"]
            .as_str()
            .unwrap()
            .starts_with("textField"),
        "{selection}"
    );
    let shot = PathBuf::from(selection["screenshot"]["filePath"].as_str().unwrap());
    assert!(shot.starts_with(dunce::canonicalize(&workspace).unwrap()) && shot.is_file());
    let context = PathBuf::from(selection["contextPath"].as_str().unwrap());
    let saved: Value = serde_json::from_slice(&std::fs::read(&context).unwrap()).unwrap();
    assert_eq!(saved["identifier"], "name");
    // Cropped to the field, not the whole screen.
    assert!(selection["screenshot"]["height"].as_u64().unwrap() < 300);

    session
        .act(&Action::Appearance {
            value: "dark".into(),
        })
        .unwrap();
    assert_eq!(
        status(&id).simulator.unwrap().appearance.as_deref(),
        Some("dark")
    );
    session
        .act(&Action::ContentSize {
            value: "extra-large".into(),
        })
        .unwrap();
    session.act(&Action::Rotate).unwrap();
    std::thread::sleep(Duration::from_secs(2));
    let landscape = session.frame().unwrap();
    eprintln!("landscape frame {}x{}", landscape.width, landscape.height);
    assert!(
        landscape.width > landscape.height,
        "the frame turns with the device"
    );
    // Taps land where the person clicks in landscape too.
    let (x, y, field) = find("name").expect("the field in landscape");
    eprintln!("landscape field {:?} at {x:.2},{y:.2}", field.frame);
    session.act(&Action::Tap { x, y }).unwrap();
    session.act(&Action::Type { text: "Bo".into() }).unwrap();
    assert_eq!(find("name").unwrap().2.value, "AdaBo");
    session.act(&Action::Rotate).unwrap();
    session
        .act(&Action::ContentSize {
            value: "large".into(),
        })
        .unwrap();
    session
        .act(&Action::Appearance {
            value: "light".into(),
        })
        .unwrap();
    session
        .act(&Action::OpenUrl {
            url: "jkpreview://detail".into(),
        })
        .unwrap();
    until("Detail screen");
    session.act(&Action::Home).unwrap();
    drop(session);

    crate::commands::previews::tests_support::stop(&runtime, &id);
    assert!(crate::commands::previews::ensure_idle(&workspace_text).is_ok());

    let settings = review::ios::Settings {
        custom: None,
        pages: Vec::new(),
        features: vec![Feature {
            name: "Detail".into(),
            page: "jkpreview://detail".into(),
            sources: vec!["Sources/**".into()],
            ..Default::default()
        }],
    };
    // Loading history clears a capture flag left from a closed app, so set it as finishing does.
    runtime.update(&id, |run| run.review_capturing = true);
    let run = runtime.run_snapshot(&id).unwrap();
    let clock = Instant::now();
    let captures = review::ios::collect(&runtime, &run, &settings);
    eprintln!(
        "review captures in {:?}: {:#?}",
        clock.elapsed(),
        captures.notes
    );
    let viewports: Vec<(&str, &str)> = captures
        .pages
        .iter()
        .map(|page| (page.path.as_str(), page.viewport.as_str()))
        .collect();
    assert_eq!(
        viewports,
        [
            ("First screen", "iphone-light"),
            ("First screen", "iphone-dark"),
            ("First screen", "iphone-large-text"),
            ("jkpreview://detail", "iphone-light"),
            ("jkpreview://detail", "iphone-dark"),
        ]
    );
    assert!(captures.before_available, "{:?}", captures.notes);
    for page in &captures.pages {
        let after = page
            .after
            .as_ref()
            .unwrap_or_else(|| panic!("{page:#?} {:?}", captures.notes));
        let before = page
            .before
            .as_ref()
            .unwrap_or_else(|| panic!("{page:#?} {:?}", captures.notes));
        assert!(Path::new(&after.file_path).is_file() && Path::new(&before.file_path).is_file());
        assert!(page.width > 0 && page.height > page.width);
    }
    let image = |artifact: &Option<crate::commands::harness::ScreenshotArtifact>| {
        std::fs::read(&artifact.as_ref().unwrap().file_path).unwrap()
    };
    assert_ne!(
        image(&captures.pages[0].after),
        image(&captures.pages[1].after),
        "light and dark differ"
    );
    assert_ne!(
        image(&captures.pages[0].before),
        image(&captures.pages[0].after),
        "before and after differ"
    );
    assert_eq!(captures.pages[3].features[0].name, "Detail");

    simulators::release(simulators::workspace_identity(&workspace_text));
    let deadline = Instant::now() + Duration::from_secs(120);
    while simulators::assigned(&workspace_text).is_some() {
        assert!(Instant::now() < deadline, "device was not deleted");
        std::thread::sleep(Duration::from_millis(250));
    }
    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_open_prompt_for_a_link_is_found_among_system_alerts() {
    let snapshot = json!({
        "tree": {"ref": "e1", "type": "application", "frame": [0, 0, 402, 874]},
        "alerts": [{"ref": "e9", "type": "alert", "frame": [40, 300, 320, 160], "children": [
            {"ref": "e10", "type": "staticText", "label": "Open in “PreviewDemo”?", "frame": [60, 320, 280, 20]},
            {"ref": "e11", "type": "button", "label": "Cancel", "frame": [60, 400, 130, 44]},
            {"ref": "e12", "type": "button", "label": "Open", "frame": [210, 400, 130, 44]}
        ]}]
    });
    assert_eq!(open_button(&snapshot).as_deref(), Some("e12"));
    let other = json!({"alerts": [{"ref": "e2", "type": "alert", "label": "Allow notifications?", "children": [
        {"ref": "e3", "type": "button", "label": "Open"}
    ]}]});
    assert_eq!(open_button(&other), None);
    assert_eq!(open_button(&json!({"tree": {}})), None);
}
