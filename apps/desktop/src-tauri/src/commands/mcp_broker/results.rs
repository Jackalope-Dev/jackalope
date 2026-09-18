use super::*;
mod query;
pub(super) mod rows;

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Selection {
    #[schemars(
        description = "Optional exact filtering/projection/count of an array. Uses RFC 6901 pointers relative to each row for columns and equality filters; returns source indices. Missing fields preserve the original result."
    )]
    pub rows: Option<rows::Rows>,
    #[serde(default)]
    #[schemars(
        description = "RFC 6901 pointers into the MCP result, e.g. /structuredContent/items. Missing paths preserve the full result. Empty selects everything."
    )]
    pub json_pointers: Vec<String>,
    #[schemars(
        description = "Maximum selected-data Unicode characters (256-16000), plus recovery metadata. The complete captured result stays available through read_tool_result without executing the tool again."
    )]
    pub max_chars: Option<usize>,
}

impl Selection {
    pub(super) fn validate(&self) -> Result<(), String> {
        if let Some(rows) = &self.rows {
            rows.validate()?;
        }
        if self.rows.is_some() && !self.json_pointers.is_empty() {
            return Err("Choose row operations or JSON pointers, not both.".into());
        }
        if self.json_pointers.len() > 16
            || self
                .json_pointers
                .iter()
                .any(|path| !path.starts_with('/') || path.len() > 512)
            || self
                .max_chars
                .is_some_and(|limit| !(256..=16_000).contains(&limit))
        {
            return Err("Select at most 16 JSON pointers and 256-16000 output characters.".into());
        }
        Ok(())
    }
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReadInput {
    pub result_handle: String,
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
    #[schemars(
        description = "Query captured JSON locally instead of reading character pages. For arrays use rows:{pointer,whereEquals,columns,offset?,limit?}. Row field paths are relative RFC 6901 pointers. Never reexecutes the remote tool."
    )]
    pub output: Option<Selection>,
}

pub(super) struct Snapshot {
    handle: String,
    json: String,
}

#[derive(Default)]
pub(super) struct SelectionStats {
    pub requests: u64,
    pub row_requests: u64,
    pub fallbacks: u64,
    pub truncated: u64,
}

fn response(value: Value, structured: bool) -> CallToolResult {
    if structured {
        let failed = value["queryError"].is_string();
        let mut result = CallToolResult::structured(value);
        if failed {
            result.is_error = Some(true);
        }
        return result;
    }
    let mut result =
        CallToolResult::success(vec![rmcp::model::ContentBlock::text(value.to_string())]);
    result.result_type = Some(rmcp::model::ResultType::COMPLETE);
    result
}

#[cfg(test)]
pub(super) fn select(
    result: CallToolResult,
    selection: Option<&Selection>,
    snapshots: &mut VecDeque<Snapshot>,
) -> CallToolResult {
    select_measured(result, selection, snapshots).0
}

pub(super) fn select_measured(
    result: CallToolResult,
    selection: Option<&Selection>,
    snapshots: &mut VecDeque<Snapshot>,
) -> (CallToolResult, SelectionStats) {
    let mut stats = SelectionStats::default();
    let structured = crate::commands::experiments::is("JACKALOPE_RESULT_QUERIES", "on");
    let preview = automatic_preview(
        &result,
        selection.is_none()
            && structured
            && crate::commands::experiments::is("JACKALOPE_RESULT_PREVIEW", "on"),
    );
    let result = select_inner(
        result,
        selection.or(preview.as_ref()),
        snapshots,
        &mut stats,
        structured,
    );
    (result, stats)
}

fn automatic_preview(result: &CallToolResult, enabled: bool) -> Option<Selection> {
    (enabled && serde_json::to_vec(result).is_ok_and(|value| value.len() > 16_000)).then_some(
        Selection {
            rows: None,
            json_pointers: vec![],
            max_chars: Some(2000),
        },
    )
}

