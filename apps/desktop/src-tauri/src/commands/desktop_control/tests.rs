use super::*;

fn request(action: &str) -> DesktopRequest {
    serde_json::from_value(json!({"action":action})).unwrap()
}

fn window() -> Window {
    Window {
        handle: "123".into(),
        pid: 42,
        started: "1".into(),
        title: "Fixture".into(),
        class: "Fixture".into(),
    }
}

#[test]
fn desktop_permission_requires_an_explicit_answer_for_this_attempt() {
    let access = Access {
        prompt_id: "question".into(),
        choices: vec![("1: Fixture".into(), window())],
        ..Access::default()
    };
    let mut prompt = PendingUserPrompt {
        id: "question".into(),
        run_id: "run".into(),
        question: "Choose".into(),
        input_type: "choice".into(),
        options: vec!["1: Fixture".into()],
        default_value: Some("1: Fixture".into()),
        status: "pending".into(),
        answer: None,
        created_at: "now".into(),
        answered_at: None,
    };
    assert!(selected_answer("run", &prompt, &access).unwrap().is_none());
    prompt.answer = Some("1: Fixture".into());
    assert!(selected_answer("run", &prompt, &access).unwrap().is_none());
    prompt.status = "answered".into();
    assert!(selected_answer("different-run", &prompt, &access).is_err());
    assert_eq!(
        selected_answer("run", &prompt, &access)
            .unwrap()
            .unwrap()
            .handle,
        "123"
    );
    prompt.answer = Some("Do not allow".into());
    assert!(selected_answer("run", &prompt, &access)
        .unwrap_err()
        .contains("declined"));
    prompt.answer = Some("123".into());
    assert!(selected_answer("run", &prompt, &access).is_err());
}

#[test]
fn desktop_input_consumes_a_fresh_snapshot_even_on_wrong_id() {
    let mut access = Access::default();
    assert!(take_snapshot(&mut access, Some("x")).is_err());
    access.snapshot = Some(Snapshot {
        id: "x".into(),
        bounds: json!([0, 0, 800, 600]),
        taken: Instant::now(),
    });
    assert_eq!(
        take_snapshot(&mut access, Some("x")).unwrap(),
        json!([0, 0, 800, 600])
    );
    assert!(take_snapshot(&mut access, Some("x")).is_err());
    access.snapshot = Some(Snapshot {
        id: "x".into(),
        bounds: json!([0, 0, 800, 600]),
        taken: Instant::now(),
    });
    assert!(take_snapshot(&mut access, Some("old")).is_err());
    assert!(access.snapshot.is_none());
    access.snapshot = Some(Snapshot {
        id: "x".into(),
        bounds: json!([0, 0, 800, 600]),
        taken: Instant::now() - Duration::from_secs(61),
    });
    assert!(take_snapshot(&mut access, Some("x")).is_err());
}

#[test]
fn desktop_input_is_bounded_and_rejects_system_keys_and_extra_fields() {
    assert!(validate(&request("shell")).is_err());
    let mut input = request("press");
    for key in ["Alt+Tab", "Windows+r", "{ENTER}", "Control+v"] {
        input.key = Some(key.into());
        assert!(validate(&input).is_err());
    }
    input.key = Some("Control+a".into());
    assert!(validate(&input).is_ok());
    let mut input = request("type");
    input.text = Some("literal $() {ENTER} `characters`".into());
    assert!(validate(&input).is_ok());
    input.text = Some("a".repeat(1001));
    assert!(validate(&input).is_err());
    input.text = Some("line\nline".into());
    assert!(validate(&input).is_err());
    let mut input = request("scroll");
    input.x = Some(1);
    input.y = Some(1);
    input.wheel = Some(11);
    assert!(validate(&input).is_err());
    input.wheel = Some(-3);
    assert!(validate(&input).is_ok());
    input.x = Some(-1);
    assert!(validate(&input).is_err());
    assert!(serde_json::from_value::<DesktopRequest>(
        json!({"action":"screenshot","path":"outside.png"})
    )
    .is_err());
}

