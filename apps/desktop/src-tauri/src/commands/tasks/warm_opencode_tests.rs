use super::*;

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
#[ignore = "Real OpenCode protocol with a fake loopback model; set JACKALOPE_OPENCODE_EXE"]
fn warm_opencode_protocol() {
    let executable = std::env::var("JACKALOPE_OPENCODE_EXE").expect("set JACKALOPE_OPENCODE_EXE");
    let fixture = Fixture(
        std::env::temp_dir().join(format!("jackalope-warm-probe-{}", uuid::Uuid::new_v4())),
    );
    std::fs::create_dir_all(&fixture.0).unwrap();
    let mock = fixture.0.join("provider.cjs");
    std::fs::write(&mock, r#"
const http = require('node:http');
const fs = require('node:fs');
const requests = [];
http.createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text); requests.push(body);
  fs.writeFileSync(process.argv[2], JSON.stringify(requests));
  const messages = JSON.stringify(body.messages);
  if (messages.includes('WAIT_FOR_CANCEL')) { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.write(': waiting\n\n'); return; }
  const chunk = {id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture'};
  res.writeHead(200, {'Content-Type':'text/event-stream'});
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{role:'assistant',content:'Local helper answer.'},finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\n');
  res.end('data: [DONE]\n\n');
}).listen(0,'127.0.0.1',function(){process.stdout.write(String(this.address().port)+'\n')});
"#).unwrap();
    let requests_path = fixture.0.join("requests.json");
    let mut provider = command(executable_node())
        .arg(&mock)
        .arg(&requests_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let tree = ProcessTree::attach(&provider).unwrap();
    struct OwnedChild(std::process::Child, ProcessTree);
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            self.1.terminate();
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let mut port = String::new();
    std::io::BufRead::read_line(
        &mut BufReader::new(provider.stdout.take().unwrap()),
        &mut port,
    )
    .unwrap();
    let _provider = OwnedChild(provider, tree);
    let binding = agent_profiles::AccountBinding {
        adapter: "opencode".into(),
        profile_id: Some("local-probe".into()),
        directory: fixture.0.join("account"),
        label: "Local protocol fixture".into(),
    };
    std::fs::create_dir_all(&binding.directory).unwrap();
    std::fs::write(binding.directory.join("jackalope-local.json"), r#"{"model":"qwen3.5:4b","digest":"fixture","inferenceDigest":"fixture","elapsedMs":0,"checkedAt":"fixture"}"#).unwrap();
    let config = serde_json::json!({"model":"fixture/model","small_model":"fixture/model","enabled_providers":["fixture"],"share":"disabled","permission":"deny",
        "provider":{"fixture":{"npm":"@ai-sdk/openai-compatible","name":"Fake local provider","options":{"baseURL":format!("http://127.0.0.1:{}/v1",port.trim())},"models":{"model":{"id":"fixture","limit":{"context":8192,"output":512}}}}}});
    let make = |prompt: &str| {
        let mut cmd = command(&executable);
        cmd.current_dir(&fixture.0)
            .args([
                "run",
                "--format",
                "json",
                "--model",
                "fixture/model",
                "--title",
                "Protocol check",
                prompt,
            ])
            .env("OPENCODE_CONFIG_CONTENT", config.to_string())
            .env("OPENCODE_DISABLE_PROJECT_CONFIG", "true")
            .env_remove("OPENCODE_CONFIG")
            .env_remove("OPENCODE_CONFIG_DIR")
            .env("XDG_DATA_HOME", fixture.0.join("data"))
            .env("XDG_CONFIG_HOME", fixture.0.join("config"))
            .env("XDG_STATE_HOME", fixture.0.join("state"))
            .env("XDG_CACHE_HOME", fixture.0.join("cache"));
        cmd
    };
    let pool = Pool::default();
    let mut sessions = Vec::new();
    let mut elapsed = Vec::new();
    let mut endpoint = String::new();
    for (index, prompt) in ["FIRST_REQUEST", "SECOND_REQUEST"].iter().enumerate() {
        let started = std::time::Instant::now();
        let mut cmd = make(prompt);
        let mut lease = pool
            .attach(&mut cmd, &binding, || false)
            .unwrap()
            .expect("local server ready");
        assert_eq!(lease.reused, index == 1);
        let server = lease.entry.server.lock().unwrap();
        endpoint = server.as_ref().unwrap().url.clone();
        drop(server);
        let denied = tauri::async_runtime::block_on(async {
            reqwest::Client::new()
                .get(format!("{endpoint}/global/health"))
                .send()
                .await
        })
        .unwrap();
        assert_eq!(denied.status(), reqwest::StatusCode::UNAUTHORIZED);
        let result =
            crate::commands::process_control::run_cancellable(cmd, Duration::from_secs(40), || {
                false
            })
            .unwrap();
        assert!(
            result.success && !result.truncated,
            "{} {}",
            result.stdout,
            result.stderr
        );
        let saved = lease.output(|| false).unwrap();
        let events: Vec<Value> = saved
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();
        assert!(
            !events.iter().any(|event| event["type"] == "error"),
            "{}",
            result.stdout
        );
        assert!(
            events
                .iter()
                .any(|event| event["type"] == "text"
                    && event["part"]["text"] == "Local helper answer."),
            "stdout: {} stderr: {} saved: {}",
            result.stdout,
            result.stderr,
            saved
        );
        sessions.push(
            events
                .iter()
                .find_map(|event| event["sessionID"].as_str())
                .unwrap()
                .to_owned(),
        );
        elapsed.push(started.elapsed().as_millis());
        lease.complete();
    }
    assert_ne!(sessions[0], sessions[1]);
    let requests: Vec<Value> =
        serde_json::from_slice(&std::fs::read(&requests_path).unwrap()).unwrap();
    assert!(requests
        .iter()
        .any(|value| value["messages"].to_string().contains("SECOND_REQUEST")));
    assert!(requests
        .iter()
        .filter(|value| value["messages"].to_string().contains("SECOND_REQUEST"))
        .all(|value| !value["messages"].to_string().contains("FIRST_REQUEST")));
    let mut cmd = make("WAIT_FOR_CANCEL");
    let lease = pool.attach(&mut cmd, &binding, || false).unwrap().unwrap();
    let started = std::time::Instant::now();
    let result =
        crate::commands::process_control::run_cancellable(cmd, Duration::from_secs(15), || {
            started.elapsed() >= Duration::from_secs(3)
        })
        .unwrap();
    assert!(!result.success);
    drop(lease);
    assert!(pool.entries.lock().unwrap().iter().all(|entry| entry
        .server
        .lock()
        .unwrap()
        .is_none()));
    let response = tauri::async_runtime::block_on(async {
        reqwest::Client::new()
            .get(format!("{endpoint}/global/health"))
            .timeout(Duration::from_secs(1))
            .send()
            .await
    });
    assert!(response.is_err());
    println!(
        "WARM_PROTOCOL {}",
        serde_json::json!({"fixture":true,"realModelInference":false,"coldMs":elapsed[0],"warmMs":elapsed[1],"distinctSessions":true,"cancellationStoppedServer":true})
    );
    let mut cmd = make("FINAL_REQUEST");
    let mut lease = pool.attach(&mut cmd, &binding, || false).unwrap().unwrap();
    assert!(!lease.reused);
    lease.complete();
    drop(lease);
    {
        let entries = pool.entries.lock().unwrap();
        for entry in entries.iter() {
            *entry.used.lock().unwrap() = std::time::Instant::now() - IDLE;
        }
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(4);
    while !pool.entries.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(pool.entries.lock().unwrap().is_empty());
}

fn executable_node() -> PathBuf {
    crate::commands::platform::find_on_path(if cfg!(windows) { "node.exe" } else { "node" })
        .expect("Node.js is installed")
}
