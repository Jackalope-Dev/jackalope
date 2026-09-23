use super::super::{
    live_sessions::{FirstMessage, SessionLimits},
    tasks::{review_run, TaskRun},
};
use super::*;
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};

pub(super) fn router(service: RemoteAccess) -> Router {
    Router::new()
        .route("/api/pair", post(pair))
        .route("/api/request", post(request))
        .fallback(get(asset))
        .layer(DefaultBodyLimit::max(32_000))
        .layer(middleware::from_fn_with_state(service.clone(), boundary))
        .with_state(service)
}
fn failure(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}
fn valid_headers(headers: &HeaderMap, config: &Config) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|h| h.to_str().ok()) else {
        return false;
    };
    let local = [
        format!("127.0.0.1:{}", config.port),
        format!("localhost:{}", config.port),
    ];
    let public = config.public_origin.strip_prefix("https://").unwrap_or("");
    if !local.iter().any(|h| h == host) && (public.is_empty() || host != public) {
        return false;
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        let Ok(origin) = origin.to_str() else {
            return false;
        };
        if origin != config.public_origin && !local.iter().any(|h| origin == format!("http://{h}"))
        {
            return false;
        }
    }
    !headers
        .get("sec-fetch-site")
        .is_some_and(|s| s == "cross-site")
}
async fn boundary(State(service): State<RemoteAccess>, req: Request, next: Next) -> Response {
    {
        let inner = service.inner.lock().unwrap();
        if !inner.config.enabled || !valid_headers(req.headers(), &inner.config) {
            return failure(
                StatusCode::FORBIDDEN,
                "This host is not available from that address.",
            );
        }
    }
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    headers.insert("referrer-policy", "no-referrer".parse().unwrap());
    headers.insert("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'".parse().unwrap());
    response
}
#[derive(Deserialize)]
struct Pair {
    code: String,
    name: String,
}
async fn pair(State(service): State<RemoteAccess>, Json(pair): Json<Pair>) -> Response {
    let mut inner = service.inner.lock().unwrap();
    let Some(pending) = inner.pairing.as_mut() else {
        return failure(
            StatusCode::FORBIDDEN,
            "Create a new pairing link on the host.",
        );
    };
    pending.attempts = pending.attempts.saturating_add(1);
    if pending.expires <= Instant::now()
        || pending.attempts > 20
        || pair.code.len() != 64
        || hash(&pair.code) != pending.hash
    {
        return failure(
            StatusCode::FORBIDDEN,
            "Pairing expired or was declined. Create a new link on the host.",
        );
    }
    let name = pair.name.trim();
    if name.is_empty() || name.chars().count() > 80 || inner.config.devices.len() >= 20 {
        return failure(
            StatusCode::BAD_REQUEST,
            "Use a device name up to 80 characters. At most 20 devices may be paired.",
        );
    }
    let token = secret();
    let id = Uuid::new_v4().to_string();
    let mut config = inner.config.clone();
    config.devices.push(Device {
        id: id.clone(),
        name: name.into(),
        token_hash: hash(&token),
        paired_at: chrono::Utc::now().to_rfc3339(),
    });
    if let Err(error) = service.save(&config) {
        return failure(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }
    inner.config = config;
    inner.pairing = None;
    Json(json!({"id":id,"token":token})).into_response()
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Action {
    pub action: String,
    pub id: Option<String>,
    pub project_id: Option<String>,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub prompt_id: Option<String>,
    pub text: Option<String>,
}
fn allowed(config: &Config, project: &str, path: &str) -> bool {
    config
        .projects
        .iter()
        .any(|p| p.project_id == project && p.project_path == path)
}
fn run<'a>(runs: &'a [TaskRun], config: &Config, id: Option<&str>) -> Result<&'a TaskRun, String> {
    runs.iter()
        .find(|r| Some(r.id.as_str()) == id && allowed(config, &r.project_id, &r.project_path))
        .ok_or_else(|| "Task is unavailable or access was removed.".into())
}
fn task(run: &TaskRun, detail: bool) -> Value {
    json!({"id":run.id,"taskId":run.task_id,"sessionId":run.live_session_id,"projectId":run.project_id,"projectName":run.project_name,"title":run.prompt.chars().take(160).collect::<String>(),"status":run.status,"startedAt":run.started_at,"result":if detail { run.result.chars().take(100_000).collect::<String>() } else { String::new() },"error":run.error,"prompts":if detail { json!(run.prompts) } else { json!([]) },"activity":if detail { json!(run.activity.iter().rev().take(30).rev().collect::<Vec<_>>()) } else { json!([]) }})
}
async fn request(
    State(service): State<RemoteAccess>,
    headers: HeaderMap,
    Json(action): Json<Action>,
) -> Response {
    let config = {
        let inner = service.inner.lock().unwrap();
        let token = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        if !token
            .filter(|v| v.len() == 64)
            .is_some_and(|v| inner.config.devices.iter().any(|d| d.token_hash == hash(v)))
        {
            return failure(
                StatusCode::UNAUTHORIZED,
                "Pair this device again on the host.",
            );
        }
        inner.config.clone()
    };
    match tauri::async_runtime::spawn_blocking(move || dispatch(&service, &config, action)).await {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err(error)) => failure(StatusCode::BAD_REQUEST, &error),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The host could not complete this request. Refresh task status before retrying.",
        ),
    }
}
fn dispatch(service: &RemoteAccess, config: &Config, action: Action) -> Result<Value, String> {
    let runs = service.runtime.snapshot(if action.action == "detail" {
        action.run_id.as_deref()
    } else {
        None
    });
    match action.action.as_str() {
        "snapshot" => {
            let mut tasks: Vec<_> = runs
                .iter()
                .filter(|r| {
                    r.archived_at.is_none() && allowed(config, &r.project_id, &r.project_path)
                })
                .collect();
            tasks.sort_by(|a, b| b.started_at.cmp(&a.started_at));
            let mut seen = std::collections::HashSet::new();
            tasks.retain(|run| seen.insert(run.live_session_id.as_ref().unwrap_or(&run.task_id)));
            let sessions = service.sessions.snapshot(None)?;
            let sessions: Vec<_> = sessions.sessions.iter().filter(|s| !s.closed && allowed(config, &s.request.project_id, &s.request.project_path)).map(|s| json!({"id":s.id,"title":s.title,"projectId":s.request.project_id,"paused":s.paused,"error":s.error,"pending":s.messages.iter().filter(|m| !m.canceled && m.run_id.is_none()).count()})).collect();
            Ok(
                json!({"projects":config.projects.iter().map(|p| json!({"id":p.project_id,"name":p.project_name})).collect::<Vec<_>>(),"tasks":tasks.into_iter().take(200).map(|r| task(r,false)).collect::<Vec<_>>(),"sessions":sessions}),
            )
        }
        "detail" => Ok(task(run(&runs, config, action.run_id.as_deref())?, true)),
        "review" => {
            let run = run(&runs, config, action.run_id.as_deref())?;
            if let Some(session_id) = &run.live_session_id {
                service.sessions.action(session_id, "pause", None)?;
                let review = serde_json::to_value(service.sessions.review(session_id)?)
                    .map_err(|e| e.to_string())?;
                Ok(json!({"files":review["files"],"diff":review["diff"],"note":review["note"]}))
            } else {
                serde_json::to_value(review_run(run)?).map_err(|e| e.to_string())
            }
        }
        "start" => {
            service.runtime.access.ensure()?;
            let id = action.id.ok_or("Missing request identifier.")?;
            Uuid::parse_str(&id).map_err(|_| "Invalid request identifier.")?;
            let mut template = config
                .projects
                .iter()
                .find(|p| Some(p.project_id.as_str()) == action.project_id.as_deref())
                .cloned()
                .ok_or("Project access was removed.")?;
            let text = action.text.ok_or("Enter a task.")?;
            let instructions = template.prompt.trim().to_string();
            let text = if instructions.is_empty() {
                text
            } else {
                format!("{text}\n\nProject instructions:\n{instructions}")
            };
            template.id = id.clone();
            let session = service.sessions.create_with_limits(
                id.clone(),
                "Remote task".into(),
                template,
                Some(FirstMessage { id, text }),
                SessionLimits::default(),
            )?;
            Ok(json!({"sessionId":session}))
        }
        "followup" | "resume" | "pause" => {
            service.runtime.access.ensure()?;
            if let Some(session_id) = action.session_id {
                let snapshot = service.sessions.snapshot(Some(&session_id))?;
                if !snapshot.sessions.iter().any(|s| {
                    s.id == session_id
                        && allowed(config, &s.request.project_id, &s.request.project_path)
                }) {
                    return Err("Session access was removed.".into());
                }
                if action.action == "followup" {
                    service.sessions.send(
                        &session_id,
                        action.id.ok_or("Missing request identifier.")?,
                        action.text.ok_or("Enter a message.")?,
                        None,
                    )?;
                } else {
                    service.sessions.action(&session_id, &action.action, None)?;
                }
            } else {
                if action.action != "followup" {
                    return Err("Choose a session.".into());
                }
                let run = run(&runs, config, action.run_id.as_deref())?;
                service.coordinator.enqueue_followup(
                    action.id.ok_or("Missing request identifier.")?,
                    &run.id,
                    action.text.ok_or("Enter a message.")?,
                    None,
                    false,
                )?;
            }
            Ok(json!({"accepted":true}))
        }
        "answer" => {
            service.runtime.access.ensure()?;
            let run = run(&runs, config, action.run_id.as_deref())?;
            if !service.runtime.respond_prompt(
                &run.id,
                &action.prompt_id.ok_or("Choose a question.")?,
                &action.text.ok_or("Enter an answer.")?,
            )? {
                return Err(
                    "This question is no longer waiting. Refresh the task before continuing."
                        .into(),
                );
            }
            Ok(json!({"accepted":true}))
        }
        "stop" => {
            let run = run(&runs, config, action.run_id.as_deref())?;
            if let Some(id) = &run.live_session_id {
                service.sessions.action(id, "pause", None)?;
            }
            service.runtime.stop(&run.id)?;
            Ok(json!({"accepted":true}))
        }
        _ => Err("This action is not available remotely.".into()),
    }
}
async fn asset(State(service): State<RemoteAccess>, req: Request) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    let path = if path.is_empty() {
        "companion.html"
    } else {
        path
    };
    if path != "companion.html" && path != "app-icon.png" && !path.starts_with("assets/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if path.contains("..") || path.contains('%') || path.contains('\\') {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(asset) = (service.assets)(path) {
        return Response::builder()
            .header(header::CONTENT_TYPE, asset.mime_type)
            .body(Body::from(asset.bytes))
            .unwrap();
    }
    failure(
        StatusCode::NOT_FOUND,
        "Build the desktop companion before opening remote access.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_start_and_followup_are_durable_idempotent_and_project_scoped() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-remote-test-{}", Uuid::new_v4()));
        let repo = directory.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec![
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "Fixture",
            ],
        ] {
            assert!(std::process::Command::new("git")
                .current_dir(&repo)
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        let runtime = TaskRuntime::with_test_access(directory.join("history")).unwrap();
        let coordinator =
            Coordinator::new(directory.join("coordination"), runtime.clone()).unwrap();
        let session_path = directory.join("sessions.json");
        let sessions =
            LiveSessions::new(session_path.clone(), runtime.clone(), coordinator.clone());
        let template: RunRequest = serde_json::from_value(json!({"id":"template","projectId":"allowed","projectName":"Fixture","projectPath":repo.to_string_lossy(),"agent":"codex","prompt":"Preserve keyboard focus.","isolated":true})).unwrap();
        let config = Config {
            enabled: true,
            projects: vec![template],
            ..Default::default()
        };
        let service = RemoteAccess {
            inner: Arc::new(Mutex::new(Inner {
                config: config.clone(),
                pairing: None,
                error: None,
                stop: None,
                listener: None,
            })),
            gate: Arc::new(tokio::sync::Mutex::new(())),
            path: directory.join("remote.bin"),
            runtime,
            coordinator,
            sessions,
            assets: Arc::new(|_| None),
        };
        let id = Uuid::new_v4().to_string();
        let start: Action = serde_json::from_value(
            json!({"action":"start","id":id,"projectId":"allowed","text":"Fix settings"}),
        )
        .unwrap();
        for _ in 0..2 {
            assert_eq!(
                dispatch(&service, &config, start.clone()).unwrap()["sessionId"],
                id
            );
        }
        let followup: Action = serde_json::from_value(json!({"action":"followup","id":Uuid::new_v4().to_string(),"sessionId":id,"text":"Also preserve Escape."})).unwrap();
        for _ in 0..2 {
            dispatch(&service, &config, followup.clone()).unwrap();
        }
        let mut denied = config.clone();
        denied.projects.clear();
        assert!(dispatch(&service, &denied, start).is_err());
        assert!(dispatch(&service, &denied, followup).is_err());
        let restored = LiveSessions::new(
            session_path,
            service.runtime.clone(),
            service.coordinator.clone(),
        );
        let snapshot = restored.snapshot(Some(&id)).unwrap();
        assert_eq!(snapshot.sessions.len(), 1);
        let session = &snapshot.sessions[0];
        assert_eq!(session.messages.len(), 2);
        assert!(session.messages[0]
            .text
            .contains("Preserve keyboard focus."));
        assert_eq!(session.messages[1].text, "Also preserve Escape.");
        assert_eq!(session.request.project_path, repo.to_string_lossy());
        assert!(session.request.isolated);
        drop(restored);
        drop(service);
        assert!(directory.starts_with(std::env::temp_dir()));
        assert!(directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("jackalope-remote-test-"));
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn pairing_authorization_revocation_and_body_limits_use_the_real_http_boundary() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-remote-test-{}", Uuid::new_v4()));
        let runtime = TaskRuntime::new(directory.join("history")).unwrap();
        let coordinator =
            Coordinator::new(directory.join("coordination"), runtime.clone()).unwrap();
        let sessions = LiveSessions::new(
            directory.join("sessions.json"),
            runtime.clone(),
            coordinator.clone(),
        );
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let code = secret();
        let template: RunRequest = serde_json::from_value(json!({"id":"template","projectId":"allowed","projectName":"Visible project","projectPath":"C:/fixture","agent":"codex","prompt":"","isolated":true})).unwrap();
        let config = Config {
            enabled: true,
            port,
            projects: vec![template],
            ..Default::default()
        };
        let service = RemoteAccess {
            inner: Arc::new(Mutex::new(Inner {
                config,
                pairing: Some(Pairing {
                    hash: hash(&code),
                    expires: Instant::now() + Duration::from_secs(300),
                    attempts: 0,
                }),
                error: None,
                stop: None,
                listener: None,
            })),
            gate: Arc::new(tokio::sync::Mutex::new(())),
            path: directory.join("remote.bin"),
            runtime,
            coordinator,
            sessions,
            assets: Arc::new(|path| {
                (path == "companion.html").then(|| CompanionAsset {
                    bytes: b"<html>Companion fixture</html>".to_vec(),
                    mime_type: "text/html".into(),
                })
            }),
        };
        let app = router(service.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let base = format!("http://127.0.0.1:{port}");
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let pair_url = format!("{base}/api/pair");
        let request_url = format!("{base}/api/request");
        let page = client.get(&base).send().await.unwrap();
        assert_eq!(page.status(), StatusCode::OK);
        assert_eq!(page.headers()[header::CACHE_CONTROL], "no-store");
        assert!(page.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
        assert!(page.text().await.unwrap().contains("Companion fixture"));
        assert_eq!(
            client
                .get(format!("{base}/index.html"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            client
                .post(&request_url)
                .json(&json!({"action":"snapshot"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .post(&pair_url)
                .header("Origin", "https://evil.example")
                .json(&json!({"code":code,"name":"Phone"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let paired: Value = client
            .post(&pair_url)
            .json(&json!({"code":code,"name":"Phone"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let token = paired["token"].as_str().unwrap();
        assert_eq!(
            client
                .post(&pair_url)
                .json(&json!({"code":code,"name":"Phone"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let snapshot: Value = client
            .post(&request_url)
            .bearer_auth(token)
            .json(&json!({"action":"snapshot"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(snapshot["projects"].as_array().unwrap().len(), 1);
        assert!(!snapshot.to_string().contains("projectPath"));
        assert!(!snapshot.to_string().contains("token"));
        assert_eq!(client.post(&request_url).bearer_auth(token).json(&json!({"action":"start","id":Uuid::new_v4().to_string(),"projectId":"allowed","text":"Do not run"})).send().await.unwrap().status(),StatusCode::BAD_REQUEST);
        assert_eq!(
            client
                .post(&request_url)
                .bearer_auth(token)
                .json(&json!({"action":"shell","text":"echo do-not-run"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            client
                .post(&request_url)
                .bearer_auth(token)
                .json(&json!({"action":"start","text":"x".repeat(33000)}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        let saved: Config =
            serde_json::from_slice(&account_storage::read(&service.path).unwrap().unwrap())
                .unwrap();
        assert_eq!(saved.devices[0].token_hash, hash(token));
        assert!(!String::from_utf8_lossy(&std::fs::read(&service.path).unwrap()).contains(token));
        service.inner.lock().unwrap().config.devices.clear();
        assert_eq!(
            client
                .post(&request_url)
                .bearer_auth(token)
                .json(&json!({"action":"snapshot"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let private = TaskRun {
            id: "private".into(),
            project_id: "hidden".into(),
            project_path: "C:/fixture".into(),
            ..Default::default()
        };
        assert!(run(&[private], &saved, Some("private")).is_err());
        service.inner.lock().unwrap().pairing = Some(Pairing {
            hash: hash(&code),
            expires: Instant::now() - Duration::from_secs(1),
            attempts: 0,
        });
        assert_eq!(
            client
                .post(&pair_url)
                .json(&json!({"code":code,"name":"Phone"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        server.abort();
        let _ = server.await;
        drop(service);
        assert!(directory.starts_with(std::env::temp_dir()));
        assert!(directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("jackalope-remote-test-"));
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn rejects_rebinding_and_cross_origin_requests() {
        let config = Config {
            port: 9472,
            public_origin: "https://host.example".into(),
            ..Default::default()
        };
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "evil.example:9472".parse().unwrap());
        assert!(!valid_headers(&headers, &config));
        headers.insert(header::HOST, "127.0.0.1:9472".parse().unwrap());
        assert!(valid_headers(&headers, &config));
        headers.insert(header::ORIGIN, "https://evil.example".parse().unwrap());
        assert!(!valid_headers(&headers, &config));
        headers.insert(header::ORIGIN, "null".parse().unwrap());
        assert!(!valid_headers(&headers, &config));
        headers.insert(header::ORIGIN, "https://host.example".parse().unwrap());
        assert!(valid_headers(&headers, &config));
    }
    #[test]
    fn remote_addresses_require_https_origins() {
        for address in [
            "http://host.example",
            "https://user@host.example",
            "https://host.example/path",
            "https://host.example#key",
        ] {
            assert!(origin(address).is_err());
        }
        assert_eq!(
            origin("https://host.example:8443/").unwrap(),
            "https://host.example:8443"
        );
    }
}
