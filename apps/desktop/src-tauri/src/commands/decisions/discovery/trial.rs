use super::*;
use crate::commands::mcp_broker;
use std::{path::PathBuf, time::Instant};

#[tokio::test]
#[ignore = "Live Jev experiment: requires JACKALOPE_JEV_TEST_KEY and JACKALOPE_JEV_SPEC; makes billable calls"]
async fn installed_discovery_trial() {
    let key = std::env::var("JACKALOPE_JEV_TEST_KEY").expect("Temporary Jev key required");
    let path = PathBuf::from(std::env::var("JACKALOPE_JEV_SPEC").unwrap());
    let suite: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let cases = suite["cases"].as_array().unwrap();
    let repeat = suite["repeat"].as_u64().unwrap().clamp(1, 10);
    let mut trials = vec![];
    for repetition in 1..=repeat {
        for case in cases {
            let query = case["query"].as_str().unwrap();
            let task = case["task"].as_str().unwrap();
            let source = case["tools"].as_array().unwrap();
            assert!(source.len() > 5 && source.len() <= 32);
            let terms = mcp_broker::words(query);
            let started = Instant::now();
            let mut candidates: Vec<_> = source.iter().map(|item| {
                let tool: rmcp::model::Tool = serde_json::from_value(json!({"name":item["name"],"description":item["description"],"inputSchema":{"type":"object"}})).unwrap();
                (mcp_broker::rank(&terms, "fixture", &tool), item.clone())
            }).collect();
            candidates.sort_by(|a, b| {
                b.0.cmp(&a.0)
                    .then(a.1["name"].as_str().cmp(&b.1["name"].as_str()))
            });
            let local: Vec<_> = candidates
                .iter()
                .filter(|(score, _)| *score > 0)
                .take(5)
                .map(|(_, item)| item["name"].clone())
                .collect();
            let local_micros = started.elapsed().as_micros();
            let items: Vec<_> = candidates.iter().map(|(_, item)| item.clone()).collect();
            let payload = super::payload(task, query, &items);
            let started = Instant::now();
            let response = jev::evaluate(&key, &payload, || false).await;
            let elapsed = started.elapsed().as_millis();
            let checked = response
                .as_ref()
                .map_err(Clone::clone)
                .and_then(|r| evaluation::validate(&payload, r));
            let flags = checked
                .as_ref()
                .map(|answers| priorities(answers, items.len()))
                .unwrap_or_else(|_| vec![false; items.len()]);
            let mut ranked: Vec<_> = candidates
                .iter()
                .enumerate()
                .filter(|(i, (score, _))| *score > 0 || flags[*i])
                .collect();
            ranked.sort_by_key(|(i, _)| (!flags[*i], *i));
            let selected: Vec<_> = ranked
                .into_iter()
                .take(5)
                .map(|(_, (_, item))| item["name"].clone())
                .collect();
            let expected = &case["expected"];
            let pass = |values: &Vec<Value>| {
                if expected.is_null() {
                    values.is_empty()
                } else {
                    values.contains(expected)
                }
            };
            trials.push(json!({"case":case["id"],"repetition":repetition,"local":local,"selected":selected,
                "localPassed":pass(&local),"jevPassed":pass(&selected),"localMicros":local_micros,"jevElapsedMs":elapsed,
                "usage":response.as_ref().ok().map(jev::usage),"model":response.as_ref().ok().map(|r|&r["model"]),
                "answers":checked.as_ref().ok(),"error":checked.err()}));
            let report = json!({"version":1,"requestedModel":jev::MODEL,"repeat":repeat,"cases":cases.iter().map(|c|&c["id"]).collect::<Vec<_>>(),"trials":trials,
                "scope":"Authored tool-description ranking only, 32 candidates maximum, no agent execution, cold application cache. Recall at five and empty results for absent capabilities. No agent-token savings, end-to-end latency improvement or general accuracy claim."});
            std::fs::write(
                path.with_extension("results.json"),
                serde_json::to_vec_pretty(&report).unwrap(),
            )
            .unwrap();
        }
    }
}
