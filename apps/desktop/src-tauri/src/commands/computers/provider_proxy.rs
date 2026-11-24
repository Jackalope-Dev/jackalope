//! Agent API keys that stay on this device for agents on a computer.
//!
//! With **Keep API keys on this device** on (Settings → Computers, beta, off by
//! default), an agent on a computer that would get an Anthropic or OpenAI API
//! key gets a per-attempt token and a base URL on its runner's relay instead.
//! The runner queues each request it receives there like a bridge call,
//! [`super::relay::Relay`] hands it to [`forward`], which checks the token and
//! the route, replaces every credential header with the saved key and sends it
//! to the provider, and the answer streams back in `run_answer` pieces. No new
//! port is opened: the provider is reached only through the runs connection.
//!
//! Claude Code sign-in tokens (`CLAUDE_CODE_OAUTH_TOKEN`) are not proxied.
//! Claude Code sets the headers and endpoints a subscription sign-in needs
//! itself, so they keep going to the computer as before.

use super::credentials::Kind;
use super::protocol::protocol;
use super::relay::{Answer, Piece};
use super::runs::{relay_url, Environment};
use crate::commands::redaction::KnownSecrets;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering},
        mpsc::Sender,
        Arc,
    },
    time::{Duration, Instant},
};

/// The longest an attempt's token is honoured: the six-hour run limit plus the
/// lost-contact window. A token is also revoked when its attempt ends.
const LIFETIME: Duration = Duration::from_secs(7 * 3600);
/// The longest one provider answer may stream.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// The most response bytes one provider answer may carry.
const ANSWER_LIMIT: u64 = 64 * 1024 * 1024;
/// Bytes of one stream sent towards the runner and not yet delivered. The
/// provider's answer is not read further until the runner takes some, so a
/// runner that reads slowly holds back the provider instead of filling this
/// device's memory.
pub(crate) const STREAM_BUFFER: usize = 1024 * 1024;
/// Provider requests one attempt may have streaming at once; more are refused
/// with 429 until one ends. With [`STREAM_BUFFER`] this bounds what an attempt
/// can hold here.
pub(crate) const STREAMS: usize = 8;
/// OpenAI request features refused for a token: background responses keep
/// running, and billing, after the token is revoked, and hosted MCP and code
/// interpreter tools reach other services from the provider.
const OPENAI_REFUSED_TOOLS: &[&str] = &["mcp", "code_interpreter"];
/// The most bytes of a provider error answer, which is read whole so the saved
/// key can be removed from it before it leaves this device. It fits one piece
/// (`providerProxy.pieceLimit`).
const ERROR_LIMIT: usize = 256 * 1024;

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

    /// The exact provider routes an agent may call: Anthropic Messages and its
    /// token count, OpenAI Responses (with compaction) and Chat Completions,
    /// and each provider's model list. Anything else, such as files, batches or
    /// administration, is refused, so a token can only run models.
    fn allows(self, method: &str, route: &str) -> bool {
        match (self, method) {
            (_, "GET") => route == "/v1/models",
            (Self::Anthropic, "POST") => {
                matches!(route, "/v1/messages" | "/v1/messages/count_tokens")
            }
            (Self::OpenAi, "POST") => matches!(
                route,
                "/v1/responses" | "/v1/responses/compact" | "/v1/chat/completions"
            ),
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
    /// The key and the token, removed from anything sent back to the computer.
    secrets: Option<KnownSecrets>,
    pub usage: Usage,
}

impl std::fmt::Debug for Grant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Grant")
            .field("provider", &self.provider)
            .finish_non_exhaustive()
    }
}

/// What an agent on a computer signs in with, built from one read of its
/// saved credential so the run's variables and the grant always agree.
pub(crate) struct SignIn {
    /// Variables the run gets. Empty when a grant stands in for an API key, so
    /// the key is never in the run's environment.
    pub env: Environment,
    pub grant: Option<Grant>,
    /// Why the credential goes to the computer although the setting is on.
    pub note: Option<String>,
}

