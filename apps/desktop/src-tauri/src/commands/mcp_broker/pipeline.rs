use super::*;
use crate::commands::tasks::TaskRuntime;

#[cfg(test)]
mod tests;

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub read: Option<Read>,
    pub result_handle: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Join {
    pub source: String,
    pub pointer: String,
    pub left_key: String,
    pub right_key: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Read {
    pub handle: Option<String>,
    pub name: Option<String>,
    pub server: Option<String>,
    #[serde(default)]
    pub arguments: serde_json::Map<String, Value>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Input {
    #[schemars(
        description = "1-4 sources with unique id and either read:{handle or name/server,arguments} or this attempt's resultHandle. Reads require known arguments and declared read-only tools; omit read.output. Originals remain recoverable."
    )]
    pub sources: Vec<Source>,
    pub source: String,
    #[schemars(
        description = "Array pointer into the source MCP envelope (e.g. /structuredContent/items), exact whereEquals, final columns, offset/limit or countOnly. Base columns keep their paths, e.g. /id. Join columns use /joined/<source>/field; /row/field explicitly selects a base field. Example columns:['/id','/joined/deployments/owner']. Filters and leftKey refer to original base rows. Missing fields fail explicitly."
    )]
    pub rows: results::rows::Rows,
    #[serde(default)]
    #[schemars(
        description = "Up to three left joins to unique scalar rightKey values. pointer selects each source array; unmatched rows retain null. No implicit many-to-many joins. Only the final selected result is delivered."
    )]
    pub joins: Vec<Join>,
    pub max_chars: Option<usize>,
}

pub fn enabled() -> bool {
    crate::commands::experiments::is("JACKALOPE_READ_PIPELINE", "on")
        && crate::commands::experiments::is("JACKALOPE_RESULT_QUERIES", "on")
}

pub fn instructions() -> &'static str {
    "\nFor known multi-source reads and joins, use read_pipeline (HTTP POST /v1/tools/pipeline) first: it retrieves and processes data locally without intermediate previews or model turns. sources:[{id,read:{handle or name/server,arguments}}]; use {id,resultHandle} only to reuse an existing capture. source selects the base id; rows:{pointer:'/structuredContent/items',whereEquals:{'/status':'open'},columns:['/id','/joined/deployments/owner']}; joins:[{source:'deployments',pointer:'/structuredContent/items',leftKey:'/deployment',rightKey:'/id'}]. Adapt these paths to the known schemas, otherwise search first. Base columns keep their paths; joined fields use /joined/<source>/.... Include every final field needed. Only final data is returned; missing fields, duplicate right keys and partial results fail with recovery handles. Single reads can use read_tool. Tools remain scoped, read-only and permission checked.\n"
}

fn validate(input: &Input) -> Result<(), String> {
    input.rows.validate()?;
    let mut ids = HashSet::new();
    if input.sources.is_empty()
        || input.sources.len() > 4
        || input.joins.len() > 3
        || input
            .max_chars
            .is_some_and(|n| !(256..=16_000).contains(&n))
    {
        return Err("Use 1-4 sources, at most three joins and 256-16000 output characters.".into());
    }
    for source in &input.sources {
        if source.id.is_empty()
            || source.id.len() > 64
            || !source
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
            || !ids.insert(source.id.as_str())
            || source.read.is_some() == source.result_handle.is_some()
            || source
                .result_handle
                .as_ref()
                .is_some_and(|h| h.is_empty() || h.len() > 80)
        {
            return Err("Each source needs a unique alphanumeric/underscore id and exactly one read or resultHandle.".into());
        }
        if let Some(read) = &source.read {
            if read.handle.is_some() == read.name.is_some()
                || read
                    .handle
                    .as_ref()
                    .is_some_and(|h| h.is_empty() || h.len() > 80 || read.server.is_some())
                || read
                    .name
                    .as_ref()
                    .is_some_and(|name| name.is_empty() || name.len() > 256)
                || read
                    .server
                    .as_ref()
                    .is_some_and(|server| server.len() > 256)
                || serde_json::to_vec(&read.arguments).map_or(true, |v| v.len() > 6000)
            {
                return Err("Pipeline reads accept at most 6000 argument bytes and no output selection; select through rows.".into());
            }
        }
    }
    let mut joined = HashSet::new();
    if !ids.contains(input.source.as_str())
        || input.joins.iter().any(|join| {
            !ids.contains(join.source.as_str())
                || join.source == input.source
                || !joined.insert(join.source.as_str())
                || [&join.pointer, &join.left_key, &join.right_key]
                    .iter()
                    .any(|p| !p.starts_with('/') || p.len() > 512)
        })
    {
        return Err(
            "Use existing source ids, unique join sources and bounded RFC 6901 pointers.".into(),
        );
    }
    Ok(())
}

