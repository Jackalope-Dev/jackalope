use super::*;
use axum::{routing::post, Router};

#[test]
fn choices_require_complete_finite_probability_distributions() {
    let valid =
        json!({"type":"choice","choice":"a","confidence":0.9,"probabilities":{"a":0.9,"b":0.1}});
    validate_choice(&valid, &["a", "b"]).unwrap();
    for patch in [
        json!({"choice":"excluded"}),
        json!({"confidence":2}),
        json!({"probabilities":{"a":0.2,"b":0.8}}),
        json!({"probabilities":{"a":0.9}}),
        json!({"probabilities":{"a":0.9,"b":0.9}}),
        json!({"probabilities":{"a":1.1,"b":-0.1}}),
    ] {
        let mut value = valid.clone();
        value
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        assert!(validate_choice(&value, &["a", "b"]).is_err());
    }
}

#[test]
fn preferences_default_to_agent_and_reject_stale_writes() {
    let path = std::env::temp_dir().join(format!("jev-settings-{}", uuid::Uuid::new_v4()));
    let mut value = preferences(&path).unwrap();
    assert_eq!(value.mode, RoutingMode::Agent);
    std::fs::create_dir_all(&path).unwrap();
    value.mode = RoutingMode::Jev;
    save(&path, &mut value).unwrap();
    assert_eq!(preferences(&path).unwrap().mode, RoutingMode::Jev);
    assert!(check_revision(&value, 0).is_err());
    check_revision(&value, 1).unwrap();
    std::fs::remove_file(path.join("settings.json")).unwrap();
    std::fs::remove_dir(path).unwrap();
}

#[cfg(windows)]
#[test]
fn saved_connection_is_encrypted_and_renderer_status_never_contains_the_key() {
    let path = std::env::temp_dir().join(format!("jev-key-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    let key = "fixture-secret-for-jev-unit-tests";
    let value = Connection {
        key: key.into(),
        checked_at: "2026-09-16T00:00:00Z".into(),
    };
    account_storage::write(
        &path.join("api-key.bin"),
        &serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    assert_eq!(connection(&path).unwrap().unwrap().key, key);
    let bytes = std::fs::read(path.join("api-key.bin")).unwrap();
    assert!(!bytes.windows(key.len()).any(|part| part == key.as_bytes()));
    assert!(!serde_json::to_string(&status(&path, None).unwrap())
        .unwrap()
        .contains(key));
    account_storage::remove(&path.join("api-key.bin")).unwrap();
    assert!(!status(&path, None).unwrap().connected);
    std::fs::remove_dir(path).unwrap();
}

async fn server(router: Router) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}/v1/systemone", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (address, task)
}

#[tokio::test]
async fn transport_sends_bearer_and_json_but_never_exposes_error_bodies() {
    let router = Router::new().route(
        "/v1/systemone",
        post(
            |headers: axum::http::HeaderMap, axum::Json(value): axum::Json<Value>| async move {
                assert_eq!(headers["authorization"], "Bearer fixture-key");
                assert_eq!(value["model"], MODEL);
                (
                    axum::http::StatusCode::UNAUTHORIZED,
                    "private echoed fixture-key",
                )
            },
        ),
    );
    let (endpoint, task) = server(router).await;
    let error = evaluate_at(&endpoint, "fixture-key", &json!({"model":MODEL}), || false)
        .await
        .unwrap_err();
    assert!(error.contains("rejected this key"));
    assert!(!error.contains("fixture-key"));
    task.abort();
}

#[tokio::test]
async fn cancellation_drops_a_pending_request_and_size_limits_are_enforced() {
    let (endpoint, task) = server(Router::new().route(
        "/v1/systemone",
        post(|| async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            "{}"
        }),
    ))
    .await;
    let started = std::time::Instant::now();
    let error = evaluate_at(&endpoint, "fixture-key", &json!({}), || {
        started.elapsed() > Duration::from_millis(100)
    })
    .await
    .unwrap_err();
    assert!(error.contains("stopped"));
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(evaluate_at(
        &endpoint,
        "fixture-key",
        &json!({"state":"x".repeat(MAX_BYTES)}),
        || false
    )
    .await
    .unwrap_err()
    .contains("too large"));
    task.abort();
    let (endpoint, task) = server(Router::new().route(
        "/v1/systemone",
        post(|| async { "x".repeat(MAX_BYTES + 1) }),
    ))
    .await;
    assert!(evaluate_at(&endpoint, "fixture-key", &json!({}), || false)
        .await
        .unwrap_err()
        .contains("size limit"));
    task.abort();
}

#[test]
fn scores_and_nouls_reject_incomplete_or_inconsistent_answers() {
    let answer = json!({"type":"score","score":1.3,"confidence":0.54,"probabilities":{"0":0,"1":0.7,"2":0.3}});
    assert_eq!(validate_score(&answer, 3).unwrap(), (1.3, 0.54));
    for patch in [
        json!({"score":2}),
        json!({"confidence":-1}),
        json!({"probabilities":{"0":0,"1":0.7}}),
        json!({"probabilities":{"0":0,"1":1.3,"2":-0.3}}),
    ] {
        let mut value = answer.clone();
        value
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        assert!(validate_score(&value, 3).is_err());
    }
    assert!(validate_score(&answer, 0).is_err());
    assert_eq!(
        validate_noul(&json!({"type":"noul","noul":0.99})).unwrap(),
        0.99
    );
    for value in [
        json!({"type":"noul","noul":2}),
        json!({"type":"noul","noul":null}),
        json!({"type":"choice","noul":1}),
    ] {
        assert!(validate_noul(&value).is_err());
    }
}

#[tokio::test]
async fn redirects_are_not_followed_and_json_responses_are_read() {
    let (endpoint, task) = server(
        Router::new()
            .route(
                "/v1/systemone",
                post(|| async { axum::response::Redirect::temporary("/unexpected") }),
            )
            .route(
                "/unexpected",
                post(|| async {
                    panic!("credentials followed a redirect");
                    #[allow(unreachable_code)]
                    "unexpected"
                }),
            ),
    )
    .await;
    assert!(evaluate_at(&endpoint, "fixture-key", &json!({}), || false)
        .await
        .unwrap_err()
        .contains("unavailable"));
    task.abort();
    let (endpoint, task) = server(Router::new().route(
        "/v1/systemone",
        post(|| async {
            axum::Json(json!({"model": MODEL, "usage":{"input_tokens":5,"output_tokens":1}}))
        }),
    ))
    .await;
    let value = evaluate_at(&endpoint, "fixture-key", &json!({}), || false)
        .await
        .unwrap();
    assert_eq!(usage(&value).input, 5);
    task.abort();
}

#[cfg(windows)]
#[test]
fn unreadable_saved_keys_allow_recovery_without_returning_secret_material() {
    let path = std::env::temp_dir().join(format!("jev-corrupt-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("api-key.bin"), b"fixture-private-corrupt-data").unwrap();
    let status = status(&path, None).unwrap();
    assert!(!status.connected);
    assert!(status.has_key);
    assert!(status.storage_error.is_some());
    assert!(!serde_json::to_string(&status)
        .unwrap()
        .contains("fixture-private-corrupt-data"));
    account_storage::remove(&path.join("api-key.bin")).unwrap();
    std::fs::remove_dir(path).unwrap();
}
