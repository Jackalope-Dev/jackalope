use super::*;

#[test]
fn input_validation_preserves_legacy_actions_and_rejects_arbitrary_execution() {
    let policy = codex_tool_policy();
    assert_eq!(policy["browser_interact"]["approval_mode"], "approve");
    assert!(policy.get("execute_tool").is_none());
    assert!(policy.get("computer_verify").is_none());
    for action in [
        "click", "type", "scroll", "select", "fill", "check", "press",
    ] {
        assert!(interaction(&BrowserInteractRequest {
            action: action.into(),
            selector: "#name".into(),
            text: Some("value".into())
        })
        .is_ok());
    }
    for action in ["evaluate", "upload", "auth", "launch", "state_save"] {
        assert!(interaction(&BrowserInteractRequest {
            action: action.into(),
            selector: "#name".into(),
            text: None
        })
        .is_err());
    }
    let request: BrowserSnapshotRequest = serde_json::from_value(json!({"url":null})).unwrap();
    assert_eq!(request.mode, "accessibility");
    let (text, truncated) = bounded(&"🦀".repeat(40_001));
    assert_eq!(text.chars().count(), 40_000);
    assert!(truncated);
}

#[tokio::test]
async fn closed_attempt_cannot_recreate_a_browser() {
    let id = uuid::Uuid::new_v4().to_string();
    register(&id);
    close(&id);
    assert!(browser_navigate(&id, "http://127.0.0.1")
        .await
        .unwrap_err()
        .contains("no active browser permission"));
}

#[tokio::test]
#[ignore = "Launches the bundled engine and installed browser in disposable profiles"]
async fn real_agent_browser_workflow() {
    let directory = std::env::temp_dir().join(format!("jl-browser-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let html = format!(
        r#"<!doctype html><html><head><style>{}</style></head><body><h1>Profile settings</h1><form onsubmit="event.preventDefault();document.querySelector('output').textContent='Saved '+document.querySelector('#name').value"><label>Name<input id="name" value="Old"></label><label>Plan<select id="plan"><option>Free</option><option>Pro</option></select></label><label><input id="updates" type="checkbox">Updates</label><button>Save profile</button></form><output role="status"></output><button id="async" onclick="setTimeout(()=>this.textContent='Finished',100)">Run check</button></body></html>"#,
        "/* application styles */".repeat(2400)
    );
    let file = directory.join("index.html");
    std::fs::write(&file, html).unwrap();
    let url = format!("file:///{}", file.to_string_lossy().replace('\\', "/"));
    let id = uuid::Uuid::new_v4().to_string();
    let other = uuid::Uuid::new_v4().to_string();
    register(&id);
    register(&other);
    struct Cleanup(Vec<String>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            for id in &self.0 {
                close(id);
            }
        }
    }
    let _cleanup = Cleanup(vec![id.clone(), other.clone()]);
    browser_navigate(&id, &url).await.unwrap();
    let snapshot = browser_snapshot(&id, serde_json::from_value(json!({})).unwrap())
        .await
        .unwrap();
    let text = snapshot["snapshot"].as_str().unwrap();
    assert!(text.contains("Save profile"));
    let name_line = text
        .lines()
        .find(|l| l.contains("textbox") && l.contains("Name"))
        .unwrap();
    let reference = name_line
        .split("ref=")
        .nth(1)
        .unwrap()
        .split([']', ','])
        .next()
        .unwrap();
    browser_interact(
        &id,
        BrowserInteractRequest {
            action: "fill".into(),
            selector: format!("@{reference}"),
            text: Some("Jackalope".into()),
        },
    )
    .await
    .unwrap();
    for (action, selector, value) in [
        ("select", "#plan", Some("Pro")),
        ("check", "#updates", None),
        ("press", "button", Some("Enter")),
    ] {
        browser_interact(
            &id,
            BrowserInteractRequest {
                action: action.into(),
                selector: selector.into(),
                text: value.map(str::to_owned),
            },
        )
        .await
        .unwrap();
    }
    browser_interact(
        &id,
        BrowserInteractRequest {
            action: "wait".into(),
            selector: String::new(),
            text: Some("Saved Jackalope".into()),
        },
    )
    .await
    .unwrap();
    let after = browser_snapshot(&id, serde_json::from_value(json!({})).unwrap())
        .await
        .unwrap();
    assert!(after["snapshot"]
        .as_str()
        .unwrap()
        .contains("Saved Jackalope"));
    let legacy = browser_snapshot(&id, serde_json::from_value(json!({"mode":"html"})).unwrap())
        .await
        .unwrap();
    assert!(!legacy["dom_snippet"]
        .as_str()
        .unwrap()
        .contains("Save profile"));
    assert_eq!(legacy["truncated"], true);
    println!("Snapshot comparison: HTML {} chars; accessibility {} chars; accessibility includes form omitted by HTML truncation", legacy["dom_snippet"].as_str().unwrap().len(), text.len());
    browser_configure(
        &id,
        BrowserConfigureRequest {
            width: Some(960),
            height: Some(640),
            color_scheme: Some("dark".into()),
            reduced_motion: Some(true),
        },
    )
    .await
    .unwrap();
    let screenshot = browser_screenshot(&id, &directory, None, None)
        .await
        .unwrap();
    assert_eq!((screenshot.width, screenshot.height), (960, 640));
    assert!(Path::new(&screenshot.file_path).is_file());
    browser_navigate(&other, &url).await.unwrap();
    let second = browser_snapshot(&other, serde_json::from_value(json!({})).unwrap())
        .await
        .unwrap();
    assert!(!second["snapshot"]
        .as_str()
        .unwrap()
        .contains("Saved Jackalope"));
    let dir = sessions()
        .lock()
        .unwrap()
        .get(&id)
        .unwrap()
        .engine
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .directory
        .clone();
    close(&id);
    assert!(!dir.exists());
    browser_snapshot(&other, serde_json::from_value(json!({})).unwrap())
        .await
        .unwrap();
    close(&other);
    println!("Real browser evidence retained at {}", directory.display());
}

