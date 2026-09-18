use super::*;

fn request() -> Input {
    serde_json::from_value(json!({
        "sources":[{"id":"incidents","resultHandle":"a"},{"id":"deployments","resultHandle":"b"}],
        "source":"incidents",
        "rows":{"pointer":"/structuredContent/items","whereEquals":{"/open":true},"columns":["/row/id","/joined/deployments/version"],"limit":1},
        "joins":[{"source":"deployments","pointer":"/structuredContent/items","leftKey":"/deployment","rightKey":"/id"}]
    })).unwrap()
}

fn sources() -> BTreeMap<String, Value> {
    BTreeMap::from([
        (
            "incidents".into(),
            json!({"structuredContent":{"items":[{"id":1,"open":false,"deployment":"a"},{"id":2,"open":true,"deployment":"b"},{"id":3,"open":true,"deployment":"a"}]}}),
        ),
        (
            "deployments".into(),
            json!({"structuredContent":{"items":[{"id":"a","version":"old"},{"id":"b","version":"new"}]}}),
        ),
    ])
}

#[test]
fn filters_join_project_and_page_without_losing_original_lineage() {
    let mut input = request();
    validate(&input).unwrap();
    let result = evaluate(&input, &sources()).unwrap();
    assert_eq!(result["sourceRows"], 3);
    assert_eq!(result["matchedRows"], 2);
    assert_eq!(
        result["rows"][0]["value"],
        json!({"/row/id":2,"/joined/deployments/version":"new"})
    );
    assert_eq!(
        result["rows"][0]["sourceIndices"],
        json!({"incidents":1,"deployments":1})
    );
    assert_eq!(result["nextOffset"], 1);
    input.rows.offset = 1;
    let result = evaluate(&input, &sources()).unwrap();
    assert_eq!(result["rows"][0]["value"]["/row/id"], 3);
    assert_eq!(result["nextOffset"], Value::Null);
    input.rows.count_only = true;
    let result = evaluate(&input, &sources()).unwrap();
    assert_eq!(result["matchedRows"], 2);
    assert_eq!(result["rows"], json!([]));
    assert_eq!(result["truncated"], false);
}

#[test]
fn ambiguous_and_missing_evidence_is_an_error_not_an_empty_answer() {
    let input = request();
    let mut data = sources();
    data.get_mut("deployments").unwrap()["structuredContent"]["items"][1]["id"] = json!("a");
    assert!(evaluate(&input, &data).unwrap_err().contains("not unique"));
    data = sources();
    data.get_mut("incidents").unwrap()["structuredContent"]["items"][0]
        .as_object_mut()
        .unwrap()
        .remove("open");
    assert!(evaluate(&input, &data)
        .unwrap_err()
        .contains("filter field"));
    data = sources();
    data.get_mut("deployments").unwrap()["structuredContent"]["items"][1]["id"] = Value::Null;
    assert!(evaluate(&input, &data).is_err());
}

#[test]
fn base_column_paths_remain_valid_after_a_join_and_errors_explain_recovery() {
    let mut input = request();
    input.rows.columns = vec!["/id".into(), "/affected".into()];
    let error = evaluate(&input, &sources()).unwrap_err();
    assert!(error.contains("/affected"));
    assert!(error.contains("reuse captured source handles"));
    input.rows.columns = vec!["/id".into(), "/joined/deployments/version".into()];
    let result = evaluate(&input, &sources()).unwrap();
    assert_eq!(
        result["rows"][0]["value"],
        json!({"/id":2,"/joined/deployments/version":"new"})
    );
}

#[test]
fn unmatched_left_rows_remain_explicit_and_scalar_types_do_not_coerce() {
    let mut input = request();
    input.rows.columns = vec!["/row/id".into(), "/joined/deployments".into()];
    let mut data = sources();
    data.get_mut("incidents").unwrap()["structuredContent"]["items"][1]["deployment"] = json!(1);
    data.get_mut("deployments").unwrap()["structuredContent"]["items"][1]["id"] = json!("1");
    let result = evaluate(&input, &data).unwrap();
    assert_eq!(
        result["rows"][0]["value"]["/joined/deployments"],
        Value::Null
    );
    assert_eq!(
        result["rows"][0]["sourceIndices"]["deployments"],
        Value::Null
    );
}

