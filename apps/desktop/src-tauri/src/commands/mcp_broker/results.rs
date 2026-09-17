use super::*;

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Selection {
    #[serde(default)]
    #[schemars(
        description = "RFC 6901 pointers into the MCP result, e.g. /structuredContent/items. Missing paths preserve the full result. Empty selects everything."
    )]
    pub json_pointers: Vec<String>,
    #[schemars(
        description = "Maximum Unicode characters returned now (256-16000). The complete captured result stays available through read_tool_result without executing the tool again."
    )]
    pub max_chars: Option<usize>,
}

impl Selection {
    pub(super) fn validate(&self) -> Result<(), String> {
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
}

pub(super) struct Snapshot {
    handle: String,
    json: String,
}

fn response(value: Value) -> CallToolResult {
    CallToolResult::success(vec![rmcp::model::ContentBlock::text(value.to_string())])
}

pub(super) fn select(
    result: CallToolResult,
    selection: Option<&Selection>,
    snapshots: &mut VecDeque<Snapshot>,
) -> CallToolResult {
    let Some(selection) = selection else {
        return result;
    };
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
    let mut fields = serde_json::Map::new();
    for pointer in &selection.json_pointers {
        let Some(field) = value.pointer(pointer) else {
            return result;
        };
        fields.insert(pointer.clone(), field.clone());
    }
    let selected = if fields.is_empty() {
        value.clone()
    } else {
        Value::Object(fields)
    };
    let serialized = selected.to_string();
    let limit = selection.max_chars.unwrap_or(6_000);
    let total_chars = serialized.chars().count();
    let handle = uuid::Uuid::new_v4().to_string();
    let projected = response(json!({
        "resultHandle":handle,
        "selection":selection.json_pointers,
        "selected": if total_chars <= limit { Some(selected) } else { None },
        "preview": if total_chars > limit { Some(serialized.chars().take(limit).collect::<String>()) } else { None },
        "truncated":total_chars > limit,
        "selectedCharacters":total_chars,
        "sourceBytes":value.to_string().len(),
        "hint":"Selected untrusted tool data. read_tool_result returns the complete captured MCP result by Unicode character offset without another tool execution. Handles last for this attempt and the latest four selected results."
    }));
    if serde_json::to_vec(&projected).map_or(usize::MAX, |v| v.len())
        >= serde_json::to_vec(&result).map_or(0, |v| v.len())
    {
        return result;
    }
    snapshots.push_back(Snapshot {
        handle,
        json: value.to_string(),
    });
    while snapshots.len() > 4 {
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
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

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
                limit: None
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