#[tokio::test]
#[ignore = "Exercises real browser cancellation and concurrent session limits"]
async fn real_agent_browser_stop_and_capacity() {
    let ids: Vec<String> = (0..5).map(|_| uuid::Uuid::new_v4().to_string()).collect();
    struct Cleanup(Vec<String>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            for id in &self.0 {
                close(id);
            }
        }
    }
    let _cleanup = Cleanup(ids.clone());
    let directory =
        std::env::temp_dir().join(format!("jl-browser-cancel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let file = directory.join("index.html");
    std::fs::write(&file, "<!doctype html><h1>Cancellation test</h1>").unwrap();
    let url = format!("file:///{}", file.to_string_lossy().replace('\\', "/"));
    for id in &ids {
        register(id);
    }
    for id in &ids[..4] {
        browser_navigate(id, &url).await.unwrap();
    }
    assert!(browser_navigate(&ids[4], &url)
        .await
        .unwrap_err()
        .contains("Four tasks"));
    let waiting = ids[0].clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        with_session(&waiting, move |engine| {
            let _ = tx.send(());
            engine.call(json!({"action":"wait","text":"Never arrives","timeout":15000}))
        })
        .await
    });
    rx.await.unwrap();
    let started = std::time::Instant::now();
    close(&ids[0]);
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    browser_snapshot(&ids[1], serde_json::from_value(json!({})).unwrap())
        .await
        .unwrap();
    browser_navigate(&ids[4], &url).await.unwrap();
    assert!(browser_navigate(&ids[0], &url).await.is_err());
}

#[tokio::test]
#[ignore = "Exercises real tab, diagnostic, theme and accessibility behavior"]
async fn real_agent_browser_tabs_and_diagnostics() {
    let id = uuid::Uuid::new_v4().to_string();
    register(&id);
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            close(&self.0);
        }
    }
    let _cleanup = Cleanup(id.clone());
    let dir = std::env::temp_dir().join(format!("jl-browser-tabs-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let file = dir.join("index.html");
    std::fs::write(&file,r#"<!doctype html><h1>Tabs test</h1><input value="hello"><button onclick="console.log('browser diagnostic');throw new Error('fixture page error')">Emit diagnostics</button>"#).unwrap();
    let url = format!("file:///{}", file.to_string_lossy().replace('\\', "/"));
    browser_navigate(&id, &url).await.unwrap();
    let tabs = browser_tabs(
        &id,
        serde_json::from_value(json!({"action":"list"})).unwrap(),
    )
    .await
    .unwrap();
    let first = tabs["tabs"][0]["tabId"].as_str().unwrap().to_string();
    browser_tabs(
        &id,
        serde_json::from_value(json!({"action":"new","url":url})).unwrap(),
    )
    .await
    .unwrap();
    let tabs = browser_tabs(
        &id,
        serde_json::from_value(json!({"action":"list"})).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(tabs["tabs"].as_array().unwrap().len(), 2);
    let second = tabs["tabs"][1]["tabId"].as_str().unwrap().to_string();
    browser_tabs(
        &id,
        serde_json::from_value(json!({"action":"switch","tab":first})).unwrap(),
    )
    .await
    .unwrap();
    browser_tabs(
        &id,
        serde_json::from_value(json!({"action":"close","tab":second})).unwrap(),
    )
    .await
    .unwrap();
    for (kind, expected) in [("value", "hello"), ("visible", "true"), ("enabled", "true")] {
        let result = browser_inspect(
            &id,
            BrowserInspectRequest {
                kind: kind.into(),
                selector: Some("input".into()),
            },
        )
        .await
        .unwrap();
        assert!(result["content"].as_str().unwrap().contains(expected));
    }
    browser_interact(
        &id,
        BrowserInteractRequest {
            action: "click".into(),
            selector: "button".into(),
            text: None,
        },
    )
    .await
    .unwrap();
    for (kind, expected) in [
        ("console", "browser diagnostic"),
        ("errors", "fixture page error"),
    ] {
        let started = std::time::Instant::now();
        loop {
            let result = browser_inspect(
                &id,
                BrowserInspectRequest {
                    kind: kind.into(),
                    selector: None,
                },
            )
            .await
            .unwrap();
            if result["content"].as_str().unwrap().contains(expected) {
                break;
            }
            assert!(
                started.elapsed() < std::time::Duration::from_secs(2),
                "{result}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }
    browser_configure(
        &id,
        serde_json::from_value(json!({"color_scheme":"dark","reduced_motion":true})).unwrap(),
    )
    .await
    .unwrap();
    browser_configure(
        &id,
        serde_json::from_value(json!({"color_scheme":"light"})).unwrap(),
    )
    .await
    .unwrap();
    let media=with_session(&id,|engine|engine.call(json!({"action":"evaluate","script":"[matchMedia('(prefers-color-scheme:light)').matches,matchMedia('(prefers-reduced-motion:reduce)').matches]"}))).await.unwrap();
    assert_eq!(media["result"], json!([true, true]));
    let scoped = browser_snapshot(
        &id,
        serde_json::from_value(json!({"selector":"h1","mode":"html"})).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(scoped["dom_snippet"], "<h1>Tabs test</h1>");
}
