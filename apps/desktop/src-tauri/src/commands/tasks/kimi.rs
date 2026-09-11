use super::*;
use serde_json::json;
use std::io::BufRead;
mod questions;

pub(in crate::commands) fn initialize() -> Value {
    json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"elicitation":{"form":true}},"clientInfo":{"name":"jackalope","version":env!("CARGO_PKG_VERSION")}}})
}

pub(in crate::commands) fn session_request(workspace: &str, session: Option<&str>) -> Value {
    let mut params = json!({"cwd":workspace,"mcpServers":[]});
    if let Some(session) = session {
        params["sessionId"] = json!(session);
    }
    json!({"jsonrpc":"2.0","id":1,"method":if session.is_some() {"session/load"} else {"session/new"},"params":params})
}

fn send(input: &mut impl Write, value: &Value) -> Result<(), String> {
    writeln!(input, "{value}")
        .and_then(|_| input.flush())
        .map_err(|_| "Could not send a request to Kimi.".into())
}

#[cfg(test)]
fn drive(
    output: impl BufRead,
    input: &mut impl Write,
    workspace: &str,
    previous: Option<&str>,
    model: Option<&str>,
    prompt: &str,
    observe: impl FnMut(&Value),
    permission: impl FnMut(&Value) -> Value,
) -> Result<(), String> {
    drive_with_servers(
        output,
        input,
        workspace,
        previous,
        model,
        prompt,
        &[],
        observe,
        permission,
    )
}

fn prompt_request(id: u64, session: &str, prompt: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"session/prompt","params":{"sessionId":session,"prompt":[{"type":"text","text":prompt}]}})
}

fn session_usage(text: &str) -> Option<(u64, u64)> {
    let line = text
        .lines()
        .find_map(|line| line.strip_prefix("Session total: "))?;
    if line == "no LLM calls yet" {
        return Some((0, 0));
    }
    let (input, output) = line.strip_suffix(" output")?.split_once(" input, ")?;
    Some((input.parse().ok()?, output.parse().ok()?))
}