/// The sign-in for a run from `chosen`, the result of reading its saved
/// credential ([`super::credentials::chosen`]). With `keep` (Keep API keys on
/// this device) an API key becomes a grant and nothing else; a Claude Code
/// sign-in token goes to the computer as before, with a note. A failed read
/// fails the attempt either way, so nothing falls back to sending the key.
pub(crate) fn sign_in(
    chosen: Result<(&'static Kind, String), String>,
    keep: bool,
) -> Result<SignIn, String> {
    let (kind, value) = chosen?;
    if !keep {
        return Ok(SignIn {
            env: kind.environment(&value),
            grant: None,
            note: None,
        });
    }
    match Provider::for_credential(kind.id) {
        Some(provider) => Ok(SignIn {
            env: Vec::new(),
            grant: Some(Grant::new(provider, value, provider.upstream(), LIFETIME)),
            note: None,
        }),
        None if kind.variables == ["CLAUDE_CODE_OAUTH_TOKEN"] => Ok(SignIn {
            env: kind.environment(&value),
            grant: None,
            note: Some(format!(
                "Keep API keys on this device covers API keys only, so the {} goes to the computer as before.",
                kind.label
            )),
        }),
        None => Err(format!(
            "Keep API keys on this device is on, but the {} cannot stay on this device, so the agent did not start. Turn the setting off in Settings → Computers to send it to the computer.",
            kind.label
        )),
    }
}

impl Grant {
    pub fn new(provider: Provider, credential: String, upstream: &str, lifetime: Duration) -> Self {
        let token = format!(
            "jkp-{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        Self {
            secrets: KnownSecrets::new([credential.clone(), token.clone()]),
            token,
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

    /// The saved key and the run's token, for the attempt's redaction. The key
    /// never reaches the run; it is protected in its record anyway.
    pub fn protected(&self) -> Vec<String> {
        vec![self.credential.clone(), self.token.clone()]
    }

    fn scrub(&self, text: &str) -> String {
        match &self.secrets {
            Some(secrets) => secrets.redacted(text).into_owned(),
            None => text.to_string(),
        }
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
    /// older, deprecated form, kept for older Codex versions). Applied after
    /// project secrets, so none of them can point the agent elsewhere.
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
        env.retain(|(name, value)| !replaced.contains(&name.as_str()) && value != &self.credential);
        env.extend(given.into_iter().map(|(name, value)| (name.into(), value)));
        if adapter == "codex" {
            // `-c openai_base_url=…` given earlier is replaced, value and flag.
            let mut index = 0;
            while index < argv.len() {
                if argv[index] == "-c"
                    && argv
                        .get(index + 1)
                        .is_some_and(|value| value.starts_with("openai_base_url="))
                {
                    argv.drain(index..index + 2);
                } else {
                    index += 1;
                }
            }
            let at = argv
                .iter()
                .position(|arg| arg == "-c")
                .unwrap_or(argv.len().min(1));
            let value = toml::Value::String(base).to_string();
            argv.splice(at..at, ["-c".into(), format!("openai_base_url={value}")]);
        }
    }

    /// Stops honouring the token, for an attempt that ended.
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
        let (requests, failed, refused) = self.counts();
        if requests == 0 {
            return None;
        }
        let mut text = format!(
            "Keep API keys on this device: {requests} {} from {computer} reached {} with the API key kept on this device",
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

    /// Requests, failed and refused.
    fn counts(&self) -> (u32, u32, u32) {
        (
            self.usage.requests.load(Ordering::SeqCst),
            self.usage.failed.load(Ordering::SeqCst),
            self.usage.refused.load(Ordering::SeqCst),
        )
    }
}

/// A run's grant, revoked once its holder is dropped, whether the attempt
/// ended, failed or was canceled. The relay and its streams share the grant.
pub(crate) struct Held(Arc<Grant>);

impl Held {
    pub fn new(grant: Grant) -> Self {
        Self(Arc::new(grant))
    }

    pub fn shared(&self) -> Arc<Grant> {
        self.0.clone()
    }
}

impl std::ops::Deref for Held {
    type Target = Grant;

    fn deref(&self) -> &Grant {
        &self.0
    }
}

impl Drop for Held {
    fn drop(&mut self) {
        self.0.revoke();
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

/// A provider request ready to send. Its headers hold the saved key, so its
/// debug form names them without values.
struct Upstream {
    method: reqwest::Method,
    url: reqwest::Url,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl std::fmt::Debug for Upstream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Upstream")
            .field("method", &self.method)
            .field("url", &self.url.as_str())
            .field(
                "headers",
                &self
                    .headers
                    .iter()
                    .map(|(name, _)| name)
                    .collect::<Vec<_>>(),
            )
            .finish_non_exhaustive()
    }
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

/// The route and query of a provider call, accepted only in a plain form:
/// path segments of letters, digits, `_` and `-`, and a query of those plus
/// `.`, `=` and `&`. Percent escapes, backslashes, dot segments, empty
/// segments and fragments never pass, so nothing the URL parser or the
/// provider would decode or normalize can reach a route other than the one
/// checked.
fn plain_route(rest: &str) -> Option<(&str, Option<&str>)> {
    let (path, query) = match rest.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (rest, None),
    };
    let segment = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    };
    let path_ok = path
        .strip_prefix('/')
        .is_some_and(|inner| inner.split('/').all(segment));
    let query_ok = query.map_or(true, |query| {
        !query.is_empty()
            && query
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-.=&".contains(&byte))
    });
    (path_ok && query_ok).then_some((path, query))
}

/// The provider URL for `route`, checked again after parsing: the same scheme,
/// host and port as the provider, no user information or fragment, and exactly
/// the route and query that were allowed.
fn upstream_url(upstream: &str, route: &str, query: Option<&str>) -> Option<reqwest::Url> {
    let base = reqwest::Url::parse(upstream).ok()?;
    let text = match query {
        Some(query) => format!("{upstream}{route}?{query}"),
        None => format!("{upstream}{route}"),
    };
    let url = reqwest::Url::parse(&text).ok()?;
    let expected_path = format!("{}{route}", base.path().trim_end_matches('/'));
    let same_place = url.scheme() == base.scheme()
        && url.host_str() == base.host_str()
        && url.port_or_known_default() == base.port_or_known_default()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.path() == expected_path
        && url.query() == query;
    same_place.then_some(url)
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
        .filter(|_| shape.providers.iter().any(|name| name == provider.name()))
        .ok_or_else(|| refuse(404, "This provider is not proxied for this run."))?;
    let not_forwarded = || {
        refuse(
            404,
            "Jackalope does not forward this request to the provider.",
        )
    };
    let method = call["method"].as_str().unwrap_or_default();
    let (route, query) = plain_route(rest).ok_or_else(not_forwarded)?;
    if !provider.allows(method, route) {
        return Err(not_forwarded());
    }
    let url = upstream_url(&grant.upstream, route, query).ok_or_else(not_forwarded)?;
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
                "Requests to the provider through Jackalope are limited to {} MB.",
                shape.request_limit / (1024 * 1024)
            ),
        ));
    }
    if headers.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case("content-encoding")
            && !value
                .as_str()
                .is_some_and(|value| value.eq_ignore_ascii_case("identity"))
    }) {
        return Err(refuse(
            415,
            "Jackalope forwards only uncompressed requests to the provider.",
        ));
    }
    if provider == Provider::OpenAi {
        if let Some(reason) = openai_refusal(route, &body) {
            return Err(refuse(400, reason));
        }
    }
    let mut forwarded: Vec<(String, String)> = headers
        .iter()
        .filter_map(|(name, value)| {
            let name = name.to_ascii_lowercase();
            if !shape.headers.contains(&name) || shape.credential_headers.contains(&name) {
                return None;
            }
            let value = value.as_str()?;
            if name == "anthropic-beta" {
                return allowed_betas(value).map(|kept| (name, kept));
            }
            Some((name, value.to_string()))
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
        url,
        headers: forwarded,
        body,
    })
}

