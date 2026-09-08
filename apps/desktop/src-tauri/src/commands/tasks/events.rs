use super::*;

pub(super) fn activity(run: &mut TaskRun, text: &str) {
    if text.trim().is_empty() {
        return;
    }
    let bounded: String = text.chars().take(6000).collect();
    run.activity.push(bounded);
    if run.activity.len() > 150 {
        run.activity.remove(0);
    }
}

pub(super) fn num(value: &Value, key: &str) -> u64 {
    value[key].as_u64().unwrap_or(0)
}

#[cfg(test)]
pub(super) fn consume_event(run: &mut TaskRun, line: &str) {
    let adapter = run.agent.clone();
    consume_adapter_event(run, line, &adapter);
}

pub(super) fn consume_adapter_event(run: &mut TaskRun, line: &str, adapter: &str) {
    let Ok(event) = serde_json::from_str::<Value>(line) else {
        activity(run, line);
        return;
    };
    let kind = event["type"].as_str().unwrap_or("");
    if let Some(failure) = super::routing::quota_failure(&event) {
        run.quota_failure = Some(failure);
    }
    if adapter == "opencode" {
        consume_opencode_event(run, &event, kind);
        return;
    }
    let child = event["parent_tool_use_id"].as_str();
    if adapter == "claude" && event["type"] == "assistant" {
        let message = &event["message"];
        let usage = &message["usage"];
        if let Some(id) = message["id"].as_str().filter(|id| id.len() <= 200) {
            if usage["input_tokens"].is_u64() && usage["output_tokens"].is_u64() {
                let observation = UsageObservation {
                    message_id: id.to_string(),
                    parent_tool_use_id: child.map(str::to_string),
                    model: message["model"].as_str().map(str::to_string),
                    input: num(usage, "input_tokens")
                        .saturating_add(num(usage, "cache_read_input_tokens"))
                        .saturating_add(num(usage, "cache_creation_input_tokens")),
                    output: num(usage, "output_tokens"),
                };
                if let Some(old) = run
                    .usage_observations
                    .iter_mut()
                    .find(|o| o.message_id == id)
                {
                    *old = observation;
                } else if run.usage_observations.len() < 2000 {
                    run.usage_observations.push(observation);
                }
            }
        }
    }
    if child.is_some() {
        return;
    }

    if let Some(id) = event["thread_id"].as_str().or(event["session_id"].as_str()) {
        run.session_id = Some(id.into());
    }
    if let Some(model) = event["model"]
        .as_str()
        .or(event["message"]["model"].as_str())
    {
        run.model = Some(model.into());
    }
    match (adapter, kind) {
        ("codex", "item.completed") => {
            let item = &event["item"];
            if item["type"] == "agent_message" {
                run.result = item["text"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(120_000)
                    .collect();
            } else if let Some(command) = item["command"].as_str() {
                activity(
                    run,
                    &format!(
                        "{}\nExit: {}\n{}",
                        command,
                        item["exit_code"],
                        item["aggregated_output"].as_str().unwrap_or("")
                    ),
                );
            } else {
                activity(
                    run,
                    &format!(
                        "{}: {}",
                        item["type"].as_str().unwrap_or("Activity"),
                        item["text"].as_str().unwrap_or("")
                    ),
                );
            }
        }
        ("codex", "turn.completed") => {
            let u = &event["usage"];
            if u["input_tokens"].is_u64() && u["output_tokens"].is_u64() {
                run.usage = Usage {
                    input: num(u, "input_tokens"),
                    output: num(u, "output_tokens"),
                    cache_read: num(u, "cached_input_tokens"),
                    reported: true,
                    ..Usage::default()
                };
            }
        }
        (_, "error" | "turn.failed") => {
            run.error = Some(
                event["message"]
                    .as_str()
                    .or(event["error"]["message"].as_str())
                    .unwrap_or("Agent reported an error")
                    .into(),
            );
        }
        ("claude" | "grok", "assistant") => {
            if let Some(content) = event["message"]["content"].as_array() {
                for block in content {
                    if let Some(text) = block["text"].as_str() {
                        activity(run, text);
                    }
                    if let Some(name) = block["name"].as_str() {
                        activity(run, &format!("Using {name}"));
                    }
                }
            }
        }
        ("claude" | "grok", "result") => {
            run.result = event["result"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(120_000)
                .collect();
            if event["is_error"] == true {
                run.error = Some(event["errors"].to_string());
            }
            let u = &event["usage"];
            if u["input_tokens"].is_u64() && u["output_tokens"].is_u64() {
                let read = num(u, "cache_read_input_tokens");
                let write = num(u, "cache_creation_input_tokens");
                run.usage = Usage {
                    input: num(u, "input_tokens") + read + write,
                    output: num(u, "output_tokens"),
                    cache_read: read,
                    cache_write: write,
                    reported: true,
                    estimated_cost_usd: event["total_cost_usd"].as_f64(),
                };
            }
            if let Some(denials) = event["permission_denials"]
                .as_array()
                .filter(|v| !v.is_empty())
            {
                activity(run, &format!("{} tool request(s) were denied by the agent's permission policy. Review the result before continuing.", denials.len()));
            }
        }
        _ => {}
    }
}

fn consume_opencode_event(run: &mut TaskRun, event: &Value, kind: &str) {
    if let Some(session) = event["sessionID"].as_str().filter(|id| id.len() <= 200) {
        run.session_id = Some(session.into());
    }
    let part = &event["part"];
    match kind {
        "step_start" => run.result.clear(),
        "text" => {
            if let Some(text) = part["text"].as_str() {
                activity(run, text);
                let room = 120_000usize.saturating_sub(run.result.chars().count());
                run.result.extend(text.chars().take(room));
            }
        }
        "tool_use" => {
            let tool = part["tool"].as_str().unwrap_or("tool");
            let status = part["state"]["status"].as_str().unwrap_or("running");
            activity(run, &format!("{tool}: {status}"));
        }
        "step_finish" => {
            let tokens = &part["tokens"];
            let Some(id) = part["id"].as_str().filter(|id| id.len() <= 200) else {
                return;
            };
            if !tokens["input"].is_u64()
                || !tokens["output"].is_u64()
                || run.usage_observations.iter().any(|o| o.message_id == id)
                || run.usage_observations.len() >= 2000
            {
                return;
            }
            let read = num(&tokens["cache"], "read");
            let write = num(&tokens["cache"], "write");
            let input = num(tokens, "input")
                .saturating_add(read)
                .saturating_add(write);
            let output = num(tokens, "output");
            run.usage_observations.push(UsageObservation {
                message_id: id.into(),
                parent_tool_use_id: None,
                model: run.model.clone(),
                input,
                output,
            });
            run.usage.input = run.usage.input.saturating_add(input);
            run.usage.output = run.usage.output.saturating_add(output);
            run.usage.cache_read = run.usage.cache_read.saturating_add(read);
            run.usage.cache_write = run.usage.cache_write.saturating_add(write);
            run.usage.reported = true;
            if let Some(cost) = part["cost"].as_f64().filter(|n| n.is_finite() && *n >= 0.0) {
                run.usage.estimated_cost_usd =
                    Some(run.usage.estimated_cost_usd.unwrap_or(0.0) + cost);
            }
        }
        "error" => {
            run.error = Some(
                event["error"]["data"]["message"]
                    .as_str()
                    .or(event["error"]["message"].as_str())
                    .or(event["error"]["name"].as_str())
                    .unwrap_or("OpenCode reported an error")
                    .chars()
                    .take(6000)
                    .collect(),
            );
        }
        _ => {}
    }
}