#[test]
fn validates_sources_and_complete_mirrored_json_only() {
    let mut input = request();
    input.sources[0].id = "bad/id".into();
    assert!(validate(&input).is_err());
    let mut input = request();
    input.joins[0].source = input.source.clone();
    assert!(validate(&input).is_err());
    let mut result = CallToolResult::structured(json!({"items":[1,2]}));
    assert!(complete(&result).is_ok());
    result
        .content
        .push(rmcp::model::ContentBlock::text("Important exception"));
    assert!(complete(&result).is_err());
    assert!(complete(&CallToolResult::structured(
        json!({"items":[1],"hasMore":true})
    ))
    .is_err());
    assert!(complete(&CallToolResult::error(vec![])).is_err());
}

#[tokio::test]
async fn composed_execution_recovers_sources_and_charges_only_delivered_bytes() {
    let root = std::env::temp_dir().join(format!("jackalope-pipeline-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("history")).unwrap();
    let run: TaskRun = serde_json::from_value(json!({"id":"pipeline","taskId":"task","projectId":"project",
        "projectName":"Fixture","projectPath":root,"workspace":root,"branch":"main","baseHead":"",
        "agent":"codex","account":"fixture","model":null,"prompt":"Join incident evidence","status":"running",
        "startedAt":"2026-09-18T00:00:00Z","endedAt":null,"sessionId":null,"result":"","activity":[],"error":null,
        "persistenceError":null,"exitCode":null,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false,"estimatedCostUsd":null}})).unwrap();
    std::fs::write(
        root.join("history/pipeline.json"),
        serde_json::to_vec(&run).unwrap(),
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    runtime
        .update_checked(&run.id, |current| current.status = "running".into())
        .unwrap();
    let broker = &runtime.mcp_broker;
    broker.prepare(&run.id, vec![], root.clone(), None).unwrap();
    let mut input = request();
    for source in &mut input.sources {
        let result = CallToolResult::structured(sources()[&source.id]["structuredContent"].clone());
        source.result_handle = Some(broker.capture_result(&run.id, &result).await.unwrap());
    }
    let source_handle = input.sources[0].result_handle.clone().unwrap();
    let result = execute(&runtime, &run, input).await.unwrap();
    let data = result.structured_content.as_ref().unwrap();
    assert_eq!(data["rows"][0]["value"]["/row/id"], 2);
    assert_eq!(data["sources"]["incidents"], source_handle);
    let attempt = broker.attempt(&run.id).unwrap();
    let usage = attempt.catalog.lock().await.usage.clone();
    assert_eq!(usage.calls, 0);
    assert_eq!(
        usage.result_bytes_returned,
        Some(serde_json::to_vec(&result).unwrap().len() as u64)
    );
    assert_eq!(
        broker
            .captured_json(
                &run.id,
                &source_handle,
                Some("/structuredContent/items/0/id")
            )
            .await
            .unwrap(),
        1
    );
    runtime
        .update_checked(&run.id, |current| current.status = "completed".into())
        .unwrap();
    assert!(execute(&runtime, &run, request()).await.is_err());
    broker.close(&run.id);
    drop(runtime);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn captured_sources_are_attempt_scoped_and_closed_attempts_reject_recovery() {
    let broker = Broker::default();
    broker
        .prepare("a", vec![], std::env::temp_dir(), None)
        .unwrap();
    broker
        .prepare("b", vec![], std::env::temp_dir(), None)
        .unwrap();
    let original = CallToolResult::structured(json!({"items":[{"id":1}]}));
    let handle = broker.capture_result("a", &original).await.unwrap();
    let attempt = broker.attempt("b").unwrap();
    assert!(results::captured_result(&attempt.catalog.lock().await.results, &handle).is_err());
    assert!(broker.captured_json("a", &handle, None).await.is_ok());
    broker.close("a");
    assert!(broker.captured_json("a", &handle, None).await.is_err());
    broker.close("b");
}
