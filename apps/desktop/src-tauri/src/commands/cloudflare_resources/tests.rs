//! Every Cloudflare call goes to a local Axum server that answers with the
//! documented response shapes; no test reaches Cloudflare.

use super::*;
use axum::{
    body::Bytes,
    extract::State as AxumState,
    http::{HeaderMap, Method, StatusCode, Uri},
    Json, Router,
};
use std::sync::{Arc, Mutex as StdMutex};

type Responder = Arc<dyn Fn(&str, &str, &Value) -> (u16, Value) + Send + Sync>;

#[derive(Clone)]
struct Fake {
    respond: Responder,
    calls: Arc<StdMutex<Vec<(String, String, Value, String)>>>,
}

impl Fake {
    fn calls(&self) -> Vec<(String, String, Value, String)> {
        self.calls.lock().unwrap().clone()
    }
    fn routes(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .map(|(method, path, _, _)| format!("{method} {path}"))
            .collect()
    }
}

async fn handle(
    AxumState(fake): AxumState<Fake>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, Json<Value>) {
    let path = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or_default()
        .trim_start_matches("/accounts/acct")
        .to_string();
    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let auth = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    fake.calls
        .lock()
        .unwrap()
        .push((method.to_string(), path.clone(), body.clone(), auth));
    let (status, value) = (fake.respond)(method.as_str(), &path, &body);
    (StatusCode::from_u16(status).unwrap(), Json(value))
}

async fn server(
    oauth: bool,
    respond: impl Fn(&str, &str, &Value) -> (u16, Value) + Send + Sync + 'static,
) -> (Api, Fake, tokio::task::JoinHandle<()>) {
    let fake = Fake {
        respond: Arc::new(respond),
        calls: Arc::default(),
    };
    let router = Router::new().fallback(handle).with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}/accounts/acct", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let api = Api {
        root,
        account_id: "acct".into(),
        token: "fixture-token".into(),
        oauth,
        client: reqwest::Client::new(),
    };
    (api, fake, task)
}

fn success(result: Value) -> (u16, Value) {
    (
        200,
        json!({"success": true, "errors": [], "messages": [], "result": result}),
    )
}

fn error(status: u16, code: u64, message: &str) -> (u16, Value) {
    (
        status,
        json!({"success": false, "errors": [{"code": code, "message": message}], "result": null}),
    )
}

fn origin() -> PostgresOrigin {
    parse_postgres("postgres://app%40team:s3cr%23t@db.example.com:6543/game").unwrap()
}

