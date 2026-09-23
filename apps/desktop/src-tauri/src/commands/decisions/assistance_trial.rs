use super::*;
use serde_json::{json, Value};

#[tokio::test]
#[ignore = "Live typed Jev assistance screen; requires a temporary key and explicit suite"]
async fn installed_assistance_shadow_trial() {
    let key = std::env::var("JACKALOPE_JEV_TEST_KEY").expect("Temporary key required");
    let path = std::path::PathBuf::from(
        std::env::var("JACKALOPE_ASSISTANCE_SPEC").expect("Explicit suite required"),
    );
    let suite: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let cases = suite["cases"].as_array().unwrap();
    assert!(!cases.is_empty() && cases.len() <= 20);
    let mut receipts = Vec::new();
    for case in cases {
        let payload = json!({"model":crate::commands::jev::MODEL,"state":case["state"],"questions":case["questions"]});
        assert!(payload["questions"]
            .as_object()
            .is_some_and(|q| !q.is_empty() && q.len() <= 32));
        let started = std::time::Instant::now();
        let response = crate::commands::jev::evaluate(&key, &payload, || false).await;
        let elapsed = started.elapsed().as_millis();
        let checked = response
            .as_ref()
            .map_err(Clone::clone)
            .and_then(|response| evaluation::validate(&payload, response));
        receipts.push(json!({"id":case["id"],"rubricRevision":1,"requestedModel":crate::commands::jev::MODEL,
            "model":response.as_ref().ok().map(|r|&r["model"]),"inputHash":context::fingerprint(&payload),
            "elapsedMs":elapsed,"answers":checked.as_ref().ok(),"decision":{"fallbackReason":checked.err(),"usage":response.as_ref().ok().map(crate::commands::jev::usage)},
            "evidence":{"assistance":{"mode":"shadow","operation":case["operation"]}},
            "scope":"Authored typed-decision screen with expected labels withheld from the payload. No agent launch suppressed and no downstream quality/cost claim."}));
        std::fs::write(
            path.with_extension("results.json"),
            serde_json::to_vec_pretty(&receipts).unwrap(),
        )
        .unwrap();
    }
}
