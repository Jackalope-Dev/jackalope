//! Agent API keys that stay on this device for agents on a computer.
//!
//! With a computer's provider proxy on (beta, off by default), an agent that
//! would get an Anthropic or OpenAI API key gets a per-attempt token and a base
//! URL on its runner's relay instead. The runner queues each request it
//! receives there like a bridge call, [`super::relay::Relay`] hands it to
//! [`forward`], which checks the token, replaces every credential header with
//! the saved key and sends it to the provider, and the answer streams back in
//! `run_answer` pieces. No new port is opened: the provider is reached only
//! through the relay's authenticated runs connection.
//!
//! Claude Code sign-in tokens (`CLAUDE_CODE_OAUTH_TOKEN`) are not proxied.
//! Claude Code sets the headers and endpoints a subscription sign-in needs
//! itself, so they keep going to the computer as before.

use super::protocol::protocol;
use super::relay::{Answer, Piece};
use super::runs::{relay_url, Environment};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc::Sender,
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

/// The longest an attempt's token is honoured: the six-hour run limit plus the
/// lost-contact window. A token is also revoked when its attempt stops reading.
const LIFETIME: Duration = Duration::from_secs(7 * 3600);
/// The longest one provider answer may stream.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// The most response bytes one provider answer may carry.
const ANSWER_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Provider {
    Anthropic,
    OpenAi,
}

impl Provider {
    /// The provider an agent sign-in for computers is an API key for.
    fn for_credential(id: &str) -> Option<Self> {
        match id {
            "anthropic-key" => Some(Self::Anthropic),
            "openai-key" => Some(Self::OpenAi),
            _ => None,
        }
    }

    /// Its name in relay paths (`providerProxy.providers` of the protocol).
    pub fn name(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Anthropic => "Anthropic",
            Self::OpenAi => "OpenAI",
        }
    }

    fn upstream(self) -> &'static str {
        match self {
            Self::Anthropic => "https://api.anthropic.com",
            Self::OpenAi => "https://api.openai.com",
        }
    }

    /// The provider routes an agent may call: Anthropic Messages, and OpenAI
    /// Responses and Chat Completions, plus each provider's model list.
    fn allows(self, method: &str, route: &str) -> bool {
        let under = |prefix: &str| route == prefix || route.starts_with(&format!("{prefix}/"));
        match (self, method) {
            (_, "GET") => route == "/v1/models",
            (Self::Anthropic, "POST") => under("/v1/messages"),
            (Self::OpenAi, "POST") => under("/v1/responses") || route == "/v1/chat/completions",
            _ => false,
        }
    }

    /// An error body shaped like the provider's own, so the agent CLI shows
    /// the message.
    fn error(self, status: u16, message: &str) -> Vec<u8> {
        let kind = match status {
            401 => "authentication_error",
            404 => "not_found_error",
            413 => "request_too_large",
            _ => "api_error",
        };
        match self {
            Self::Anthropic => {
                json!({"type":"error","error":{"type":kind,"message":message}})
            }
            Self::OpenAi => json!({"error":{"message":message,"type":kind,"code":null}}),
        }
        .to_string()
        .into_bytes()
    }
}

/// What a run's provider requests did, for the attempt.
#[derive(Default)]
pub(crate) struct Usage {
    requests: AtomicU32,
    /// Answered by the provider with an error, or not answered.
    failed: AtomicU32,
    /// Refused here: a wrong or expired token, a route or size not allowed.
    refused: AtomicU32,
}

/// One attempt's permission to reach a provider with a saved API key.
pub(crate) struct Grant {
    token: String,
    provider: Provider,
    credential: String,
    upstream: String,
    expires: Instant,
    revoked: AtomicBool,
    pub usage: Usage,
}

impl std::fmt::Debug for Grant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Grant")
            .field("provider", &self.provider)
            .finish_non_exhaustive()
    }
}

/// A grant for `adapter`'s saved credential on a computer, or why its
/// credential goes to the computer as before.
pub(crate) fn grant(root: &Path, adapter: &str) -> Result<Grant, String> {
    let (kind, credential) = super::credentials::chosen(root, adapter)?;
    let provider = Provider::for_credential(kind.id).ok_or_else(|| {
        format!(
            "The provider proxy carries API keys only, so the {} goes to the computer as before.",
            kind.label
        )
    })?;
    Ok(Grant::new(provider, credential, provider.upstream(), LIFETIME))
}