#[tokio::test]
async fn r2_reuses_a_bucket_with_the_name_and_creates_a_missing_one() {
    let (api, fake, task) = server(false, |method, path, _| match (method, path) {
        ("GET", "/r2/buckets/game-assets") => success(json!({"name": "game-assets"})),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_r2("game-assets").await.unwrap(),
        Some("game-assets".into())
    );
    assert_eq!(fake.routes(), ["GET /r2/buckets/game-assets"]);
    assert_eq!(fake.calls()[0].3, "Bearer fixture-token");
    task.abort();

    let (api, fake, task) = server(false, |method, path, body| match (method, path) {
        ("GET", "/r2/buckets/game-assets") => {
            error(404, 10006, "The specified bucket does not exist.")
        }
        ("POST", "/r2/buckets") if body["name"] == "game-assets" => {
            success(json!({"name": "game-assets", "location": "WNAM"}))
        }
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_r2("game-assets").await.unwrap(),
        Some("game-assets".into())
    );
    assert_eq!(
        fake.routes(),
        ["GET /r2/buckets/game-assets", "POST /r2/buckets"]
    );
    task.abort();
}

#[tokio::test]
async fn r2_explains_an_account_without_r2_and_a_bucket_created_meanwhile() {
    let (api, _, task) = server(false, |method, _, _| match method {
        "GET" => error(404, 10006, "missing"),
        _ => error(
            403,
            10042,
            "Please enable R2 through the Cloudflare Dashboard.",
        ),
    })
    .await;
    let failure = api.ensure_r2("game-assets").await.unwrap_err();
    // 403 with 10042 is a permission-shaped status, so the permission wins.
    assert_eq!(failure.recovery, Some(Recovery::Token));
    task.abort();

    let (api, _, task) = server(false, |method, _, _| match method {
        "GET" => error(404, 10006, "missing"),
        _ => error(
            400,
            10042,
            "Please enable R2 through the Cloudflare Dashboard.",
        ),
    })
    .await;
    let failure = api.ensure_r2("game-assets").await.unwrap_err();
    assert_eq!(failure.recovery, Some(Recovery::Enable));
    assert_eq!(
        failure.link.as_deref(),
        Some("https://dash.cloudflare.com/acct/r2/overview")
    );
    task.abort();

    let (api, _, task) = server(false, |method, _, _| match method {
        "GET" => error(404, 10006, "missing"),
        _ => error(409, 10004, "The bucket you tried to create already exists."),
    })
    .await;
    assert_eq!(
        api.ensure_r2("game-assets").await.unwrap(),
        Some("game-assets".into())
    );
    task.abort();
}

#[tokio::test]
async fn d1_finds_by_exact_name_or_creates() {
    let (api, fake, task) = server(false, |method, path, _| match (method, path) {
        ("GET", path) if path.starts_with("/d1/database?name=game-db") => success(json!([
            {"uuid": "other", "name": "game-db-old"},
            {"uuid": "11111111-2222-3333-4444-555555555555", "name": "game-db"}
        ])),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_d1("game-db").await.unwrap().as_deref(),
        Some("11111111-2222-3333-4444-555555555555")
    );
    assert_eq!(fake.routes().len(), 1);
    task.abort();

    let (api, fake, task) = server(false, |method, path, body| match (method, path) {
        ("GET", _) => success(json!([{"uuid": "x", "name": "game-db-old"}])),
        ("POST", "/d1/database") if body == &json!({"name": "game-db"}) => {
            success(json!({"uuid": "new-uuid", "name": "game-db"}))
        }
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_d1("game-db").await.unwrap().as_deref(),
        Some("new-uuid")
    );
    assert_eq!(fake.routes()[1], "POST /d1/database");
    task.abort();
}

#[tokio::test]
async fn kv_searches_every_page_before_creating() {
    let (api, fake, task) = server(false, |method, path, _| match (method, path) {
        ("GET", "/storage/kv/namespaces?per_page=100&page=1") => {
            let others: Vec<Value> = (0..100)
                .map(|n| json!({"id": format!("id{n}"), "title": format!("other-{n}")}))
                .collect();
            (
                200,
                json!({"success": true, "result": others, "result_info": {"page": 1, "total_pages": 2}}),
            )
        }
        ("GET", "/storage/kv/namespaces?per_page=100&page=2") => (
            200,
            json!({"success": true, "result": [{"id": "kv-id", "title": "game-config"}], "result_info": {"page": 2, "total_pages": 2}}),
        ),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_kv("game-config").await.unwrap().as_deref(),
        Some("kv-id")
    );
    assert_eq!(fake.routes().len(), 2);
    task.abort();

    let (api, fake, task) = server(false, |method, _, body| match method {
        "GET" => (
            200,
            json!({"success": true, "result": [], "result_info": {"page": 1, "total_pages": 0}}),
        ),
        "POST" if body["title"] == "game-config" => {
            success(json!({"id": "created", "title": "game-config"}))
        }
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_kv("game-config").await.unwrap().as_deref(),
        Some("created")
    );
    assert_eq!(
        fake.routes(),
        [
            "GET /storage/kv/namespaces?per_page=100&page=1",
            "POST /storage/kv/namespaces"
        ]
    );
    task.abort();
}

#[tokio::test]
async fn queues_reuse_or_create_by_queue_name() {
    let (api, fake, task) = server(false, |method, path, _| match (method, path) {
        ("GET", "/queues") => success(json!([{"queue_id": "q1", "queue_name": "game-jobs"}])),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_queue("game-jobs").await.unwrap().as_deref(),
        Some("q1")
    );
    assert_eq!(fake.routes(), ["GET /queues"]);
    task.abort();

    let (api, _, task) = server(false, |method, _, body| match method {
        "GET" => success(json!([])),
        "POST" if body == &json!({"queue_name": "game-jobs"}) => {
            success(json!({"queue_id": "q2", "queue_name": "game-jobs"}))
        }
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_queue("game-jobs").await.unwrap().as_deref(),
        Some("q2")
    );
    task.abort();
}

#[tokio::test]
async fn hyperdrive_sends_the_origin_only_when_creating_and_never_echoes_the_password() {
    let (api, fake, task) = server(false, |method, path, _| match (method, path) {
        ("GET", "/hyperdrive/configs") => success(json!([{"id": "hd1", "name": "game-postgres"}])),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    assert_eq!(
        api.ensure_hyperdrive("game-postgres", None)
            .await
            .unwrap()
            .as_deref(),
        Some("hd1")
    );
    assert_eq!(fake.routes(), ["GET /hyperdrive/configs"]);
    task.abort();

    let (api, fake, task) = server(false, |method, _, _| match method {
        "GET" => success(json!([])),
        "POST" => success(json!({"id": "hd2", "name": "game-postgres"})),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    let missing = api
        .ensure_hyperdrive("game-postgres", None)
        .await
        .unwrap_err();
    assert_eq!(missing.step, Step::Hyperdrive);
    assert!(missing.message.contains("Postgres connection string"));
    assert_eq!(
        api.ensure_hyperdrive("game-postgres", Some(&origin()))
            .await
            .unwrap()
            .as_deref(),
        Some("hd2")
    );
    let sent = fake.calls().last().unwrap().2.clone();
    assert_eq!(
        sent["origin"],
        json!({"scheme": "postgres", "host": "db.example.com", "port": 6543, "database": "game", "user": "app@team", "password": "s3cr#t"})
    );
    task.abort();

    let (api, _, task) = server(false, |method, _, _| match method {
        "GET" => success(json!([])),
        _ => error(
            400,
            2008,
            "Could not connect to app@team:s3cr#t@db.example.com",
        ),
    })
    .await;
    let failure = api
        .ensure_hyperdrive("game-postgres", Some(&origin()))
        .await
        .unwrap_err();
    assert!(!failure.message.contains("s3cr#t"), "{}", failure.message);
    assert!(failure.message.contains("[redacted]"));
    task.abort();
}

#[tokio::test]
async fn turnstile_creates_a_managed_widget_for_the_domains() {
    let (api, fake, task) = server(false, |method, _, body| match method {
        "GET" => (
            200,
            json!({"success": true, "result": [{"sitekey": "0xother", "name": "other"}], "result_info": {"page": 1, "total_pages": 1}}),
        ),
        "POST" if body["mode"] == "managed" => success(json!({
            "sitekey": "0x4AAAA", "secret": "0x4AAAA-secret", "name": body["name"], "domains": body["domains"]
        })),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    let domains = vec!["example.com".to_string(), "play.example.com".to_string()];
    assert_eq!(
        api.ensure_turnstile("game-turnstile", &domains)
            .await
            .unwrap()
            .as_deref(),
        Some("0x4AAAA")
    );
    assert_eq!(
        fake.calls().last().unwrap().2,
        json!({"name": "game-turnstile", "domains": ["example.com", "play.example.com"], "mode": "managed"})
    );
    task.abort();
}

#[tokio::test]
async fn refusals_name_the_missing_permission_and_rate_limits_ask_to_retry() {
    let (api, _, task) = server(false, |_, _, _| error(403, 10000, "Authentication error")).await;
    let failure = api.ensure_d1("game-db").await.unwrap_err();
    assert_eq!(failure.step, Step::D1);
    assert_eq!(failure.recovery, Some(Recovery::Token));
    assert_eq!(failure.permissions, ["D1: Edit"]);
    assert!(failure.message.contains("Account → D1: Edit"));
    assert_eq!(failure.link.as_deref(), Some(TOKENS_URL));
    task.abort();

    let (api, _, task) = server(true, |_, _, _| error(403, 10000, "Authentication error")).await;
    let failure = api.ensure_queue("game-jobs").await.unwrap_err();
    assert_eq!(failure.recovery, Some(Recovery::Reauthorize));
    assert_eq!(failure.scopes, ["queues.write"]);
    assert_eq!(failure.permissions, ["Queues: Edit"]);
    task.abort();

    let (api, _, task) = server(false, |_, _, _| error(429, 971, "Please wait")).await;
    let failure = api.ensure_kv("game-config").await.unwrap_err();
    assert_eq!(failure.recovery, None);
    assert!(failure.message.contains("rate limiting"));
    task.abort();

    let (api, _, task) = server(false, |_, _, _| error(500, 7000, "No route\u{7}")).await;
    let failure = api
        .ensure_turnstile("t", &["a.com".into()])
        .await
        .unwrap_err();
    assert_eq!(failure.message, "Cloudflare returned 500: No route");
    task.abort();
}

#[tokio::test]
async fn provisioning_stops_at_the_first_failure_and_keeps_what_was_set_up() {
    let (api, fake, task) = server(false, |method, path, _| match (method, path) {
        ("GET", "/r2/buckets/game-assets") => success(json!({"name": "game-assets"})),
        ("GET", path) if path.starts_with("/storage/kv") => success(json!([])),
        ("POST", "/storage/kv/namespaces") => success(json!({"id": "kv1", "title": "game-config"})),
        ("GET", "/queues") => error(403, 10000, "Authentication error"),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    let request = Request {
        prefix: "game".into(),
        kinds: vec![
            Kind::Turnstile,
            Kind::Queue,
            Kind::Kv,
            Kind::DurableObjects,
            Kind::R2,
            Kind::Workers,
        ],
        postgres_url: None,
        turnstile_domains: vec!["example.com".into()],
    };
    let plan = plan(&request, None).unwrap();
    let steps = Arc::new(StdMutex::new(Vec::new()));
    let seen = steps.clone();
    let (done, failure) =
        provision(&api, &plan, &move |step| seen.lock().unwrap().push(step)).await;
    let kinds: Vec<Kind> = done.iter().map(|resource| resource.kind).collect();
    assert_eq!(kinds, [Kind::Workers, Kind::R2, Kind::Kv]);
    assert_eq!(done[2].id.as_deref(), Some("kv1"));
    assert_eq!(done[0].name, "game");
    assert_eq!(failure.unwrap().step, Step::Queue);
    assert_eq!(
        *steps.lock().unwrap(),
        [Step::Workers, Step::R2, Step::Kv, Step::Queue]
    );
    assert!(!fake.routes().iter().any(|route| route.contains("widgets")));
    task.abort();
}

#[test]
fn bindings_are_valid_jsonc_and_reference_each_resource() {
    let resource = |kind: Kind, id: Option<&str>| Resource {
        kind,
        name: resource_name("game", kind),
        id: id.map(str::to_owned),
        binding: kind.binding().into(),
    };
    let resources = vec![
        resource(Kind::Workers, None),
        resource(Kind::R2, Some("game-assets")),
        resource(Kind::D1, Some("d1-uuid")),
        resource(Kind::Kv, Some("kv-id")),
        resource(Kind::Queue, Some("q-id")),
        resource(Kind::DurableObjects, None),
        resource(Kind::Hyperdrive, Some("hd-id")),
        resource(Kind::Turnstile, Some("0x4AAAA")),
    ];
    let text = bindings("game", &resources, "2026-11-05");
    let json: String = text
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    let value: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["name"], "game");
    assert_eq!(value["compatibility_date"], "2026-11-05");
    assert_eq!(
        value["r2_buckets"],
        json!([{"binding": "ASSETS", "bucket_name": "game-assets"}])
    );
    assert_eq!(
        value["d1_databases"],
        json!([{"binding": "DB", "database_name": "game-db", "database_id": "d1-uuid"}])
    );
    assert_eq!(
        value["kv_namespaces"],
        json!([{"binding": "CONFIG", "id": "kv-id"}])
    );
    assert_eq!(
        value["queues"]["producers"],
        json!([{"binding": "JOBS", "queue": "game-jobs"}])
    );
    assert_eq!(
        value["durable_objects"]["bindings"],
        json!([{"name": "SESSIONS", "class_name": "Session"}])
    );
    assert_eq!(
        value["migrations"][0]["new_sqlite_classes"],
        json!(["Session"])
    );
    assert_eq!(
        value["hyperdrive"],
        json!([{"binding": "HYPERDRIVE", "id": "hd-id"}])
    );
    assert_eq!(value["vars"]["TURNSTILE_SITE_KEY"], "0x4AAAA");

    let only_kv = bindings("game", &[resource(Kind::Kv, Some("kv-id"))], "2026-11-05");
    assert!(only_kv.contains("kv_namespaces"));
    assert!(!only_kv.contains("r2_buckets"));
}

#[test]
fn the_manifest_is_written_merged_and_removed_with_its_last_resource() {
    let project = std::env::temp_dir().join(format!("jackalope-cf-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&project).unwrap();
    let kv = Resource {
        kind: Kind::Kv,
        name: "game-config".into(),
        id: Some("kv1".into()),
        binding: "CONFIG".into(),
    };
    let first = write_manifest(&project, "acct", "game", vec![kv.clone()])
        .unwrap()
        .unwrap();
    assert_eq!(read_manifest(&project).unwrap().unwrap(), first);
    let saved = std::fs::read_to_string(project.join(MANIFEST_PATH)).unwrap();
    assert!(saved.contains("\"accountId\": \"acct\""));
    assert!(saved.contains("kv_namespaces"));

    let r2 = Resource {
        kind: Kind::R2,
        name: "game-assets".into(),
        id: Some("game-assets".into()),
        binding: "ASSETS".into(),
    };
    let resources = merged(Some(&first), "acct", vec![r2.clone()]);
    assert_eq!(resources, [kv.clone(), r2.clone()]);
    let second = write_manifest(&project, "acct", "game", resources)
        .unwrap()
        .unwrap();
    // Manifest order follows setup order, whatever order runs added them.
    assert_eq!(second.resources, [r2.clone(), kv.clone()]);
    // Another account's resources are not carried into this one's manifest.
    assert!(merged(Some(&second), "other", vec![]).is_empty());

    assert!(write_manifest(&project, "acct", "game", vec![])
        .unwrap()
        .is_none());
    assert!(read_manifest(&project).unwrap().is_none());
    std::fs::write(project.join(MANIFEST_PATH), "not json").unwrap();
    assert!(read_manifest(&project)
        .unwrap_err()
        .contains("could not be read"));
    std::fs::remove_dir_all(project).unwrap();
}

#[test]
fn oauth_grants_without_a_resource_scope_ask_for_it_first() {
    let kinds = [Kind::R2, Kind::Kv, Kind::DurableObjects, Kind::Workers];
    assert!(missing_scopes(&kinds, None).is_empty());
    assert_eq!(
        missing_scopes(&kinds, Some("artifacts.write workers-kv-storage.write")),
        [Kind::R2]
    );
    assert!(missing_scopes(
        &kinds,
        Some("workers-r2-storage.write workers-kv-storage.write")
    )
    .is_empty());
    let failure = permission_failure(Step::Account, &[Kind::R2, Kind::D1], true);
    assert_eq!(failure.recovery, Some(Recovery::Reauthorize));
    assert_eq!(failure.scopes, ["workers-r2-storage.write", "d1.write"]);
    assert!(failure.message.contains("an R2 bucket and a D1 database"));
    // Every requested scope maps back to the permission an API token would need.
    for kind in KINDS {
        if let Some(scope) = kind.scope() {
            assert_eq!(permission_for_scope(scope), Some(kind.permission()));
        }
    }
    assert_eq!(permission_for_scope("workers-scripts.write"), None);
    assert_eq!(permission_for_scope("account-settings.read"), None);
}

#[test]
fn requests_validate_names_domains_and_connection_strings() {
    let request = |prefix: &str, kinds: Vec<Kind>| Request {
        prefix: prefix.into(),
        kinds,
        postgres_url: None,
        turnstile_domains: Vec::new(),
    };
    for prefix in ["game", "my-game-2", "a"] {
        assert!(
            plan(&request(prefix, vec![Kind::Kv]), None).is_ok(),
            "{prefix}"
        );
    }
    for prefix in [
        "",
        "-game",
        "game-",
        "Game",
        "my game",
        "a--b",
        &"a".repeat(41),
    ] {
        assert!(
            plan(&request(prefix, vec![Kind::Kv]), None).is_err(),
            "{prefix}"
        );
    }
    assert!(plan(&request("game", vec![]), None).is_err());
    let ordered = plan(
        &request("game", vec![Kind::Kv, Kind::Workers, Kind::R2]),
        None,
    )
    .unwrap();
    assert_eq!(ordered.kinds, [Kind::Workers, Kind::R2, Kind::Kv]);

    assert!(plan(&request("game", vec![Kind::Turnstile]), None).is_err());
    assert_eq!(
        normalize_domains(&[
            " https://Example.com/ ".into(),
            "example.com".into(),
            "".into(),
            "localhost".into()
        ])
        .unwrap(),
        ["example.com", "localhost"]
    );
    assert!(normalize_domains(&["not a domain".into()]).is_err());
    assert!(normalize_domains(&(0..11).map(|n| format!("d{n}.com")).collect::<Vec<_>>()).is_err());

    // Hyperdrive without a connection string still plans; an existing config needs none.
    assert!(plan(&request("game", vec![Kind::Hyperdrive]), None)
        .unwrap()
        .postgres
        .is_none());
    assert_eq!(
        plan(
            &request("game", vec![Kind::Hyperdrive]),
            Some("postgresql://u:p@db.example.com/app")
        )
        .unwrap()
        .postgres
        .unwrap()
        .port,
        5432
    );
    assert_eq!(origin().user, "app@team");
    assert_eq!(origin().password, "s3cr#t");
    for url in [
        "mysql://u:p@db.example.com/app",
        "postgres://u@db.example.com/app",
        "postgres://u:p@db.example.com/",
        "postgres://u:p@localhost/app",
        "postgres://u:p%zz@db.example.com/app",
        "not a url",
    ] {
        assert!(parse_postgres(url).is_err(), "{url}");
    }
}

#[test]
fn deletes_stay_inside_the_resource_routes() {
    assert_eq!(
        Api::delete_route(Kind::R2, "game-assets").as_deref(),
        Some("/r2/buckets/game-assets")
    );
    assert_eq!(
        Api::delete_route(Kind::Turnstile, "0x4AAAA").as_deref(),
        Some("/challenges/widgets/0x4AAAA")
    );
    assert_eq!(Api::delete_route(Kind::Kv, "../tokens"), None);
    assert_eq!(Api::delete_route(Kind::D1, "a/b"), None);
    assert_eq!(Api::delete_route(Kind::Workers, "game"), None);
}

#[tokio::test]
async fn deleting_reports_non_empty_buckets_and_treats_missing_ones_as_gone() {
    let (api, _, task) = server(false, |_, path, _| match path {
        "/r2/buckets/full" => error(409, 10008, "The bucket you tried to delete is not empty"),
        "/r2/buckets/gone" => error(404, 10006, "The specified bucket does not exist."),
        "/d1/database/d1" => success(Value::Null),
        _ => error(500, 1, "unexpected"),
    })
    .await;
    let error = api.delete(Kind::R2, "full").await.unwrap_err();
    assert!(error.contains("deletes only empty buckets"));
    assert!(error.contains("is not empty"));
    assert!(api.delete(Kind::R2, "gone").await.is_ok());
    assert!(api.delete(Kind::D1, "d1").await.is_ok());
    task.abort();
}

#[test]
fn failures_serialize_for_the_setup_screen() {
    let value = serde_json::to_value(permission_failure(Step::Kv, &[Kind::Kv], false)).unwrap();
    assert_eq!(value["step"], "kv");
    assert_eq!(value["recovery"], "token");
    assert_eq!(value["permissions"], json!(["Workers KV Storage: Edit"]));
    assert_eq!(
        serde_json::to_value(Step::DurableObjects).unwrap(),
        "durableObjects"
    );
    let kind: Kind = serde_json::from_value(json!("durableObjects")).unwrap();
    assert_eq!(kind, Kind::DurableObjects);
}
