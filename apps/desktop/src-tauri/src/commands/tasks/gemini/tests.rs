use super::super::tests::sample;
use super::*;

const GEMINI_INIT: &str = r#"{"type":"init","session_id":"session-1"}"#;
const GEMINI_DONE: &str = r#"{"type":"message","role":"assistant","content":"Done"}"#;
const GEMINI_SUCCESS: &str = r#"{"type":"result","status":"success"}"#;

#[test]
fn native_gemini_fixture_checks_edits_resume_stop_and_history() {
    let fixture =
        std::env::temp_dir().join(format!("jackalope-gemini-fixture-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&fixture).unwrap();
    std::fs::write(fixture.join("agent.cjs"), r#"
const assert = require('node:assert/strict');
const fs = require('node:fs');
const args = process.argv.slice(2);
assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
assert.equal(args[args.indexOf('--approval-mode') + 1], 'auto_edit');
assert.equal(process.env.NO_BROWSER, 'true');
assert.ok(!args.includes('--yolo'));
const session = 'ef2d7491-adca-4681-8d75-adba30777920';
const emit = event => console.log(JSON.stringify(event));
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  assert.ok(input.startsWith('Jackalope task context:'));
  emit({type:'init', session_id:session, model:'fixture-model'});
  if (input.includes('breadth-first')) {
    setInterval(() => {}, 1000);
    return;
  }
  let text;
  if (args.includes('--resume')) {
    assert.equal(args[args.indexOf('--resume') + 1], session);
    assert.equal(fs.readFileSync('receipt.txt', 'utf8'), 'JACKALOPE_NATIVE_OK');
    text = fs.readFileSync('.fixture-session', 'utf8');
  } else {
    emit({type:'message',role:'assistant',content:'I will create the receipt.'});
    emit({type:'tool_use',tool_id:'write-1',tool_name:'write_file',parameters:{file_path:require('node:path').resolve('receipt.txt')}});
    fs.writeFileSync('receipt.txt', 'JACKALOPE_NATIVE_OK');
    fs.writeFileSync('.fixture-session', 'copper-rabbit-731');
    emit({type:'tool_result',tool_id:'write-1',status:'success'});
    console.error('Transient RESOURCE_EXHAUSTED; provider recovered.');
    text = 'Receipt created.';
  }
  emit({type:'message',role:'assistant',content:text});
  emit({type:'result',status:'success',stats:{input_tokens:80,output_tokens:10,cached:20}});
});
"#).unwrap();
    let executable = fixture.join(if cfg!(windows) { "agent.cmd" } else { "agent" });
    #[cfg(windows)]
    std::fs::write(&executable, "@echo off\r\nnode \"%~dp0agent.cjs\" %*\r\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(
            &executable,
            "#!/bin/sh\nexec node \"$(dirname \"$0\")/agent.cjs\" \"$@\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let root = super::super::tests::agent_lifecycle_trial("gemini", Some(&executable));
    assert_eq!(
        root.parent().unwrap().canonicalize().unwrap(),
        std::env::temp_dir().canonicalize().unwrap()
    );
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(
        fixture.parent().unwrap().canonicalize().unwrap(),
        std::env::temp_dir().canonicalize().unwrap()
    );
    std::fs::remove_dir_all(fixture).unwrap();
}

#[test]
fn continuation_rejects_a_different_session() {
    let mut run = sample("gemini");
    run.session_id = Some("saved-session".into());
    let mut stream = Stream::new(run.session_id.clone());
    stream.consume(&mut run, GEMINI_INIT);
    stream.consume(&mut run, GEMINI_DONE);
    stream.consume(&mut run, GEMINI_SUCCESS);
    assert!(run.error.as_deref().unwrap().contains("did not resume"));
    assert_eq!(run.session_id.as_deref(), Some("saved-session"));
    assert!(run.result.is_empty());
}

#[test]
fn authentication_failures_before_initialization_keep_the_provider_error() {
    let mut run = sample("gemini");
    let mut stream = Stream::default();
    stream.consume(&mut run, r#"{"type":"result","status":"error","error":{"type":"FatalAuthenticationError","message":"Please sign in"}}"#);
    stream.finish(&mut run);
    assert_eq!(
        run.error.as_deref(),
        Some("Gemini CLI error: Please sign in")
    );
    assert!(run.session_id.is_none());
    assert!(!run.usage.reported);

    let mut run = sample("gemini");
    run.error = Some(MALFORMED.into());
    diagnostic(
        &mut run,
        "Error authenticating: FatalCancellationError: Authentication cancelled by user.",
    );
    assert_eq!(run.error.as_deref(), Some(AUTHENTICATION));
    assert!(run.quota_failure.is_none());
}

#[test]
fn tools_cannot_promote_prior_narration_to_a_final_result() {
    for final_text in [None, Some("Verified the change.")] {
        let mut run = sample("gemini");
        let mut stream = Stream::default();
        for event in [
            GEMINI_INIT,
            r#"{"type":"message","role":"assistant","content":"I will inspect the file next."}"#,
            r#"{"type":"tool_use","tool_id":"read-1","tool_name":"read_file","parameters":{"file_path":"src/a.ts"}}"#,
            r#"{"type":"tool_result","tool_id":"read-1","status":"success"}"#,
        ] {
            stream.consume(&mut run, event);
        }
        assert!(run.result.is_empty());
        if let Some(text) = final_text {
            stream.consume(
                &mut run,
                &serde_json::json!({
                    "type": "message", "role": "assistant", "content": text
                })
                .to_string(),
            );
        }
        stream.consume(&mut run, GEMINI_SUCCESS);
        stream.finish(&mut run);
        assert_eq!(run.error.is_none(), final_text.is_some());
        assert_eq!(run.result, final_text.unwrap_or_default());
        assert!(run
            .activity
            .iter()
            .any(|line| line.contains("I will inspect")));
    }
}

#[test]
fn recoverable_quota_warnings_do_not_trigger_account_handoff() {
    let mut run = sample("gemini");
    let mut stream = Stream::default();
    stream.consume(&mut run, GEMINI_INIT);
    stream.consume(&mut run, r#"{"type":"error","severity":"warning","message":"RESOURCE_EXHAUSTED; switching to the fallback model"}"#);
    stream.consume(&mut run, GEMINI_DONE);
    stream.consume(&mut run, GEMINI_SUCCESS);
    stream.finish(&mut run);
    assert!(run.quota_failure.is_none());
    assert!(run.error.is_none());
}

fn gemini_args(session: Option<&str>) -> Vec<String> {
    let mut cmd = Command::new("gemini");
    gemini::configure(&mut cmd, session);
    cmd.get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn gemini_launches_headless_stream_json_with_edit_approval_and_exact_resume() {
    assert_eq!(
        gemini_args(None).join(" "),
        "--output-format stream-json --approval-mode auto_edit"
    );
    let resumed = gemini_args(Some("0b6f7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"));
    assert!(resumed
        .windows(2)
        .any(|pair| pair == ["--resume", "0b6f7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"]));
    for forbidden in ["yolo", "--yolo", "latest", "--prompt-interactive", "-i"] {
        assert!(!resumed.iter().any(|arg| arg == forbidden), "{forbidden}");
    }
    assert_eq!(
        crate::commands::agent_profiles::env_var_for("gemini"),
        Some("GEMINI_CLI_HOME")
    );
}

#[test]
fn gemini_stream_records_session_text_tools_and_reported_usage() {
    let mut run = sample("gemini");
    let mut stream = gemini::Stream::default();
    for line in [
        r#"{"type":"init","timestamp":"t","session_id":"session-1","model":"gemini-2.5-pro"}"#,
        r#"{"type":"message","timestamp":"t","role":"user","content":"ignored prompt"}"#,
        r#"{"type":"message","timestamp":"t","role":"assistant","content":"Looking","delta":true}"#,
        r#"{"type":"message","timestamp":"t","role":"assistant","content":" around.","delta":true}"#,
        r#"{"type":"tool_use","timestamp":"t","tool_name":"write_file","tool_id":"call-1","parameters":{"file_path":"src/a.ts","content":"x"}}"#,
        r#"{"type":"tool_result","timestamp":"t","tool_id":"call-1","status":"success","output":"ok"}"#,
        r#"{"type":"message","timestamp":"t","role":"assistant","content":"Done."}"#,
        r#"{"type":"error","timestamp":"t","severity":"warning","message":"Loop detection paused"}"#,
        r#"{"type":"result","timestamp":"t","status":"success","stats":{"total_tokens":130,"input_tokens":100,"output_tokens":30,"cached":40,"input":60,"duration_ms":5,"tool_calls":1}}"#,
    ] {
        stream.consume(&mut run, line);
    }
    stream.finish(&mut run);
    assert!(run.error.is_none(), "{:?}", run.error);
    assert_eq!(run.session_id.as_deref(), Some("session-1"));
    assert_eq!(run.model.as_deref(), Some("gemini-2.5-pro"));
    assert_eq!(run.result, "Done.");
    assert!(run.activity.contains(&"Looking around.".into()));
    assert!(run.activity.contains(&"Writing src/a.ts".into()));
    assert!(!run.activity.concat().contains("ignored prompt"));
    assert_eq!(run.efficiency.tool_calls["write_file"], 1);
    assert!(run.usage.reported);
    assert_eq!(
        (run.usage.input, run.usage.output, run.usage.cache_read),
        (100, 30, 40)
    );
}

#[test]
fn gemini_keeps_missing_empty_and_resumed_usage_unknown() {
    for (resumed, stats) in [
        (false, r#""#),
        (false, r#","stats":{"duration_ms":5}"#),
        (false, r#","stats":{"input_tokens":0,"output_tokens":0}"#),
        (true, r#","stats":{"input_tokens":9,"output_tokens":3}"#),
    ] {
        let mut run = sample("gemini");
        let mut stream = gemini::Stream::new(resumed.then(|| "session-1".to_string()));
        stream.consume(&mut run, GEMINI_INIT);
        stream.consume(&mut run, GEMINI_DONE);
        let result = format!(r#"{{"type":"result","status":"success"{stats}}}"#);
        stream.consume(&mut run, &result);
        stream.finish(&mut run);
        assert!(run.error.is_none(), "{:?}", run.error);
        assert!(!run.usage.reported, "{stats}");
        assert_eq!((run.usage.input, run.usage.output), (0, 0));
    }
}

#[test]
fn gemini_rejects_incomplete_malformed_and_failed_streams() {
    for tail in [
        "",
        "not-json",
        r#"{"session_id":"session-1"}"#,
        r#"{"type":"result","status":"success"}"#,
        r#"{"type":"error","severity":"error","message":"Maximum session turns exceeded"}"#,
        r#"{"type":"result","status":"error","error":{"type":"FatalAuthenticationError","message":"Please sign in"}}"#,
    ] {
        let mut run = sample("gemini");
        let mut stream = gemini::Stream::default();
        stream.consume(&mut run, GEMINI_INIT);
        stream.consume(&mut run, tail);
        stream.finish(&mut run);
        assert!(run.error.is_some(), "Accepted {tail}");
    }
    for init in [
        r#"{"type":"init","session_id":"../escape","model":"m"}"#,
        r#"{"type":"message","role":"assistant","content":"before init"}"#,
    ] {
        let mut run = sample("gemini");
        let mut stream = gemini::Stream::default();
        stream.consume(&mut run, init);
        assert!(run.error.is_some(), "Accepted {init}");
        assert!(run.session_id.is_none());
    }
    let mut run = sample("gemini");
    let mut stream = gemini::Stream::default();
    stream.consume(&mut run, GEMINI_INIT);
    stream.consume(&mut run, GEMINI_DONE);
    stream.consume(&mut run, GEMINI_SUCCESS);
    assert!(run.error.is_none(), "{:?}", run.error);
    stream.consume(&mut run, GEMINI_SUCCESS);
    assert!(run.error.unwrap().contains("outside an active stream"));
}

#[test]
fn gemini_surfaces_permission_denials_and_terminal_quota_errors() {
    let mut run = sample("gemini");
    let mut stream = gemini::Stream::default();
    stream.consume(&mut run, GEMINI_INIT);
    stream.consume(&mut run, r#"{"type":"tool_result","tool_id":"c","status":"error","error":{"type":"execution_denied","message":"Tool execution denied by policy."}}"#);
    stream.consume(&mut run, GEMINI_DONE);
    stream.consume(&mut run, GEMINI_SUCCESS);
    assert!(run.error.unwrap().contains("required permission"));

    let mut run = sample("gemini");
    let mut stream = gemini::Stream::default();
    stream.consume(&mut run, GEMINI_INIT);
    stream.consume(&mut run, r#"{"type":"result","status":"error","error":{"type":"TerminalQuotaError","message":"You have exhausted your capacity on this model. RESOURCE_EXHAUSTED"}}"#);
    assert!(run.quota_failure.is_some());
    assert!(run.error.is_some());

    let mut run = sample("gemini");
    gemini::diagnostic(&mut run, "Retrying with backoff: quota exceeded");
    assert!(run.quota_failure.is_none() && run.error.is_none());
    gemini::diagnostic(&mut run, "Loaded cached credentials.");
    assert!(run.error.is_none());
    gemini::diagnostic(&mut run, "API Error: Quota exceeded for requests per day");
    assert!(run.quota_failure.is_some());
    assert!(run.error.as_deref().unwrap().contains("quota"));
    let mut run = sample("gemini");
    gemini::diagnostic(&mut run, "Error: permission denied for run_shell_command");
    assert!(run.error.unwrap().contains("required permission"));
}