impl Grant {
    pub fn new(provider: Provider, credential: String, upstream: &str, lifetime: Duration) -> Self {
        Self {
            token: format!(
                "jkp-{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
            provider,
            credential,
            upstream: upstream.trim_end_matches('/').to_string(),
            expires: Instant::now() + lifetime,
            revoked: AtomicBool::new(false),
            usage: Usage::default(),
        }
    }

    pub fn provider(&self) -> Provider {
        self.provider
    }

    /// The saved key, kept out of the run but protected in its output anyway.
    pub fn credential(&self) -> &str {
        &self.credential
    }

    /// The agent's base URL, on the runner's relay stand-in.
    fn base_url(&self) -> String {
        let base = format!(
            "{}{}{}",
            relay_url(),
            protocol().provider_proxy.prefix,
            self.provider.name()
        );
        match self.provider {
            // Claude Code appends `/v1/messages` to its base URL.
            Provider::Anthropic => base,
            // Codex appends `/responses` to the OpenAI base URL.
            Provider::OpenAi => format!("{base}/v1"),
        }
    }

    /// Gives the run the token and base URL instead of the saved key. Codex
    /// takes the base URL from `openai_base_url` (`OPENAI_BASE_URL` is its
    /// older, deprecated form, kept for older Codex versions).
    pub fn apply(&self, adapter: &str, argv: &mut Vec<String>, env: &mut Environment) {
        let base = self.base_url();
        let (replaced, given): (&[&str], Vec<(&str, String)>) = match self.provider {
            Provider::Anthropic => (
                &[
                    "ANTHROPIC_API_KEY",
                    "ANTHROPIC_AUTH_TOKEN",
                    "CLAUDE_CODE_OAUTH_TOKEN",
                    "ANTHROPIC_BASE_URL",
                ],
                vec![
                    ("ANTHROPIC_API_KEY", self.token.clone()),
                    ("ANTHROPIC_BASE_URL", base.clone()),
                ],
            ),
            Provider::OpenAi => (
                &["CODEX_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL"],
                vec![
                    ("CODEX_API_KEY", self.token.clone()),
                    ("OPENAI_API_KEY", self.token.clone()),
                    ("OPENAI_BASE_URL", base.clone()),
                ],
            ),
        };
        env.retain(|(name, _)| !replaced.contains(&name.as_str()));
        env.extend(given.into_iter().map(|(name, value)| (name.into(), value)));
        if adapter == "codex" {
            argv.retain(|arg| !arg.starts_with("openai_base_url="));
            let at = argv
                .iter()
                .position(|arg| arg == "-c")
                .unwrap_or(argv.len().min(1));
            let value = toml::Value::String(base).to_string();
            argv.splice(at..at, ["-c".into(), format!("openai_base_url={value}")]);
        }
    }

    pub fn revoke(&self) {
        self.revoked.store(true, Ordering::SeqCst);
    }

    /// Whether the presented credential header is this attempt's live token.
    fn admits(&self, headers: &serde_json::Map<String, Value>) -> bool {
        if self.revoked.load(Ordering::SeqCst) || Instant::now() >= self.expires {
            return false;
        }
        let header = |name: &str| {
            headers
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .and_then(|(_, value)| value.as_str())
        };
        let presented = header("x-api-key").or_else(|| {
            header("authorization").and_then(|value| {
                value
                    .strip_prefix("Bearer ")
                    .or_else(|| value.strip_prefix("bearer "))
            })
        });
        presented.is_some_and(|value| same(value.trim().as_bytes(), self.token.as_bytes()))
    }

    /// The activity line for the attempt, once it made requests.
    pub fn summary(&self, computer: &str) -> Option<String> {
        let requests = self.usage.requests.load(Ordering::SeqCst);
        if requests == 0 {
            return None;
        }
        let failed = self.usage.failed.load(Ordering::SeqCst);
        let refused = self.usage.refused.load(Ordering::SeqCst);
        let mut text = format!(
            "Provider proxy: {requests} {} from {computer} reached {} with the API key kept on this device",
            if requests == 1 { "request" } else { "requests" },
            self.provider.label()
        );
        if failed > 0 {
            text.push_str(&format!("; {failed} failed"));
        }
        if refused > 0 {
            text.push_str(&format!("; {refused} refused"));
        }
        text.push('.');
        Some(text)
    }

    /// Request counts for the attempt record.
    pub fn counts(&self) -> (u32, u32, u32) {
        (
            self.usage.requests.load(Ordering::SeqCst),
            self.usage.failed.load(Ordering::SeqCst),
            self.usage.refused.load(Ordering::SeqCst),
        )
    }
}

fn same(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

/// Whether a relayed call is a provider request rather than a bridge call.
pub(crate) fn is_provider_call(call: &Value) -> bool {
    call["path"]
        .as_str()
        .is_some_and(|path| path.starts_with(&protocol().provider_proxy.prefix))
}

/// A provider request ready to send.
#[derive(Debug)]
struct Upstream {
    method: reqwest::Method,
    url: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn decoded(call: &Value) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(call["body"].as_str().unwrap_or_default())
        .ok()
}

/// One whole answer, as the single piece of a provider stream.
fn whole(id: &str, status: u16, body: Vec<u8>) -> Answer {
    Answer {
        call: id.into(),
        status,
        content_type: "application/json".into(),
        body,
        piece: Some(Piece {
            offset: 0,
            last: true,
            headers: Vec::new(),
        }),
    }
}

/// Checks a provider call against the grant: the token, the route and the
/// size. The call's own credential headers are dropped and the saved key is
/// the only credential the provider receives.
fn screen(grant: &Grant, id: &str, call: &Value) -> Result<Upstream, Answer> {
    let shape = &protocol().provider_proxy;
    let provider = grant.provider;
    let refuse = |status: u16, message: &str| whole(id, status, provider.error(status, message));
    let path = call["path"].as_str().unwrap_or_default();
    let rest = path
        .strip_prefix(&shape.prefix)
        .and_then(|rest| rest.strip_prefix(provider.name()))
        .filter(|rest| rest.starts_with('/'))
        .ok_or_else(|| refuse(404, "This provider is not proxied for this run."))?;
    let route = rest.split('?').next().unwrap_or_default();
    let method = call["method"].as_str().unwrap_or_default();
    if rest.contains("..") || !provider.allows(method, route) {
        return Err(refuse(
            404,
            "Jackalope's provider proxy does not forward this request.",
        ));
    }
    let empty = serde_json::Map::new();
    let headers = call["headers"].as_object().unwrap_or(&empty);
    if !grant.admits(headers) {
        return Err(refuse(
            401,
            "This run's provider token is not valid or has expired.",
        ));
    }
    let body = decoded(call).ok_or_else(|| refuse(400, "The request body is unreadable."))?;
    if body.len() > shape.request_limit {
        return Err(refuse(
            413,
            &format!(
                "Requests through Jackalope's provider proxy are limited to {} MB.",
                shape.request_limit / (1024 * 1024)
            ),
        ));
    }
    let mut forwarded: Vec<(String, String)> = headers
        .iter()
        .filter_map(|(name, value)| {
            let name = name.to_ascii_lowercase();
            (shape.headers.contains(&name) && !shape.credential_headers.contains(&name))
                .then(|| Some((name, value.as_str()?.to_string())))
                .flatten()
        })
        .collect();
    forwarded.push(match provider {
        Provider::Anthropic => ("x-api-key".into(), grant.credential.clone()),
        Provider::OpenAi => (
            "authorization".into(),
            format!("Bearer {}", grant.credential),
        ),
    });
    Ok(Upstream {
        method: if method == "GET" {
            reqwest::Method::GET
        } else {
            reqwest::Method::POST
        },
        url: format!("{}{rest}", grant.upstream),
        headers: forwarded,
        body,
    })
}

/// Calls the relay has stopped forwarding, because the agent hung up.
pub(crate) type Gone = Arc<Mutex<HashSet<String>>>;

/// Forwards one provider call and streams its answer back as pieces, each
/// sent as soon as it arrives. Stops early when the agent hangs up (`gone`).
pub(crate) async fn forward(
    grant: Arc<Grant>,
    id: String,
    call: Value,
    sender: Sender<Answer>,
    gone: Gone,
) {
    let usage = &grant.usage;
    usage.requests.fetch_add(1, Ordering::SeqCst);
    let upstream = match screen(&grant, &id, &call) {
        Ok(upstream) => upstream,
        Err(answer) => {
            usage.refused.fetch_add(1, Ordering::SeqCst);
            let _ = sender.send(answer);
            return;
        }
    };
    let failed = |message: String| {
        usage.failed.fetch_add(1, Ordering::SeqCst);
        whole(&id, 502, grant.provider.error(502, &message))
    };
    let client = match crate::commands::http::client(ANSWER_TIMEOUT) {
        Ok(client) => client,
        Err(error) => {
            let _ = sender.send(failed(format!(
                "Jackalope could not reach {}: {error}",
                grant.provider.label()
            )));
            return;
        }
    };
    let mut request = client
        .request(upstream.method, &upstream.url)
        .body(upstream.body);
    for (name, value) in &upstream.headers {
        request = request.header(name, value);
    }
    let mut response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            let _ = sender.send(failed(format!(
                "{} did not answer Jackalope's provider proxy: {}",
                grant.provider.label(),
                error.without_url()
            )));
            return;
        }
    };
    let status = response.status().as_u16();
    if status >= 400 {
        usage.failed.fetch_add(1, Ordering::SeqCst);
    }
    let names = &protocol().provider_proxy.response_headers;
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter(|(name, _)| names.iter().any(|known| known == name.as_str()))
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let piece_limit = protocol().provider_proxy.piece_limit;
    let mut offset = 0u64;
    let mut first = Some(headers);
    let mut send = |body: &[u8], last: bool| {
        if gone.lock().map_or(true, |gone| gone.contains(&id)) {
            return false;
        }
        let answer = Answer {
            call: id.clone(),
            status,
            content_type: content_type.clone(),
            body: body.to_vec(),
            piece: Some(Piece {
                offset,
                last,
                headers: first.take().unwrap_or_default(),
            }),
        };
        offset += body.len() as u64;
        sender.send(answer).is_ok()
    };
    // The status and headers go at once, before the first token.
    if !send(&[], false) {
        return;
    }
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if offset + (chunk.len() as u64) <= ANSWER_LIMIT => {
                for part in chunk.chunks(piece_limit) {
                    if !send(part, false) {
                        return;
                    }
                }
            }
            Ok(None) => {
                send(&[], true);
                return;
            }
            // Too large, or cut off: the agent sees the stream end early.
            Ok(Some(_)) | Err(_) => {
                usage.failed.fetch_add(1, Ordering::SeqCst);
                send(&[], true);
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::io::{BufRead, BufReader, Read, Write};

    fn call(path: &str, headers: Value, body: &[u8]) -> Value {
        json!({
            "id": "00112233445566778899",
            "method": "POST",
            "path": path,
            "headers": headers,
            "body": base64::engine::general_purpose::STANDARD.encode(body),
        })
    }

    fn anthropic(upstream: &str) -> Grant {
        Grant::new(
            Provider::Anthropic,
            "sk-ant-real-key-0123456789".into(),
            upstream,
            LIFETIME,
        )
    }

    #[test]
    fn the_saved_key_replaces_every_credential_the_computer_sends() {
        let grant = anthropic("https://api.anthropic.com");
        let token = grant.token.clone();
        let upstream = screen(
            &grant,
            "c",
            &call(
                "/provider/anthropic/v1/messages?beta=true",
                json!({
                    "x-api-key": token,
                    "Authorization": format!("Bearer {token}"),
                    "content-type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "cookie": "session=1",
                    "x-forwarded-for": "10.0.0.1",
                }),
                b"{}",
            ),
        )
        .unwrap();
        assert_eq!(
            upstream.url,
            "https://api.anthropic.com/v1/messages?beta=true"
        );
        let names: Vec<&str> = upstream.headers.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["content-type", "anthropic-version", "x-api-key"]);
        assert_eq!(upstream.headers[2].1, "sk-ant-real-key-0123456789");
        assert!(upstream
            .headers
            .iter()
            .all(|(_, value)| !value.contains(&grant.token)));

        let openai = Grant::new(
            Provider::OpenAi,
            "sk-openai-real".into(),
            "https://api.openai.com",
            LIFETIME,
        );
        let upstream = screen(
            &openai,
            "c",
            &call(
                "/provider/openai/v1/responses",
                json!({"authorization": format!("Bearer {}", openai.token), "openai-organization": "org-x"}),
                b"{}",
            ),
        )
        .unwrap();
        assert_eq!(
            upstream.headers,
            [("authorization".into(), "Bearer sk-openai-real".into())]
        );
        assert!(screen(
            &openai,
            "c",
            &call(
                "/provider/openai/v1/chat/completions",
                json!({"authorization": format!("Bearer {}", openai.token)}),
                b"{}"
            )
        )
        .is_ok());
    }

