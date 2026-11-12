//! The canary for secrets Jackalope gives an agent. A distinctive value is
//! planted the way an attempt plants a project secret and a managed key, each
//! adapter's event lines echo it in every shape an agent prints (as written,
//! inside JSON, base64, URL-encoded, split across streamed chunks), and no form
//! of it may appear wherever the attempt's record is kept or shown: history on
//! disk, a recovery export, what the app displays, and history read back after
//! a restart.
//!
//! A search that looks in the wrong place finds nothing, and nothing looks like
//! a pass. So a control value, echoed in the same lines but never given to the
//! agent, must be found in each of those places, or the test fails as blind.

use super::*;
use base64::Engine as _;

/// A project secret, with a quote, a backslash and non-ASCII text, which JSON
/// escapes and so hides from a search of serialized text.
const CANARY: &str = "jl-canary-\"7f3a\"\\9c-пароль-0d1e5b";
/// Echoed beside the canary but never given to the agent.
const CONTROL: &str = "jl-control-\"7f3a\"\\9c-пароль-0d1e5b";
/// A managed account's key, given to the agent by its account binding.
const MANAGED: &str = "sk-managed-canary-5b2c9e81d4a7";
const SECRET_NAME: &str = "HIGGSFIELD_ACCOUNT";

fn json_escaped(value: &str) -> String {
    let quoted = serde_json::to_string(value).unwrap();
    quoted[1..quoted.len() - 1].to_string()
}

fn base64(value: &str) -> String {
    base64::engine::general_purpose::STANDARD
        .encode(value)
        .trim_end_matches('=')
        .to_string()
}

fn url(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// Every form of `value` this scan looks for, including each form as it is
/// written inside a serialized JSON string.
fn needles(value: &str) -> Vec<String> {
    let ascii: String = json_escaped(value)
        .chars()
        .map(|c| {
            if c.is_ascii() {
                c.to_string()
            } else {
                c.encode_utf16(&mut [0; 2])
                    .iter()
                    .map(|unit| format!("\\u{unit:04x}"))
                    .collect()
            }
        })
        .collect();
    let forms = [
        value.to_string(),
        json_escaped(value),
        ascii,
        base64(value),
        url(value),
    ];
    forms
        .iter()
        .flat_map(|form| [form.clone(), json_escaped(form)])
        .collect()
}

/// What an agent prints about `value`: the value, a JSON file holding it, and
/// its base64 and URL encodings.
fn shapes(value: &str) -> String {
    format!(
        "value {value} | file {} | base64 {} | url {}",
        serde_json::json!({ "key": value }),
        base64(value),
        url(value)
    )
}

fn echo() -> String {
    format!(
        "{} || {} || managed {MANAGED}",
        shapes(CANARY),
        shapes(CONTROL)
    )
}

/// Each adapter's event lines, echoing the canary through every part of its
/// protocol Jackalope reads.
fn lines(adapter: &str) -> Vec<String> {
    use serde_json::json;
    let text = echo();
    match adapter {
        "codex" => vec![
            json!({"type": "thread.started", "thread_id": "thread-canary"}),
            json!({"type": "item.started", "item": {"type": "command_execution", "command": format!("printenv {SECRET_NAME} # {text}")}}),
            json!({"type": "item.completed", "item": {"type": "agent_message", "text": text}}),
            json!({"type": "turn.failed", "error": {"message": text}}),
        ],
        "claude" => vec![
            json!({"type": "assistant", "session_id": "session-canary", "message": {
                "id": "message-canary", "model": "claude-canary", "role": "assistant",
                "content": [
                    {"type": "text", "text": text},
                    {"type": "tool_use", "id": "tool-canary", "name": "Bash", "input": {"command": format!("echo {text}"), "type": text}},
                ],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            }}),
            json!({"type": "user", "message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "tool-canary", "content": text, "is_error": true},
            ]}}),
            json!({"type": "result", "subtype": "error_during_execution", "is_error": true, "result": text}),
        ],
        "opencode" => vec![
            json!({"type": "text", "sessionID": "ses_canary", "part": {"text": text}}),
            json!({"type": "tool_use", "sessionID": "ses_canary", "part": {"tool": "bash", "state": {"status": "completed", "input": {"command": text}}}}),
        ],
        _ => unreachable!(),
    }
    .into_iter()
    .map(|line| line.to_string())
    .chain([format!("not an event: {text}")])
    .collect()
}

/// Plants the canary on `id` exactly as an attempt plants what it gives its agent.
fn plant(runtime: &TaskRuntime, id: &str) {
    let mut cmd = super::command("fixture");
    cmd.env(SECRET_NAME, CANARY)
        .env("OPENAI_API_KEY", MANAGED)
        .env("CODEX_HOME", "/profiles/codex");
    let protected = crate::commands::redaction::injected_into(&cmd, &[SECRET_NAME.to_string()]);
    runtime
        .update_checked(id, |run| run.protect(protected))
        .unwrap();
}

