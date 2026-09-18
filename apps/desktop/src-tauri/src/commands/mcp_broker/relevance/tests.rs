use super::*;

fn input() -> Input {
    serde_json::from_value(json!({"handle":"test","pointer":"/report/items","query":"Find all causes, exceptions and dependencies of the timeout."})).unwrap()
}

#[test]
fn automatic_selection_requires_one_complete_eligible_array() {
    let result = original();
    assert_eq!(automatic_input(&result).unwrap().pointer, "/report/items");
    let mut ambiguous = result.clone();
    ambiguous.structured_content.as_mut().unwrap()["other"] = json!([1]);
    assert!(automatic_input(&ambiguous).is_none());
    let mut error = result.clone();
    error.is_error = Some(true);
    assert!(automatic_input(&error).is_none());
    assert!(automatic_input(&CallToolResult::structured(json!({"items":[1,2]}))).is_none());
}

fn original() -> CallToolResult {
    let data = json!({"report":{"items":(0..12).map(|index| json!({"id":index,"body":"Evidence paragraph. ".repeat(100)})).collect::<Vec<_>>(),"version":3},"notice":"Complete source"});
    serde_json::from_value(json!({"content":[{"type":"text","text":data.to_string(),"annotations":{"audience":["assistant"]}}],"structuredContent":data,"isError":false,"_meta":{"source":"fixture"}})).unwrap()
}

fn answer() -> Value {
    json!({"status":"answered","recordId":"receipt","answers":(0..12).map(|index| (format!("row_{index}"), json!({"probabilities":{"0":if index%2==0 {0.98} else {0.02},"1":0.01,"2":if index%2==0 {0.01} else {0.97}}}))).collect::<serde_json::Map<_,_>>()})
}

#[test]
fn missing_malformed_uncertain_and_pinned_rows_stay() {
    let mut answer = answer();
    answer["answers"]["row_2"] = json!({});
    answer["answers"]["row_4"]["probabilities"] = json!({"0":0.99,"1":0.9,"2":0.0});
    answer["answers"]["row_6"]["probabilities"] = json!({"0":0.94,"1":0.03,"2":0.03});
    answer["answers"]["row_8"]["probabilities"] = json!({"0":1.01,"1":-0.01,"2":0.0});
    assert_eq!(
        retained(&answer, 12, &[0]),
        (0..10).chain([11]).collect::<Vec<_>>()
    );
    answer["status"] = json!("unavailable");
    assert_eq!(retained(&answer, 12, &[]), (0..12).collect::<Vec<_>>());
}

#[test]
fn selection_preserves_metadata_and_recovers_exact_original() {
    let original = original();
    let input = input();
    let data = evidence(&original, &input).unwrap();
    let mut snapshots = VecDeque::new();
    let handle = results::capture(&original, &mut snapshots).unwrap();
    let (selected, _) = select(&original, &input, &data, &answer(), &handle).unwrap();
    let value = serde_json::to_value(&selected).unwrap();
    assert_eq!(value["structuredContent"]["report"]["version"], 3);
    assert_eq!(value["structuredContent"]["notice"], "Complete source");
    assert_eq!(value["_meta"]["source"], "fixture");
    assert_eq!(
        value["content"][0]["annotations"]["audience"][0],
        "assistant"
    );
    assert_eq!(
        serde_json::from_str::<Value>(value["content"][0]["text"].as_str().unwrap()).unwrap(),
        value["structuredContent"]
    );
    let receipt: Value =
        serde_json::from_str(value["content"][1]["text"].as_str().unwrap()).unwrap();
    assert_eq!(
        receipt["jackalopeRelevanceSelection"]["sourceIndices"],
        json!([1, 3, 5, 7, 9, 11])
    );
    assert_eq!(
        receipt["jackalopeRelevanceSelection"]["omittedIndices"],
        json!([0, 2, 4, 6, 8, 10])
    );
    assert_eq!(
        results::captured_json(&snapshots, &handle, None).unwrap(),
        serde_json::to_value(&original).unwrap()
    );
    assert_eq!(
        results::captured_json(&snapshots, &handle, Some("/structuredContent")).unwrap(),
        data
    );
    assert!(results::captured_json(&VecDeque::new(), &handle, None).is_err());
}

#[test]
fn incomplete_unsupported_or_small_evidence_is_not_sent_to_jev() {
    let original = original();
    let input = input();
    assert!(evidence(&original, &input).is_some());
    let mut error = original.clone();
    error.is_error = Some(true);
    assert!(evidence(&error, &input).is_none());
    let mut other_text = original.clone();
    other_text.content.push(rmcp::model::ContentBlock::text(
        "Exception elsewhere: do not omit row 0.",
    ));
    assert!(evidence(&other_text, &input).is_none());
    for data in [
        json!({"report":{"items":[]}}),
        json!({"items":[]}),
        json!({"report":{"items":[{"id":0}]}}),
    ] {
        assert!(evidence(&CallToolResult::structured(data), &input).is_none());
    }
    let mut request = self::input();
    request.keep_indices.push(20);
    assert!(evidence(&original, &request).is_none());
    request.keep_indices = vec![32];
    assert!(validate(&request).is_err());
    let mut value = serde_json::to_value(&original).unwrap();
    value["content"] = json!([{"type":"image","data":"AA==","mimeType":"image/png"}]);
    assert!(evidence(&serde_json::from_value(value).unwrap(), &input).is_none());
    let mut partial = serde_json::to_value(&original).unwrap();
    partial["structuredContent"]["report"]["truncated"] = json!(true);
    partial["content"][0]["text"] = json!(partial["structuredContent"].to_string());
    assert!(evidence(&serde_json::from_value(partial).unwrap(), &input).is_none());
}

#[test]
fn explicit_error_rows_override_irrelevance() {
    let mut value = serde_json::to_value(original()).unwrap();
    value["structuredContent"]["report"]["items"][0]["error"] = json!("Missing dependency");
    value["content"][0]["text"] = json!(value["structuredContent"].to_string());
    let original = serde_json::from_value(value).unwrap();
    let input = input();
    let data = evidence(&original, &input).unwrap();
    let (selected, _) = select(&original, &input, &data, &answer(), "handle").unwrap();
    assert_eq!(
        selected.structured_content.unwrap()["report"]["items"][0]["error"],
        "Missing dependency"
    );
}

#[test]
fn no_selection_is_applied_for_failed_or_empty_outcomes() {
    let original = original();
    let input = input();
    let data = evidence(&original, &input).unwrap();
    assert!(select(
        &original,
        &input,
        &data,
        &json!({"status":"unavailable"}),
        "handle"
    )
    .is_none());
    let mut answer = answer();
    for row in answer["answers"].as_object_mut().unwrap().values_mut() {
        *row = json!({"probabilities":{"0":1.0,"1":0.0,"2":0.0}});
    }
    assert!(select(&original, &input, &data, &answer, "handle").is_none());
}
