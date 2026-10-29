use super::*;
use grant::{Choice, Grant, Scope};

fn request(action: &str) -> DesktopRequest {
    serde_json::from_value(json!({"action":action})).unwrap()
}

fn window_of(handle: &str, pid: u32, app: &str) -> Window {
    Window {
        handle: handle.into(),
        pid,
        started: "1".into(),
        title: format!("{app} {handle}"),
        class: "Fixture".into(),
        app: app.into(),
        app_name: app.to_uppercase(),
    }
}

fn window() -> Window {
    window_of("123", 42, "fixture")
}

fn prompt(id: &str, run: &str, status: &str, answer: Option<&str>) -> PendingUserPrompt {
    PendingUserPrompt {
        id: id.into(),
        run_id: run.into(),
        question: "Choose".into(),
        input_type: "choice".into(),
        options: vec![],
        default_value: None,
        status: status.into(),
        answer: answer.map(Into::into),
        created_at: "now".into(),
        answered_at: None,
        presentation: Default::default(),
    }
}

fn store() -> std::path::PathBuf {
    grant::store_path(
        &std::env::temp_dir().join(format!("jackalope-desktop-grants-{}", uuid::Uuid::new_v4())),
    )
}

#[test]
fn desktop_permission_requires_an_explicit_answer_for_this_attempt() {
    let choices = vec![("1: Fixture".to_owned(), Choice::Window(window()))];
    let mut question = prompt("question", "run", "pending", None);
    assert!(selected_answer("run", &question, "question", &choices)
        .unwrap()
        .is_none());
    question.answer = Some("1: Fixture".into());
    assert!(selected_answer("run", &question, "question", &choices)
        .unwrap()
        .is_none());
    question.status = "answered".into();
    assert!(selected_answer("different-run", &question, "question", &choices).is_err());
    assert!(selected_answer("run", &question, "other", &choices).is_err());
    assert_eq!(
        selected_answer("run", &question, "question", &choices).unwrap(),
        Some(Choice::Window(window()))
    );
    question.answer = Some("Do not allow".into());
    assert!(selected_answer("run", &question, "question", &choices)
        .unwrap_err()
        .contains("declined"));
    question.answer = Some("123".into());
    assert!(selected_answer("run", &question, "question", &choices).is_err());
}

#[test]
fn grant_levels_scope_windows_apps_and_the_desktop() {
    let editor = window_of("1", 10, "notepad");
    let second_editor = window_of("2", 11, "notepad");
    let browser = window_of("3", 12, "chrome");
    let jackalope = window_of("4", std::process::id(), "jackalope");
    let one = Grant::from_choice(Choice::Window(editor.clone()));
    assert_eq!(one.scope, Scope::Window);
    assert!(one.allows(&editor, &[]));
    assert!(!one.allows(&second_editor, &[]));
    let mut replaced = editor.clone();
    replaced.started = "2".into();
    assert!(
        !one.allows(&replaced, &[]),
        "a reused handle in a new process is outside the grant"
    );

    let app = Grant::from_choice(Choice::App {
        key: "notepad".into(),
        label: "Notepad".into(),
        primary: editor.clone(),
        remember: false,
    });
    assert!(app.allows(&editor, &[]) && app.allows(&second_editor, &[]));
    assert!(!app.allows(&browser, &[]));

    let desktop = Grant::from_choice(Choice::Desktop);
    assert!(desktop.window.is_none());
    assert!(desktop.allows(&browser, &[]));
    let denied = [std::process::id()];
    assert!(
        !desktop.allows(&jackalope, &denied),
        "Jackalope's own windows are never granted"
    );
    assert!(!app.allows(&editor, &[10]));

    let windows = vec![editor.clone(), second_editor.clone(), browser.clone()];
    let listed = grant::options(Scope::Window, &windows, "Site", Some("chrome"));
    assert_eq!(listed.len(), 3);
    assert_eq!(
        listed[0].1,
        Choice::Window(browser.clone()),
        "the hinted app is listed first"
    );
    let apps = grant::options(Scope::App, &windows, "Site", None);
    assert_eq!(apps.len(), 4, "each app offers once and always");
    assert!(apps[0].0.contains("2 windows"));
    assert!(apps[1].0.starts_with("1: Always allow") && apps[1].0.ends_with("in Site"));
    assert!(matches!(apps[1].1, Choice::App { remember: true, .. }));
    let full = grant::options(Scope::Desktop, &windows, "Site", None);
    assert_eq!(full.len(), 1);
    assert_eq!(full[0].1, Choice::Desktop);
    assert!(
        full.iter().all(|(label, _)| !label.contains("Always")),
        "full desktop is never offered as remembered"
    );
    assert!(
        grant::question(Scope::Desktop, "Site", Some("to compare two apps"), false)
            .contains("never remembered")
    );
    let portal = grant::question(Scope::App, "Site", None, true);
    assert!(
        portal.contains("approve remote control") && !portal.contains("pauses it"),
        "portal desktops do not promise an input pause they cannot provide"
    );
    let labels: Vec<_> = listed
        .iter()
        .chain(&apps)
        .map(|(label, _)| label.clone())
        .collect();
    let unique: HashSet<_> = labels.iter().collect();
    assert_eq!(
        unique.len(),
        labels.len(),
        "answers map to exactly one choice"
    );
}