/// Everything else the record keeps of an attempt: what the agent wrote to
/// stderr, asked through the bridge and is still streaming, and an ACP agent's
/// answer, arriving in chunks that split the canary.
fn drive_record(runtime: &TaskRuntime, id: &str) {
    let text = echo();
    runtime
        .update_output(id, |run| run.diagnostics.push(format!("warning: {text}")))
        .unwrap();
    let prompt: crate::commands::harness::PendingUserPrompt =
        serde_json::from_value(serde_json::json!({
            "id": "prompt-canary", "runId": id, "question": text, "options": [text.clone()],
            "status": "pending", "answer": null, "createdAt": "2026-01-01T00:00:00Z",
            "answeredAt": null,
        }))
        .unwrap();
    runtime
        .update_checked(id, |run| run.prompts.push(prompt))
        .unwrap();
    let split = text.find("canary-").unwrap() + 9;
    for chunk in [&text[..split], &text[split..]] {
        runtime
            .update_output(id, |run| {
                kimi::consume(
                    run,
                    &serde_json::json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": chunk}}),
                )
            })
            .unwrap();
    }
    let streaming = format!("{} {}", shapes(CONTROL), &CANARY[..16]);
    runtime
        .update_output(id, |run| run.streaming = streaming)
        .unwrap();
}

/// Fails when any form of a planted value is in `haystack`, and as blind when
/// the control is not.
fn assert_clean(place: &str, haystack: &str) {
    for value in [CANARY, MANAGED] {
        for needle in needles(value) {
            assert!(
                !haystack.contains(&needle),
                "a planted value was found in {place} as {needle:?}"
            );
        }
    }
    for needle in [json_escaped(CONTROL), base64(CONTROL), url(CONTROL)] {
        assert!(
            haystack.contains(&needle),
            "blind: the control was not found in {place} as {needle:?}"
        );
    }
    assert!(
        haystack.contains("[redacted]"),
        "{place} shows no redaction"
    );
}

fn files(directory: &std::path::Path) -> String {
    let mut text = String::new();
    for entry in std::fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        // The runtime's ownership lock holds no record, and Windows refuses to
        // read a file another handle has locked.
        if path.is_file()
            && path.file_name() != Some(crate::cli_protocol::profile::RUNTIME_LOCK.as_ref())
        {
            text.push_str(&String::from_utf8_lossy(&std::fs::read(&path).unwrap()));
        }
    }
    text
}

#[test]
fn planted_secrets_never_reach_what_an_attempt_records_or_shows() {
    let root = std::env::temp_dir().join(format!("jackalope-canary-{}", uuid::Uuid::new_v4()));
    let history = root.join("history");
    let runtime = TaskRuntime::new(history.clone()).unwrap();
    let mut ids = Vec::new();
    for adapter in ["codex", "claude", "opencode"] {
        let mut run = tests::sample(adapter);
        run.id = format!("canary-{adapter}");
        runtime.save(&run).unwrap();
        runtime
            .inner
            .lock()
            .unwrap()
            .runs
            .insert(run.id.clone(), run.clone());
        plant(&runtime, &run.id);
        for line in lines(adapter) {
            runtime
                .update_output(&run.id, |run| consume_adapter_event(run, &line, adapter))
                .unwrap();
        }
        drive_record(&runtime, &run.id);
        ids.push((adapter, run.id));
    }

    for (adapter, id) in &ids {
        let shown = runtime.run_snapshot(id).unwrap();
        assert_clean(
            &format!("the {adapter} attempt as shown"),
            &format!(
                "{}{}",
                serde_json::to_string(&shown).unwrap(),
                shown.streaming
            ),
        );
        assert!(
            !shown.streaming.contains(&CANARY[..16]),
            "{}",
            shown.streaming
        );
        // Identifiers and the model are kept as the agent's CLI reported them.
        let session = match *adapter {
            "codex" => "thread-canary",
            "claude" => "session-canary",
            _ => "ses_canary",
        };
        assert_eq!(shown.session_id.as_deref(), Some(session));
        if *adapter == "claude" {
            assert_eq!(shown.model.as_deref(), Some("claude-canary"));
        }
        assert_eq!(shown.prompts[0].id, "prompt-canary");
        assert_eq!(shown.prompts[0].status, "pending");

        let export = root.join(format!("{id}-recovery.json"));
        runtime.export_recovery(id, &export).unwrap();
        assert_clean(
            &format!("the {adapter} recovery export"),
            &std::fs::read_to_string(&export).unwrap(),
        );
    }

    // Mid-attempt history, journal included, and again once the attempt's
    // record is checkpointed as completion does.
    runtime.ensure_history_saved().unwrap();
    assert_clean("history on disk", &files(&history));
    for (_, id) in &ids {
        runtime
            .update_checked(id, |run| run.status = RunStatus::Review)
            .unwrap();
    }
    runtime.ensure_history_saved().unwrap();
    assert_clean("checkpointed history on disk", &files(&history));
    drop(runtime);

    let restored = TaskRuntime::new(history.clone()).unwrap();
    for (adapter, id) in &ids {
        let run = restored.run_snapshot(id).unwrap();
        assert!(run.secrets.is_none());
        assert_clean(
            &format!("the {adapter} attempt after a restart"),
            &serde_json::to_string(&run).unwrap(),
        );
    }
    drop(restored);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn the_canary_scan_sees_an_unredacted_record() {
    // The same lines without the planting: every planted form must be found,
    // so a clean result above means the redaction worked, not that the scan
    // missed.
    let mut run = tests::sample("claude");
    for line in lines("claude") {
        consume_adapter_event(&mut run, &line, "claude");
    }
    let saved = serde_json::to_string(&run).unwrap();
    for value in [CANARY, MANAGED] {
        assert!(saved.contains(&json_escaped(value)), "{value}");
    }
    assert!(saved.contains(&base64(CANARY)) && saved.contains(&url(CANARY)));
}
