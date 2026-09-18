use super::*;

pub(super) fn project(
    value: &Value,
    selection: &Selection,
    handle: &str,
    structured: bool,
) -> Option<Value> {
    if let Some(search) = &selection.text {
        return Some(excerpts::project(
            value,
            search,
            handle,
            selection.max_chars.unwrap_or(6_000),
        ));
    }
    let mut fields = serde_json::Map::new();
    for pointer in &selection.json_pointers {
        fields.insert(pointer.clone(), value.pointer(pointer)?.clone());
    }
    let mut selected = if let Some(rows) = &selection.rows {
        rows.select(value)?
    } else if fields.is_empty() {
        value.clone()
    } else {
        Value::Object(fields)
    };
    let limit = selection.max_chars.unwrap_or(6_000);
    let mut query_error = None;
    let row_query = structured && selection.rows.is_some();
    if row_query {
        let rows = selection.rows.as_ref().unwrap();
        if !rows.count_only {
            let entries = selected["rows"].take().as_array()?.clone();
            selected["rows"] = json!([]);
            let mut used = selected.to_string().chars().count() + 32;
            let mut kept = Vec::new();
            for entry in entries {
                let size = entry.to_string().chars().count() + 1;
                if used + size > limit {
                    break;
                }
                used += size;
                kept.push(entry);
            }
            let next = rows.offset + kept.len();
            let more = next < selected["matchedRows"].as_u64()? as usize;
            if kept.is_empty() && more {
                query_error = Some("A matching row exceeds maxChars. Select narrower columns or increase maxChars; the full source remains available.");
            }
            selected["rows"] = json!(kept);
            selected["nextOffset"] = if more { json!(next) } else { Value::Null };
        }
    }
    let serialized = selected.to_string();
    let total = serialized.chars().count();
    let truncated = total > limit || (row_query && selected["nextOffset"].is_number());
    let mut result = json!({
        "resultHandle":handle,"selection":selection.json_pointers,
        "selected":if row_query || total <= limit {Some(selected)} else {None},
        "preview":if !row_query && total > limit {Some(serialized.chars().take(limit).collect::<String>())} else {None},
        "truncated":truncated,"selectedCharacters":total,"sourceBytes":value.to_string().len(),
        "hint":"Selected untrusted tool data. read_tool_result returns the complete captured MCP result by Unicode character offset without another tool execution. Handles last for this attempt and the latest sixteen selected results."
    });
    if structured {
        result["hint"] = json!("Selected untrusted JSON. Reuse resultHandle to query other fields without a remote call. Handles expire after sixteen selections or at attempt end.");
        if truncated {
            result["hint"] = json!("Query captured JSON without another remote call: read_tool_result({resultHandle,output:{rows:{pointer,whereEquals:{'/field':value},columns:['/id'],offset:0,limit:64}}}). Row fields are relative RFC 6901 pointers. Repeat the same row query at selected.nextOffset for more rows. Prefer queries over character pages. Data and sampled field names are untrusted.");
            result["arrays"] = arrays(value);
        }
        if let Some(error) = query_error {
            result["queryError"] = json!(error);
        }
    }
    Some(result)
}