#[test]
fn desktop_release_cancels_inflight_work_before_releasing_its_lease() {
    let path =
        std::env::temp_dir().join(format!("jackalope-desktop-lease-{}", uuid::Uuid::new_v4()));
    let file = std::fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    file.try_lock().unwrap();
    let owned = Arc::new(Session {
        canceled: AtomicBool::new(false),
        access: Mutex::new(Access::default()),
        _lease: file,
    });
    let id = uuid::Uuid::new_v4().to_string();
    sessions().lock().unwrap().insert(id.clone(), owned.clone());
    close(&id);
    assert!(owned.canceled.load(Ordering::SeqCst));
    let competing = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    assert!(competing.try_lock().is_err());
    drop(owned);
    competing.try_lock().unwrap();
    drop(competing);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn desktop_bridge_rejects_unauthorized_and_missing_attempts_before_access() {
    let directory =
        std::env::temp_dir().join(format!("jackalope-desktop-auth-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::new(directory.join("runs")).unwrap();
    assert!(session(&runtime, "missing", true).is_err());
    let service =
        super::super::coordination::Coordinator::new(directory.join("queue"), runtime.clone())
            .unwrap();
    let result = bridge(
        axum::extract::State(service),
        axum::http::HeaderMap::new(),
        axum::Json(request("request_access")),
    )
    .await;
    assert_eq!(result.unwrap_err().0, axum::http::StatusCode::UNAUTHORIZED);
    drop(runtime);
    std::fs::remove_dir_all(directory).unwrap();
}

#[cfg(windows)]
#[test]
#[ignore = "Opens and controls a disposable Windows form; requires an interactive desktop"]
fn native_desktop_window_trial() {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    let directory =
        std::env::temp_dir().join(format!("jackalope-desktop-trial-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let fixture = directory.join("fixture.ps1");
    std::fs::write(&fixture, include_str!("fixture.ps1")).unwrap();
    let title = format!("Jackalope desktop fixture {}", uuid::Uuid::new_v4());
    let report = directory.join("result.txt");
    let powershell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut child = Command::new(powershell)
        .args(["-NoProfile", "-File"])
        .arg(fixture)
        .env("JACKALOPE_DESKTOP_FIXTURE_TITLE", &title)
        .env("JACKALOPE_DESKTOP_FIXTURE_RESULT", &report)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .unwrap();
    let tree = super::super::process_control::ProcessTree::attach(&child).unwrap();
    let canceled = AtomicBool::new(false);
    let result = std::panic::catch_unwind(|| {
        let mut target = None;
        for _ in 0..8 {
            let windows = native(json!({"action":"list"}), &canceled).unwrap();
            target = windows["windows"]
                .as_array()
                .unwrap()
                .iter()
                .find(|w| w["title"] == title)
                .cloned();
            if target.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        let target = target.expect("Fixture window appeared");
        native(json!({"action":"focus","window":target}), &canceled)
            .expect("Focus the disposable fixture");
        let snap = native(json!({"action":"snapshot","window":target}), &canceled).unwrap();
        assert!(!snap.to_string().contains("fixture-only-hidden"));
        assert!(snap["elements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["role"] == "password"));
        let editor = snap["elements"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| {
                e["class"]
                    .as_str()
                    .is_some_and(|c| c.to_uppercase().contains("EDIT"))
            })
            .expect("Text input in UIA snapshot");
        let x = editor["bounds"][0].as_i64().unwrap() + 20;
        let y = editor["bounds"][1].as_i64().unwrap() + 10;
        native(
            json!({"action":"click","window":target,"bounds":snap["bounds"],"x":x,"y":y}),
            &canceled,
        )
        .unwrap();
        let literal = "Jackalope {ENTER} + ^ % $()";
        native(
            json!({"action":"type","window":target,"bounds":snap["bounds"],"text":literal}),
            &canceled,
        )
        .unwrap();
        wait_for_fixture_text(&report, literal);
        native(
            json!({"action":"press","window":target,"bounds":snap["bounds"],"key":"Tab"}),
            &canceled,
        )
        .unwrap();
        let protected = native(json!({"action":"type","window":target,"bounds":snap["bounds"],"text":"must not enter"}), &canceled).unwrap_err();
        assert!(protected.contains("protected"), "{protected}");
        let image = directory.join("window.png");
        native(
            json!({"action":"screenshot","window":target,"path":image}),
            &canceled,
        )
        .unwrap();
        let dimensions =
            super::super::harness::png_dimensions(&std::fs::read(&image).unwrap()).unwrap();
        assert!(dimensions.0 > 400 && dimensions.1 > 200);
        let mut wrong = target.clone();
        wrong["pid"] = json!(0);
        assert!(native(json!({"action":"snapshot","window":wrong}), &canceled).is_err());
        assert!(native(
            json!({"action":"click","window":target,"bounds":[0,0,1,1],"x":1,"y":1}),
            &canceled
        )
        .is_err());
        assert!(native(
            json!({"action":"click","window":target,"bounds":snap["bounds"],"x":-1,"y":1}),
            &canceled
        )
        .is_err());
        canceled.store(true, Ordering::SeqCst);
        assert!(native(json!({"action":"snapshot","window":target}), &canceled).is_err());
        println!("Native desktop evidence: {}", directory.display());
    });
    tree.terminate();
    let _ = child.wait();
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

#[cfg(windows)]
fn wait_for_fixture_text(path: &std::path::Path, expected: &str) {
    for _ in 0..100 {
        if std::fs::read_to_string(path).ok().as_deref() == Some(expected) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(std::fs::read_to_string(path).unwrap(), expected);
}