    #[test]
    fn wrong_expired_and_revoked_tokens_routes_and_sizes_are_refused() {
        let grant = anthropic("https://api.anthropic.com");
        let good = json!({"x-api-key": grant.token.clone()});
        let status = |grant: &Grant, call: &Value| screen(grant, "c", call).unwrap_err().status;
        let messages = "/provider/anthropic/v1/messages";
        assert_eq!(
            status(
                &grant,
                &call(messages, json!({"x-api-key": "sk-ant-real-key-0123456789"}), b"{}")
            ),
            401
        );
        assert_eq!(status(&grant, &call(messages, json!({}), b"{}")), 401);
        for path in [
            "/provider/openai/v1/responses",
            "/provider/anthropic/v1/complete",
            "/provider/anthropic/v1/messages/../files",
            "/provider/anthropicx/v1/messages",
        ] {
            assert_eq!(status(&grant, &call(path, good.clone(), b"{}")), 404, "{path}");
        }
        let large = vec![b'x'; protocol().provider_proxy.request_limit + 1];
        let refused = screen(&grant, "c", &call(messages, good.clone(), &large)).unwrap_err();
        assert_eq!(refused.status, 413);
        let body: Value = serde_json::from_slice(&refused.body).unwrap();
        assert_eq!(body["type"], "error");
        assert!(body["error"]["message"].as_str().unwrap().contains("16 MB"));

        assert!(screen(&grant, "c", &call(messages, good.clone(), b"{}")).is_ok());
        grant.revoke();
        assert_eq!(status(&grant, &call(messages, good.clone(), b"{}")), 401);

        let expired = Grant::new(
            Provider::Anthropic,
            "sk-ant-real-key-0123456789".into(),
            "https://api.anthropic.com",
            Duration::from_millis(30),
        );
        let fresh = json!({"x-api-key": expired.token.clone()});
        assert!(screen(&expired, "c", &call(messages, fresh.clone(), b"{}")).is_ok());
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(status(&expired, &call(messages, fresh, b"{}")), 401);
    }