fn select_inner(
    result: CallToolResult,
    selection: Option<&Selection>,
    snapshots: &mut VecDeque<Snapshot>,
    stats: &mut SelectionStats,
    structured: bool,
) -> CallToolResult {
    let Some(selection) = selection else {
        return result;
    };
    stats.requests = 1;
    stats.row_requests = u64::from(selection.rows.is_some());
    stats.fallbacks = 1;
    if result.is_error == Some(true) {
        return result;
    }
    let Ok(value) = serde_json::to_value(&result) else {
        return result;
    };
    // Never replace images/audio/resources with a JSON text preview.
    if value["content"]
        .as_array()
        .is_some_and(|blocks| blocks.iter().any(|block| block["type"] != "text"))
    {
        return result;
    }
    let handle = uuid::Uuid::new_v4().to_string();
    let Some(projection) = query::project(&value, selection, &handle, structured) else {
        return result;
    };
    let truncated = projection["truncated"] == true;
    let projected = response(projection, structured);
    if selection.rows.is_none()
        && serde_json::to_vec(&projected).map_or(usize::MAX, |v| v.len())
            >= serde_json::to_vec(&result).map_or(0, |v| v.len())
    {
        return result;
    }
    stats.fallbacks = 0;
    stats.truncated = u64::from(truncated);
    snapshots.push_back(Snapshot {
        handle,
        json: value.to_string(),
    });
    while snapshots.len() > 16 {
        snapshots.pop_front();
    }
    projected
}

pub(super) fn read(
    snapshots: &VecDeque<Snapshot>,
    input: &ReadInput,
) -> Result<CallToolResult, String> {
    if input.result_handle.len() > 80
        || input.offset > 1_000_000
        || input.limit.is_some_and(|n| !(1..=16_000).contains(&n))
    {
        return Err("Use a valid result handle, character offset and limit of 1-16000.".into());
    }
    let snapshot = snapshots.iter().find(|item| item.handle == input.result_handle)
        .ok_or("Result handle expired or belongs to another attempt. Do not repeat a write to recover its output.")?;
    if let Some(selection) = &input.output {
        selection.validate()?;
        if input.offset != 0 || input.limit.is_some() {
            return Err("Use output.rows.offset/limit for queries; do not combine a query with character paging.".into());
        }
        let value: Value =
            serde_json::from_str(&snapshot.json).map_err(|_| "Captured JSON is unavailable.")?;
        let projected = query::project(&value, selection, &input.result_handle, true)
            .ok_or("The requested array or fields are absent. Inspect available source paths; missing evidence must not be treated as irrelevant.")?;
        return Ok(response(projected, true));
    }
    let total = snapshot.json.chars().count();
    if input.offset > total {
        return Err("Offset exceeds the captured result.".into());
    }
    let text: String = snapshot
        .json
        .chars()
        .skip(input.offset)
        .take(input.limit.unwrap_or(6_000))
        .collect();
    let next = input.offset + text.chars().count();
    Ok(response(
        json!({"resultHandle":input.result_handle,"text":text,"offset":input.offset,"totalCharacters":total,"nextOffset":if next < total {Some(next)} else {None}}),
        false,
    ))
}