pub(super) fn drive_with_servers(
    output: impl BufRead,
    input: &mut impl Write,
    workspace: &str,
    previous: Option<&str>,
    model: Option<&str>,
    prompt: &str,
    servers: &[Value],
    mut observe: impl FnMut(&Value),
    mut permission: impl FnMut(&Value) -> Value,
) -> Result<(), String> {
    send(input, &initialize())?;
    let mut output = output;
    let mut expected = 0;
    let mut session = previous.map(str::to_string);
    let mut wait_for_commands = false;
    let mut commands_session = None;
    let mut usage_session = None;
    let mut usage_text = String::new();
    let mut usage_baseline: Option<(u64, u64)> = None;
    let mut terminal_result = None;
    loop {
        let mut bytes = Vec::new();
        let size = match (&mut output).take(1_000_001).read_until(b'\n', &mut bytes) {
            Ok(size) => size,
            Err(_) => {
                if let Some(result) = terminal_result {
                    return result;
                }
                return Err("Could not read Kimi's response.".into());
            }
        };
        if size == 0 {
            if let Some(result) = terminal_result {
                return result;
            }
            return Err("Kimi closed before completing the task.".into());
        }
        if size > 1_000_000 {
            if let Some(result) = terminal_result {
                return result;
            }
            return Err("Kimi returned an oversized protocol event.".into());
        }
        let event: Value = match serde_json::from_slice(&bytes) {
            Ok(event) => event,
            Err(_) => {
                if let Some(result) = terminal_result {
                    return result;
                }
                return Err(
                    "Kimi returned an invalid ACP event. Install the current Kimi Code CLI.".into(),
                );
            }
        };
        if let Some(method) = event["method"].as_str() {
            if method == "session/update"
                && event["params"]["update"]["sessionUpdate"] == "available_commands_update"
            {
                commands_session = event["params"]["sessionId"].as_str().map(str::to_string);
                if event["params"]["update"]["availableCommands"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|command| command["name"] == "usage")
                {
                    usage_session = event["params"]["sessionId"].as_str().map(str::to_string);
                }
                if expected == 6 && commands_session.as_deref() == session.as_deref() {
                    expected = if usage_session.as_deref() == session.as_deref() {
                        4
                    } else {
                        3
                    };
                    observe(
                        &json!({"sessionUpdate":"jackalope_usage_probe","active":expected == 4}),
                    );
                    send(
                        input,
                        &prompt_request(
                            expected,
                            session.as_deref().unwrap(),
                            if expected == 4 { "/usage" } else { prompt },
                        ),
                    )?;
                }
            }
            if let Some(id) = event.get("id") {
                if method == "session/request_permission"
                    && expected == 3
                    && event["params"]["sessionId"].as_str() == session.as_deref()
                {
                    let outcome = permission(&event["params"]);
                    let denied = outcome["outcome"] != "selected"
                        || event["params"]["options"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .any(|option| {
                                option["optionId"] == outcome["optionId"]
                                    && option["kind"]
                                        .as_str()
                                        .is_some_and(|kind| kind.starts_with("reject"))
                            });
                    send(
                        input,
                        &json!({"jsonrpc":"2.0","id":id,"result":{"outcome":outcome}}),
                    )?;
                    if denied {
                        return Err("Kimi permission was declined or unanswered. Review the task before continuing.".into());
                    }
                } else if method == "elicitation/create"
                    && expected == 3
                    && event["params"]["sessionId"].as_str() == session.as_deref()
                {
                    if questions::fields(&event["params"]).is_ok() {
                        let response = permission(&event["params"]);
                        send(input, &json!({"jsonrpc":"2.0","id":id,"result":response}))?;
                        if response["action"] != "accept" {
                            return Err("Kimi's question was unanswered. Continue when you are ready to respond.".into());
                        }
                    } else {
                        send(
                            input,
                            &json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":"Unsupported question schema"}}),
                        )?;
                    }
                } else {
                    send(
                        input,
                        &json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Unsupported client request"}}),
                    )?;
                }
            } else if method == "session/update"
                && event["params"]["sessionId"].as_str() == session.as_deref()
            {
                let update = &event["params"]["update"];
                if expected == 3
                    || ([4, 5].contains(&expected) && update["sessionUpdate"] == "usage_update")
                {
                    observe(update);
                } else if [4, 5].contains(&expected)
                    && update["sessionUpdate"] == "agent_message_chunk"
                    && update["content"]["type"] == "text"
                {
                    if let Some(text) = update["content"]["text"].as_str() {
                        usage_text.extend(
                            text.chars()
                                .take(8192usize.saturating_sub(usage_text.chars().count())),
                        );
                    }
                }
            }
            continue;
        }
        if event["id"].as_u64() != Some(expected) {
            continue;
        }
        if event.get("error").is_some() {
            if expected == 4 {
                observe(&json!({"sessionUpdate":"jackalope_usage_probe","active":false}));
                usage_session = None;
                send(
                    input,
                    &prompt_request(3, session.as_deref().unwrap(), prompt),
                )?;
                expected = 3;
                continue;
            }
            if expected == 5 {
                return terminal_result.unwrap();
            }
            observe(
                &json!({"sessionUpdate":"jackalope_error","type":"error","error":event["error"]}),
            );
            return Err(format!("Kimi rejected ACP request {expected}. Check its sign-in, model and CLI version, then retry."));
        }
        let Some(result) = event.get("result").filter(|value| value.is_object()) else {
            if let Some(result) = terminal_result {
                return result;
            }
            return Err("Kimi returned a missing ACP result.".into());
        };
        match expected {
            0 => {
                if result["protocolVersion"] != 1 {
                    return Err("Kimi reported an unsupported ACP version.".into());
                }
                let version = result["agentInfo"]["version"].as_str().unwrap_or("");
                let version: Result<Vec<u64>, _> = version.split('.').map(str::parse).collect();
                // Current Kimi defers its command palette until after the session response.
                wait_for_commands = matches!(version.as_deref(), Ok([major, minor, patch]) if (*major, *minor, *patch) >= (0, 42, 0));
                if previous.is_some() && result["agentCapabilities"]["loadSession"] != true {
                    return Err("This Kimi version cannot resume saved sessions. Update Kimi before continuing.".into());
                }
                for server in servers {
                    if let Some(transport) = server["type"].as_str() {
                        if result["agentCapabilities"]["mcpCapabilities"][transport] != true {
                            return Err(format!("This Kimi version does not support {transport} project connections. Update Kimi or use on-demand discovery."));
                        }
                    }
                }
                let mut request = session_request(workspace, previous);
                request["params"]["mcpServers"] = json!(servers);
                send(input, &request)?;
                expected = 1;
            }
            1 => {
                if previous.is_none() {
                    session = result["sessionId"]
                        .as_str()
                        .filter(|id| {
                            !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
                        })
                        .map(str::to_string);
                }
                let session_id = session
                    .as_deref()
                    .ok_or("Kimi did not return a session ID.")?;
                observe(&json!({"sessionUpdate":"jackalope_session","sessionId":session_id}));
                if model.is_none() {
                    let reported = result["configOptions"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|option| option["id"] == "model")
                        .and_then(|option| option["currentValue"].as_str())
                        .or_else(|| result["models"]["currentModelId"].as_str());
                    if let Some(reported) = reported {
                        observe(
                            &json!({"sessionUpdate":"current_model_update","currentModelId":reported}),
                        );
                    }
                }
                if let Some(model) = model {
                    send(
                        input,
                        &json!({"jsonrpc":"2.0","id":2,"method":"session/set_model","params":{"sessionId":session_id,"modelId":model}}),
                    )?;
                    expected = 2;
                    continue;
                }
                if wait_for_commands && commands_session.as_deref() != Some(session_id) {
                    expected = 6;
                    observe(&json!({"sessionUpdate":"jackalope_usage_probe","active":true}));
                    continue;
                }
                expected = if usage_session.as_deref() == Some(session_id) {
                    4
                } else {
                    3
                };
                if expected == 4 {
                    observe(&json!({"sessionUpdate":"jackalope_usage_probe","active":true}));
                }
                send(
                    input,
                    &prompt_request(
                        expected,
                        session_id,
                        if expected == 4 { "/usage" } else { prompt },
                    ),
                )?;
            }
            2 => {
                let session_id = session.as_deref().unwrap();
                if wait_for_commands && commands_session.as_deref() != Some(session_id) {
                    expected = 6;
                    observe(&json!({"sessionUpdate":"jackalope_usage_probe","active":true}));
                    continue;
                }
                expected = if usage_session.as_deref() == Some(session_id) {
                    4
                } else {
                    3
                };
                if expected == 4 {
                    observe(&json!({"sessionUpdate":"jackalope_usage_probe","active":true}));
                }
                send(
                    input,
                    &prompt_request(
                        expected,
                        session_id,
                        if expected == 4 { "/usage" } else { prompt },
                    ),
                )?;
            }
            3 => {
                let completed = if result["stopReason"] == "end_turn" {
                    Ok(())
                } else {
                    Err("Kimi stopped without completing the turn. Inspect the saved activity and continue if needed.".into())
                };
                if usage_baseline.is_none() {
                    return completed;
                }
                terminal_result = Some(completed);
                observe(
                    &json!({"sessionUpdate":"jackalope_usage_probe","active":true,"afterTurn":true}),
                );
                usage_text.clear();
                if send(
                    input,
                    &prompt_request(5, session.as_deref().unwrap(), "/usage"),
                )
                .is_err()
                {
                    return terminal_result.unwrap();
                }
                expected = 5;
            }
            4 => {
                observe(&json!({"sessionUpdate":"jackalope_usage_probe","active":false}));
                if result["stopReason"] == "end_turn" {
                    usage_baseline = session_usage(&usage_text);
                }
                usage_text.clear();
                send(
                    input,
                    &prompt_request(3, session.as_deref().unwrap(), prompt),
                )?;
                expected = 3;
            }
            5 => {
                if result["stopReason"] == "end_turn" {
                    if let Some(((before_input, before_output), (after_input, after_output))) =
                        usage_baseline.zip(session_usage(&usage_text))
                    {
                        if let Some((input, output)) = after_input
                            .checked_sub(before_input)
                            .zip(after_output.checked_sub(before_output))
                        {
                            observe(
                                &json!({"sessionUpdate":"jackalope_usage","input":input,"output":output}),
                            );
                        }
                    }
                }
                return terminal_result.unwrap();
            }
            _ => unreachable!(),
        }
    }
}

pub(super) fn consume(run: &mut TaskRun, update: &Value) {
    match update["sessionUpdate"].as_str().unwrap_or("") {
        "usage_update" => {
            if let Some((used, size)) = update["used"]
                .as_u64()
                .zip(update["size"].as_u64())
                .filter(|(_, size)| *size > 0)
            {
                activity(run, &format!("Context: {used} of {size} tokens. This is context occupancy, not billed usage."));
            }
        }
        "jackalope_usage" => {
            if let Some((input, output)) = update["input"].as_u64().zip(update["output"].as_u64()) {
                run.usage = Usage {
                    input,
                    output,
                    reported: true,
                    ..Usage::default()
                };
            }
        }
        "jackalope_error" => {
            if let Some(failure) = super::routing::quota_failure(update) {
                run.quota_failure = Some(failure);
            }
        }
        "jackalope_session" => run.session_id = update["sessionId"].as_str().map(str::to_string),
        "agent_message_chunk" => {
            if let Some(text) = update["content"]["text"]
                .as_str()
                .filter(|_| update["content"]["type"] == "text")
            {
                let room = 120_000usize.saturating_sub(run.result.chars().count());
                run.result.extend(text.chars().take(room));
                if text.chars().count() > room {
                    run.error
                        .get_or_insert("Kimi's answer exceeded the result limit.".into());
                }
            }
        }
        "tool_call" | "tool_call_update" => activity(
            run,
            &format!(
                "{}: {}",
                update["title"].as_str().unwrap_or("Tool"),
                update["status"].as_str().unwrap_or("pending")
            ),
        ),
        "current_model_update" => run.model = update["currentModelId"].as_str().map(str::to_string),
        _ => {}
    }
}

pub(super) fn permission(runtime: &TaskRuntime, run_id: &str, params: &Value) -> Value {
    if params["mode"] == "form" {
        return questions::answer(params, |question, options, multiple| {
            wait_for_answer(
                runtime,
                run_id,
                question,
                options,
                if multiple { "multiChoice" } else { "choice" },
            )
        });
    }
    let options: Vec<_> = params["options"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|option| {
            matches!(
                option["kind"].as_str(),
                Some("allow_once" | "reject_once" | "allow_always" | "reject_always")
            )
        })
        .filter_map(|option| {
            Some((
                option["optionId"].as_str()?.to_string(),
                option["name"]
                    .as_str()?
                    .chars()
                    .take(160)
                    .collect::<String>(),
            ))
        })
        .take(8)
        .collect();
    if options.is_empty() {
        return json!({"outcome":"cancelled"});
    }
    let labels: Vec<String> = options
        .iter()
        .enumerate()
        .map(|(index, (_, name))| format!("{}. {name}", index + 1))
        .collect();
    let question = format!(
        "Kimi requests permission: {}\n{}",
        params["toolCall"]["title"]
            .as_str()
            .unwrap_or("Tool action")
            .chars()
            .take(500)
            .collect::<String>(),
        params["toolCall"]["rawInput"]
            .to_string()
            .chars()
            .take(3000)
            .collect::<String>()
    );
    wait_for_answer(runtime, run_id, question, labels.clone(), "choice")
        .and_then(|answer| labels.iter().position(|label| label == &answer))
        .map(|index| json!({"outcome":"selected","optionId":options[index].0}))
        .unwrap_or_else(|| json!({"outcome":"cancelled"}))
}

fn wait_for_answer(
    runtime: &TaskRuntime,
    run_id: &str,
    question: String,
    options: Vec<String>,
    input_type: &str,
) -> Option<String> {
    let prompt = crate::commands::harness::PendingUserPrompt {
        id: uuid::Uuid::new_v4().to_string(),
        run_id: run_id.into(),
        question,
        input_type: input_type.into(),
        options,
        default_value: None,
        status: "pending".into(),
        answer: None,
        created_at: Utc::now().to_rfc3339(),
        answered_at: None,
    };
    runtime.record_prompt(&prompt);
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(600) {
        let inner = runtime.inner.lock().unwrap();
        if inner.canceled.contains(run_id)
            || inner
                .processes
                .get(run_id)
                .is_none_or(|child| child.lock().unwrap().try_wait().ok().flatten().is_some())
        {
            break;
        }
        if let Some(answer) = inner
            .runs
            .get(run_id)
            .and_then(|run| run.prompts.iter().find(|saved| saved.id == prompt.id))
            .and_then(|saved| saved.answer.as_ref())
        {
            return Some(answer.clone());
        }
        drop(inner);
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript(events: &[Value]) -> std::io::Cursor<Vec<u8>> {
        std::io::Cursor::new(
            events
                .iter()
                .map(|event| format!("{event}\n"))
                .collect::<String>()
                .into_bytes(),
        )
    }

    #[test]
    fn kimi_usage_uses_session_deltas_and_never_counts_context_as_consumption() {
        let update = |value: Value| json!({"method":"session/update","params":{"sessionId":"saved","update":value}});
        let message = |text: &str| {
            update(
                json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":text}}),
            )
        };
        let mut run = TaskRun::default();
        let mut sent = Vec::new();
        drive(transcript(&[
            json!({"id":0,"result":{"protocolVersion":1,"agentInfo":{"version":"0.42.0"},"agentCapabilities":{"loadSession":true}}}),
            json!({"id":1,"result":{}}),
            update(json!({"sessionUpdate":"available_commands_update","availableCommands":[{"name":"usage"}]})),
            message("Context: 500 / 10000 tokens (5%)\nSession total: 800 input, 100 output"),
            json!({"id":4,"result":{"stopReason":"end_turn"}}),
            message("New answer"),
            update(json!({"sessionUpdate":"usage_update","used":700,"size":10000})),
            json!({"id":3,"result":{"stopReason":"end_turn"}}),
            message("Context: 700 / 10000 tokens (7%)\nSession total: 1100 input, 140 output"),
            json!({"id":5,"result":{"stopReason":"end_turn"}}),
        ]), &mut sent, "C:/workspace", Some("saved"), None, "Continue", |event| consume(&mut run,event), |_| panic!("Unexpected permission")).unwrap();
        assert_eq!(run.result, "New answer");
        assert_eq!((run.usage.input, run.usage.output), (300, 40));
        assert!(run.usage.reported);
        assert!(run.usage.estimated_cost_usd.is_none());
        assert_eq!(run.activity.len(), 1);
        let requests: Vec<Value> = String::from_utf8(sent)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(
            requests
                .iter()
                .map(|request| request["id"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![0, 1, 4, 3, 5]
        );
        assert_eq!(
            session_usage("Session total: no LLM calls yet"),
            Some((0, 0))
        );
        assert!(session_usage("Context: 4000 / 8000 tokens").is_none());
        assert!(session_usage("Session total: -1 input, 20 output").is_none());
        assert!(session_usage("Session total: NaN input, 20 output").is_none());
    }

    #[test]
    fn kimi_current_cli_without_usage_does_not_send_a_slash_prompt() {
        let mut sent = Vec::new();
        drive(transcript(&[
            json!({"id":0,"result":{"protocolVersion":1,"agentInfo":{"version":"0.42.0"}}}),
            json!({"id":1,"result":{"sessionId":"new"}}),
            json!({"method":"session/update","params":{"sessionId":"new","update":{"sessionUpdate":"available_commands_update","availableCommands":[]}}}),
            json!({"id":3,"result":{"stopReason":"end_turn"}}),
        ]), &mut sent, "C:/workspace", None, None, "Task", |_| {}, |_| panic!("Unexpected permission")).unwrap();
        assert!(!String::from_utf8(sent).unwrap().contains("/usage"));
    }

    #[test]
    fn kimi_optional_usage_failure_preserves_the_completed_turn() {
        for tail in [
            "",
            "not json\n",
            "{\"id\":5}\n",
            "{\"id\":5,\"error\":{}}\n",
        ] {
            let mut data = transcript(&[
                json!({"id":0,"result":{"protocolVersion":1}}),
                json!({"method":"session/update","params":{"sessionId":"new","update":{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"usage"}]}}}),
                json!({"id":1,"result":{"sessionId":"new"}}),
                json!({"method":"session/update","params":{"sessionId":"new","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Session total: no LLM calls yet"}}}}),
                json!({"id":4,"result":{"stopReason":"end_turn"}}),
                json!({"id":3,"result":{"stopReason":"end_turn"}}),
            ]).into_inner();
            data.extend_from_slice(tail.as_bytes());
            drive(
                std::io::Cursor::new(data),
                &mut Vec::new(),
                "C:/workspace",
                None,
                None,
                "Task",
                |_| {},
                |_| panic!("Unexpected permission"),
            )
            .unwrap();
        }
    }

    #[test]
    fn kimi_direct_connections_are_sent_only_after_capability_negotiation() {
        let servers = vec![
            json!({"name":"tools","type":"http","url":"https://example.invalid/mcp","headers":[]}),
        ];
        let mut sent = Vec::new();
        drive_with_servers(transcript(&[
            json!({"id":0,"result":{"protocolVersion":1,"agentCapabilities":{"mcpCapabilities":{"http":true}}}}),
            json!({"id":1,"result":{"sessionId":"new"}}),
            json!({"id":3,"result":{"stopReason":"end_turn"}}),
        ]), &mut sent, "C:/workspace", None, None, "Task", &servers, |_| {}, |_| panic!("Unexpected permission")).unwrap();
        let messages: Vec<Value> = String::from_utf8(sent)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(messages[1]["params"]["mcpServers"], json!(servers));
        assert!(drive_with_servers(
            transcript(&[json!({"id":0,"result":{"protocolVersion":1}})]),
            &mut Vec::new(),
            "C:/workspace",
            None,
            None,
            "Task",
            &servers,
            |_| {},
            |_| panic!("Unexpected permission")
        )
        .is_err());
    }

    #[test]
    fn kimi_resumes_bound_session_without_replaying_history_and_selects_model_before_prompt() {
        let mut run = TaskRun::default();
        let mut sent = Vec::new();
        drive(transcript(&[
            json!({"id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}),
            json!({"method":"session/update","params":{"sessionId":"saved","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"old history"}}}}),
            json!({"id":1,"result":{}}), json!({"id":2,"result":{}}),
            json!({"method":"session/update","params":{"sessionId":"foreign","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"wrong session"}}}}),
            json!({"method":"session/update","params":{"sessionId":"saved","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"New answer 🐇"}}}}),
            json!({"id":3,"result":{"stopReason":"end_turn"}}),
        ]), &mut sent, "C:/workspace", Some("saved"), Some("configured-model"), "Continue", |event| consume(&mut run, event), |_| panic!("Unexpected permission")).unwrap();
        let requests: Vec<Value> = String::from_utf8(sent)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(requests[1]["method"], "session/load");
        assert_eq!(requests[1]["params"]["sessionId"], "saved");
        assert_eq!(requests[2]["method"], "session/set_model");
        assert_eq!(requests[2]["params"]["modelId"], "configured-model");
        assert_eq!(requests[3]["method"], "session/prompt");
        assert_eq!(run.result, "New answer 🐇");
        assert_eq!(run.session_id.as_deref(), Some("saved"));
        assert!(!run.usage.reported);
    }

    #[test]
    fn kimi_requires_completion_and_never_falls_back_after_resume_or_model_failure() {
        for tail in [
            json!({"id":1,"error":{"message":"private provider diagnostic"}}),
            json!({"id":1,"result":{}}),
        ] {
            let mut sent = Vec::new();
            let result = drive(
                transcript(&[
                    json!({"id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}),
                    tail,
                ]),
                &mut sent,
                "C:/workspace",
                Some("saved"),
                Some("model"),
                "Task",
                |_| {},
                |_| json!({"outcome":"cancelled"}),
            );
            assert!(result.is_err());
            assert!(!result.unwrap_err().contains("private provider"));
            assert!(!String::from_utf8(sent).unwrap().contains("session/new"));
        }
        for tail in [
            json!({"id":3,"result":{"stopReason":"cancelled"}}),
            json!({"id":3,"result":{}}),
            json!({"id":3,"error":{}}),
        ] {
            assert!(drive(
                transcript(&[
                    json!({"id":0,"result":{"protocolVersion":1}}),
                    json!({"id":1,"result":{"sessionId":"new"}}),
                    tail
                ]),
                &mut Vec::new(),
                "C:/workspace",
                None,
                None,
                "Task",
                |_| {},
                |_| json!({"outcome":"cancelled"})
            )
            .is_err());
        }
    }

    #[test]
    fn kimi_permissions_are_correlated_and_denial_stops_the_turn() {
        for allowed in [true, false] {
            let mut sent = Vec::new();
            let result = drive(
                transcript(&[
                    json!({"id":0,"result":{"protocolVersion":1}}),
                    json!({"id":1,"result":{"sessionId":"new"}}),
                    json!({"id":"permission-7","method":"session/request_permission","params":{"sessionId":"new","options":[{"optionId":"yes","kind":"allow_once"},{"optionId":"no","kind":"reject_once"}]}}),
                    json!({"id":3,"result":{"stopReason":"end_turn"}}),
                ]),
                &mut sent,
                "C:/workspace",
                None,
                None,
                "Task",
                |_| {},
                |_| json!({"outcome":"selected","optionId":if allowed {"yes"} else {"no"}}),
            );
            assert_eq!(result.is_ok(), allowed);
            let sent = String::from_utf8(sent).unwrap();
            let reply: Value = serde_json::from_str(sent.lines().last().unwrap()).unwrap();
            assert_eq!(reply["id"], "permission-7");
            assert_eq!(
                reply["result"]["outcome"]["optionId"],
                if allowed { "yes" } else { "no" }
            );
        }
    }

    #[test]
    fn kimi_rejects_oversized_and_invalid_events() {
        for data in [vec![b'x'; 1_000_002], b"not json\n".to_vec(), vec![]] {
            assert!(drive(
                std::io::Cursor::new(data),
                &mut Vec::new(),
                "C:/workspace",
                None,
                None,
                "Task",
                |_| {},
                |_| json!({"outcome":"cancelled"})
            )
            .is_err());
        }
    }

    #[test]
    #[cfg(windows)]
    fn kimi_owned_process_permissions_resume_and_stop_preserve_history() {
        use crate::commands::agent_policy::{AgentPolicy, CustomAgent};
        let folder = std::env::temp_dir().join(format!("jackalope-kimi-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let root = folder.to_str().unwrap();
        git(root, &["init", "-b", "master"]).unwrap();
        git(
            root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "Fixture",
            ],
        )
        .unwrap();
        let executable = folder.join("fixture.cmd");
        std::fs::write(&executable, "@echo off\r\nnode \"%~dp0fixture.cjs\"\r\n").unwrap();
        std::fs::write(folder.join("fixture.cjs"), r#"
const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const sessionId = 'kimi-fixture-session';
let waiting = false;
require('readline').createInterface({input:process.stdin}).on('line', line => {
 const r=JSON.parse(line);
 if(r.method==='initialize') send({id:r.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
 else if(r.method==='session/new') send({id:r.id,result:{sessionId}});
 else if(r.method==='session/load') {
   if(r.params.sessionId!==sessionId) process.exit(2);
   send({method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'old history'}}}});
   send({id:r.id,result:{}});
 } else if(r.method==='session/prompt') {
   waiting=r.params.prompt[0].text.startsWith('Wait forever');
   if(!waiting) send({id:'approval',method:'session/request_permission',params:{sessionId,toolCall:{title:'Fixture action',rawInput:{command:'fixture only'}},options:[{optionId:'yes',name:'Allow once',kind:'allow_once'},{optionId:'no',name:'Reject once',kind:'reject_once'}]}});
 } else if(r.id==='approval' && r.result.outcome.optionId==='yes') {
   send({method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Fixture complete'}}}});
   send({id:3,result:{stopReason:'end_turn'}});
 }
});
setInterval(()=>{},1000);
"#).unwrap();
        let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
        let mut policy = AgentPolicy::default();
        policy.custom_agents.push(CustomAgent {
            id: "kimi-fixture".into(),
            name: "Kimi fixture".into(),
            command: executable.to_string_lossy().into(),
            adapter: Some("kimi".into()),
        });
        std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
        std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
        let mut request = RunRequest {
            effort: None,
            dependency_snapshot: Default::default(),
            monitor_change: None,
            context_selection: Default::default(),
            context_receipt: Default::default(),
            id: "kimi-fixture-first".into(),
            project_id: "fixture".into(),
            project_name: "Fixture".into(),
            project_path: root.into(),
            agent: "kimi-fixture".into(),
            agent_profile_id: None,
            verify_command: None,
            prepare_command: None,
            auto_verify: false,
            target_branch: None,
            account_binding: None,
            model: None,
            prompt: "Fixture task".into(),
            isolated: false,
            previous_run_id: None,
            coordination: None,
            connection_ids: None,
        };
        for attempt in 0..3 {
            runtime.start(request.clone()).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(15);
            let completed = loop {
                let run = runtime
                    .integration_runs()
                    .unwrap()
                    .into_iter()
                    .find(|run| run.id == request.id)
                    .unwrap();
                if !["starting", "running", "stopping"].contains(&run.status.as_str()) {
                    break run;
                }
                for prompt in &run.prompts {
                    if prompt.status == "pending" {
                        runtime
                            .respond_prompt(&run.id, &prompt.id, &prompt.options[0])
                            .unwrap();
                    }
                }
                if attempt == 2 && run.session_id.is_some() && run.status == "running" {
                    runtime.stop(&run.id).unwrap();
                }
                if std::time::Instant::now() > deadline {
                    runtime.stop_all();
                    panic!("Kimi fixture timed out: {:?}", run.error);
                }
                std::thread::sleep(Duration::from_millis(25));
            };
            assert_eq!(
                completed.status,
                if attempt == 2 { "stopped" } else { "review" },
                "{:?}",
                completed.error
            );
            assert_eq!(
                completed.session_id.as_deref(),
                Some("kimi-fixture-session")
            );
            if attempt < 2 {
                assert_eq!(completed.result, "Fixture complete");
            }
            assert!(runtime.inner.lock().unwrap().processes.is_empty());
            request.previous_run_id = Some(request.id.clone());
            request.id = format!("kimi-fixture-next-{attempt}");
            if attempt == 1 {
                request.prompt = "Wait forever".into();
            }
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while Arc::strong_count(&runtime._owner) > 1 {
            assert!(
                std::time::Instant::now() < deadline,
                "Kimi fixture worker did not release history ownership after stopping"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(runtime);
        let runtime = TaskRuntime::new(folder.join("history")).unwrap();
        assert_eq!(runtime.integration_runs().unwrap().len(), 3);
        drop(runtime);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