#[test]
fn remembered_grants_are_per_project_never_full_desktop_and_revocable() {
    let path = store();
    assert!(
        grant::remember(&path, "project", Scope::Desktop, "explorer", "Explorer")
            .unwrap_err()
            .contains("cannot be remembered")
    );
    let saved = grant::remember(&path, "project", Scope::App, "notepad", "Notepad").unwrap();
    let again = grant::remember(&path, "project", Scope::Window, "notepad", "Notepad").unwrap();
    assert_eq!(saved.id, again.id, "remembering twice keeps one entry");
    assert_eq!(
        again.scope,
        Scope::App,
        "a narrower answer does not shrink an app grant"
    );
    assert_eq!(grant::remembered(&path, "project").len(), 1);
    assert!(grant::remembered(&path, "other").is_empty());

    let editor = window_of("1", 10, "notepad");
    let windows = vec![editor.clone(), window_of("3", 12, "chrome")];
    let grants = grant::remembered(&path, "project");
    assert!(
        grant::remembered_choice(&grants, Scope::Window, None, &windows).is_none(),
        "the agent must name the app"
    );
    assert!(grant::remembered_choice(&grants, Scope::Desktop, Some("notepad"), &windows).is_none());
    assert!(grant::remembered_choice(&grants, Scope::Window, Some("chrome"), &windows).is_none());
    let (used, choice) =
        grant::remembered_choice(&grants, Scope::Window, Some("Notepad"), &windows).unwrap();
    assert_eq!(used.id, saved.id);
    assert_eq!(choice, Choice::Window(editor.clone()));
    assert!(matches!(
        grant::remembered_choice(&grants, Scope::App, Some("notepad"), &windows)
            .unwrap()
            .1,
        Choice::App {
            remember: false,
            ..
        }
    ));
    let crowded = vec![editor.clone(), window_of("2", 11, "notepad")];
    assert!(
        grant::remembered_choice(&grants, Scope::Window, Some("notepad"), &crowded).is_none(),
        "several windows still ask which one"
    );

    let window_only = store();
    grant::remember(&window_only, "project", Scope::Window, "notepad", "Notepad").unwrap();
    assert!(grant::remembered_choice(
        &grant::remembered(&window_only, "project"),
        Scope::App,
        Some("notepad"),
        &windows
    )
    .is_none());

    assert!(
        grant::forget(&path, "other", &saved.id).is_err(),
        "another project cannot revoke it"
    );
    grant::forget(&path, "project", &saved.id).unwrap();
    assert!(grant::remembered(&path, "project").is_empty());
    for file in [path, window_only] {
        let _ = std::fs::remove_dir_all(file.parent().unwrap());
    }
}