pub(super) fn captured_json(
    snapshots: &VecDeque<Snapshot>,
    handle: &str,
    pointer: Option<&str>,
) -> Result<Value, String> {
    if handle.is_empty()
        || handle.len() > 80
        || pointer.is_some_and(|p| !p.starts_with('/') || p.len() > 512)
    {
        return Err(
            "Use this attempt's result handle and an optional bounded RFC 6901 pointer.".into(),
        );
    }
    let snapshot = snapshots
        .iter()
        .find(|item| item.handle == handle)
        .ok_or("Captured result expired or belongs to another attempt; no remote call was made.")?;
    let value: Value =
        serde_json::from_str(&snapshot.json).map_err(|_| "Captured JSON unavailable.")?;
    let value = match pointer {
        Some(pointer) => value
            .pointer(pointer)
            .cloned()
            .ok_or("Captured result path is absent; missing evidence is not irrelevant.")?,
        None => value,
    };
    if value.to_string().len() > 96_000 {
        return Err("Captured evidence exceeds 96 KB. Select a narrower JSON pointer.".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jev_sources_read_original_snapshots_and_fail_closed_on_missing_evidence() {
        let original = CallToolResult::structured(
            json!({"visible":"small", "evidence":[1,2,3], "large":"x".repeat(96_001)}),
        );
        let selection: Selection =
            serde_json::from_value(json!({"jsonPointers":["/structuredContent/visible"]})).unwrap();
        let mut snapshots = VecDeque::new();
        select(original, Some(&selection), &mut snapshots);
        let handle = snapshots[0].handle.clone();
        assert_eq!(
            captured_json(&snapshots, &handle, Some("/structuredContent/evidence")).unwrap(),
            json!([1, 2, 3])
        );
        assert!(captured_json(&snapshots, &handle, None)
            .unwrap_err()
            .contains("96 KB"));
        assert!(captured_json(&snapshots, &handle, Some("/missing")).is_err());
        assert!(captured_json(&snapshots, &handle, Some("invalid")).is_err());
        assert!(captured_json(&VecDeque::new(), &handle, None).is_err());
        snapshots.clear();
        assert!(captured_json(&snapshots, &handle, None)
            .unwrap_err()
            .contains("expired"));
    }

    #[test]
    fn selection_metrics_distinguish_fallbacks_from_actual_projection() {
        let original = CallToolResult::structured(
            json!({"items":[{"id":1,"ready":true,"noise":"x".repeat(2000)}]}),
        );
        let selection = |pointer: &str| {
            serde_json::from_value::<Selection>(
                json!({"rows":{"pointer":pointer,"columns":["/id"]}}),
            )
            .unwrap()
        };
        let mut snapshots = VecDeque::new();
        let (_, stats) = select_measured(
            original.clone(),
            Some(&selection("/absent")),
            &mut snapshots,
        );
        assert_eq!(
            (stats.requests, stats.row_requests, stats.fallbacks),
            (1, 1, 1)
        );
        assert!(snapshots.is_empty());
        let (_, stats) = select_measured(
            original,
            Some(&selection("/structuredContent/items")),
            &mut snapshots,
        );
        assert_eq!(
            (
                stats.requests,
                stats.row_requests,
                stats.fallbacks,
                stats.truncated
            ),
            (1, 1, 0, 0)
        );
        assert_eq!(snapshots.len(), 1);
    }

    #[test]
    fn selection_is_lossless_retrievable_and_smaller_without_reexecution() {
        let original =
            CallToolResult::structured(json!({"answer":"required", "noise":"界".repeat(12_000)}));
        let mut snapshots = VecDeque::new();
        let selection: Selection =
            serde_json::from_value(json!({"jsonPointers":["/structuredContent/answer"]})).unwrap();
        let selected = select(original.clone(), Some(&selection), &mut snapshots);
        assert!(
            serde_json::to_vec(&selected).unwrap().len()
                < serde_json::to_vec(&original).unwrap().len() / 10
        );
        let handle = snapshots[0].handle.clone();
        let mut recovered = String::new();
        let mut offset = 0;
        loop {
            let page = read(
                &snapshots,
                &ReadInput {
                    result_handle: handle.clone(),
                    offset,
                    limit: Some(997),
                    output: None,
                },
            )
            .unwrap();
            let value = serde_json::to_value(page).unwrap();
            let page: Value =
                serde_json::from_str(value["content"][0]["text"].as_str().unwrap()).unwrap();
            recovered.push_str(page["text"].as_str().unwrap());
            let Some(next) = page["nextOffset"].as_u64() else {
                break;
            };
            offset = next as usize;
        }
        assert_eq!(
            serde_json::from_str::<Value>(&recovered).unwrap(),
            serde_json::to_value(&original).unwrap()
        );
        assert!(read(
            &VecDeque::new(),
            &ReadInput {
                result_handle: handle,
                offset: 0,
                limit: None,
                output: None,
            }
        )
        .is_err());
        let missing: Selection =
            serde_json::from_value(json!({"jsonPointers":["/absent"]})).unwrap();
        assert_eq!(
            serde_json::to_value(select(original.clone(), Some(&missing), &mut snapshots)).unwrap(),
            serde_json::to_value(original).unwrap()
        );
    }

    #[test]
    fn errors_and_small_responses_are_preserved() {
        let selection: Selection = serde_json::from_value(json!({"maxChars":256})).unwrap();
        for result in [
            CallToolResult::structured(json!({"ok":true})),
            CallToolResult::error(vec![rmcp::model::ContentBlock::text(
                "failure".repeat(1000),
            )]),
        ] {
            let mut snapshots = VecDeque::new();
            assert_eq!(
                serde_json::to_value(select(result.clone(), Some(&selection), &mut snapshots))
                    .unwrap(),
                serde_json::to_value(result).unwrap()
            );
            assert!(snapshots.is_empty());
        }
    }
}
