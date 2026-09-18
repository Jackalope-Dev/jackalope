use super::*;

#[tokio::test]
async fn deferred_delivery_accounts_actual_bytes_and_preserves_attempt_boundary() {
    let root = folder();
    let broker = Broker::default();
    broker
        .prepare("selection", vec![fixture(SERVER)], root.clone(), None)
        .unwrap();
    let (found, _) = broker.search("selection", search("tool_19")).await.unwrap();
    let handle = found["tools"][0]["handle"].as_str().unwrap();
    let (original, usage) = broker
        .execute_with_policy("selection", execute(handle), true, false)
        .await
        .unwrap();
    assert_eq!(usage.calls, 1);
    assert!(usage.result_bytes_received.unwrap() > 0);
    assert_eq!(usage.result_bytes_returned, Some(0));
    let captured = broker.capture_result("selection", &original).await.unwrap();
    assert_eq!(
        broker
            .captured_json("selection", &captured, None)
            .await
            .unwrap(),
        serde_json::to_value(&original).unwrap()
    );
    let delivered = CallToolResult::structured(json!({"selected":true}));
    let usage = broker
        .record_delivery("selection", &delivered, None)
        .await
        .unwrap();
    assert_eq!(
        usage.result_bytes_returned,
        Some(serde_json::to_vec(&delivered).unwrap().len() as u64)
    );
    assert_eq!(usage.calls, 1);
    broker.close("selection");
    assert!(broker
        .record_delivery("selection", &delivered, None)
        .await
        .is_err());
    assert!(broker
        .captured_json("selection", &captured, None)
        .await
        .is_err());
    remove_fixture(root).await;
}

#[test]
fn delayed_call_receipts_cannot_erase_completed_batch_accounting() {
    let call = BrokerUsage {
        calls: 3,
        result_bytes_returned: Some(200),
        ..Default::default()
    };
    let batch = BrokerUsage {
        batches: Some(1),
        selection_requests: Some(2),
        row_selection_requests: Some(2),
        result_queries: Some(1),
        result_bytes_returned: Some(250),
        ..call.clone()
    };
    assert!(batch.supersedes(&call));
    assert!(!call.supersedes(&batch));
    let stale_query = BrokerUsage {
        result_queries: Some(0),
        ..batch.clone()
    };
    assert!(!stale_query.supersedes(&batch));
    let refreshed = BrokerUsage {
        catalog_tools: 0,
        catalog_bytes: 0,
        ..batch.clone()
    };
    assert!(refreshed.supersedes(&batch));
    assert!(call.supersedes(&BrokerUsage::default()));
}

