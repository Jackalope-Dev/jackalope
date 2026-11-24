use super::*;
use crate::commands::app_store_connect::tests::{armored, fake_api, saved, test_key};

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scratch() -> Scratch {
    let path = std::env::temp_dir().join(format!("jackalope-testflight-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    Scratch(dunce::canonicalize(path).unwrap())
}

fn mkdir(path: &Path) {
    std::fs::create_dir_all(path).unwrap();
}

#[test]
fn the_nearest_workspace_or_project_is_found() {
    let root = scratch();
    let root = root.0.as_path();
    assert_eq!(find_container(root), None);
    mkdir(&root.join("ios/App.xcodeproj/project.xcworkspace"));
    mkdir(&root.join("node_modules/dep/Dep.xcodeproj"));
    assert_eq!(
        find_container(root),
        Some(Container::Project(root.join("ios/App.xcodeproj")))
    );
    mkdir(&root.join("ios/App.xcworkspace"));
    mkdir(&root.join("ios/Pods/Pods.xcodeproj"));
    assert_eq!(
        find_container(root),
        Some(Container::Workspace(root.join("ios/App.xcworkspace")))
    );
    mkdir(&root.join("Root.xcodeproj"));
    assert_eq!(
        find_container(root),
        Some(Container::Project(root.join("Root.xcodeproj")))
    );
    mkdir(&root.join(".hidden.xcworkspace"));
    assert_eq!(
        find_container(root),
        Some(Container::Project(root.join("Root.xcodeproj")))
    );
}

#[test]
fn schemes_are_read_and_chosen() {
    let listing = r#"{"project":{"name":"Example","schemes":["Example","ExampleTests","Widget"],"targets":[]}}"#;
    let names = schemes(listing);
    assert_eq!(names, ["Example", "ExampleTests", "Widget"]);
    assert_eq!(
        schemes(r#"{"workspace":{"name":"W","schemes":["A"]}}"#),
        ["A"]
    );
    let project = Container::Project(PathBuf::from("/w/Example.xcodeproj"));
    assert_eq!(choose_scheme(&names, &project, None).unwrap(), "Example");
    assert_eq!(
        choose_scheme(&names, &project, Some("Widget")).unwrap(),
        "Widget"
    );
    let error = choose_scheme(&names, &project, Some("Missing")).unwrap_err();
    assert!(error.contains("Example, ExampleTests, Widget"), "{error}");
    let other = Container::Workspace(PathBuf::from("/w/Other.xcworkspace"));
    let two = ["App".to_string(), "AppTests".into(), "Pods-App".into()];
    assert_eq!(choose_scheme(&two, &other, None).unwrap(), "App");
    let error = choose_scheme(&names, &other, None).unwrap_err();
    assert!(error.contains("Project settings"), "{error}");
    assert_eq!(
        choose_scheme(&["Only".into()], &other, None).unwrap(),
        "Only"
    );
}

fn settings_json(root: &Path, extra: &str) -> String {
    format!(
        r#"[
  {{"action":"build","target":"ExampleTests","buildSettings":{{"PRODUCT_TYPE":"com.apple.product-type.bundle.unit-test","WRAPPER_EXTENSION":"xctest"}}}},
  {{"action":"build","target":"Example","buildSettings":{{
    "PRODUCT_TYPE":"com.apple.product-type.application","WRAPPER_EXTENSION":"app",
    "PRODUCT_NAME":"Example","PRODUCT_BUNDLE_IDENTIFIER":"com.example.app",
    "MARKETING_VERSION":"1.2","CURRENT_PROJECT_VERSION":"12",
    "PROJECT_FILE_PATH":"{root}/Example.xcodeproj","SRCROOT":"{root}"{extra}
  }}}}
]"#,
        root = root.display()
    )
}

#[test]
fn the_app_targets_version_and_build_are_read() {
    let root = scratch();
    let root = root.0.as_path();
    let found = settings(
        &settings_json(root, r#","DEVELOPMENT_TEAM":"TEAM123456""#),
        "Example",
    )
    .unwrap();
    assert_eq!(found.app_name, "Example");
    assert_eq!(found.bundle_id, "com.example.app");
    assert_eq!(
        (found.version.as_str(), found.build.as_str()),
        ("1.2", "12")
    );
    assert_eq!(found.development_team.as_deref(), Some("TEAM123456"));
    assert_eq!(found.project_file, Some(root.join("Example.xcodeproj")));
    assert_eq!(found.info_plist, None);

    // An Info.plist that spells out its numbers wins over the build settings.
    std::fs::write(
        root.join("Info.plist"),
        "<plist><dict>\n<key>CFBundleShortVersionString</key>\n<string>1.3</string>\n<key>CFBundleVersion</key>\n<string>40</string>\n</dict></plist>",
    )
    .unwrap();
    let found = settings(
        &settings_json(root, r#","INFOPLIST_FILE":"Info.plist""#),
        "Example",
    )
    .unwrap();
    assert_eq!(
        (found.version.as_str(), found.build.as_str()),
        ("1.3", "40")
    );
    assert_eq!(found.info_plist, Some(root.join("Info.plist")));
    std::fs::write(
        root.join("Info.plist"),
        "<plist><dict><key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string></dict></plist>",
    )
    .unwrap();
    let found = settings(
        &settings_json(root, r#","INFOPLIST_FILE":"Info.plist""#),
        "Example",
    )
    .unwrap();
    assert_eq!(found.build, "12");
    assert_eq!(found.info_plist, None);

    assert!(settings("[]", "Example")
        .unwrap_err()
        .contains("does not build an iOS app"));
    assert!(settings("not json", "Example").is_err());
}

#[test]
fn build_numbers_follow_app_store_connect_rules() {
    for good in ["1", "12", "1.0", "1.0.14", "2026112401"] {
        assert!(valid_build(good), "{good}");
    }
    for bad in [
        "",
        "1.",
        ".1",
        "1.2.3.4",
        "1a",
        "1 2",
        "1234567890123456789",
    ] {
        assert!(!valid_build(bad), "{bad}");
    }
    assert_eq!(next_build("12"), "13");
    assert_eq!(next_build("1.0.9"), "1.0.10");
    assert_eq!(next_build("weird"), "1");
    assert!(build_key("1.0.10") > build_key("1.0.9"));
    assert_eq!(build_key("2"), build_key("2.0"));
}

fn local(root: &Path, team: Option<&str>) -> Local {
    Local {
        container: Container::Project(root.join("Example.xcodeproj")),
        scheme: "Example".into(),
        settings: Settings {
            app_name: "Example".into(),
            bundle_id: "com.example.app".into(),
            version: "1.2".into(),
            build: "12".into(),
            development_team: team.map(str::to_string),
            project_file: Some(root.join("Example.xcodeproj")),
            info_plist: None,
            source_root: Some(root.to_path_buf()),
        },
    }
}

#[test]
fn uploads_are_blocked_until_the_project_and_connection_agree() {
    let root = scratch();
    let root = root.0.as_path();
    let (key, _) = test_key();
    let connection = saved(&key);
    let remote = |latest: Option<&str>| Remote {
        app_id: Some("app-1".into()),
        latest: latest.map(str::to_string),
        ..Remote::default()
    };

    let info = assess(
        root,
        local(root, None),
        Some(&connection),
        remote(Some("11")),
    );
    assert_eq!(info.blocked, None);
    assert_eq!(info.container, "Example.xcodeproj");
    assert_eq!(info.suggested_build, "12");
    assert_eq!(info.development_team.as_deref(), Some("TEAM123456"));

    let info = assess(
        root,
        local(root, None),
        Some(&connection),
        remote(Some("12")),
    );
    assert_eq!(info.suggested_build, "13");
    assert!(info.blocked.unwrap().contains("not newer than build 12"));

    let info = assess(root, local(root, None), None, Remote::default());
    assert!(info.blocked.unwrap().contains("Connect App Store Connect"));

    let mut other = saved(&key);
    other.bundle_id = Some("com.example.other".into());
    let info = assess(root, local(root, None), Some(&other), remote(None));
    assert!(info
        .blocked
        .unwrap()
        .contains("set up for com.example.other"));

    let info = assess(
        root,
        local(root, Some("OTHER12345")),
        Some(&connection),
        remote(None),
    );
    assert!(info.blocked.unwrap().contains("team OTHER12345"));

    let missing = Remote {
        missing_app: Some("App Store Connect has no app".into()),
        ..Remote::default()
    };
    let info = assess(root, local(root, None), Some(&connection), missing);
    assert!(info.blocked.unwrap().contains("no app"));

    let noted = Remote {
        note: Some("App Store Connect could not be reached: offline".into()),
        ..Remote::default()
    };
    let info = assess(root, local(root, None), Some(&connection), noted);
    assert_eq!(info.blocked, None);
    assert!(info.remote_note.unwrap().contains("offline"));

    let mut unset = local(root, None);
    unset.settings.build = String::new();
    let info = assess(root, unset, Some(&connection), remote(Some("4")));
    assert_eq!(info.suggested_build, "5");
    assert!(info.blocked.unwrap().contains("build number"));
}

#[test]
fn the_build_number_changes_in_every_file_that_spells_it() {
    let root = scratch();
    let root = root.0.as_path();
    mkdir(&root.join("Example.xcodeproj"));
    let pbxproj = "\t\t\t\tCURRENT_PROJECT_VERSION = 12;\n\t\t\t\tMARKETING_VERSION = 1.2;\n\t\t\t\tCURRENT_PROJECT_VERSION = \"12\";\n\t\t\t\tCURRENT_PROJECT_VERSION = 3;\n";
    std::fs::write(root.join("Example.xcodeproj/project.pbxproj"), pbxproj).unwrap();
    std::fs::write(
        root.join("project.yml"),
        "settings:\n  base:\n    CURRENT_PROJECT_VERSION: \"12\"\n    MARKETING_VERSION: 1.2\n",
    )
    .unwrap();
    std::fs::write(
        root.join("Info.plist"),
        "<dict>\n<key>CFBundleVersion</key>\n  <string>12</string>\n</dict>",
    )
    .unwrap();
    let mut settings = local(root, None).settings;
    settings.info_plist = Some(root.join("Info.plist"));
    let changed = set_build_number(root, &settings, "12", "13").unwrap();
    assert_eq!(changed.len(), 3);
    assert_eq!(
        std::fs::read_to_string(root.join("Example.xcodeproj/project.pbxproj")).unwrap(),
        "\t\t\t\tCURRENT_PROJECT_VERSION = 13;\n\t\t\t\tMARKETING_VERSION = 1.2;\n\t\t\t\tCURRENT_PROJECT_VERSION = 13;\n\t\t\t\tCURRENT_PROJECT_VERSION = 3;\n"
    );
    assert!(std::fs::read_to_string(root.join("project.yml"))
        .unwrap()
        .contains("    CURRENT_PROJECT_VERSION: 13\n"));
    assert_eq!(
        std::fs::read_to_string(root.join("Info.plist")).unwrap(),
        "<dict>\n<key>CFBundleVersion</key>\n  <string>13</string>\n</dict>"
    );
    let error = set_build_number(root, &settings, "99", "100").unwrap_err();
    assert!(error.contains("xcconfig"), "{error}");

    // Files outside the task workspace are never changed.
    let elsewhere = scratch();
    let error = set_build_number(elsewhere.0.as_path(), &settings, "13", "14").unwrap_err();
    assert!(error.contains("not set"), "{error}");
}

fn plan(folder: &Path, workspace: &Path, program: Program) -> Plan {
    Plan {
        program,
        workspace: workspace.to_path_buf(),
        container: Container::Workspace(workspace.join("App.xcworkspace")),
        scheme: "App".into(),
        development_team: "TEAM123456".into(),
        settings: vec!["DEVELOPMENT_TEAM=TEAM123456".into()],
        export_method: "app-store-connect".into(),
        auth: Some(Auth {
            key: armored("KEYBODY"),
            key_id: "ABC123XYZ9".into(),
            issuer_id: "issuer-uuid".into(),
        }),
        folder: folder.to_path_buf(),
    }
}

fn strings(args: Vec<OsString>) -> Vec<String> {
    args.into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn archive_and_export_commands_sign_with_the_key_and_keep_output_in_app_data() {
    let plan = plan(
        Path::new("/data/testflight/run/current"),
        Path::new("/work"),
        Program::Xcrun,
    );
    let key = "/data/testflight/run/current/key/AuthKey_ABC123XYZ9.p8";
    let auth = [
        "-allowProvisioningUpdates",
        "-authenticationKeyPath",
        key,
        "-authenticationKeyID",
        "ABC123XYZ9",
        "-authenticationKeyIssuerID",
        "issuer-uuid",
    ];
    let mut archive = vec![
        "archive",
        "-workspace",
        "/work/App.xcworkspace",
        "-scheme",
        "App",
        "-configuration",
        "Release",
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        "/data/testflight/run/current/App.xcarchive",
    ];
    archive.extend(auth);
    archive.push("DEVELOPMENT_TEAM=TEAM123456");
    assert_eq!(strings(plan.archive_args()), archive);
    let mut export = vec![
        "-exportArchive",
        "-archivePath",
        "/data/testflight/run/current/App.xcarchive",
        "-exportOptionsPlist",
        "/data/testflight/run/current/ExportOptions.plist",
        "-exportPath",
        "/data/testflight/run/current/export",
    ];
    export.extend(auth);
    assert_eq!(strings(plan.export_args()), export);

    let options = plan.export_options();
    for expected in [
        "<key>method</key>\n\t<string>app-store-connect</string>",
        "<key>destination</key>\n\t<string>upload</string>",
        "<key>teamID</key>\n\t<string>TEAM123456</string>",
        "<key>manageAppVersionAndBuildNumber</key>\n\t<false/>",
        "<key>signingStyle</key>\n\t<string>automatic</string>",
    ] {
        assert!(options.contains(expected), "{expected}\n{options}");
    }
    assert!(!options.contains("KEYBODY"));
}

#[cfg(unix)]
mod fake_xcodebuild {
    use super::*;

    /// A stand-in xcodebuild that records its calls, makes the archive, checks
    /// the key file's permissions, and fails or stalls on request.
    fn fake(dir: &Path) -> PathBuf {
        let script = dir.join("xcodebuild");
        std::fs::write(
            &script,
            r#"#!/bin/sh
dir=$(dirname "$0")
printf '%s\n' "$*" >> "$dir/calls"
step="$1"
while [ $# -gt 0 ]; do
  case "$1" in
    -archivePath) archive="$2" ;;
    -authenticationKeyPath) ls -l "$2" | cut -c1-10 > "$dir/key-mode"; cp "$2" "$dir/key-seen" ;;
  esac
  shift
done
case "$step" in
  archive)
    echo "Building Example"
    if [ -f "$dir/fail-archive" ]; then
      echo "/w/App/View.swift:3:5: error: cannot find 'Missing' in scope"
      echo "** ARCHIVE FAILED **"
      exit 65
    fi
    mkdir -p "$archive/Products/Applications/App.app"
    printf '** ARCHIVE SUCCEEDED **'
    ;;
  -exportArchive)
    [ -f "$dir/slow-export" ] && sleep 30
    if [ -f "$dir/fail-export" ]; then
      echo 'error: exportArchive: No signing certificate "iOS Distribution" found' 1>&2
      echo "** EXPORT FAILED **"
      exit 70
    fi
    echo "Upload succeeded."
    echo "** EXPORT SUCCEEDED **"
    ;;
esac
"#,
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    fn job(folder: &Path) -> Arc<Job> {
        mkdir(folder);
        Arc::new(Job::new(
            UploadState {
                run_id: "run-1".into(),
                phase: Phase::Archiving,
                app_name: "Example".into(),
                bundle_id: "com.example.app".into(),
                version: "1.2".into(),
                build: "13".into(),
                started_at: "2026-01-01T00:00:00Z".into(),
                finished_at: None,
                log: Vec::new(),
                error: None,
                processing: None,
                log_path: folder.join("upload.log").to_string_lossy().into_owned(),
            },
            folder.join("upload.json"),
            &folder.join("upload.log"),
        ))
    }

    #[test]
    fn a_successful_upload_archives_exports_follows_processing_and_deletes_the_key() {
        let dir = scratch();
        let tools = dir.0.join("tools");
        mkdir(&tools);
        let folder = dir.0.join("data/current");
        let plan = plan(&folder, &dir.0, Program::Path(fake(&tools)));
        let job = job(&dir.0.join("data"));
        let phases = Mutex::new(Vec::new());
        execute(&plan, &job, |job| {
            phases.lock().unwrap().push(job.snapshot().phase);
            Processing::Ready
        });
        let state = job.snapshot();
        assert_eq!(state.phase, Phase::Done, "{:?}", state.error);
        assert_eq!(*phases.lock().unwrap(), [Phase::Processing]);
        assert_eq!(
            state.processing.as_deref(),
            Some("Processed. The build is ready to test in TestFlight.")
        );
        assert!(state.finished_at.is_some());
        let calls = std::fs::read_to_string(tools.join("calls")).unwrap();
        let calls: Vec<&str> = calls.lines().collect();
        assert_eq!(calls.len(), 2);
        assert!(calls[0].starts_with("archive -workspace"), "{}", calls[0]);
        assert!(calls[1].starts_with("-exportArchive"), "{}", calls[1]);
        assert_eq!(
            std::fs::read_to_string(tools.join("key-mode"))
                .unwrap()
                .trim(),
            "-rw-------"
        );
        assert!(std::fs::read_to_string(tools.join("key-seen"))
            .unwrap()
            .contains("KEYBODY"));
        assert!(!folder.join("key").exists());
        assert!(folder
            .join("App.xcarchive/Products/Applications/App.app")
            .is_dir());
        assert!(folder.join("ExportOptions.plist").is_file());
        // The final line had no newline and still reached the log.
        assert!(state
            .log
            .iter()
            .any(|line| line == "** ARCHIVE SUCCEEDED **"));
        assert!(state.log.iter().any(|line| line == "Upload succeeded."));
        assert!(state.log.iter().all(|line| !line.contains("KEYBODY")));
        let log = std::fs::read_to_string(&state.log_path).unwrap();
        assert!(log.contains("$ xcodebuild archive"));
        let saved: UploadState =
            serde_json::from_slice(&std::fs::read(dir.0.join("data/upload.json")).unwrap())
                .unwrap();
        assert_eq!(saved.phase, Phase::Done);
    }

    #[test]
    fn a_failed_step_reports_xcodebuilds_own_errors() {
        let dir = scratch();
        let tools = dir.0.join("tools");
        mkdir(&tools);
        std::fs::write(tools.join("fail-export"), "").unwrap();
        let folder = dir.0.join("data/current");
        let plan = plan(&folder, &dir.0, Program::Path(fake(&tools)));
        let job = job(&dir.0.join("data"));
        execute(&plan, &job, |_| {
            panic!("processing is not followed after a failure")
        });
        let state = job.snapshot();
        assert_eq!(state.phase, Phase::Failed);
        assert_eq!(
            state.error.as_deref(),
            Some("The upload failed (exit 70):\nerror: exportArchive: No signing certificate \"iOS Distribution\" found\n** EXPORT FAILED **")
        );
        assert!(!folder.join("key").exists());

        std::fs::remove_file(tools.join("fail-export")).unwrap();
        std::fs::write(tools.join("fail-archive"), "").unwrap();
        let job = super::fake_xcodebuild::job(&dir.0.join("data2"));
        execute(&plan, &job, |_| Processing::Ready);
        let error = job.snapshot().error.unwrap();
        assert!(
            error.starts_with("The archive failed (exit 65):\n"),
            "{error}"
        );
        assert!(
            error.contains("error: cannot find 'Missing' in scope"),
            "{error}"
        );
    }

    #[test]
    fn canceling_stops_xcodebuild_and_ends_canceled() {
        let dir = scratch();
        let tools = dir.0.join("tools");
        mkdir(&tools);
        std::fs::write(tools.join("slow-export"), "").unwrap();
        let folder = dir.0.join("data/current");
        let plan = plan(&folder, &dir.0, Program::Path(fake(&tools)));
        let job = job(&dir.0.join("data"));
        let canceler = job.clone();
        std::thread::spawn(move || {
            while canceler.snapshot().phase != Phase::Exporting {
                std::thread::sleep(Duration::from_millis(20));
            }
            std::thread::sleep(Duration::from_millis(200));
            canceler.canceled.store(true, Ordering::Relaxed);
        });
        let started = std::time::Instant::now();
        execute(&plan, &job, |_| Processing::Ready);
        assert!(started.elapsed() < Duration::from_secs(20));
        let state = job.snapshot();
        assert_eq!(state.phase, Phase::Canceled);
        assert_eq!(state.error, None);
        assert!(!folder.join("key").exists());
    }
}

#[test]
fn an_upload_interrupted_by_quitting_reads_as_failed() {
    let dir = scratch();
    let record = dir.0.join("upload.json");
    let state = UploadState {
        run_id: "run-quit".into(),
        phase: Phase::Exporting,
        app_name: "Example".into(),
        bundle_id: "com.example.app".into(),
        version: "1.2".into(),
        build: "13".into(),
        started_at: "2026-01-01T00:00:00Z".into(),
        finished_at: None,
        log: vec!["line".into()],
        error: None,
        processing: None,
        log_path: String::new(),
    };
    std::fs::write(&record, serde_json::to_vec(&state).unwrap()).unwrap();
    let read = status(&record, "run-quit").unwrap();
    assert_eq!(read.phase, Phase::Failed);
    assert!(read
        .error
        .unwrap()
        .contains("closed before the upload finished"));
    assert!(status(&dir.0.join("missing.json"), "run-none").is_none());
}

#[tokio::test]
async fn processing_is_followed_until_app_store_connect_finishes() {
    let (key, _) = test_key();
    let listed = |state: &str| {
        format!(
            r#"{{"data":[{{"id":"b1","attributes":{{"version":"13","processingState":"{state}"}}}}]}}"#
        )
    };
    let (base, mut requests) = fake_api(vec![
        (200, r#"{"data":[]}"#.into()),
        (
            500,
            r#"{"errors":[{"code":"UNEXPECTED_ERROR","title":"An unexpected error occurred."}]}"#
                .into(),
        ),
        (200, listed("PROCESSING")),
        (200, listed("VALID")),
    ])
    .await;
    let client = crate::commands::http::direct_client(Duration::from_secs(5)).unwrap();
    let api = Api::at(&base, client, &saved(&key)).unwrap();
    let notes = Mutex::new(Vec::new());
    let uploaded = Uploaded {
        app_id: "app-1",
        version: "1.2",
        build: "13",
    };
    let result = follow_processing(
        &api,
        &uploaded,
        (Duration::ZERO, 10),
        || false,
        |note| notes.lock().unwrap().push(note),
    )
    .await;
    assert_eq!(result, Processing::Ready);
    assert_eq!(
        *notes.lock().unwrap(),
        [
            "Uploaded. Waiting for App Store Connect to list the build.",
            "App Store Connect answered 500: UNEXPECTED_ERROR: An unexpected error occurred.",
            "App Store Connect is processing the build (PROCESSING).",
        ]
    );
    let first = requests.recv().await.unwrap();
    assert!(
        first.starts_with("GET /v1/builds?filter[app]=app-1&filter[version]=13&filter[preReleaseVersion.version]=1.2"),
        "{first}"
    );

    let (base, _requests) = fake_api(vec![(200, listed("INVALID"))]).await;
    let client = crate::commands::http::direct_client(Duration::from_secs(5)).unwrap();
    let api = Api::at(&base, client, &saved(&key)).unwrap();
    let result = follow_processing(&api, &uploaded, (Duration::ZERO, 3), || false, |_| {}).await;
    assert_eq!(result, Processing::Rejected("INVALID".into()));
    let stopped = follow_processing(
        &api,
        &uploaded,
        (Duration::from_secs(5), 3),
        || true,
        |_| {},
    )
    .await;
    assert_eq!(stopped, Processing::Stopped);
}

/// Archives a generated one-screen app for generic iOS without signing, with
/// the same command construction an upload uses. Needs Xcode and XcodeGen:
/// `cargo test real_archive -- --ignored`.
#[test]
#[ignore = "needs Xcode and XcodeGen"]
fn real_archive_builds_for_generic_ios() {
    let dir = scratch();
    let root = dir.0.as_path();
    mkdir(&root.join("Sources"));
    std::fs::write(
        root.join("Sources/App.swift"),
        "import SwiftUI\n@main struct TinyApp: App { var body: some Scene { WindowGroup { Text(\"Hi\") } } }\n",
    )
    .unwrap();
    std::fs::write(
        root.join("project.yml"),
        "name: Tiny\noptions:\n  bundleIdPrefix: com.example\nsettings:\n  base:\n    MARKETING_VERSION: \"1.0\"\n    CURRENT_PROJECT_VERSION: \"7\"\n    GENERATE_INFOPLIST_FILE: YES\ntargets:\n  Tiny:\n    type: application\n    platform: iOS\n    deploymentTarget: \"17.0\"\n    sources: [Sources]\n",
    )
    .unwrap();
    let generated = Command::new("xcodegen")
        .arg("generate")
        .current_dir(root)
        .output()
        .expect("xcodegen is installed");
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );

    let local = read_local(&Program::Xcrun, root, None).unwrap();
    assert_eq!(local.scheme, "Tiny");
    assert_eq!(local.settings.bundle_id, "com.example.Tiny");
    assert_eq!(
        (
            local.settings.version.as_str(),
            local.settings.build.as_str()
        ),
        ("1.0", "7")
    );

    let folder = root.join("app-data/current");
    mkdir(&folder);
    let plan = Plan {
        program: Program::Xcrun,
        workspace: root.to_path_buf(),
        container: local.container,
        scheme: local.scheme,
        development_team: String::new(),
        settings: vec!["CODE_SIGNING_ALLOWED=NO".into()],
        export_method: "app-store-connect".into(),
        auth: None,
        folder: folder.clone(),
    };
    let mut command = plan.program.command(root);
    command.args(plan.archive_args());
    let result = process_control::run(command, Duration::from_secs(900)).unwrap();
    assert!(
        result.success,
        "{}\n{}",
        tail(&result.stdout, 30),
        result.stderr
    );
    let app = plan.archive_path().join("Products/Applications/Tiny.app");
    assert!(app.is_dir(), "{}", app.display());
    let info = std::fs::read(plan.archive_path().join("Info.plist")).unwrap();
    assert!(!info.is_empty());

    let changed = set_build_number(root, &local.settings, "7", "8").unwrap();
    assert_eq!(changed.len(), 2, "{changed:?}");
    let reread = read_local(&Program::Xcrun, root, None).unwrap();
    assert_eq!(reread.settings.build, "8");
}
