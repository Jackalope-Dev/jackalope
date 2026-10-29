use super::*;
use crate::commands::project_registry::ProjectRecord;
use std::path::Path;

fn record(command: Option<&str>) -> ProjectRecord {
    ProjectRecord {
        id: "project".into(),
        name: "Project".into(),
        path: "/project".into(),
        preview_command: command.map(str::to_string),
        ..Default::default()
    }
}

#[test]
fn captures_need_a_preview_command_and_default_to_the_home_page_on_desktop() {
    assert_eq!(settings(&record(None)), None);
    assert_eq!(settings(&record(Some("pnpm dev"))), None, "needs {{port}}");
    let defaults = settings(&record(Some(" pnpm dev --port {port} "))).unwrap();
    assert_eq!(defaults.command, "pnpm dev --port {port}");
    assert_eq!(defaults.pages, ["/"]);
    assert_eq!(defaults.viewports, ["desktop"]);
    let mut off = record(Some("pnpm dev --port {port}"));
    off.review_captures = Some(false);
    assert_eq!(settings(&off), None);
    let mut custom = record(Some("pnpm dev --port {port}"));
    custom.review_pages = vec![
        "/settings/".into(),
        "/settings".into(),
        "https://example.com".into(),
        "//evil".into(),
    ];
    custom.review_viewports = vec!["narrow".into(), "watch".into(), "desktop".into()];
    let custom = settings(&custom).unwrap();
    assert_eq!(custom.pages, ["/settings"]);
    assert_eq!(custom.viewports, ["desktop", "narrow"]);
    // Older ledgers without the new fields keep working.
    let legacy: ProjectRecord =
        serde_json::from_str(r#"{"id":"old","name":"Old","path":"/old"}"#).unwrap();
    assert!(legacy.review_pages.is_empty() && legacy.review_captures.is_none());
}

#[test]
fn page_paths_stay_on_the_preview_origin() {
    assert_eq!(normalize("/"), Some("/".into()));
    assert_eq!(normalize("/a/b/#top"), Some("/a/b".into()));
    assert_eq!(normalize("/search?q=1"), Some("/search?q=1".into()));
    for rejected in ["", "settings", "//host/x", "/a b", "/a\\b", "http://x/"] {
        assert_eq!(normalize(rejected), None, "{rejected}");
    }
}

#[test]
fn criteria_name_routes_but_not_source_files_or_other_sites() {
    assert_eq!(
        paths_in_text(
            "WHEN a person opens /settings/profile and http://localhost:5173/onboarding?step=2, \
             THEN `/billing`. Edit /src/app.tsx, see https://example.com/docs and/or / for more."
        ),
        ["/settings/profile", "/onboarding?step=2", "/billing"]
    );
    assert!(paths_in_text("No route here").is_empty());
}

#[test]
fn pages_follow_settings_then_criteria_then_visits_within_the_cap() {
    let criteria = vec![
        ("AC-1".to_string(), "The /settings page saves".to_string()),
        (
            "AC-2".to_string(),
            "/settings and /help both work".to_string(),
        ),
    ];
    let visited: Vec<String> = ["/a", "/b", "/c", "/d", "/e", "/help"]
        .map(String::from)
        .to_vec();
    let pages = select_pages(&["/".into()], &criteria, &visited);
    let paths: Vec<&str> = pages.iter().map(|page| page.path.as_str()).collect();
    assert_eq!(paths, ["/", "/settings", "/help", "/e", "/d", "/c"]);
    assert_eq!(pages.len(), PAGE_LIMIT);
    assert_eq!(pages[1].criteria, ["AC-1", "AC-2"]);
    assert_eq!(pages[2].reasons, ["plan", "visited"]);
}

#[test]
fn only_local_visits_are_remembered_and_they_stay_bounded() {
    let mut run = TaskRun::default();
    record_visit(&mut run, "https://example.com/private");
    record_visit(&mut run, "file:///tmp/page.html");
    assert!(run.visited_pages.is_empty());
    record_visit(&mut run, "http://127.0.0.1:4000/a");
    record_visit(&mut run, "http://localhost:5173/b/");
    record_visit(&mut run, "http://127.0.0.1:4000/a#again");
    assert_eq!(run.visited_pages, ["/b", "/a"]);
    for index in 0..30 {
        record_visit(&mut run, &format!("http://localhost:3000/page-{index}"));
    }
    assert_eq!(run.visited_pages.len(), VISIT_LIMIT);
    assert_eq!(run.visited_pages.last().unwrap(), "/page-29");
}

fn artifact(id: &str) -> ScreenshotArtifact {
    ScreenshotArtifact {
        id: id.into(),
        name: id.into(),
        url: "http://127.0.0.1:1/".into(),
        file_path: format!("/workspace/.jackalope/artifacts/screenshots/{id}.png"),
        width: 1280,
        height: 800,
        timestamp: "now".into(),
    }
}

#[test]
fn browser_criteria_get_matching_captures_as_pending_review_evidence() {
    let doc = crate::commands::planning::artifact::PlanDocument {
        criteria: vec![
            crate::commands::planning::artifact::Criterion {
                id: "AC-1".into(),
                verify: crate::commands::planning::artifact::VerifyKind::Browser,
                text: "The /settings page shows the saved name".into(),
                ..Default::default()
            },
            crate::commands::planning::artifact::Criterion {
                id: "AC-2".into(),
                verify: crate::commands::planning::artifact::VerifyKind::Browser,
                text: "The banner appears".into(),
                ..Default::default()
            },
            crate::commands::planning::artifact::Criterion {
                id: "AC-3".into(),
                verify: crate::commands::planning::artifact::VerifyKind::Test,
                text: "Unit tests pass for /settings".into(),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let titles = crate::commands::planning::handoff::outcomes(&doc, &[]);
    assert_eq!(
        titles[0],
        "AC-1: [browser] The /settings page shows the saved name"
    );
    assert_eq!(titles[2], "AC-3: Unit tests pass for /settings");
    let mut run = TaskRun::default();
    run.contract.requirements = titles
        .iter()
        .enumerate()
        .map(|(index, title)| crate::commands::outcomes::Requirement {
            id: format!("requirement-{index}"),
            title: title.clone(),
            checkpoint: false,
            receipt: None,
        })
        .collect();
    assert_eq!(
        browser_criteria(&run),
        [
            (
                "AC-1".to_string(),
                "The /settings page shows the saved name".to_string()
            ),
            ("AC-2".to_string(), "The banner appears".to_string())
        ]
    );
    let page = |path: &str, criteria: &[&str], after: Option<&str>| ReviewCapture {
        path: path.into(),
        viewport: "desktop".into(),
        width: 1280,
        height: 800,
        criteria: criteria.iter().map(|c| c.to_string()).collect(),
        before: Some(artifact(&format!("{path}-before"))),
        after: after.map(artifact),
        ..Default::default()
    };
    let captures = ReviewCaptures {
        pages: vec![
            page("/", &[], Some("home")),
            page("/settings", &["AC-1"], Some("settings")),
        ],
        ..Default::default()
    };
    assert_eq!(captures.image_count(), 4);
    assert_eq!(captures.artifact("settings").unwrap().id, "settings");
    let steps = criterion_steps(&run, &captures);
    assert_eq!(steps.len(), 2);
    assert_eq!(steps[0].step, "AC-1 review screenshots");
    assert_eq!(steps[0].status, "pending");
    assert!(steps[0].evidence[1].ends_with("settings.png"));
    // A criterion that names no page is shown with the first captured page.
    assert!(steps[1].evidence[1].ends_with("home.png"));
    // Review evidence never stands in for the criterion's own check.
    let states = crate::commands::planning::handoff::criterion_states(
        &doc,
        &[crate::commands::planning::handoff::Evidence {
            steps,
            requirements: vec![],
        }],
    );
    assert!(states.iter().all(|state| state.state == "unassessed"));
    let none = ReviewCaptures {
        pages: vec![page("/", &["AC-1"], None)],
        ..Default::default()
    };
    assert!(criterion_steps(&run, &none).is_empty());
}

fn fixture() -> (TaskRuntime, PathBuf, String) {
    let root = std::env::temp_dir().join(format!("jackalope-review-test-{}", uuid::Uuid::new_v4()));
    let history = root.join("history");
    std::fs::create_dir_all(&history).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let record = serde_json::json!({ "id": id, "taskId": id, "projectId": "review-fixture", "projectName": "Review", "projectPath": root, "workspace": root, "branch": "main", "baseHead": "", "agent": "codex", "account": "test", "model": null, "prompt": "Review fixture", "status": "review", "startedAt": "2026-10-28T10:00:00Z", "endedAt": null, "sessionId": null, "result": "Fixture", "activity": [], "diagnostics": [], "error": null, "persistenceError": null, "exitCode": 0, "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reported": false, "estimatedCostUsd": null } });
    std::fs::write(
        history.join(format!("{id}.json")),
        serde_json::to_vec(&record).unwrap(),
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(history).unwrap();
    (runtime, root, id)
}

#[test]
fn projects_without_a_preview_command_capture_nothing() {
    let (runtime, root, id) = fixture();
    runtime.update(&id, |run| run.status = "running".into());
    capture(&runtime, &id);
    let run = runtime.run_snapshot(&id).unwrap();
    assert!(run.review_captures.is_none() && run.progress.is_none());
    assert!(!root.join(".jackalope").exists());
    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
#[ignore = "Runs a disposable local web server and the bundled browser for review screenshots"]
fn real_review_capture_saves_result_screenshots_and_cleans_up() {
    let (runtime, root, id) = fixture();
    std::fs::write(root.join("server.cjs"), "require('http').createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<h1>Review fixture '+req.url+'</h1>')}).listen(Number(process.argv[2]),'127.0.0.1')").unwrap();
    std::fs::create_dir_all(runtime.preferences_directory()).unwrap();
    project_registry::save(
        &runtime,
        vec![ProjectRecord {
            id: "review-fixture".into(),
            name: "Review".into(),
            path: root.to_string_lossy().into_owned(),
            preview_command: Some("node server.cjs {port}".into()),
            review_pages: vec!["/".into(), "/settings".into()],
            review_viewports: vec!["desktop".into(), "narrow".into()],
            ..Default::default()
        }],
    )
    .unwrap();
    runtime.update(&id, |run| {
        run.status = "running".into();
        record_visit(run, "http://127.0.0.1:9999/help");
    });
    capture(&runtime, &id);
    let run = runtime.run_snapshot(&id).unwrap();
    let captures = run.review_captures.unwrap();
    assert_eq!(captures.pages.len(), 6, "{:?}", captures.notes);
    assert!(
        captures.pages.iter().all(|page| page.after.is_some()),
        "{:?}",
        captures.notes
    );
    assert!(!captures.before_available);
    assert!(captures.notes.iter().any(|note| note.contains("Before")));
    for page in &captures.pages {
        let after = page.after.as_ref().unwrap();
        let bytes = crate::commands::artifacts::read_screenshot(&root, Path::new(&after.file_path))
            .unwrap();
        assert_eq!(
            crate::commands::harness::png_dimensions(&bytes).unwrap().0,
            page.width
        );
    }
    // The preview process is gone, so the workspace can be leased again.
    let _lease = crate::commands::verification::reserve_workspace(root.to_str().unwrap()).unwrap();
    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}