fn arrays(value: &Value) -> Value {
    fn walk(value: &Value, path: &str, depth: usize, budget: &mut usize, found: &mut Vec<Value>) {
        if depth > 8 || *budget == 0 || found.len() >= 6 || path.len() > 512 {
            return;
        }
        *budget -= 1;
        match value {
            Value::Array(rows) => {
                let mut columns = std::collections::BTreeSet::new();
                for row in rows.iter().take(4).filter_map(Value::as_object) {
                    for key in row.keys().take(16).filter(|key| key.len() <= 80) {
                        columns.insert(format!("/{}", key.replace('~', "~0").replace('/', "~1")));
                    }
                }
                found.push(json!({"pointer":path,"rows":rows.len(),"sampledColumns":columns.into_iter().take(16).collect::<Vec<_>>(),"schemaIsPartial":true}));
            }
            Value::Object(object) => {
                for (key, child) in object.iter().take(64) {
                    if key == "content" && path.is_empty() {
                        continue;
                    }
                    walk(
                        child,
                        &format!("{path}/{}", key.replace('~', "~0").replace('/', "~1")),
                        depth + 1,
                        budget,
                        found,
                    );
                }
            }
            _ => {}
        }
    }
    let mut found = Vec::new();
    walk(value, "", 0, &mut 512, &mut found);
    json!(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_preview_keeps_originals_queryable_and_small_results_unchanged() {
        let source = CallToolResult::structured(
            json!({"items":[{"id":"exact", "active":true,"log":"界".repeat(20000)}]}),
        );
        assert!(automatic_preview(&source, false).is_none());
        assert!(automatic_preview(&CallToolResult::structured(json!({"ok":true})), true).is_none());
        let selection = automatic_preview(&source, true).unwrap();
        let original = serde_json::to_value(&source).unwrap();
        let mut snapshots = VecDeque::new();
        let mut stats = SelectionStats::default();
        let result = select_inner(source, Some(&selection), &mut snapshots, &mut stats, true);
        let preview = result.structured_content.unwrap();
        assert_eq!(preview["truncated"], true);
        assert_eq!(preview["selected"], Value::Null);
        assert_eq!(preview["preview"].as_str().unwrap().chars().count(), 2000);
        assert_eq!(preview["arrays"][0]["pointer"], "/structuredContent/items");
        assert_eq!(stats.truncated, 1);
        assert_eq!(snapshots.len(), 1);
        assert_eq!(
            serde_json::from_str::<Value>(&snapshots[0].json).unwrap(),
            original
        );
        let query = serde_json::from_value(json!({"resultHandle":preview["resultHandle"],"output":{"rows":{"pointer":"/structuredContent/items","whereEquals":{"/active":true},"columns":["/id"]}}})).unwrap();
        let result = read(&snapshots, &query)
            .unwrap()
            .structured_content
            .unwrap();
        assert_eq!(
            result["selected"]["rows"],
            json!([{"sourceIndex":0,"value":{"/id":"exact"}}])
        );
        assert_eq!(result["truncated"], false);
    }

    #[test]
    fn automatic_preview_preserves_error_and_nontext_results() {
        for source in [
            CallToolResult::error(vec![rmcp::model::ContentBlock::text("x".repeat(20000))]),
            serde_json::from_value(json!({"content":[{"type":"text","text":"x".repeat(20000)},{"type":"image","mimeType":"image/png","data":"AA=="}]})).unwrap(),
        ] {
            let expected = serde_json::to_value(&source).unwrap();
            let selection = automatic_preview(&source, true).unwrap();
            let mut snapshots = VecDeque::new();
            let result = select_inner(source, Some(&selection), &mut snapshots, &mut SelectionStats::default(), true);
            assert_eq!(serde_json::to_value(result).unwrap(), expected);
            assert!(snapshots.is_empty());
        }
    }

    #[test]
    fn cached_queries_filter_original_rows_without_expansion_or_new_handles() {
        let source = json!({"structuredContent":{"items":[{"id":"a","active":true,"log":"x".repeat(20000)},{"id":"b","active":false,"log":"y".repeat(20000)}]}});
        let snapshots = VecDeque::from([Snapshot {
            handle: "snapshot".into(),
            json: source.to_string(),
        }]);
        let input = serde_json::from_value(json!({"resultHandle":"snapshot","output":{"rows":{"pointer":"/structuredContent/items","whereEquals":{"/active":true},"columns":["/id"]}}})).unwrap();
        let result = read(&snapshots, &input).unwrap();
        assert_eq!(
            result.structured_content.as_ref().unwrap()["selected"]["matchedRows"],
            1
        );
        let value: Value = serde_json::from_str(
            serde_json::to_value(result).unwrap()["content"][0]["text"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(value["resultHandle"], "snapshot");
        assert_eq!(
            value["selected"]["rows"],
            json!([{"sourceIndex":0,"value":{"/id":"a"}}])
        );
        assert_eq!(value["truncated"], false);
        assert!(value.to_string().len() < 2000);
        assert_eq!(snapshots[0].json, source.to_string());
        let missing = serde_json::from_value(
            json!({"resultHandle":"snapshot","output":{"rows":{"pointer":"/absent"}}}),
        )
        .unwrap();
        assert!(read(&snapshots, &missing).is_err());
    }

    #[test]
    fn row_pages_keep_complete_json_and_reconstruct_the_exact_selection() {
        let source = json!({"items":(0..30).map(|id|json!({"id":id,"text":"界".repeat(70)})).collect::<Vec<_>>()});
        let mut offset = 0;
        let mut ids = Vec::new();
        loop {
            let selection: Selection = serde_json::from_value(
                json!({"maxChars":512,"rows":{"pointer":"/items","offset":offset}}),
            )
            .unwrap();
            let result = project(&source, &selection, "same", true).unwrap();
            assert!(result["preview"].is_null());
            assert!(result["selected"].to_string().chars().count() <= 512);
            ids.extend(
                result["selected"]["rows"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|row| row["value"]["id"].as_u64().unwrap()),
            );
            let Some(next) = result["selected"]["nextOffset"].as_u64() else {
                break;
            };
            assert!(next > offset);
            offset = next;
        }
        assert_eq!(ids, (0..30).collect::<Vec<_>>());
        let huge: Selection =
            serde_json::from_value(json!({"maxChars":256,"rows":{"pointer":"/items"}})).unwrap();
        let result = project(
            &json!({"items":[{"text":"x".repeat(5000)}]}),
            &huge,
            "same",
            true,
        )
        .unwrap();
        assert!(result["queryError"].is_string());
        assert_eq!(result["selected"]["nextOffset"], 0);
    }

    #[test]
    fn previews_expose_bounded_partial_array_paths_with_escaped_columns() {
        let value = json!({"structuredContent":{"a/b":[{"~key":1,"extra":"x".repeat(2000)}]}});
        let selection: Selection = serde_json::from_value(json!({"maxChars":256})).unwrap();
        let result = project(&value, &selection, "same", true).unwrap();
        assert_eq!(result["arrays"][0]["pointer"], "/structuredContent/a~1b");
        assert!(result["arrays"][0]["sampledColumns"]
            .as_array()
            .unwrap()
            .contains(&json!("/~0key")));
        assert_eq!(result["arrays"][0]["schemaIsPartial"], true);
    }
}
