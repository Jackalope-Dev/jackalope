//! A JSON-RPC (or Claude Code control-protocol) session with an agent CLI over
//! its stdio, as quota readers, model discovery and sign-in checks use it.

use serde_json::Value;
use std::process::Stdio;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::{timeout, Duration},
};

/// Why a CLI request failed. The CLI's own error text is never surfaced: it
/// can echo credentials.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum RpcError {
    Start,
    Send,
    Read,
    TooLarge,
    Closed,
    Invalid,
    Rejected,
    Missing,
}

impl RpcError {
    /// The failure as a sentence that names `agent`.
    pub(crate) fn message(self, agent: &str) -> String {
        match self {
            Self::Start => format!("{agent} could not be started."),
            Self::Send => format!("{agent} could not receive the request."),
            Self::Read => format!("{agent}'s response could not be read."),
            Self::TooLarge => format!("{agent}'s output exceeded the response limit."),
            Self::Closed => format!("{agent} closed before answering."),
            Self::Invalid => format!("{agent} returned an invalid response."),
            Self::Rejected => {
                format!("{agent} rejected the request. Update the CLI and check its sign-in.")
            }
            Self::Missing => format!("{agent} returned no result."),
        }
    }
}

/// An [`RpcError`] from a [`Client`], with the agent it talked to.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Failure {
    pub(crate) error: RpcError,
    agent: &'static str,
}

impl Failure {
    pub(crate) fn message(self) -> String {
        self.error.message(self.agent)
    }
}

impl From<Failure> for String {
    fn from(failure: Failure) -> Self {
        failure.message()
    }
}

pub(crate) struct Client {
    agent: &'static str,
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    bytes: usize,
}

impl Client {
    pub(crate) fn spawn_bound(
        binding: &super::agent_profiles::AccountBinding,
        args: &[&str],
    ) -> Result<Self, String> {
        Self::spawn_executable(binding, &super::tasks::executable(&binding.adapter)?, args)
    }

    pub(crate) fn spawn_executable(
        binding: &super::agent_profiles::AccountBinding,
        executable: &std::path::Path,
        args: &[&str],
    ) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command
            .args(args)
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        super::agent_profiles::apply_binding(command.as_std_mut(), binding)?;
        super::process_control::hidden(command.as_std_mut());
        let agent = super::agents::find(&binding.adapter)
            .map_or("The agent CLI", |agent| agent.short_name.as_str());
        let start = || RpcError::Start.message(agent);
        let mut child = command.spawn().map_err(|_| start())?;
        let input = child.stdin.take().ok_or_else(start)?;
        let output = BufReader::new(child.stdout.take().ok_or_else(start)?);
        Ok(Self {
            agent,
            child,
            input,
            output,
            bytes: 0,
        })
    }

    pub(crate) async fn notify(&mut self, value: Value) -> Result<(), Failure> {
        let agent = self.agent;
        self.input
            .write_all(format!("{value}\n").as_bytes())
            .await
            .map_err(|_| Failure {
                error: RpcError::Send,
                agent,
            })
    }

    /// Sends `request` and waits for the response with its `id` (or control
    /// `request_id`), skipping anything else the CLI writes meanwhile.
    pub(crate) async fn request(&mut self, request: Value) -> Result<Value, Failure> {
        self.notify(request.clone()).await?;
        let agent = self.agent;
        read_response(&mut self.output, &request, &mut self.bytes)
            .await
            .map_err(|error| Failure { error, agent })
    }

    pub(crate) async fn close(mut self) {
        let _ = self.child.start_kill();
        let _ = timeout(Duration::from_secs(2), self.child.wait()).await;
    }
}

async fn read_response<R: AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
    request: &Value,
    bytes: &mut usize,
) -> Result<Value, RpcError> {
    loop {
        let mut line = vec![];
        let size = (&mut *reader)
            .take(262_145)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| RpcError::Read)?;
        *bytes += size;
        if size > 262_144 || *bytes > 1_048_576 {
            return Err(RpcError::TooLarge);
        }
        if size == 0 {
            return Err(RpcError::Closed);
        }
        let value: Value = serde_json::from_slice(&line).map_err(|_| RpcError::Invalid)?;
        let response = if let Some(id) = request.get("request_id") {
            if value["type"] != "control_response" || value["response"]["request_id"] != *id {
                continue;
            }
            let response = &value["response"];
            if response["subtype"] != "success" {
                return Err(RpcError::Rejected);
            }
            response.get("response")
        } else {
            if value.get("id") != request.get("id") {
                continue;
            }
            if value.get("error").is_some() {
                return Err(RpcError::Rejected);
            }
            value.get("result")
        };
        return response
            .filter(|v| v.is_object())
            .cloned()
            .ok_or(RpcError::Missing);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn correlates_control_and_rpc_responses_without_exposing_errors() {
        let request = json!({"request_id":"usage"});
        let data = b"{\"type\":\"system\"}\n{\"type\":\"control_response\",\"response\":{\"request_id\":\"other\"}}\n{\"type\":\"control_response\",\"response\":{\"request_id\":\"usage\",\"subtype\":\"success\",\"response\":{\"rate_limits_available\":true}}}\n";
        assert_eq!(
            read_response(&mut BufReader::new(&data[..]), &request, &mut 0)
                .await
                .unwrap()["rate_limits_available"],
            true
        );
        for (request, data) in [
            (request, "{\"type\":\"control_response\",\"response\":{\"request_id\":\"usage\",\"subtype\":\"error\",\"error\":\"secret\"}}\n"),
            (json!({"id":2}), "{\"id\":2,\"error\":{\"message\":\"secret\"}}\n"),
        ] {
            let error = read_response(&mut BufReader::new(data.as_bytes()), &request, &mut 0).await.unwrap_err();
            assert_eq!(error, RpcError::Rejected);
            assert!(!error.message("Claude").contains("secret"));
        }
        let data = b"{\"id\":1,\"result\":{}}\n{\"id\":2,\"result\":{\"config\":{}}}\n";
        assert!(
            read_response(&mut BufReader::new(&data[..]), &json!({"id":2}), &mut 0)
                .await
                .unwrap()["config"]
                .is_object()
        );
    }

    #[tokio::test]
    async fn bounds_output_and_rejects_eof_or_malformed_results() {
        for data in [
            vec![b'x'; 262_145],
            vec![],
            b"invalid\n".to_vec(),
            b"{\"id\":2,\"result\":null}\n".to_vec(),
        ] {
            assert!(read_response(
                &mut BufReader::new(data.as_slice()),
                &serde_json::json!({"id":2}),
                &mut 0
            )
            .await
            .is_err());
        }
        let data = b"{\"id\":2,\"result\":{}}\n";
        assert!(read_response(
            &mut BufReader::new(&data[..]),
            &serde_json::json!({"id":2}),
            &mut 1_048_576
        )
        .await
        .is_err());
        let (_writer, reader) = tokio::io::duplex(64);
        assert!(timeout(
            Duration::from_millis(20),
            read_response(
                &mut BufReader::new(reader),
                &serde_json::json!({"id":2}),
                &mut 0
            )
        )
        .await
        .is_err());
    }
}
