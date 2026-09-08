use serde_json::Value;
use std::process::Stdio;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::{timeout, Duration},
};

pub(crate) struct Client {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    bytes: usize,
}

impl Client {
    pub(crate) fn spawn_bound(
        binding: &super::super::agent_profiles::AccountBinding,
        args: &[&str],
    ) -> Result<Self, String> {
        let mut command = Command::new(super::super::tasks::executable(&binding.adapter)?);
        command
            .args(args)
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        super::super::agent_profiles::apply_binding(command.as_std_mut(), binding);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|_| "Could not start the quota reader")?;
        let input = child.stdin.take().ok_or("Quota input unavailable")?;
        let output = BufReader::new(child.stdout.take().ok_or("Quota output unavailable")?);
        Ok(Self {
            child,
            input,
            output,
            bytes: 0,
        })
    }

    pub(crate) async fn notify(&mut self, value: Value) -> Result<(), String> {
        self.input
            .write_all(format!("{value}\n").as_bytes())
            .await
            .map_err(|_| "Could not notify the CLI".into())
    }

    pub(crate) async fn request(&mut self, request: Value) -> Result<Value, String> {
        self.input
            .write_all(format!("{request}\n").as_bytes())
            .await
            .map_err(|_| "Could not send the quota request")?;
        read_response(&mut self.output, &request, &mut self.bytes).await
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
) -> Result<Value, String> {
    loop {
        let mut line = vec![];
        let size = (&mut *reader)
            .take(262_145)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| "Could not read the quota response")?;
        *bytes += size;
        if size > 262_144 || *bytes > 1_048_576 {
            return Err("Quota output exceeded the response limit".into());
        }
        if size == 0 {
            return Err("The CLI closed before returning quota information".into());
        }
        let value: Value = serde_json::from_slice(&line).map_err(|_| "Invalid quota response")?;
        let response = if let Some(id) = request.get("request_id") {
            if value["type"] != "control_response" || value["response"]["request_id"] != *id {
                continue;
            }
            let response = &value["response"];
            if response["subtype"] != "success" {
                return Err(
                    "The CLI rejected the quota request. Update the CLI and check its sign-in."
                        .into(),
                );
            }
            response.get("response")
        } else {
            if value.get("id") != request.get("id") {
                continue;
            }
            if value.get("error").is_some() {
                return Err(
                    "The CLI rejected the quota request. Update the CLI and check its sign-in."
                        .into(),
                );
            }
            value.get("result")
        };
        return response
            .filter(|v| v.is_object())
            .cloned()
            .ok_or_else(|| "Missing quota result".into());
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
            assert!(!error.contains("secret"));
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
