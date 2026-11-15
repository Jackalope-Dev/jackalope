//! Outbound HTTP: clients that never follow redirects, shared per timeout, and a
//! response body read that stops at a size limit.

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};

/// How a client reaches its host.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Route {
    /// Through the system proxy settings, for internet services.
    System,
    /// Straight to the host, for loopback tunnels and machines on the local network.
    Direct,
}

static CLIENTS: OnceLock<Mutex<HashMap<(Route, Duration), reqwest::Client>>> = OnceLock::new();

fn shared(route: Route, timeout: Duration) -> Result<reqwest::Client, String> {
    let mut clients = CLIENTS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(client) = clients.get(&(route, timeout)) {
        return Ok(client.clone());
    }
    let mut builder = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none());
    if route == Route::Direct {
        builder = builder.no_proxy();
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    clients.insert((route, timeout), client.clone());
    Ok(client)
}

/// A client for internet services. Redirects are refused so a bearer token is
/// only ever sent to the host it was meant for.
pub(crate) fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    shared(Route::System, timeout)
}

/// A client that ignores proxy settings, for hosts reached on this machine or network.
pub(crate) fn direct_client(timeout: Duration) -> Result<reqwest::Client, String> {
    shared(Route::Direct, timeout)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BodyError {
    /// The connection failed while the body was arriving.
    Interrupted,
    /// The body is longer than the limit; reading stopped there.
    TooLarge,
}

/// The response body, refusing one longer than `limit` bytes.
pub(crate) async fn read_bounded(
    response: &mut reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, BodyError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| BodyError::Interrupted)? {
        if bytes.len() + chunk.len() > limit {
            return Err(BodyError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bodies_over_the_limit_are_refused() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buffer = [0u8; 1024];
                let _ = stream.read(&mut buffer).await;
                let _ = stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n0123456789")
                    .await;
            }
        });
        let client = direct_client(Duration::from_secs(5)).unwrap();
        let url = format!("http://{address}/");
        let mut response = client.get(&url).send().await.unwrap();
        assert_eq!(
            read_bounded(&mut response, 10).await.unwrap(),
            b"0123456789"
        );
        let mut response = client.get(&url).send().await.unwrap();
        assert_eq!(
            read_bounded(&mut response, 9).await,
            Err(BodyError::TooLarge)
        );
    }
}