/// One provider stream's controls, shared by [`forward`] and the relay.
#[derive(Clone, Default)]
pub(crate) struct Flow {
    stop: Arc<AtomicBool>,
    /// Bytes sent towards the runner and not yet delivered.
    buffered: Arc<AtomicUsize>,
}

impl Flow {
    /// Ends the stream: nothing more is read or sent.
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    /// Records `bytes` of the stream delivered to the runner.
    pub fn delivered(&self, bytes: usize) {
        let _ = self
            .buffered
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |held| {
                Some(held.saturating_sub(bytes))
            });
    }

    #[cfg(test)]
    pub fn buffered(&self) -> usize {
        self.buffered.load(Ordering::SeqCst)
    }

    /// Records `bytes` sent towards the runner, as [`forward`] does.
    #[cfg(test)]
    pub fn held(&self, bytes: usize) {
        self.buffered.fetch_add(bytes, Ordering::SeqCst);
    }

    /// Waits until the stream may send more; false once it was stopped.
    async fn room(&self) -> bool {
        while self.buffered.load(Ordering::SeqCst) >= STREAM_BUFFER {
            if self.stopped() {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        !self.stopped()
    }
}

/// The `anthropic-beta` values forwarded: only those of families Claude Code
/// sends (`providerProxy.anthropicBetas`). The rest, such as the MCP
/// connector, code execution, the Files API, Skills and web fetch, are
/// dropped, so a token cannot turn on features that reach other services or
/// store data with the provider.
fn allowed_betas(value: &str) -> Option<String> {
    let families = &protocol().provider_proxy.anthropic_betas;
    let kept: Vec<&str> = value
        .split(',')
        .map(str::trim)
        .filter(|beta| {
            beta.bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
                && families.iter().any(|family| {
                    beta.strip_prefix(family.as_str()).is_some_and(|date| {
                        !date.is_empty() && date.bytes().all(|b| b.is_ascii_digit() || b == b'-')
                    })
                })
        })
        .collect();
    (!kept.is_empty()).then(|| kept.join(","))
}

/// Why an OpenAI Responses request is refused: a background response, or a
/// hosted tool in [`OPENAI_REFUSED_TOOLS`]. A body that is not JSON cannot be
/// checked, so it is refused too.
fn openai_refusal(route: &str, body: &[u8]) -> Option<&'static str> {
    if !route.starts_with("/v1/responses") {
        return None;
    }
    let Ok(request) = serde_json::from_slice::<Value>(body) else {
        return Some("Jackalope can only forward a JSON Responses request.");
    };
    if request["background"] == true {
        return Some("Background responses are not forwarded: they would keep running after this run's token stops working.");
    }
    let hosted = request["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|tool| {
            tool["type"]
                .as_str()
                .is_some_and(|kind| OPENAI_REFUSED_TOOLS.contains(&kind))
        });
    hosted
        .then_some("Hosted MCP and code interpreter tools are not forwarded with this run's token.")
}

