//! A local `opencode serve` process: its loopback address and password, its
//! readiness check and authenticated requests to it.

use reqwest::Method;
use serde_json::Value;
use std::process::Command;
use std::time::{Duration, Instant};

const USERNAME: &str = "jackalope";
const HEALTH_LIMIT: usize = 4096;

/// How long a starting server may take to answer its health check, and how
/// long a client waits for a connection to it.
pub(in crate::commands::tasks) struct Readiness {
    budget: Duration,
    interval: Duration,
    probe: Duration,
    connect: Duration,
}

/// A task server: a cold start can install plugins and dependencies first.
pub(in crate::commands::tasks) const TASK_STARTUP: Readiness = Readiness {
    budget: Duration::from_secs(20),
    interval: Duration::from_millis(100),
    probe: Duration::from_secs(1),
    connect: Duration::from_secs(2),
};

/// A warm helper server, given up on quickly so the helper runs without it.
pub(in crate::commands::tasks) const HELPER_STARTUP: Readiness = Readiness {
    budget: Duration::from_secs(8),
    interval: Duration::from_millis(50),
    probe: Duration::from_millis(500),
    connect: Duration::from_millis(300),
};

#[derive(Clone)]
pub(in crate::commands::tasks) struct Endpoint {
    port: u16,
    pub url: String,
    password: String,
}

impl Endpoint {
    /// A free loopback port and a new password. The listener holds the port
    /// until the caller drops it just before the server binds.
    pub fn reserve() -> Result<(std::net::TcpListener, Self), String> {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        Ok((
            listener,
            Self {
                port,
                url: format!("http://127.0.0.1:{port}"),
                password: uuid::Uuid::new_v4().to_string(),
            },
        ))
    }

    /// Makes `command` serve on this endpoint, with `flags` after `serve`.
    pub fn serve(&self, command: &mut Command, flags: &[&str]) {
        command.arg("serve").args(flags).args([
            "--hostname",
            "127.0.0.1",
            "--port",
            &self.port.to_string(),
        ]);
        self.authorize(command);
    }

    /// The credentials OpenCode reads for both `serve` and `--attach`.
    pub fn authorize(&self, command: &mut Command) {
        command
            .env("OPENCODE_SERVER_PASSWORD", &self.password)
            .env("OPENCODE_SERVER_USERNAME", USERNAME);
    }

    /// A client for a server started with `readiness`. It bypasses proxies,
    /// as the server is on loopback, and refuses redirects so the password
    /// stays with it.
    pub fn client(readiness: &Readiness) -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(readiness.connect)
            .build()
            .map_err(|e| e.to_string())
    }

    pub fn url(&self, route: &str) -> reqwest::Url {
        reqwest::Url::parse(&format!("{}{route}", self.url)).expect("fixed local OpenCode URL")
    }

    pub fn request(
        &self,
        client: &reqwest::Client,
        method: Method,
        url: reqwest::Url,
    ) -> reqwest::RequestBuilder {
        client
            .request(method, url)
            .basic_auth(USERNAME, Some(&self.password))
    }

    async fn healthy(
        &self,
        client: &reqwest::Client,
        directory: Option<&str>,
        timeout: Duration,
    ) -> bool {
        let mut url = self.url("/global/health");
        if let Some(directory) = directory {
            url.query_pairs_mut().append_pair("directory", directory);
        }
        let Ok(mut response) = self
            .request(client, Method::GET, url)
            .timeout(timeout)
            .send()
            .await
        else {
            return false;
        };
        if !response.status().is_success() {
            return false;
        }
        crate::commands::http::read_bounded(&mut response, HEALTH_LIMIT)
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .is_some_and(|value| value["healthy"] == true)
    }

    /// Polls the health route until it reports healthy, the budget runs out
    /// or `stopped` returns true.
    pub async fn wait_ready(
        &self,
        client: &reqwest::Client,
        directory: Option<&str>,
        readiness: &Readiness,
        stopped: impl Fn() -> bool,
    ) -> bool {
        let started = Instant::now();
        while !stopped() {
            if self.healthy(client, directory, readiness.probe).await {
                return true;
            }
            if started.elapsed() > readiness.budget {
                break;
            }
            tokio::time::sleep(readiness.interval).await;
        }
        false
    }
}

/// Session, message, part and request identifiers OpenCode returns, before
/// they are put into a route.
pub(in crate::commands::tasks) fn valid_id(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("OpenCode returned an invalid identifier.".into());
    }
    Ok(value)
}