    #[test]
    fn runs_get_the_token_and_base_url_instead_of_the_key() {
        let grant = anthropic("https://api.anthropic.com");
        let mut argv = vec!["claude".to_string(), "-p".into()];
        let mut env: Environment = vec![
            ("ANTHROPIC_API_KEY".into(), grant.credential.clone()),
            ("ANTHROPIC_AUTH_TOKEN".into(), "other".into()),
            ("PATH_EXTRA".into(), "kept".into()),
        ];
        grant.apply("claude", &mut argv, &mut env);
        assert_eq!(argv, ["claude", "-p"]);
        assert!(env.iter().all(|(_, value)| value != &grant.credential));
        assert!(env.contains(&("ANTHROPIC_API_KEY".into(), grant.token.clone())));
        assert!(env.contains(&(
            "ANTHROPIC_BASE_URL".into(),
            format!("{}/provider/anthropic", relay_url())
        )));
        assert!(env.iter().all(|(name, _)| name != "ANTHROPIC_AUTH_TOKEN"));

        let openai = Grant::new(
            Provider::OpenAi,
            "sk-openai-real".into(),
            "https://api.openai.com",
            LIFETIME,
        );
        let mut argv: Vec<String> = ["codex", "exec", "-c", "sandbox_mode=\"x\"", "--json"]
            .map(String::from)
            .to_vec();
        let mut env: Environment = vec![
            ("CODEX_API_KEY".into(), "sk-openai-real".into()),
            ("OPENAI_API_KEY".into(), "sk-openai-real".into()),
        ];
        openai.apply("codex", &mut argv, &mut env);
        let base = format!("{}/provider/openai/v1", relay_url());
        assert_eq!(
            argv,
            [
                "codex".to_string(),
                "exec".into(),
                "-c".into(),
                format!("openai_base_url=\"{base}\""),
                "-c".into(),
                "sandbox_mode=\"x\"".into(),
                "--json".into(),
            ]
        );
        assert!(env.contains(&("OPENAI_BASE_URL".into(), base)));
        assert!(env.iter().all(|(_, value)| value != "sk-openai-real"));
        assert_eq!(
            env.iter().filter(|(_, value)| value == &openai.token).count(),
            2
        );
    }

    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // Linux CI has no Secret Service keyring to hold the saved sign-in.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn subscription_tokens_stay_on_the_current_path() {
        let root = Scratch(
            std::env::temp_dir().join(format!("jackalope-proxy-{}", uuid::Uuid::new_v4())),
        );
        std::fs::create_dir_all(root.path()).unwrap();
        super::super::credentials::set(
            root.path(),
            "claude-token",
            Some("sk-ant-oat01-0123456789abcdef"),
        )
        .unwrap();
        let reason = grant(root.path(), "claude").unwrap_err();
        assert!(reason.contains("API keys only"), "{reason}");
        super::super::credentials::set(root.path(), "claude-token", None).unwrap();
        super::super::credentials::set(
            root.path(),
            "anthropic-key",
            Some("sk-ant-api03-0123456789abcdef"),
        )
        .unwrap();
        let granted = grant(root.path(), "claude").unwrap();
        assert_eq!(granted.provider(), Provider::Anthropic);
        assert!(!format!("{granted:?}").contains("sk-ant-api03"));
    }

    /// A provider stand-in that records the request and answers with SSE
    /// events, pausing between them.
    fn mock_upstream() -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut lines = Vec::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                lines.push(line.trim().to_string());
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            lines.push(String::from_utf8(body).unwrap());
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nrequest-id: req_1\r\nset-cookie: a=b\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n"
            )
            .unwrap();
            for event in ["event: message_start\ndata: {}\n\n", "event: message_stop\ndata: {}\n\n"] {
                write!(stream, "{:x}\r\n{event}\r\n", event.len()).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(Duration::from_millis(300));
            }
            write!(stream, "0\r\n\r\n").unwrap();
            lines
        });
        (address, server)
    }

    #[test]
    fn streams_pass_through_in_order_as_they_arrive() {
        let (upstream, server) = mock_upstream();
        let grant = Arc::new(anthropic(&upstream));
        let (sender, receiver) = std::sync::mpsc::channel();
        let gone: Gone = Default::default();
        let request = call(
            "/provider/anthropic/v1/messages",
            json!({"x-api-key": grant.token.clone(), "content-type": "application/json"}),
            br#"{"stream":true}"#,
        );
        let thread = {
            let grant = grant.clone();
            std::thread::spawn(move || {
                super::super::remote::block(forward(
                    grant,
                    "00112233445566778899".into(),
                    request,
                    sender,
                    gone,
                ))
            })
        };
        let started = Instant::now();
        let mut pieces = Vec::new();
        while let Ok(answer) = receiver.recv_timeout(Duration::from_secs(20)) {
            pieces.push((started.elapsed(), answer));
        }
        thread.join().unwrap();
        let request = server.join().unwrap();
        assert!(request.iter().any(|line| line == "x-api-key: sk-ant-real-key-0123456789"));
        assert!(request.iter().all(|line| !line.contains(&grant.token)));
        assert_eq!(request.last().unwrap(), r#"{"stream":true}"#);

        let first = &pieces[0].1;
        assert_eq!(first.status, 200);
        assert_eq!(first.content_type, "text/event-stream");
        let piece = first.piece.as_ref().unwrap();
        assert_eq!(piece.headers, [("request-id".to_string(), "req_1".to_string())]);
        let body: Vec<u8> = pieces.iter().flat_map(|(_, a)| a.body.clone()).collect();
        assert_eq!(
            String::from_utf8(body).unwrap(),
            "event: message_start\ndata: {}\n\nevent: message_stop\ndata: {}\n\n"
        );
        // Offsets are continuous, only the final piece is last, and the first
        // event arrived before the stream ended.
        let mut offset = 0;
        for (index, (_, answer)) in pieces.iter().enumerate() {
            let piece = answer.piece.as_ref().unwrap();
            assert_eq!(piece.offset, offset);
            assert_eq!(piece.last, index == pieces.len() - 1);
            offset += answer.body.len() as u64;
        }
        let first_event = pieces
            .iter()
            .find(|(_, answer)| !answer.body.is_empty())
            .unwrap()
            .0;
        assert!(first_event + Duration::from_millis(250) < pieces.last().unwrap().0);
        assert_eq!(grant.counts(), (1, 0, 0));
        assert!(grant.summary("Box").unwrap().contains("1 request from Box"));
    }

    #[test]
    fn refused_calls_never_reach_the_provider() {
        let grant = Arc::new(anthropic("http://127.0.0.1:9"));
        let (sender, receiver) = std::sync::mpsc::channel();
        super::super::remote::block(forward(
            grant.clone(),
            "c".into(),
            call(
                "/provider/anthropic/v1/messages",
                json!({"authorization": "Bearer guess"}),
                b"{}",
            ),
            sender,
            Default::default(),
        ));
        let answer = receiver.recv().unwrap();
        assert_eq!(answer.status, 401);
        assert!(answer.piece.unwrap().last);
        assert_eq!(grant.counts(), (1, 0, 1));
    }
}