fn complete(result: &CallToolResult) -> Result<Value, String> {
    let value = serde_json::to_value(result).map_err(|e| e.to_string())?;
    let data = value.get("structuredContent").ok_or(
        "Pipeline requires structured JSON; recover the original to inspect other output.",
    )?;
    if result.is_error == Some(true)
        || relevance::incomplete(data)
        || value["resultType"]
            .as_str()
            .is_some_and(|kind| kind != "complete")
        || value["content"].as_array().is_none_or(|blocks| {
            blocks.iter().any(|block| {
                block["type"] != "text"
                    || block["text"]
                        .as_str()
                        .and_then(|text| serde_json::from_str::<Value>(text).ok())
                        .as_ref()
                        != Some(data)
            })
        })
    {
        return Err("Pipeline cannot transform errors, partial results, nontext content or additional unmirrored evidence. Inspect the captured original.".into());
    }
    Ok(value)
}

fn scalar_key(value: &Value) -> Result<String, String> {
    if value.is_null() || value.is_array() || value.is_object() {
        return Err("Join keys must be non-null scalars.".into());
    }
    Ok(value.to_string())
}

fn evaluate(input: &Input, sources: &BTreeMap<String, Value>) -> Result<Value, String> {
    let base = sources.get(&input.source).ok_or("Missing base source.")?;
    let original_rows = base
        .pointer(&input.rows.pointer)
        .and_then(Value::as_array)
        .ok_or("Base array pointer is absent.")?;
    if original_rows.len() > 10_000 {
        return Err("Pipeline arrays are limited to 10000 rows.".into());
    }
    let matches = input
        .rows
        .matching(base)
        .ok_or("A filter field is absent; missing evidence cannot be discarded.")?;
    let mut indexes = Vec::new();
    for join in &input.joins {
        let rows = sources
            .get(&join.source)
            .and_then(|value| value.pointer(&join.pointer))
            .and_then(Value::as_array)
            .ok_or("Join array pointer is absent.")?;
        if rows.len() > 10_000 {
            return Err("Pipeline arrays are limited to 10000 rows.".into());
        }
        let mut index = BTreeMap::new();
        for (position, row) in rows.iter().enumerate() {
            let key = scalar_key(
                row.pointer(&join.right_key)
                    .ok_or("A right join key is absent.")?,
            )?;
            if index.insert(key, (position, row)).is_some() {
                return Err("Right join keys are not unique; refine the read instead of silently losing matches.".into());
            }
        }
        indexes.push(index);
    }
    let mut rows = Vec::new();
    let mut output_bytes = 0;
    for (matched_index, (position, row)) in matches.iter().enumerate() {
        let emit = !input.rows.count_only
            && matched_index >= input.rows.offset
            && rows.len() < input.rows.limit.unwrap_or(64);
        let mut joined = serde_json::Map::new();
        let mut lineage = serde_json::Map::new();
        lineage.insert(input.source.clone(), json!(position));
        for (join, index) in input.joins.iter().zip(&indexes) {
            let key = scalar_key(
                row.pointer(&join.left_key)
                    .ok_or("A left join key is absent.")?,
            )?;
            let found = index.get(&key);
            if emit {
                joined.insert(
                    join.source.clone(),
                    found.map_or(Value::Null, |(_, row)| (*row).clone()),
                );
            }
            lineage.insert(
                join.source.clone(),
                found.map_or(Value::Null, |(position, _)| json!(position)),
            );
        }
        if !emit {
            continue;
        }
        let value = if input.joins.is_empty() {
            (*row).clone()
        } else {
            json!({"row":row,"joined":joined})
        };
        let mut selected = serde_json::Map::new();
        for column in &input.rows.columns {
            let qualified = ["/row", "/joined"]
                .iter()
                .any(|prefix| column == prefix || column.starts_with(&format!("{prefix}/")));
            let projected = if !input.joins.is_empty() && !qualified {
                row.pointer(column)
            } else {
                value.pointer(column)
            };
            selected.insert(column.clone(), projected.ok_or_else(|| format!("Column {column:?} is absent. Base fields use /field or /row/field; joined fields use /joined/<source>/field. To retain unmatched nulls select /joined/<source>. Correct the columns and reuse captured source handles without another remote read."))?.clone());
        }
        let row = json!({"sourceIndices":lineage,"value":if selected.is_empty() {value} else {Value::Object(selected)}});
        output_bytes += row.to_string().len();
        if output_bytes > 1_000_000 {
            return Err("Pipeline output exceeds 1 MB; select fewer columns or rows.".into());
        }
        rows.push(row);
    }
    let next = input.rows.offset + rows.len();
    Ok(
        json!({"sourceRows":original_rows.len(),"matchedRows":matches.len(),"rows":rows,"countOnly":input.rows.count_only,
        "nextOffset":if !input.rows.count_only && next < matches.len() {Some(next)} else {None},
        "truncated":!input.rows.count_only && next < matches.len()}),
    )
}