#[test]
fn remembered_grant_files_stay_readable_across_versions() {
    let path = store();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        r#"{"grants":[{"id":"a","projectId":"p","scope":"app","app":"notepad","label":"Notepad","createdAt":"t"},{"id":"b","projectId":"p","scope":"screen-region","app":"x","label":"X","createdAt":"t","future":1}],"futureField":true}"#,
    )
    .unwrap();
    let grants = grant::remembered(&path, "p");
    assert_eq!(grants.len(), 2);
    assert_eq!(grants[1].scope, Scope::Unknown);
    assert!(
        grant::remembered_choice(&grants, Scope::Window, Some("x"), &[window_of("1", 1, "x")])
            .is_none()
    );
    assert!(
        grant::sites(&path, "p").is_empty(),
        "files without sites still load"
    );
    grant::decide_site(&path, "p", "example.com", true).unwrap();
    assert_eq!(
        grant::remembered(&path, "p").len(),
        2,
        "writing sites keeps grants"
    );
    std::fs::write(&path, "not json").unwrap();
    assert!(
        grant::remembered(&path, "p").is_empty(),
        "an unreadable file grants nothing"
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());

    let record: DesktopActionRecord =
        serde_json::from_value(json!({"at":"t","action":"click","summary":"clicked"})).unwrap();
    assert!(record.capture.is_none() && record.method.is_none());
    let run: TaskRun = serde_json::from_value(json!({
        "id":"r","taskId":"t","projectId":"p","projectName":"P","projectPath":"/p","workspace":"/w","branch":"b","baseHead":"h",
        "agent":"claude","account":"a","model":null,"prompt":"x","status":"done","startedAt":"s","endedAt":null,"sessionId":null,
        "result":"","activity":[],"error":null,"persistenceError":null,"exitCode":null,
        "usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false,"estimatedCostUsd":null}
    }))
    .unwrap();
    assert!(
        run.desktop_actions.is_empty(),
        "runs saved before the action log still load"
    );
}

