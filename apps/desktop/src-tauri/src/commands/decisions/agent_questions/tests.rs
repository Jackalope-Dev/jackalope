use super::*;

fn run(workspace: &std::path::Path) -> TaskRun {
    serde_json::from_value(json!({"id":"jev-test-run","taskId":"task","projectId":"project",
        "projectName":"Fixture","projectPath":workspace,"workspace":workspace,"branch":"main",
        "baseHead":"","agent":"codex","account":"fixture","model":null,"prompt":"Classify the supplied evidence",
        "status":"running","startedAt":"2026-09-17T00:00:00Z","endedAt":null,"sessionId":null,"result":"",
        "activity":[],"error":null,"persistenceError":null,"exitCode":null,
        "usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false,"estimatedCostUsd":null}})).unwrap()
}

fn input() -> Value {
    json!({"state":{"symptom":"Package missing"},"questions":{
        "category":{"type":"choice","instructions":"Classify input.symptom", "criteria":{"dependency":"Missing package","other":null}},
        "urgency":{"type":"score","instructions":"Rate input.symptom", "criteria":["No impact","Build blocked"]},
        "blocked":{"type":"noul","instructions":"Does input.symptom describe a failed build?"}
    }})
}

#[test]
fn typed_questions_reject_invalid_or_oversized_contracts() {
    let parsed: Input = serde_json::from_value(input()).unwrap();
    parsed.validate().unwrap();
    assert!(serde_json::to_value(&parsed.questions).unwrap()["blocked"]
        .get("criteria")
        .is_none());
    for (pointer, replacement) in [
        ("/questions/category/type", json!("generate")),
        ("/questions/category/criteria", json!(["bad shape"])),
        ("/questions/urgency/criteria", json!(["one level"])),
        ("/questions/blocked/instructions", json!("")),
        ("/questions/blocked/instructions", json!("x".repeat(4001))),
        ("/state", json!("x".repeat(96_001))),
        ("/questions", json!({})),
    ] {
        let mut value = input();
        *value.pointer_mut(pointer).unwrap() = replacement;
        assert!(
            !serde_json::from_value::<Input>(value).is_ok_and(|request| request.validate().is_ok()),
            "{pointer}"
        );
    }
    let mut unknown = input();
    unknown["questions"]["blocked"]["endpoint"] = json!("https://other.invalid");
    assert!(serde_json::from_value::<Input>(unknown).is_err());
    let mut many = input();
    many["questions"] = Value::Object(
        (0..33)
            .map(|n| (format!("q{n}"), input()["questions"]["blocked"].clone()))
            .collect(),
    );
    assert!(serde_json::from_value::<Input>(many)
        .unwrap()
        .validate()
        .is_err());
}

#[test]
fn failed_calls_and_parallel_reservations_share_an_attempt_limit() {
    let run = std::sync::Mutex::new(run(std::path::Path::new("")));
    let admitted = std::thread::scope(|scope| {
        let tasks: Vec<_> = (0..20)
            .map(|_| scope.spawn(|| reserve(&mut run.lock().unwrap(), 3)))
            .collect();
        tasks
            .into_iter()
            .map(|task| task.join().unwrap())
            .filter(|admitted| *admitted)
            .count()
    });
    assert_eq!(admitted, 8);
    let mut run = run.into_inner().unwrap();
    assert_eq!(run.efficiency.jev_questions, Some(24));
    run.efficiency.jev_question_calls = Some(0);
    run.status = "review".into();
    assert!(!reserve(&mut run, 1));
    assert_eq!(run.efficiency.jev_question_calls, Some(0));
}

#[test]
fn preparation_rejects_attempt_handles_and_preserves_typed_contracts() {
    let parsed: Input = serde_json::from_value(input()).unwrap();
    parsed.validate_preparation().unwrap();
    let restored: Input = serde_json::from_value(serde_json::to_value(parsed).unwrap()).unwrap();
    restored.validate_preparation().unwrap();
    let mut value = input();
    value["sources"] = json!({"prior":{"kind":"tool_result","resultHandle":"old-attempt"}});
    assert!(serde_json::from_value::<Input>(value)
        .unwrap()
        .validate_preparation()
        .is_err());
    let old: crate::commands::knowledge::ContextReceipt =
        serde_json::from_value(json!({"entries":[],"bytes":0})).unwrap();
    assert!(old.jev_preparation.is_none());
    assert!(old.jev_preparation_result.is_none());
}

#[test]
fn preparation_clears_stale_answers_and_falls_back_without_opt_in() {
    let root = std::env::temp_dir().join(format!(
        "jackalope-jev-preparation-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(root.join("history")).unwrap();
    let initial = run(&root);
    std::fs::write(
        root.join(format!("history/{}.json", initial.id)),
        serde_json::to_vec(&initial).unwrap(),
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    runtime
        .update_checked(&initial.id, |run| run.status = "running".into())
        .unwrap();
    let mut request: crate::commands::tasks::RunRequest = serde_json::from_value(json!({
        "id":initial.id,"projectId":initial.project_id,"projectName":"Fixture","projectPath":root,
        "agent":"codex","prompt":initial.prompt,"isolated":false
    }))
    .unwrap();
    request.context_receipt.jev_preparation = Some(serde_json::from_value(input()).unwrap());
    request.context_receipt.jev_preparation_result =
        Some(json!({"status":"answered","answers":{"stale":true}}));
    preparation::prepare(&runtime, &initial, &mut request).unwrap();
    let result = request
        .context_receipt
        .jev_preparation_result
        .as_ref()
        .unwrap();
    assert_eq!(result["status"], "unavailable");
    assert!(result.get("answers").is_none());
    assert!(evaluation::records(&runtime).unwrap().is_empty());
    request.context_receipt.jev_preparation = None;
    preparation::prepare(&runtime, &initial, &mut request).unwrap();
    assert!(request.context_receipt.jev_preparation_result.is_none());
    assert!(preparation::prompt(None).is_empty());
    drop(runtime);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn preparation_prompt_keeps_uncertainty_and_provenance_without_full_distributions() {
    let receipt = json!({"status":"answered","recordId":"receipt-id","sources":{"report":{"nextLine":81}},
        "answers":{"kind":{"type":"choice","choice":"other","confidence":0.51,"probabilities":{"other":0.51,"dependency":0.49}},
        "blocked":{"type":"noul","noul":0.4}}});
    let prompt = preparation::prompt(Some(&receipt));
    for retained in [
        "receipt-id",
        "nextLine",
        "0.51",
        "0.4",
        "untrusted",
        "required checks",
    ] {
        assert!(prompt.contains(retained));
    }
    assert!(!prompt.contains("probabilities"));
    assert!(receipt["answers"]["kind"].get("probabilities").is_some());
}

#[tokio::test]
async fn sources_include_task_context_and_provenance_without_echoing_text() {
    let root =
        std::env::temp_dir().join(format!("jackalope-jev-questions-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("report.md"), "Build failed\nMore evidence\n").unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let run = run(&root);
    let mut request = input();
    request["sources"] =
        json!({"report":{"kind":"file","path":"report.md","startLine":1,"lines":1}});
    let (payload, provenance) = request::prepare(
        &runtime,
        &run,
        serde_json::from_value(request.clone()).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(payload["state"]["task"]["objective"], run.prompt);
    assert_eq!(payload["state"]["input"]["symptom"], "Package missing");
    assert_eq!(
        payload["state"]["sources"]["report"]["text"],
        "Build failed\n"
    );
    assert_eq!(provenance["report"]["nextLine"], 2);
    assert_eq!(
        provenance["report"]["blockHash"].as_str().unwrap().len(),
        64
    );
    assert!(provenance["report"].get("text").is_none());
    std::fs::write(root.join("report.md"), "Changed evidence\nMore evidence\n").unwrap();
    let (fresh, fresh_provenance) = request::prepare(
        &runtime,
        &run,
        serde_json::from_value(request.clone()).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(
        fresh["state"]["sources"]["report"]["text"],
        "Changed evidence\n"
    );
    assert_ne!(
        fresh_provenance["report"]["blockHash"],
        provenance["report"]["blockHash"]
    );
    for path in ["../report.md", ".env", "absent.md"] {
        request["sources"]["report"]["path"] = json!(path);
        assert!(request::prepare(
            &runtime,
            &run,
            serde_json::from_value(request.clone()).unwrap()
        )
        .await
        .is_err());
    }
    assert!(!available(&runtime, &run.project_id));
    assert!(
        ask(&runtime, &run, serde_json::from_value(input()).unwrap())
            .await
            .is_err()
    );
    assert!(evaluation::records(&runtime).unwrap().is_empty());
    drop(runtime);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "Live agent-facing Jev tool screen; requires a temporary key and explicit bounded suite"]
async fn installed_agent_questions_trial() {
    let spec_path = std::path::PathBuf::from(
        std::env::var("JACKALOPE_JEV_QUESTIONS_SPEC").expect("Explicit suite required"),
    );
    let spec: Value = serde_json::from_slice(&std::fs::read(&spec_path).unwrap()).unwrap();
    let requests = spec["requests"].as_array().unwrap();
    assert!(!requests.is_empty() && requests.len() <= 8);
    let root = std::env::temp_dir().join(format!("jackalope-jev-live-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("history")).unwrap();
    std::fs::write(root.join("report.md"), spec["source"].as_str().unwrap()).unwrap();
    let initial = run(&root);
    std::fs::write(
        root.join(format!("history/{}.json", initial.id)),
        serde_json::to_vec(&initial).unwrap(),
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    runtime
        .update_checked(&initial.id, |run| run.status = "running".into())
        .unwrap();
    assert!(runtime.is_running(&initial.id));
    let directory = super::super::settings::directory(&runtime);
    let mut preferences = super::super::settings::Preferences {
        mode: super::super::DecisionMode::Jev,
        ..Default::default()
    };
    super::super::settings::save(&directory, &mut preferences).unwrap();
    std::fs::write(
        directory.join("options.json"),
        br#"{"default":{"agentQuestions":true}}"#,
    )
    .unwrap();
    let key_path = directory.join("api-key.bin");
    struct KeyFile(std::path::PathBuf);
    impl Drop for KeyFile {
        fn drop(&mut self) {
            let _ = crate::commands::account_storage::remove(&self.0);
        }
    }
    let key_file = KeyFile(key_path.clone());
    let key = std::env::var("JACKALOPE_JEV_TEST_KEY").expect("Temporary key required");
    crate::commands::account_storage::write(
        &key_path,
        &serde_json::to_vec(&json!({"key":key,"checked_at":"2026-09-17T00:00:00Z"})).unwrap(),
    )
    .unwrap();
    drop(key);
    let mut receipts = Vec::new();
    for request in requests {
        let started = std::time::Instant::now();
        let result = ask(
            &runtime,
            &initial,
            serde_json::from_value(request["input"].clone()).unwrap(),
        )
        .await;
        receipts.push(json!({"id":request["id"],"elapsedMs":started.elapsed().as_millis(),"result":result.as_ref().ok(),"error":result.as_ref().err()}));
        std::fs::write(spec_path.with_extension("results.json"), serde_json::to_vec_pretty(&json!({"requests":receipts,"decisionRecords":evaluation::records(&runtime).unwrap(),"scope":"Direct native Jev tool; no worker agent launched. Not an end-to-end agent comparison."})).unwrap()).unwrap();
        if !result
            .as_ref()
            .is_ok_and(|value| value["status"] == "answered")
        {
            break;
        }
    }
    drop(key_file);
    drop(runtime);
    std::fs::remove_dir_all(root).unwrap();
}