pub async fn read(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: Input,
) -> Result<CallToolResult, String> {
    if !enabled() || !runtime.is_running(&run.id) {
        return Err(
            "Read pipelines require an active attempt and the read-pipeline experiment.".into(),
        );
    }
    execute(runtime, run, input).await
}

async fn execute(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: Input,
) -> Result<CallToolResult, String> {
    if !runtime.is_running(&run.id) {
        return Err("This attempt has ended.".into());
    }
    validate(&input)?;
    let broker = &runtime.mcp_broker;
    let attempt = broker.attempt(&run.id)?;
    let mut handles = BTreeMap::new();
    let mut sources = BTreeMap::new();
    // Resolve and validate every operation before dispatching any remote call.
    let mut calls = BTreeMap::new();
    for source in &input.sources {
        if let Some(handle) = &source.result_handle {
            let catalog = attempt.catalog.lock().await;
            let result = results::captured_result(&catalog.results, handle)?;
            sources.insert(source.id.clone(), complete(&result)?);
            handles.insert(source.id.clone(), handle.clone());
        } else if let Some(call) = &source.read {
            let call = match &call.handle {
                Some(handle) => ExecuteInput {
                    handle: handle.clone(),
                    arguments: call.arguments.clone(),
                    output: None,
                },
                None => {
                    broker
                        .resolve_named(
                            &run.id,
                            NamedReadInput {
                                name: call.name.clone().ok_or("Missing exact tool name.")?,
                                server: call.server.clone(),
                                arguments: call.arguments.clone(),
                                output: None,
                            },
                        )
                        .await?
                }
            };
            calls.insert(source.id.clone(), call);
        }
    }
    {
        let catalog = attempt.catalog.lock().await;
        for call in calls.values() {
            if !catalog
                .leases
                .iter()
                .any(|lease| lease.handle == call.handle && is_read_only(&lease.tool))
            {
                return Err(
                    "Pipeline handles must refer to available declared read-only tools.".into(),
                );
            }
        }
    }
    let computed = async {
        for (id, call) in calls {
            let (result, usage) = broker
                .execute_with_policy(&run.id, call, true, false)
                .await?;
            record_usage(runtime, run, usage);
            handles.insert(id.clone(), broker.capture_result(&run.id, &result).await?);
            sources.insert(id, complete(&result)?);
        }
        evaluate(&input, &sources)
    }
    .await;
    let mut result = match computed {
        Ok(mut value) => {
            value["sources"] = json!(handles);
            CallToolResult::structured(value)
        }
        Err(error) => {
            let mut result = CallToolResult::structured(
                json!({"error":error,"sources":handles,"hint":"Use resultHandle recovery for captured originals. A pipeline failure is not an empty result."}),
            );
            result.is_error = Some(true);
            result
        }
    };
    let mut receipt = None;
    if input.rows.where_equals.is_empty()
        && input.rows.columns.is_empty()
        && !input.rows.count_only
        && delivery::automatic(runtime, &run.project_id)
    {
        if let Some(candidate) = relevance::automatic_input(&result) {
            (result, receipt) = relevance::filter(runtime, run, result, &candidate).await?;
        }
    }
    let mut catalog = attempt.catalog.lock().await;
    if *attempt.closed.borrow() {
        return Err("This attempt has ended.".into());
    }
    let output = results::Selection {
        text: None,
        rows: None,
        json_pointers: Vec::new(),
        max_chars: Some(input.max_chars.unwrap_or(16_000)),
    };
    let (result, stats) = results::select_measured(result, Some(&output), &mut catalog.results);
    catalog.usage.selection(stats);
    drop(catalog);
    let usage = broker.record_delivery(&run.id, &result, receipt).await?;
    record_usage(runtime, run, usage);
    Ok(result)
}