#[test]
fn browser_sites_are_recognized_and_decided_per_host() {
    assert!(
        grant::is_browser("chrome")
            && grant::is_browser("com.apple.Safari")
            && grant::is_browser("zen")
    );
    assert!(!grant::is_browser("notepad"));
    assert_eq!(
        grant::site_host("https://www.GitHub.com/org/repo?x=1").as_deref(),
        Some("github.com")
    );
    assert_eq!(
        grant::site_host("mail.google.com/mail/u/0").as_deref(),
        Some("mail.google.com")
    );
    assert_eq!(
        grant::site_host("http://localhost:3000/").as_deref(),
        Some("localhost")
    );
    assert_eq!(
        grant::site_host("http://user@example.org:8080/a").as_deref(),
        Some("example.org")
    );
    assert!(grant::site_host("about:blank").is_none());
    assert!(grant::site_host("chrome://settings").is_none());
    assert!(grant::site_host("file:///etc/passwd").is_none());

    let path = store();
    grant::decide_site(&path, "p", "google.com", true).unwrap();
    grant::decide_site(&path, "p", "bank.example.com", false).unwrap();
    let sites = grant::sites(&path, "p");
    assert_eq!(
        grant::site_decision(&sites, "mail.google.com"),
        Some(true),
        "a parent domain decision applies"
    );
    assert_eq!(
        grant::site_decision(&sites, "bank.example.com"),
        Some(false)
    );
    assert_eq!(grant::site_decision(&sites, "example.com"), None);
    assert_eq!(grant::site_decision(&sites, "github.com"), None);
    grant::decide_site(&path, "p", "google.com", false).unwrap();
    assert_eq!(
        grant::site_decision(&grant::sites(&path, "p"), "google.com"),
        Some(false),
        "a new decision replaces the old one"
    );
    assert!(grant::sites(&path, "other").is_empty());
    let id = grant::sites(&path, "p")[0].id.clone();
    grant::forget(&path, "p", &id).unwrap();
    assert_eq!(grant::sites(&path, "p").len(), 1);
    let options = site_options("github.com", "Site");
    assert_eq!(options.len(), 4);
    assert_eq!(options[1].1, (true, true));
    assert_eq!(options[3].1, (false, true));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn element_refs_resolve_from_the_latest_snapshot_only() {
    let mut windows_style = json!({"bounds":[100,100,800,600],"elements":[
        {"ref":"e7","role":"Button","name":"Save","bounds":[10,20,80,30],"actions":["invoke"]},
        {"ref":"e9","role":"password","name":"[protected]","protected":true,"bounds":[10,60,200,30]},
        {"ref":"e11","role":"Edit","name":"Offscreen","bounds":null},
        {"ref":"e12","role":"Text","name":"Far","bounds":[790,590,40,40]}
    ]});
    let table = elements::normalize(&mut windows_style);
    assert_eq!(table.resolve("e7").unwrap().name, "Save");
    assert_eq!(
        table
            .center("e7", elements::area(&windows_style["bounds"]))
            .unwrap(),
        (50, 35)
    );
    assert!(table.resolve("e9").unwrap_err().contains("protected"));
    assert!(table
        .center("e11", None)
        .unwrap_err()
        .contains("no on-screen bounds"));
    assert!(
        table
            .center("e12", elements::area(&windows_style["bounds"]))
            .is_err(),
        "centers outside the window are refused"
    );
    assert!(table
        .resolve("e8")
        .unwrap_err()
        .contains("Take a new snapshot"));
    for bad in ["7", "e", "e07", "E7", "e7x", "e123456789"] {
        assert!(table.resolve(bad).is_err(), "{bad}");
    }

    let mut legacy = json!({"bounds":{"x":0,"y":0,"width":400,"height":300},"controls":[
        {"depth":0,"role":"AXWindow","name":"Doc","bounds":{"x":0,"y":0,"width":400,"height":300}},
        {"depth":1,"role":"AXTextField","password":true,"name":"secret","value":"hunter2","bounds":{"x":5,"y":5,"width":50,"height":20}},
        {"depth":1,"role":"AXButton","name":"OK","bounds":{"x":300,"y":250,"width":60,"height":30}}
    ]});
    let table = elements::normalize(&mut legacy);
    assert!(legacy.get("controls").is_none());
    let items = legacy["elements"].as_array().unwrap();
    assert_eq!(
        items
            .iter()
            .map(|i| i["ref"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["e1", "e2", "e3"]
    );
    assert_eq!(items[1]["name"], "[protected]");
    assert!(
        items[1].get("value").is_none(),
        "protected values never leave normalization"
    );
    assert!(!legacy.to_string().contains("hunter2"));
    assert_eq!(items[2]["bounds"], json!([300, 250, 60, 30]));
    assert_eq!(
        table
            .center("e3", elements::area(&legacy["bounds"]))
            .unwrap(),
        (330, 265)
    );
    let found = elements::RefTable::find_text(&legacy, "ok").unwrap();
    assert_eq!(found["ref"], "e3");
    assert!(elements::RefTable::find_text(&legacy, "hunter").is_none());

    let mut duplicates = json!({"elements":[{"ref":"e1","name":"a"},{"ref":"e1","name":"b"}]});
    elements::normalize(&mut duplicates);
    assert_ne!(
        duplicates["elements"][0]["ref"],
        duplicates["elements"][1]["ref"]
    );
}

#[test]
fn desktop_input_consumes_a_fresh_snapshot_even_on_wrong_id() {
    let snapshot = |id: &str, age: u64| Snapshot {
        id: id.into(),
        bounds: json!([0, 0, 800, 600]),
        surface: "window",
        window: Some(window()),
        refs: Default::default(),
        site: None,
        taken: Instant::now() - Duration::from_secs(age),
        epoch: 1,
    };
    let mut access = Access::default();
    assert!(take_snapshot(&mut access, Some("x")).is_err());
    access.snapshot = Some(snapshot("x", 0));
    assert_eq!(
        take_snapshot(&mut access, Some("x")).unwrap().bounds,
        json!([0, 0, 800, 600])
    );
    assert!(take_snapshot(&mut access, Some("x")).is_err());
    access.snapshot = Some(snapshot("x", 0));
    assert!(take_snapshot(&mut access, Some("old")).is_err());
    assert!(access.snapshot.is_none());
    access.snapshot = Some(snapshot("x", 61));
    assert!(take_snapshot(&mut access, Some("x")).is_err());
}

#[test]
fn desktop_input_is_bounded_and_rejects_system_keys_and_extra_fields() {
    use actions::validate;
    assert!(validate(&request("shell")).is_err());
    let mut input = request("press");
    for key in [
        "Alt+Tab",
        "Windows+r",
        "{ENTER}",
        "Control+v",
        "Primary+v",
        "Control+Escape",
        "Control+Shift+Escape",
        "Control+Alt+Delete",
        "Alt+F4",
        "Primary+Tab",
        "Primary+Space",
        "Primary+q",
        "Shift+a",
        "a",
        "Control+Control+a",
        "Meta+a",
        "Control+",
        "F13",
        "Control+A",
    ] {
        input.key = Some(key.into());
        assert!(validate(&input).is_err(), "{key}");
    }
    for key in [
        "Tab",
        "Shift+Tab",
        "Enter",
        "Control+a",
        "Primary+a",
        "Primary+s",
        "Primary+z",
        "Primary+y",
        "F5",
        "Control+Shift+t",
        "Alt+ArrowLeft",
        "Primary+c",
        "Control+/",
        "Shift+F10",
        "Primary+Shift+z",
    ] {
        input.key = Some(key.into());
        assert!(validate(&input).is_ok(), "{key}");
    }
    let chord = actions::chord("Shift+Primary+z").unwrap();
    assert_eq!(chord.modifiers, ["Shift", "Primary"]);
    assert_eq!(
        chord.native()["modifiers"],
        if cfg!(target_os = "macos") {
            json!(["Shift", "Command"])
        } else {
            json!(["Shift", "Control"])
        }
    );
    assert_eq!(
        actions::chord("Control+Primary+a").unwrap().native()["modifiers"],
        if cfg!(target_os = "macos") {
            json!(["Control", "Command"])
        } else {
            json!(["Control"])
        }
    );
    assert_eq!(
        platform::key("Primary+a"),
        if cfg!(target_os = "macos") {
            "Primary+a"
        } else {
            "Control+a"
        }
    );
    assert_eq!(platform::key("Control+a"), "Control+a");

    let mut input = request("type");
    input.text = Some("literal $() {ENTER} `characters`".into());
    assert!(validate(&input).is_ok());
    input.text = Some("a".repeat(1001));
    assert!(validate(&input).is_err());
    input.text = Some("line\nline".into());
    assert!(validate(&input).is_err());
    let mut input = request("set_value");
    input.element = Some("e3".into());
    input.text = Some("line\nline".into());
    assert!(
        validate(&input).is_ok(),
        "set_value accepts multi-line text"
    );
    input.element = None;
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
    input.x = None;
    input.y = None;
    input.element = Some("e4".into());
    assert!(validate(&input).is_ok(), "scroll can target an element");
    let mut click = request("click");
    assert!(validate(&click).is_err(), "a click needs a target");
    click.element = Some("e1".into());
    click.x = Some(1);
    click.y = Some(1);
    assert!(
        validate(&click).is_err(),
        "element and coordinates are exclusive"
    );
    click.x = None;
    click.y = None;
    assert!(validate(&click).is_ok());
    click.element = Some("button".into());
    assert!(validate(&click).is_err());
    let mut drag = request("drag");
    drag.element = Some("e1".into());
    assert!(validate(&drag).is_err(), "drag needs a destination");
    drag.to_x = Some(5);
    drag.to_y = Some(5);
    assert!(validate(&drag).is_ok());
    for action in ["invoke", "select"] {
        assert!(
            validate(&request(action)).is_err(),
            "{action} needs an element"
        );
    }
    let mut wait = request("wait_for");
    assert!(validate(&wait).is_err());
    wait.text = Some("Saved".into());
    wait.timeout_ms = Some(20_000);
    assert!(validate(&wait).is_err());
    wait.timeout_ms = Some(2_000);
    assert!(validate(&wait).is_ok());
    let mut open = request("open_app");
    for bad in [
        "C:\\Windows\\notepad.exe",
        "/Applications/Safari.app",
        "notepad & calc",
        "-n",
        "app;rm",
    ] {
        open.app = Some(bad.into());
        assert!(validate(&open).is_err(), "{bad}");
    }
    open.app = Some("notepad".into());
    assert!(validate(&open).is_ok());
    let mut access = request("request_access");
    access.scope = Some("screen".into());
    assert!(validate(&access).is_err());
    for scope in ["window", "app", "desktop"] {
        access.scope = Some(scope.into());
        assert!(validate(&access).is_ok());
    }
    access.reason = Some("x".repeat(301));
    assert!(validate(&access).is_err());
    assert!(validate(&request("switch_window")).is_err());
    let mut clipboard = request("clipboard_write");
    assert!(validate(&clipboard).is_err());
    clipboard.text = Some("a\nb".into());
    assert!(validate(&clipboard).is_ok());
    assert!(serde_json::from_value::<DesktopRequest>(
        json!({"action":"screenshot","path":"outside.png"})
    )
    .is_err());
    assert!(serde_json::from_value::<DesktopRequest>(
        json!({"action":"click","element":"e1","deny":[1]})
    )
    .is_err());
}

#[test]
fn platform_capabilities_match_the_helpers() {
    let capabilities = platform::capabilities();
    for action in actions::ACTIONS {
        if cfg!(any(windows, target_os = "macos")) {
            assert!(capabilities.action(action).is_ok(), "{action}");
        }
    }
    assert!(capabilities.scope(Scope::Window).is_ok());
    assert_eq!(
        capabilities.scope(Scope::Desktop).is_ok(),
        cfg!(any(windows, target_os = "macos"))
    );
    assert_eq!(
        capabilities.element_actions,
        cfg!(any(windows, target_os = "macos"))
    );
    assert_eq!(
        platform::launcher().is_some(),
        cfg!(any(windows, target_os = "macos"))
    );
    assert!(capabilities.scope(Scope::Unknown).is_err());
}

#[test]
fn desktop_control_portal_capabilities_offer_no_single_window_grants() {
    let both = platform::portal_capabilities(portal::PortalScopes {
        app: true,
        desktop: true,
    });
    assert!(both.scope(Scope::App).is_ok() && both.scope(Scope::Desktop).is_ok());
    let error = both.scope(Scope::Window).unwrap_err();
    assert!(error.contains("app or desktop"), "{error}");
    assert!(both.element_actions && both.chords);
    for action in ["open_app", "clipboard_read", "clipboard_write"] {
        assert!(both.action(action).is_err(), "{action}");
    }
    for action in actions::ACTIONS {
        if !["open_app", "clipboard_read", "clipboard_write"].contains(action) {
            assert!(both.action(action).is_ok(), "{action}");
        }
    }
    let app_only = platform::portal_capabilities(portal::PortalScopes {
        app: true,
        desktop: false,
    });
    assert!(app_only.scope(Scope::Desktop).is_err());
    let message = platform::portal_message(portal::PortalScopes {
        app: true,
        desktop: false,
    });
    assert!(message.contains("does not pause") && message.contains("an app"));
}

#[test]
fn action_summaries_are_compact_and_never_echo_long_text() {
    let mut typed = request("type");
    typed.text = Some("x".repeat(100));
    let summary = summarize(&typed, Some("e3 \u{201c}Search\u{201d}"));
    assert!(summary.starts_with("typed") && summary.contains('\u{2026}') && summary.len() < 120);
    let mut press = request("press");
    press.key = Some("Primary+s".into());
    assert_eq!(summarize(&press, None), "pressed Primary+s");
    let mut click = request("click");
    click.x = Some(4);
    click.y = Some(9);
    assert_eq!(summarize(&click, None), "click (4, 9)");
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
    let file = super::super::file_lock::FileLock::try_new(file).unwrap();
    let owned = Arc::new(Session::new(file));
    let id = uuid::Uuid::new_v4().to_string();
    sessions().lock().unwrap().insert(id.clone(), owned.clone());
    close(&id);
    assert!(owned.canceled.load(Ordering::SeqCst));
    assert!(
        view(&id).is_none(),
        "a revoked grant disappears from the Screen view"
    );
    assert!(
        owned
            .call(json!({"action":"list"}), Duration::from_secs(1))
            .is_err(),
        "a revoked session never starts a helper"
    );
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
    let runtime = TaskRuntime::with_test_access(directory.join("runs")).unwrap();
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

/// Opens a disposable form, starts a real indicator and drives the resident
/// helper through every Windows action, printing per-action latency.
#[cfg(windows)]
#[test]
#[ignore = "Opens and controls a disposable Windows form; requires an interactive test desktop"]
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
    // The job object closes the fixture even if an assertion unwinds past cleanup.
    let tree = super::super::process_control::ProcessTree::attach(&child).unwrap();
    let canceled = AtomicBool::new(false);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut helper = helper::Helper::new(platform::launcher().unwrap());
        let mut call = |payload: Value| {
            let started = Instant::now();
            let result = helper
                .call(&payload, Duration::from_secs(45), &canceled)
                .map_err(String::from);
            println!("{} {} ms", payload["action"], started.elapsed().as_millis());
            result
        };
        let mut target = None;
        for _ in 0..20 {
            let listed = call(json!({"action":"list"})).unwrap();
            target = listed["windows"]
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
        let window: Window = serde_json::from_value(target.clone()).unwrap();
        let mut indicator =
            indicator::Indicator::start(&Grant::from_choice(Choice::Window(window))).unwrap();
        let state = indicator.state().unwrap();
        assert_eq!(state.status, "active");
        let base = |action: &str| json!({"action":action,"window":target,"scope":"window","surface":"window","guard":indicator.guard(state.epoch),"deny":[std::process::id()]});
        call(base("focus")).expect("Focus the disposable fixture");
        let mut snap = call(base("snapshot")).unwrap();
        assert!(!snap.to_string().contains("fixture-only-hidden"));
        let refs = elements::normalize(&mut snap);
        let items = snap["elements"].as_array().unwrap().clone();
        let find = |role: &str| {
            items
                .iter()
                .find(|e| e["role"] == role && e["protected"] != true)
                .unwrap()["ref"]
                .as_str()
                .unwrap()
                .to_owned()
        };
        let editor = find("Edit");
        let button = find("Button");
        let password = items.iter().find(|e| e["protected"] == true).unwrap()["ref"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(refs.resolve(&password).is_err());
        let again = call(base("snapshot")).unwrap();
        assert!(
            again["elements"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["ref"] == editor.as_str()),
            "refs are stable"
        );

        let mut value = base("set_value");
        value["element"] = json!(editor);
        value["text"] = json!("set by accessibility");
        let result = call(value).unwrap();
        assert_eq!(result["method"], "accessibility");
        wait_for_fixture_text(&report, "set by accessibility");
        let mut press = base("invoke");
        press["element"] = json!(button);
        assert_eq!(call(press).unwrap()["focusChanged"], false);
        wait_for_fixture_text(&report, "button invoked");

        let mut click = base("click");
        click["element"] = json!(editor);
        call(click).unwrap();
        let literal = "Jackalope {ENTER} + ^ % $()";
        let mut select_all = base("press");
        select_all["chord"] = json!({"modifiers":["Control"],"key":"a"});
        call(select_all).unwrap();
        let mut typed = base("type");
        typed["text"] = json!(literal);
        call(typed).unwrap();
        wait_for_fixture_text(&report, literal);
        let mut protected = base("set_value");
        protected["element"] = json!(password);
        protected["text"] = json!("must not enter");
        assert!(call(protected).unwrap_err().contains("protected"));

        let image = directory.join("window.png");
        let mut shot = base("screenshot");
        shot["path"] = json!(image);
        call(shot).unwrap();
        let dimensions =
            super::super::harness::png_dimensions(&std::fs::read(&image).unwrap()).unwrap();
        assert!(dimensions.0 > 400 && dimensions.1 > 200);
        let thumb = directory.join("thumb.png");
        let mut small = base("screenshot");
        small["path"] = json!(thumb);
        small["thumb"] = json!(200);
        call(small).unwrap();
        assert_eq!(
            super::super::harness::png_dimensions(&std::fs::read(&thumb).unwrap())
                .unwrap()
                .0,
            200
        );

        let mut wrong = base("snapshot");
        wrong["window"]["pid"] = json!(0);
        assert!(call(wrong).is_err());
        let mut moved = base("click");
        moved["bounds"] = json!([0, 0, 1, 1]);
        moved["x"] = json!(1);
        moved["y"] = json!(1);
        assert!(call(moved).is_err());
        canceled.store(true, Ordering::SeqCst);
        assert!(call(base("snapshot")).is_err());
        drop(indicator);
        println!("Native desktop evidence: {}", directory.display());
    }));
    tree.terminate();
    let _ = child.kill();
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