#[tokio::test]
#[ignore = "Measures local fixture transport and filtering only; no model calls"]
async fn local_optimization_trial() {
    let root = folder();
    let broker = Broker::default();
    let delayed = SERVER
        .replace("calls++; send(", "calls++; setTimeout(()=>send(")
        .replace("isError:false}); }", "isError:false}),150); }");
    let connections = (0..4)
        .map(|index| {
            let mut config = fixture(&delayed);
            config.id = format!("service-{index}");
            config
        })
        .collect();
    broker
        .prepare("screen", connections, root.clone(), None)
        .unwrap();
    let (found, _) = broker.search("screen", search("tool_19")).await.unwrap();
    let handles: Vec<_> = found["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["handle"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(handles.len(), 4);
    let mut timings = Vec::new();
    for repetition in 0..8 {
        for batch in if repetition % 2 == 0 {
            [false, true]
        } else {
            [true, false]
        } {
            let started = Instant::now();
            if batch {
                let calls = handles
                    .iter()
                    .map(|handle| json!({"handle":handle,"arguments":{"value":"hello"}}))
                    .collect::<Vec<_>>();
                let (value, _) = broker
                    .read_batch(
                        "screen",
                        serde_json::from_value(json!({"calls":calls})).unwrap(),
                    )
                    .await
                    .unwrap();
                assert!(value.structured_content.unwrap()["results"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|row| row["result"]["isError"] == false));
            } else {
                for handle in &handles {
                    assert_eq!(
                        broker
                            .read("screen", execute(handle))
                            .await
                            .unwrap()
                            .0
                            .is_error,
                        Some(false)
                    );
                }
            }
            if repetition > 0 {
                timings.push(json!({"repetition":repetition,"variant":if batch {"batch"} else {"serial"},"elapsedMs":started.elapsed().as_secs_f64()*1000.0}));
            }
        }
    }
    let original = CallToolResult::structured(
        json!({"items":(0..1000).map(|i|json!({"id":i,"active":i%100==0,"log":"diagnostic ".repeat(30)})).collect::<Vec<_>>()}),
    );
    let mut snapshots = VecDeque::new();
    let selection = serde_json::from_value(json!({"rows":{"pointer":"/structuredContent/items","whereEquals":{"/active":true},"columns":["/id"]}})).unwrap();
    let selected = results::select(original.clone(), Some(&selection), &mut snapshots);
    let selected_json: Value = serde_json::from_str(
        serde_json::to_value(&selected).unwrap()["content"][0]["text"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(selected_json["selected"]["matchedRows"], 10);
    for (index, row) in selected_json["selected"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        assert_eq!(row["value"]["/id"], index * 100);
    }
    assert_eq!(snapshots.len(), 1);
    std::fs::write(root.join("module.ts"), "export const x = 1;\n".repeat(120)).unwrap();
    let first = crate::commands::codebase::context_read::read(
        &root,
        serde_json::from_value(json!({"blocks":[{"path":"module.ts","lines":120}]})).unwrap(),
    )
    .unwrap();
    let repeated = crate::commands::codebase::context_read::read(&root, serde_json::from_value(json!({"blocks":[{"path":"module.ts","lines":120,"knownHash":first["blocks"][0]["blockHash"]}]})).unwrap()).unwrap();
    assert_eq!(repeated["blocks"][0]["unchanged"], true);
    println!(
        "Optimization measurement: {}",
        json!({"scope":"Local warm-connection fixture microbenchmark. Four independent servers each delay 150ms; discovery/startup and all LLM work excluded. Seven measured pairs after warmup, alternating order. Bytes are not tokens or monetary savings.","timings":timings,
        "filter":{"beforeBytes":serde_json::to_vec(&original).unwrap().len(),"afterBytes":serde_json::to_vec(&selected).unwrap().len(),"matchedRows":10,"recoverable":true},
        "context":{"beforeBytes":first.to_string().len(),"afterBytes":repeated.to_string().len(),"unchangedBlocks":1}})
    );
    broker.close("screen");
    remove_fixture(root).await;
}

#[tokio::test]
async fn independent_connections_overlap_and_batches_preserve_order() {
    let root = folder();
    let broker = Broker::default();
    let script = SERVER.replace("calls++; send(", "calls++; fs.writeFileSync(q.params.arguments.value, 'ready'); const timer=setInterval(()=>{if(!fs.existsSync('left') || !fs.existsSync('right'))return; clearInterval(timer); send(").replace("isError:false}); }", "isError:false});},10); }");
    let left = fixture(&script);
    let mut right = fixture(&script);
    right.id = "second".into();
    broker
        .prepare("parallel", vec![left, right], root.clone(), None)
        .unwrap();
    let (found, _) = broker.search("parallel", search("tool_19")).await.unwrap();
    assert_eq!(found["tools"].as_array().unwrap().len(), 2);
    let calls = found["tools"].as_array().unwrap().iter().enumerate().map(|(index, tool)| json!({"handle":tool["handle"],"arguments":{"value":if index == 0 {"left"} else {"right"}}})).collect::<Vec<_>>();
    let batch = serde_json::from_value(json!({"calls":calls})).unwrap();
    let (result, usage) =
        tokio::time::timeout(Duration::from_secs(5), broker.read_batch("parallel", batch))
            .await
            .expect("Independent servers must not wait on a shared catalog lock")
            .unwrap();
    let value = result.structured_content.unwrap();
    assert_eq!(value["results"][0]["index"], 0);
    assert_eq!(value["results"][1]["index"], 1);
    assert_eq!(usage.calls, 2);
    assert_eq!(usage.batches, Some(1));
    assert_eq!(usage.failures, 0);
    let invalid = serde_json::from_value(json!({"calls":[{"handle":"unselected"}]})).unwrap();
    assert!(broker.read_batch("parallel", invalid).await.is_err());
    broker.close("parallel");
    remove_fixture(root).await;
}

#[tokio::test]
async fn same_connection_batch_calls_remain_ordered() {
    let root = folder();
    let broker = Broker::default();
    broker
        .prepare("ordered", vec![fixture(SERVER)], root.clone(), None)
        .unwrap();
    let (found, _) = broker.search("ordered", search("tool_19")).await.unwrap();
    let calls: Vec<_> = (0..3)
        .map(|_| json!({"handle":found["tools"][0]["handle"],"arguments":{"value":"small"}}))
        .collect();
    let (result, _) = broker
        .read_batch(
            "ordered",
            serde_json::from_value(json!({"calls":calls})).unwrap(),
        )
        .await
        .unwrap();
    for (index, result) in result.structured_content.unwrap()["results"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        assert_eq!(result["result"]["structuredContent"]["calls"], index + 1);
    }
    broker.close("ordered");
    remove_fixture(root).await;
}

#[tokio::test]
async fn named_batches_preserve_partial_errors_without_retries() {
    let root = folder();
    let broker = Broker::default();
    let script = SERVER.replace("isError:false", "isError:q.params.arguments.value==='fail'");
    broker
        .prepare("partial", vec![fixture(&script)], root.clone(), None)
        .unwrap();
    let values = ["first".to_owned(), "fail".to_owned(), "last".repeat(1100)];
    let calls: Vec<_> = values
        .iter()
        .map(|value| json!({"name":"tool_19","arguments":{"value":value}}))
        .collect();
    let (result, usage) = broker
        .read_batch(
            "partial",
            serde_json::from_value(json!({"calls":calls})).unwrap(),
        )
        .await
        .unwrap();
    let results = result.structured_content.unwrap();
    for (index, row) in results["results"].as_array().unwrap().iter().enumerate() {
        assert_eq!(row["result"]["isError"], index == 1);
        assert_eq!(row["result"]["structuredContent"]["calls"], index + 1);
        let source: Value =
            serde_json::from_str(row["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(source["args"]["value"], values[index]);
    }
    assert_eq!(usage.calls, 3);
    assert_eq!(usage.failures, 1);
    broker.close("partial");
    remove_fixture(root).await;
}

#[tokio::test]
async fn ending_attempt_cancels_batch_calls_and_queued_reads() {
    let root = folder();
    let broker = Broker::default();
    let script = SERVER.replace(
        "calls++; send(",
        "fs.writeFileSync('started', 'yes'); return; calls++; send(",
    );
    broker
        .prepare("cancel-batch", vec![fixture(&script)], root.clone(), None)
        .unwrap();
    let (found, _) = broker
        .search("cancel-batch", search("tool_19"))
        .await
        .unwrap();
    let calls: Vec<_> = (0..2)
        .map(|_| json!({"handle":found["tools"][0]["handle"],"arguments":{"value":"hello"}}))
        .collect();
    let worker = broker.clone();
    let pending = tokio::spawn(async move {
        worker
            .read_batch(
                "cancel-batch",
                serde_json::from_value(json!({"calls":calls})).unwrap(),
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while !root.join("started").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    broker.close("cancel-batch");
    let (result, _) = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(result.structured_content.unwrap()["results"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["error"].is_string()));
    remove_fixture(root).await;
}

#[test]
fn named_reads_reject_ambiguous_mutating_and_incomplete_discovery() {
    let tool = json!({"tool":{"name":"lookup"},"operation":"read_tool","handle":"one"});
    let found = json!({"tools":[tool],"errors":[],"nextOffset":null});
    assert_eq!(named_read_handle(&found, "lookup").unwrap(), "one");
    assert!(named_read_handle(&found, "look").is_err());
    let mut ambiguous = found.clone();
    ambiguous["tools"].as_array_mut().unwrap().push(tool);
    assert!(named_read_handle(&ambiguous, "lookup").is_err());
    let mut mutable = found.clone();
    mutable["tools"][0]["operation"] = json!("execute_tool");
    assert!(named_read_handle(&mutable, "lookup").is_err());
    let mut partial = found.clone();
    partial["nextOffset"] = json!(8);
    assert!(named_read_handle(&partial, "lookup").is_err());
    partial["nextOffset"] = Value::Null;
    partial["errors"] = json!([{"error":"Unavailable connection"}]);
    assert!(named_read_handle(&partial, "lookup").is_err());
}

#[tokio::test]
async fn named_read_uses_existing_allowlist_and_attempt_boundaries() {
    let broker = Broker::default();
    let path = folder();
    let mut connection = fixture(SERVER);
    connection
        .extra
        .insert("enabled_tools".into(), json!(["tool_19"]));
    broker.prepare("one", vec![connection], path, None).unwrap();
    let input = || NamedReadInput {
        name: "tool_19".into(),
        server: Some("fixture".into()),
        arguments: json!({"value":"hello"}).as_object().unwrap().clone(),
        output: None,
    };
    let (_, usage) = broker.read_named("one", input()).await.unwrap();
    assert_eq!(usage.schema_bytes_returned, 0);
    assert_eq!(usage.calls, 1);
    let mut denied = input();
    denied.name = "tool_18".into();
    assert!(broker.read_named("one", denied).await.is_err());
    assert!(broker.read_named("other", input()).await.is_err());
    broker.close("one");
    assert!(broker.read_named("one", input()).await.is_err());
}

fn fixture(script: &str) -> McpServerConfig {
    serde_json::from_value(json!({"id":"fixture","name":"Fixture","scope":"project:test","transport":"stdio","command":"node","args":["-e",script],"discovery":true})).unwrap()
}
const SERVER: &str = r#"
const fs=require('fs'); let calls=0;
require('readline').createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line); const send=result=>console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 if(q.method==='initialize') send({protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
 if(q.method==='tools/list') {
  const start=Number(q.params?.cursor||0);
  const tools=Array.from({length:20},(_,i)=>({name:'tool_'+(start+i),annotations:{readOnlyHint:true,destructiveHint:false},description:'Read fixture '+(start+i),inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}));
  if(fs.existsSync('changed')) tools[0].description='Changed contract';
  send({tools,...(start===0?{nextCursor:'20'}:{})});
 }
 if(q.method==='tools/call') { calls++; send({content:[{type:'text',text:JSON.stringify({name:q.params.name,args:q.params.arguments,calls,cwd:process.cwd(),account:process.env.CODEX_HOME})}],structuredContent:{calls},isError:false}); }
});
"#;
fn search(query: &str) -> SearchInput {
    serde_json::from_value(json!({"query":query})).unwrap()
}
fn execute(handle: &str) -> ExecuteInput {
    ExecuteInput {
        handle: handle.into(),
        arguments: json!({"value":"hello"}).as_object().unwrap().clone(),
        output: None,
    }
}
fn folder() -> PathBuf {
    let path = std::env::temp_dir().join(format!("jackalope-broker-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    path
}

#[tokio::test]
async fn selected_results_expand_without_repeating_calls_or_crossing_attempts() {
    let path = folder();
    let broker = Broker::default();
    for id in ["one", "two"] {
        broker
            .prepare(id, vec![fixture(SERVER)], path.clone(), None)
            .unwrap();
    }
    let (found, _) = broker.search("one", search("tool_19")).await.unwrap();
    let mut input = execute(found["tools"][0]["handle"].as_str().unwrap());
    input
        .arguments
        .insert("value".into(), json!("source-data".repeat(2000)));
    input.output =
        Some(serde_json::from_value(json!({"jsonPointers":["/structuredContent/calls"]})).unwrap());
    let (selected, usage) = broker.read("one", input).await.unwrap();
    assert_eq!(usage.calls, 1);
    assert!(usage.result_bytes_returned.unwrap() < usage.result_bytes_received.unwrap() / 10);
    let selected = serde_json::to_value(selected).unwrap();
    let value: Value =
        serde_json::from_str(selected["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(value["selected"]["/structuredContent/calls"], 1);
    let input = || {
        serde_json::from_value(json!({"resultHandle":value["resultHandle"],"limit":1000})).unwrap()
    };
    assert!(broker.read_result("two", input()).await.is_err());
    let (_, usage) = broker.read_result("one", input()).await.unwrap();
    assert_eq!(usage.calls, 1);
    assert_eq!(usage.result_reads, Some(1));
    broker.close("one");
    assert!(broker.read_result("one", input()).await.is_err());
    broker.close("two");
    remove_fixture(path).await;
}

async fn remove_fixture(path: PathBuf) {
    // Windows can retain the process's working-directory handle briefly after termination.
    for _ in 0..50 {
        match std::fs::remove_dir_all(&path) {
            Ok(()) => return,
            Err(error) if error.raw_os_error() == Some(32) => {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("Could not remove MCP fixture: {error}"),
        }
    }
    std::fs::remove_dir_all(path).unwrap();
}

#[tokio::test]
async fn paginated_discovery_calls_preserve_results_and_isolate_accounts() {
    let path = folder();
    let broker = Broker::default();
    for id in ["one", "two"] {
        broker
            .prepare(
                id,
                vec![fixture(SERVER)],
                path.clone(),
                Some(("CODEX_HOME".into(), path.join(id))),
            )
            .unwrap();
    }
    let (found, usage) = broker.search("one", search("tool_19")).await.unwrap();
    assert_eq!(usage.catalog_tools, 40);
    assert_eq!(found["tools"].as_array().unwrap().len(), 1);
    assert!(usage.schema_bytes_returned < usage.catalog_bytes as u64 / 10);
    let handle = found["tools"][0]["handle"].as_str().unwrap();
    assert!(broker.execute("two", execute(handle)).await.is_err());
    let (result, usage) = broker.read("one", execute(handle)).await.unwrap();
    assert_eq!(usage.calls, 1);
    assert_eq!(
        serde_json::to_value(&result).unwrap()["resultType"],
        "complete"
    );
    assert_eq!(result.structured_content.unwrap()["calls"], 1);
    let text = serde_json::to_value(result.content).unwrap();
    let output: Value = serde_json::from_str(text[0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(
        output["account"],
        path.join("one").to_string_lossy().as_ref()
    );
    assert_eq!(output["args"]["value"], "hello");
    assert!(broker
        .search(
            "one",
            SearchInput {
                server: Some("unselected".into()),
                ..search("")
            }
        )
        .await
        .is_err());
    let (page, _) = broker
        .search(
            "one",
            SearchInput {
                offset: 5,
                limit: Some(3),
                ..search("")
            },
        )
        .await
        .unwrap();
    assert_eq!(page["tools"].as_array().unwrap().len(), 3);
    assert_eq!(page["nextOffset"], 8);
    broker.close("one");
    broker.close("two");
    assert!(broker.search("one", search("")).await.is_err());
    tokio::time::sleep(Duration::from_millis(100)).await;
    remove_fixture(path).await;
}

#[tokio::test]
async fn changed_schemas_and_disabled_tools_cannot_execute() {
    let path = folder();
    let broker = Broker::default();
    let mut config = fixture(SERVER);
    config
        .extra
        .insert("disabled_tools".into(), json!(["tool_19"]));
    broker
        .prepare("run", vec![config], path.clone(), None)
        .unwrap();
    let (found, _) = broker.search("run", search("tool_19")).await.unwrap();
    assert_eq!(found["total"], 0);
    let (found, _) = broker.search("run", search("tool_0")).await.unwrap();
    let handle = found["tools"][0]["handle"].as_str().unwrap();
    std::fs::write(path.join("changed"), "yes").unwrap();
    assert!(broker
        .execute("run", execute(handle))
        .await
        .unwrap_err()
        .contains("changed"));
    let (fresh, _) = broker
        .search(
            "run",
            SearchInput {
                refresh: true,
                ..search("tool_0")
            },
        )
        .await
        .unwrap();
    assert_ne!(fresh["tools"][0]["handle"], handle);
    broker.close("run");
    tokio::time::sleep(Duration::from_millis(100)).await;
    remove_fixture(path).await;
}

#[tokio::test]
async fn end_attempt_cancels_pending_discovery() {
    let path = folder();
    let broker = Broker::default();
    broker
        .prepare(
            "run",
            vec![fixture("setInterval(()=>{},1000)")],
            path.clone(),
            None,
        )
        .unwrap();
    let task = tokio::spawn({
        let broker = broker.clone();
        async move { broker.search("run", search("")).await }
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    broker.close("run");
    let result = tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap();
    assert!(result.is_err());
    tokio::time::sleep(Duration::from_millis(100)).await;
    remove_fixture(path).await;
}

#[test]
fn incompatible_fields_require_direct_delivery() {
    let mut config = fixture(SERVER);
    config.extra.insert("oauth".into(), json!({}));
    assert!(validate_connection(&config).is_err());
    config.extra.clear();
    config.extra.insert("enabled_tools".into(), json!("all"));
    assert!(validate_connection(&config).is_err());
    config.extra.clear();
    config.scope = "codex".into();
    assert!(validate_connection(&config).is_err());
}

#[tokio::test]
async fn streamable_http_authentication_and_tool_results_are_preserved() {
    use axum::{
        http::{HeaderMap, StatusCode},
        routing::post,
        Json, Router,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let router=Router::new().route("/mcp",post(|headers:HeaderMap,Json(request):Json<Value>| async move {
        if headers.get("authorization").and_then(|v|v.to_str().ok()) != Some("Bearer fixture") { return (StatusCode::UNAUTHORIZED,Json(json!({}))); }
        let result=match request["method"].as_str().unwrap_or_default() {
            "initialize"=>json!({"protocolVersion":request["params"]["protocolVersion"],"capabilities":{"tools":{}},"serverInfo":{"name":"http-fixture","version":"1"}}),
            "tools/list"=>json!({"tools":[{"name":"echo","inputSchema":{"type":"object"}}]}),
            "tools/call"=>json!({"content":[{"type":"text","text":"response"}],"structuredContent":{"kept":true},"isError":false}),
            _=>return (StatusCode::ACCEPTED,Json(json!({}))),
        };
        (StatusCode::OK,Json(json!({"jsonrpc":"2.0","id":request["id"],"result":result})))
    }));
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let broker = Broker::default();
    let path = folder();
    let config: McpServerConfig=serde_json::from_value(json!({"id":"http","name":"HTTP fixture","scope":"project:test","transport":"http","url":url,"discovery":true,"extra":{"headers":{"Authorization":"Bearer fixture"}}})).unwrap();
    broker
        .prepare("http", vec![config], path.clone(), None)
        .unwrap();
    let (found, _) = broker.search("http", search("echo")).await.unwrap();
    assert_eq!(found["total"], 1, "{found}");
    let (result, _) = broker
        .execute(
            "http",
            execute(found["tools"][0]["handle"].as_str().unwrap()),
        )
        .await
        .unwrap();
    assert_eq!(result.structured_content.unwrap()["kept"], true);
    broker.close("http");
    server.abort();
    remove_fixture(path).await;
}

#[tokio::test]
async fn ending_an_attempt_terminates_its_mcp_process_tree() {
    let path = folder();
    let broker = Broker::default();
    let script=format!("{SERVER}\nconst child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{{}},1000)'],{{stdio:'ignore'}});fs.writeFileSync('child.pid',String(child.pid));fs.writeFileSync('parent.pid',String(process.pid));");
    broker
        .prepare("run", vec![fixture(&script)], path.clone(), None)
        .unwrap();
    let (found, _) = broker.search("run", search("tool_19")).await.unwrap();
    assert_eq!(found["total"], 1);
    let pid: u32 = std::fs::read_to_string(path.join("child.pid"))
        .unwrap()
        .parse()
        .unwrap();
    let parent: u32 = std::fs::read_to_string(path.join("parent.pid"))
        .unwrap()
        .parse()
        .unwrap();
    broker.close("run");
    #[cfg(windows)]
    fn alive(pid: u32) -> bool {
        use windows_sys::Win32::System::Threading::*;
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return false;
            }
            let mut code = 0;
            let live = GetExitCodeProcess(process, &mut code) != 0 && code == 259;
            windows_sys::Win32::Foundation::CloseHandle(process);
            live
        }
    }
    #[cfg(not(windows))]
    fn alive(pid: u32) -> bool {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .unwrap()
            .status
            .success()
    }
    for _ in 0..30 {
        if !alive(pid) && !alive(parent) && std::fs::remove_dir_all(&path).is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(!alive(pid), "MCP child survived attempt cleanup");
    assert!(!alive(parent), "MCP parent survived attempt cleanup");
    remove_fixture(path).await;
}

#[tokio::test]
async fn read_operation_rejects_mutable_or_unclassified_tools() {
    let path = folder();
    let broker = Broker::default();
    let script = SERVER.replace(
        "annotations:{readOnlyHint:true,destructiveHint:false},",
        "annotations:{readOnlyHint:false},",
    );
    broker
        .prepare("run", vec![fixture(&script)], path.clone(), None)
        .unwrap();
    let (found, _) = broker.search("run", search("tool_19")).await.unwrap();
    assert_eq!(found["tools"][0]["operation"], "execute_tool");
    assert!(broker
        .read(
            "run",
            execute(found["tools"][0]["handle"].as_str().unwrap())
        )
        .await
        .unwrap_err()
        .contains("not declared read-only"));
    let bare: Tool =
        serde_json::from_value(json!({"name":"unknown","inputSchema":{"type":"object"}})).unwrap();
    assert!(!is_read_only(&bare));
    broker.close("run");
    tokio::time::sleep(Duration::from_millis(100)).await;
    remove_fixture(path).await;
}
