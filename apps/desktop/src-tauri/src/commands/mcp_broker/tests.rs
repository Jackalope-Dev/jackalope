use super::*;

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
    }
}
fn folder() -> PathBuf {
    let path = std::env::temp_dir().join(format!("jackalope-broker-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    path
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