/// Forwards one provider call and streams its answer back as pieces, each
/// sent as soon as it arrives and while the stream's buffer has room
/// ([`STREAM_BUFFER`]). Stops early once the flow is stopped, when the agent
/// hung up or the run ended. An error answer is read whole, up to
/// [`ERROR_LIMIT`], and sent with the key and token removed.
pub(crate) async fn forward(
    grant: Arc<Grant>,
    id: String,
    call: Value,
    sender: Sender<Answer>,
    flow: Flow,
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
    let label = grant.provider.label();
    let failed = |message: String| {
        usage.failed.fetch_add(1, Ordering::SeqCst);
        whole(&id, 502, grant.provider.error(502, &grant.scrub(&message)))
    };
    let client = match crate::commands::http::client(ANSWER_TIMEOUT) {
        Ok(client) => client,
        Err(error) => {
            let _ = sender.send(failed(format!(
                "Jackalope could not reach {label}: {error}"
            )));
            return;
        }
    };
    let mut request = client
        .request(upstream.method, upstream.url)
        .body(upstream.body);
    for (name, value) in &upstream.headers {
        request = request.header(name, value);
    }
    let mut response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            let _ = sender.send(failed(format!(
                "{label} did not answer through Jackalope: {}",
                error.without_url()
            )));
            return;
        }
    };
    let status = response.status().as_u16();
    let names = &protocol().provider_proxy.response_headers;
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter(|(name, _)| names.iter().any(|known| known == name.as_str()))
        .filter_map(|(name, value)| Some((name.to_string(), grant.scrub(value.to_str().ok()?))))
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
        if flow.stopped() {
            return false;
        }
        flow.buffered.fetch_add(body.len(), Ordering::SeqCst);
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
    if status >= 400 {
        usage.failed.fetch_add(1, Ordering::SeqCst);
        let mut body = Vec::new();
        while let Ok(Some(chunk)) = response.chunk().await {
            body.extend_from_slice(&chunk);
            if body.len() > ERROR_LIMIT {
                body.truncate(ERROR_LIMIT);
                break;
            }
        }
        // Replacing invalid UTF-8 can make the text longer than the bytes
        // read, so it is split into pieces again after scrubbing.
        let text = grant.scrub(&String::from_utf8_lossy(&body));
        let parts: Vec<&[u8]> = text.as_bytes().chunks(piece_limit).collect();
        if parts.is_empty() {
            send(&[], true);
        }
        for (index, part) in parts.iter().enumerate() {
            if !flow.room().await || !send(part, index + 1 == parts.len()) {
                return;
            }
        }
        return;
    }
    // The status and headers go at once, before the first token.
    if !send(&[], false) {
        return;
    }
    let mut received = 0u64;
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if received + (chunk.len() as u64) <= ANSWER_LIMIT => {
                received += chunk.len() as u64;
                for part in chunk.chunks(piece_limit) {
                    if !flow.room().await || !send(part, false) {
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
            upstream.url.as_str(),
            "https://api.anthropic.com/v1/messages?beta=true"
        );
        // The key never shows in the request's debug form.
        assert!(!format!("{upstream:?}").contains("sk-ant-real-key"));
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
                &call(
                    messages,
                    json!({"x-api-key": "sk-ant-real-key-0123456789"}),
                    b"{}"
                )
            ),
            401
        );
        assert_eq!(status(&grant, &call(messages, json!({}), b"{}")), 401);
        for path in [
            "/provider/openai/v1/responses",
            "/provider/anthropic/v1/complete",
            "/provider/anthropic/v1/messages/../files",
            "/provider/anthropic/v1/messages/batches",
            "/provider/anthropicx/v1/messages",
        ] {
            assert_eq!(
                status(&grant, &call(path, good.clone(), b"{}")),
                404,
                "{path}"
            );
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
        let mut argv: Vec<String> = [
            "codex",
            "exec",
            "-c",
            "openai_base_url=\"https://elsewhere\"",
            "-c",
            "sandbox_mode=\"x\"",
            "--json",
        ]
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
            env.iter()
                .filter(|(_, value)| value == &openai.token)
                .count(),
            2
        );
    }

    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn path(&self) -> &std::path::Path {
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
        let root =
            Scratch(std::env::temp_dir().join(format!("jackalope-proxy-{}", uuid::Uuid::new_v4())));
        std::fs::create_dir_all(root.path()).unwrap();
        let read = || super::super::credentials::chosen(root.path(), "claude");
        super::super::credentials::set(
            root.path(),
            "claude-token",
            Some("sk-ant-oat01-0123456789abcdef"),
        )
        .unwrap();
        let token = sign_in(read(), true).unwrap();
        assert!(token.grant.is_none());
        assert!(token.note.unwrap().contains("API keys only"));
        assert_eq!(token.env[0].0, "CLAUDE_CODE_OAUTH_TOKEN");
        super::super::credentials::set(root.path(), "claude-token", None).unwrap();
        super::super::credentials::set(
            root.path(),
            "anthropic-key",
            Some("sk-ant-api03-0123456789abcdef"),
        )
        .unwrap();
        let granted = sign_in(read(), true).unwrap();
        assert!(granted.env.is_empty());
        let grant = granted.grant.unwrap();
        assert_eq!(grant.provider(), Provider::Anthropic);
        assert!(!format!("{grant:?}").contains("sk-ant-api03"));
    }

    fn kind(id: &str) -> &'static Kind {
        super::super::credentials::KINDS
            .iter()
            .find(|kind| kind.id == id)
            .unwrap()
    }

    #[test]
    fn a_failed_credential_read_never_falls_back_to_sending_the_key() {
        // The keychain refused or failed: the attempt fails, setting on or off.
        for keep in [true, false] {
            let error = sign_in(Err("The keychain is locked.".into()), keep)
                .err()
                .unwrap();
            assert!(error.contains("keychain is locked"), "{error}");
        }
        let key = "sk-ant-api03-from-the-one-read-0123";
        let kept = sign_in(Ok((kind("anthropic-key"), key.into())), true).unwrap();
        assert!(kept.env.is_empty() && kept.note.is_none());
        assert_eq!(kept.grant.unwrap().protected()[0], key);
        let sent = sign_in(Ok((kind("anthropic-key"), key.into())), false).unwrap();
        assert!(sent.grant.is_none());
        assert_eq!(
            sent.env,
            [("ANTHROPIC_API_KEY".to_string(), key.to_string())]
        );
        let openai = sign_in(
            Ok((kind("openai-key"), "sk-proj-one-read-0123456789".into())),
            true,
        )
        .unwrap();
        assert!(openai.env.is_empty());
        assert_eq!(openai.grant.unwrap().provider(), Provider::OpenAi);
    }

    #[test]
    fn a_credential_changed_between_reads_cannot_reach_the_run() {
        // The command is translated with the one read's variables; a key that
        // differs from the granted one (saved again in between) is removed by
        // value as well as by name.
        let granted = sign_in(
            Ok((kind("anthropic-key"), "sk-ant-api03-first-0123456".into())),
            true,
        )
        .unwrap();
        let grant = granted.grant.unwrap();
        assert!(granted.env.is_empty());
        let mut argv = vec!["claude".to_string()];
        let mut env: Environment = vec![
            (
                "ANTHROPIC_API_KEY".into(),
                "sk-ant-api03-second-0123456".into(),
            ),
            ("EXTRA".into(), "sk-ant-api03-first-0123456".into()),
        ];
        grant.apply("claude", &mut argv, &mut env);
        assert!(
            env.iter().all(|(_, value)| !value.contains("sk-ant-api03")),
            "{env:?}"
        );
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
            for event in [
                "event: message_start\ndata: {}\n\n",
                "event: message_stop\ndata: {}\n\n",
            ] {
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
        let flow = Flow::default();
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
                    flow,
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
        assert!(request
            .iter()
            .any(|line| line == "x-api-key: sk-ant-real-key-0123456789"));
        assert!(request.iter().all(|line| !line.contains(&grant.token)));
        assert_eq!(request.last().unwrap(), r#"{"stream":true}"#);

        let first = &pieces[0].1;
        assert_eq!(first.status, 200);
        assert_eq!(first.content_type, "text/event-stream");
        let piece = first.piece.as_ref().unwrap();
        assert_eq!(
            piece.headers,
            [("request-id".to_string(), "req_1".to_string())]
        );
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
    fn encoded_and_disguised_routes_never_reach_another_endpoint() {
        let grant = anthropic("https://api.anthropic.com");
        let good = json!({"x-api-key": grant.token.clone()});
        for path in [
            // Percent-encoded and double-encoded dot segments and slashes.
            "/provider/anthropic/v1/messages/%2e%2e/files",
            "/provider/anthropic/v1/messages/%2E%2E/%2E%2E/v1/files",
            "/provider/anthropic/v1/messages/%252e%252e/files",
            "/provider/anthropic/v1/messages%2f..%2ffiles",
            "/provider/anthropic/v1%2fmessages",
            "/provider/anthropic/%761/messages",
            // Backslashes, which URL parsers treat as slashes.
            "/provider/anthropic/v1/messages\\..\\files",
            "/provider/anthropic/v1\\messages",
            // Dot and empty segments.
            "/provider/anthropic/v1/./messages",
            "/provider/anthropic/v1//messages",
            "/provider/anthropic/v1/messages/.",
            "/provider/anthropic/v1/messages/",
            // Query and fragment tricks.
            "/provider/anthropic/v1/messages#/../files",
            "/provider/anthropic/v1/messages?x=/../../files",
            "/provider/anthropic/v1/messages?x=%2e%2e",
            "/provider/anthropic/v1/messages?",
            "/provider/anthropic/v1/messages?@evil.example",
            "/provider/anthropic/v1/messages?#",
            "/provider/anthropic@evil.example/v1/messages",
            "/provider/anthropic/v1/messages;x=1",
            "/provider/anthropic/v1/messages\u{0}",
            "/provider/anthropic/v1/messages\t",
            "/provider/anthropic/v1/mess\u{e1}ges",
        ] {
            let refused = screen(&grant, "c", &call(path, good.clone(), b"{}")).unwrap_err();
            assert_eq!(refused.status, 404, "{path}");
        }
        let get = |path: &str, method: &str| {
            let mut request = call(path, good.clone(), b"");
            request["method"] = json!(method);
            screen(&grant, "c", &request).map(|upstream| upstream.url.to_string())
        };
        assert_eq!(
            get("/provider/anthropic/v1/models", "GET").unwrap(),
            "https://api.anthropic.com/v1/models"
        );
        for method in ["DELETE", "PUT", "PATCH", "get"] {
            assert!(
                get("/provider/anthropic/v1/messages", method).is_err(),
                "{method}"
            );
        }
        assert!(get("/provider/anthropic/v1/messages/count_tokens", "POST").is_ok());
        assert_eq!(
            get("/provider/anthropic/v1/messages?beta=true", "POST").unwrap(),
            "https://api.anthropic.com/v1/messages?beta=true"
        );
    }

    #[test]
    fn parsed_urls_must_match_the_checked_route() {
        let upstream = "https://api.anthropic.com";
        assert!(upstream_url(upstream, "/v1/messages", None).is_some());
        assert!(upstream_url(upstream, "/v1/messages", Some("beta=true")).is_some());
        // Anything the parser would rewrite is refused, even past the plain check.
        assert!(upstream_url(upstream, "/v1/../v1/messages", None).is_none());
        assert!(upstream_url(upstream, "@evil.example/v1/messages", None).is_none());
        assert!(upstream_url(upstream, ".evil.example/v1/messages", None).is_none());
        assert!(upstream_url(upstream, ":444/v1/messages", None).is_none());
        assert!(upstream_url(upstream, "/v1/messages", Some("a#b")).is_none());
        assert!(upstream_url(upstream, "/v1/messages", Some("a b")).is_none());
    }

    #[test]
    fn error_answers_never_carry_the_key_back() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
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
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let reply = r#"{"error":{"message":"Key sk-ant-real-key-0123456789 is not allowed"}}"#;
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\nrequest-id: sk-ant-real-key-0123456789\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            )
            .unwrap();
        });
        let grant = Arc::new(anthropic(&address));
        let (sender, receiver) = std::sync::mpsc::channel();
        super::super::remote::block(forward(
            grant.clone(),
            "c".into(),
            call(
                "/provider/anthropic/v1/messages",
                json!({"x-api-key": grant.token.clone()}),
                b"{}",
            ),
            sender,
            Default::default(),
        ));
        server.join().unwrap();
        let answers: Vec<Answer> = receiver.try_iter().collect();
        assert_eq!(answers.len(), 1);
        let answer = &answers[0];
        assert_eq!(answer.status, 403);
        let piece = answer.piece.as_ref().unwrap();
        assert!(piece.last);
        let text = String::from_utf8(answer.body.clone()).unwrap();
        assert!(text.contains("is not allowed"), "{text}");
        assert!(
            !format!("{answer:?}").contains("sk-ant-real-key"),
            "{answer:?}"
        );
        assert_eq!(grant.counts(), (1, 1, 0));

        // A provider that never answers fails without naming the key.
        let unreachable = Arc::new(anthropic("http://127.0.0.1:9"));
        let (sender, receiver) = std::sync::mpsc::channel();
        super::super::remote::block(forward(
            unreachable.clone(),
            "d".into(),
            call(
                "/provider/anthropic/v1/messages",
                json!({"x-api-key": unreachable.token.clone()}),
                b"{}",
            ),
            sender,
            Default::default(),
        ));
        let answer = receiver.recv().unwrap();
        assert_eq!(answer.status, 502);
        assert!(!format!("{answer:?}").contains("sk-ant-real-key"));
    }

    #[test]
    fn a_stopped_stream_sends_nothing_more() {
        let (upstream, server) = mock_upstream();
        let grant = Arc::new(anthropic(&upstream));
        let (sender, receiver) = std::sync::mpsc::channel();
        let flow = Flow::default();
        let request = call(
            "/provider/anthropic/v1/messages",
            json!({"x-api-key": grant.token.clone()}),
            b"{}",
        );
        let thread = {
            let (grant, flow) = (grant.clone(), flow.clone());
            std::thread::spawn(move || {
                super::super::remote::block(forward(grant, "c".into(), request, sender, flow))
            })
        };
        let first = receiver.recv_timeout(Duration::from_secs(20)).unwrap();
        assert_eq!(first.piece.unwrap().offset, 0);
        flow.stop();
        let _ = server.join();
        thread.join().unwrap();
        // At most the piece already on its way when the stream stopped.
        let rest: Vec<Answer> = receiver.try_iter().collect();
        assert!(rest.len() <= 1, "{rest:?}");
        assert!(rest
            .iter()
            .all(|answer| !answer.piece.as_ref().unwrap().last));
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

    /// A provider stand-in that reads one request and writes `head` then
    /// `body`, ignoring a client that hangs up.
    fn answer_once(head: String, body: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
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
            }
            let mut request = vec![0; length];
            reader.read_exact(&mut request).unwrap();
            let mut stream = stream;
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        });
        (address, server)
    }

    fn run_forward(
        grant: &Arc<Grant>,
        flow: &Flow,
    ) -> (
        std::sync::mpsc::Receiver<Answer>,
        std::thread::JoinHandle<()>,
    ) {
        let (sender, receiver) = std::sync::mpsc::channel();
        let request = call(
            "/provider/anthropic/v1/messages",
            json!({"x-api-key": grant.token.clone()}),
            b"{}",
        );
        let (grant, flow) = (grant.clone(), flow.clone());
        let thread = std::thread::spawn(move || {
            super::super::remote::block(forward(grant, "c".into(), request, sender, flow))
        });
        (receiver, thread)
    }

    #[test]
    fn a_slow_runner_holds_the_provider_back_instead_of_filling_memory() {
        let size = 6 * STREAM_BUFFER;
        let (upstream, server) = answer_once(
            format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {size}\r\nconnection: close\r\n\r\n"),
            vec![b'x'; size],
        );
        let grant = Arc::new(anthropic(&upstream));
        let flow = Flow::default();
        let (receiver, thread) = run_forward(&grant, &flow);
        let quiet = |receiver: &std::sync::mpsc::Receiver<Answer>| {
            let mut bytes = 0;
            while let Ok(answer) = receiver.recv_timeout(Duration::from_millis(500)) {
                bytes += answer.body.len();
            }
            bytes
        };
        // Nothing is delivered, so reading stops once the buffer is full.
        let held = quiet(&receiver);
        let limit = STREAM_BUFFER + protocol().provider_proxy.piece_limit;
        assert!(held >= STREAM_BUFFER && held <= limit, "{held}");
        assert_eq!(flow.buffered(), held);
        // As the runner takes pieces, more is read, never above the limit.
        let mut total = held;
        flow.delivered(held);
        while total < size {
            let more = quiet(&receiver);
            assert!(more > 0 && more <= limit, "{more}");
            total += more;
            flow.delivered(more);
        }
        assert_eq!(total, size);
        thread.join().unwrap();
        server.join().unwrap();
    }

    #[test]
    fn large_non_utf8_error_answers_stay_within_the_piece_limit() {
        let body = vec![0xffu8; ERROR_LIMIT];
        let (upstream, server) = answer_once(
            format!("HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len()),
            body,
        );
        let grant = Arc::new(anthropic(&upstream));
        let flow = Flow::default();
        let (receiver, thread) = run_forward(&grant, &flow);
        let mut pieces = Vec::new();
        while let Ok(answer) = receiver.recv_timeout(Duration::from_secs(1)) {
            flow.delivered(answer.body.len());
            pieces.push(answer);
        }
        thread.join().unwrap();
        server.join().unwrap();
        let limit = protocol().provider_proxy.piece_limit;
        assert!(pieces.len() > 1);
        assert!(pieces
            .iter()
            .all(|answer| answer.status == 400 && answer.body.len() <= limit));
        let joined: Vec<u8> = pieces
            .iter()
            .flat_map(|answer| answer.body.clone())
            .collect();
        // Each invalid byte became U+FFFD, three bytes long.
        assert_eq!(joined.len(), ERROR_LIMIT * 3);
        let mut offset = 0;
        for (index, answer) in pieces.iter().enumerate() {
            let piece = answer.piece.as_ref().unwrap();
            assert_eq!(
                (piece.offset, piece.last),
                (offset, index + 1 == pieces.len())
            );
            offset += answer.body.len() as u64;
        }
    }

    #[test]
    fn only_the_betas_claude_code_uses_are_forwarded() {
        assert_eq!(
            allowed_betas(
                "claude-code-20250219, interleaved-thinking-2025-05-14,mcp-client-2025-04-04"
            ),
            Some("claude-code-20250219,interleaved-thinking-2025-05-14".into())
        );
        for refused in [
            "mcp-client-2025-04-04",
            "code-execution-2025-08-25",
            "files-api-2025-04-14",
            "skills-2025-10-02",
            "web-fetch-2025-09-10",
            "computer-use-2025-01-24",
            "message-batches-2024-09-24",
            "claude-code-",
            "claude-code-20250219x",
            "claude-code-20250219;mcp-client-2025-04-04",
            "CLAUDE-CODE-20250219",
        ] {
            assert_eq!(allowed_betas(refused), None, "{refused}");
        }
        let grant = anthropic("https://api.anthropic.com");
        let upstream = screen(
            &grant,
            "c",
            &call(
                "/provider/anthropic/v1/messages",
                json!({"x-api-key": grant.token.clone(), "anthropic-beta": "files-api-2025-04-14"}),
                b"{}",
            ),
        )
        .unwrap();
        assert!(upstream
            .headers
            .iter()
            .all(|(name, _)| name != "anthropic-beta"));
    }

    #[test]
    fn openai_background_responses_and_hosted_tools_are_refused() {
        let grant = Grant::new(
            Provider::OpenAi,
            "sk-openai-real-0123456789".into(),
            "https://api.openai.com",
            LIFETIME,
        );
        let headers = json!({"authorization": format!("Bearer {}", grant.token)});
        let status = |path: &str, body: &Value| {
            screen(
                &grant,
                "c",
                &call(path, headers.clone(), body.to_string().as_bytes()),
            )
            .err()
            .map(|answer| answer.status)
        };
        let responses = "/provider/openai/v1/responses";
        assert_eq!(
            status(
                responses,
                &json!({"model": "m", "tools": [{"type": "function"}, {"type": "web_search"}]})
            ),
            None
        );
        assert_eq!(
            status(responses, &json!({"model": "m", "background": true})),
            Some(400)
        );
        assert_eq!(
            status(
                "/provider/openai/v1/responses/compact",
                &json!({"background": true})
            ),
            Some(400)
        );
        assert_eq!(
            status(
                responses,
                &json!({"tools": [{"type": "mcp", "server_url": "https://x"}]})
            ),
            Some(400)
        );
        assert_eq!(
            status(responses, &json!({"tools": [{"type": "code_interpreter"}]})),
            Some(400)
        );
        let unreadable = screen(
            &grant,
            "c",
            &call(responses, headers.clone(), b"\x28\xb5\x2f\xfd"),
        )
        .unwrap_err();
        assert_eq!(unreadable.status, 400);
        let mut compressed = headers.clone();
        compressed["content-encoding"] = json!("zstd");
        assert_eq!(
            screen(&grant, "c", &call(responses, compressed, b"{}"))
                .unwrap_err()
                .status,
            415
        );
        assert_eq!(
            status(
                "/provider/openai/v1/chat/completions",
                &json!({"model": "m"})
            ),
            None
        );
    }
}
