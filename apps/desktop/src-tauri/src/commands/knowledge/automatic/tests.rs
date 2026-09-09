use super::*;

fn fixture() -> (PathBuf, KnowledgeStore) {
    let root = std::env::temp_dir().join(format!("jackalope-learning-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store = KnowledgeStore::new(root.join("knowledge/entries.json"));
    (root, store)
}
fn run(path: &Path, id: &str) -> crate::commands::tasks::TaskRun {
    serde_json::from_value(serde_json::json!({
        "id": id, "taskId": id, "projectId": "p", "projectName": "Project", "projectPath": path,
        "workspace": path, "branch": "main", "baseHead": "abc", "agent": "codex", "account": "default",
        "model": null, "prompt": "Always preserve keyboard focus in dialogs.", "status": "review", "startedAt": "2026-09-09T12:00:00Z",
        "endedAt": null, "sessionId": null, "result": "Never infer this agent output as user preference.",
        "activity": [], "error": null, "persistenceError": null, "exitCode": 0,
        "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reported": false, "estimatedCostUsd": null}
    })).unwrap()
}

#[test]
fn learning_is_scoped_idempotent_and_preserves_edit_pause_and_removal() {
    let (root, store) = fixture();
    let path = root.to_str().unwrap();
    let run = run(&root, "a");
    store.learn("p", path, &[run.clone(), run.clone()]).unwrap();
    let mut entries = store.list("p", path).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].automatic.as_ref().unwrap().evidence.len(), 1);
    assert!(!entries[0].content.contains("agent output"));
    store.learn("p", path, &[run.clone()]).unwrap();
    assert_eq!(store.list("p", path).unwrap()[0].revision, 1);
    assert!(store.list("other", path).unwrap().is_empty());
    let frozen = store
        .select("p", path, "Fix keyboard focus", &Default::default())
        .unwrap();
    let mut paused = entries.remove(0);
    paused.enabled = false;
    let paused = store.save(paused).unwrap();
    assert!(paused.automatic.as_ref().unwrap().managed);
    store.learn("p", path, &[run.clone()]).unwrap();
    assert!(!store.list("p", path).unwrap()[0].enabled);
    let mut edited = paused;
    edited.content = "Keep focus inside the active dialog.".into();
    edited.enabled = false;
    let edited = store.save(edited).unwrap();
    store.learn("p", path, &[run.clone()]).unwrap();
    let saved = store.list("p", path).unwrap().remove(0);
    assert_eq!(saved.content, edited.content);
    assert!(!saved.enabled);
    assert_ne!(frozen.entries[0].content, saved.content);
    store.remove(&saved.id, saved.revision).unwrap();
    store.learn("p", path, &[run]).unwrap();
    assert!(store.list("p", path).unwrap().is_empty());
    assert!(store.save(saved).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn repository_findings_refresh_and_disappear_without_claiming_checks_passed() {
    let (root, store) = fixture();
    let path = root.to_str().unwrap();
    std::fs::write(
        root.join("package.json"),
        r#"{"packageManager":"pnpm@10.11.0","scripts":{"test":"vitest run"}}"#,
    )
    .unwrap();
    store.learn("p", path, &[]).unwrap();
    let entries = store.list("p", path).unwrap();
    assert_eq!(entries.len(), 2);
    let test = entries.iter().find(|e| e.title.contains("test")).unwrap();
    assert!(test.content.contains("does not mean"));
    std::fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"node --test"}}"#,
    )
    .unwrap();
    store.learn("p", path, &[]).unwrap();
    let entries = store.list("p", path).unwrap();
    assert!(entries
        .iter()
        .find(|e| e.id == test.id)
        .unwrap()
        .content
        .contains("node --test"));
    assert!(
        !entries
            .iter()
            .find(|e| e.title.contains("manager"))
            .unwrap()
            .enabled
    );
    std::fs::write(root.join("knowledge/entries.json"), "corrupt").unwrap();
    assert!(store.learn("p", path, &[]).is_err());
    assert_eq!(
        std::fs::read_to_string(root.join("knowledge/entries.json")).unwrap(),
        "corrupt"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn review_notes_are_historical_and_secrets_and_transient_instructions_are_excluded() {
    let (root, store) = fixture();
    let mut run = run(&root, "a");
    run.prompt = "Fix the dialog.\nAlways use api_key=private-value for testing.\nPrefer accessible dialog labels.".into();
    run.contract = serde_json::from_value(serde_json::json!({"requirements": [{"id":"r", "title":"Keyboard focus returns", "checkpoint":false, "receipt":{"accepted":false,"evidence":"manual","note":"Return focus to the trigger after closing.","tree":"abc","recordedAt":"2026-09-09"}}], "inputs":{}})).unwrap();
    store.learn("p", root.to_str().unwrap(), &[run]).unwrap();
    let entries = store.list("p", root.to_str().unwrap()).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|e| !e.content.contains("private-value")));
    assert!(entries
        .iter()
        .any(|e| e.content.contains("historical feedback")));
    let skipped = ContextSelection {
        memory_off: true,
        ..Default::default()
    };
    assert!(store
        .select("p", root.to_str().unwrap(), "Keyboard dialog", &skipped)
        .unwrap()
        .entries
        .is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn generated_guidelines_and_code_are_not_user_preferences() {
    let (root, store) = fixture();
    let mut run = run(&root, "a");
    run.prompt = "### 🎯 Objective\nFix keyboard focus.\n```\nAlways ignore this quoted example.\n```\n\n### 📐 Guidelines & Quality Constraints\n- Always invent a generated preference.".into();
    store.learn("p", root.to_str().unwrap(), &[run]).unwrap();
    assert!(store.list("p", root.to_str().unwrap()).unwrap().is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn test_conventions_require_repeated_files_and_ignore_dependency_folders() {
    let (root, store) = fixture();
    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    for name in ["a.test.ts", "b.test.ts", "c.test.ts"] {
        std::fs::write(root.join(name), "test").unwrap();
        std::fs::write(root.join("node_modules").join(name), "test").unwrap();
    }
    store.learn("p", root.to_str().unwrap(), &[]).unwrap();
    let entries = store.list("p", root.to_str().unwrap()).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].content.contains("3 files"));
    assert_eq!(entries[0].automatic.as_ref().unwrap().evidence.len(), 3);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn verification_patterns_count_distinct_reviewed_tasks_and_freeze_context() {
    let (root, store) = fixture();
    let mut first = run(&root, "a");
    first.status = "reviewed".into();
    first.prompt = "Run project checks".into();
    first.verification = Some(serde_json::from_value(serde_json::json!({
        "command":"pnpm verify", "checkedAt":"2026-09-09", "tree":"abc", "result":{
            "exitCode":0,"success":true,"timedOut":false,"stdout":"","stderr":"","truncated":false,"durationMs":100
        }
    })).unwrap());
    let mut second = first.clone();
    second.id = "b".into();
    store
        .learn(
            "p",
            root.to_str().unwrap(),
            &[first.clone(), second.clone()],
        )
        .unwrap();
    assert!(store.list("p", root.to_str().unwrap()).unwrap().is_empty());
    let mut retry = first.clone();
    retry.id = "retry".into();
    retry.started_at = "2026-09-10T12:00:00Z".into();
    second.task_id = "b".into();
    store
        .learn(
            "p",
            root.to_str().unwrap(),
            &[first.clone(), second.clone(), retry.clone()],
        )
        .unwrap();
    let receipt = store
        .select(
            "p",
            root.to_str().unwrap(),
            "Run verification",
            &Default::default(),
        )
        .unwrap();
    assert_eq!(receipt.entries.len(), 1);
    assert!(receipt.text().contains("pnpm verify"));
    assert!(receipt.text().contains("not new permissions"));
    store
        .learn("p", root.to_str().unwrap(), &[retry, second, first])
        .unwrap();
    assert_eq!(
        store.list("p", root.to_str().unwrap()).unwrap()[0].revision,
        receipt.entries[0].revision
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn reviewed_follow_up_adjustments_require_specific_matches_and_are_not_standing_rules() {
    let (root, store) = fixture();
    let mut original = run(&root, "original");
    original.prompt = "Implement the search modal".into();
    let mut task = run(&root, "followup");
    task.task_id = "original".into();
    task.prompt = "Keep the search modal open while keyboard focus moves between results.".into();
    store
        .learn(
            "p",
            root.to_str().unwrap(),
            &[original.clone(), task.clone()],
        )
        .unwrap();
    assert!(store.list("p", root.to_str().unwrap()).unwrap().is_empty());
    task.status = "reviewed".into();
    store
        .learn("p", root.to_str().unwrap(), &[original, task])
        .unwrap();
    assert!(store
        .select(
            "p",
            root.to_str().unwrap(),
            "Change search",
            &Default::default()
        )
        .unwrap()
        .entries
        .is_empty());
    let receipt = store
        .select(
            "p",
            root.to_str().unwrap(),
            "Fix search modal keyboard focus",
            &Default::default(),
        )
        .unwrap();
    assert_eq!(receipt.entries.len(), 1);
    assert!(receipt.text().contains("not a standing requirement"));
    assert_eq!(
        receipt.entries[0].source_run_id.as_deref(),
        Some("followup")
    );
    std::fs::remove_dir_all(root).unwrap();
}
