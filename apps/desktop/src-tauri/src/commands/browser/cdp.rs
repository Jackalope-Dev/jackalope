//! One-shot Chrome DevTools Protocol calls on a browser Jackalope launched.
//!
//! Only loopback `ws://127.0.0.1:<port>/devtools/browser/<id>` endpoints read
//! from the profile's own `DevToolsActivePort` are accepted. Each call opens a
//! connection, sends one command and reads frames until the matching response.

use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpStream,
    time::{Duration, Instant},
};

const RESPONSE_LIMIT: usize = 8 * 1024 * 1024;

fn address(endpoint: &str) -> Result<(u16, &str), String> {
    let rest = endpoint
        .strip_prefix("ws://127.0.0.1:")
        .ok_or("The browser endpoint is not local.")?;
    let (port, path) = rest.split_at(rest.find('/').ok_or("Invalid browser endpoint")?);
    let port = port.parse().map_err(|_| "Invalid browser endpoint")?;
    if !path.starts_with("/devtools/browser/") {
        return Err("Invalid browser endpoint".into());
    }
    Ok((port, path))
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for (index, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if index <= chunk.len() {
                out.push(TABLE[((n >> shift) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A client-to-server text frame, masked as the protocol requires.
fn frame(payload: &[u8]) -> Vec<u8> {
    let mask: [u8; 4] = uuid::Uuid::new_v4().as_bytes()[..4].try_into().unwrap();
    let mut out = vec![0x81];
    match payload.len() {
        n if n < 126 => out.push(0x80 | n as u8),
        n if n <= 0xffff => {
            out.push(0x80 | 126);
            out.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            out.push(0x80 | 127);
            out.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    out.extend_from_slice(&mask);
    out.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    out
}

/// One complete server frame from the front of `buffer`: (opcode, fin, payload, used).
fn parse_frame(buffer: &[u8]) -> Option<(u8, bool, Vec<u8>, usize)> {
    if buffer.len() < 2 {
        return None;
    }
    let fin = buffer[0] & 0x80 != 0;
    let opcode = buffer[0] & 0x0f;
    let masked = buffer[1] & 0x80 != 0;
    let (length, mut used) = match buffer[1] & 0x7f {
        126 => (
            u16::from_be_bytes(buffer.get(2..4)?.try_into().ok()?) as usize,
            4,
        ),
        127 => (
            u64::from_be_bytes(buffer.get(2..10)?.try_into().ok()?) as usize,
            10,
        ),
        n => (n as usize, 2),
    };
    let mask = if masked {
        let mask: [u8; 4] = buffer.get(used..used + 4)?.try_into().ok()?;
        used += 4;
        Some(mask)
    } else {
        None
    };
    let mut payload = buffer.get(used..used.checked_add(length)?)?.to_vec();
    if let Some(mask) = mask {
        for (i, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[i % 4];
        }
    }
    Some((opcode, fin, payload, used + length))
}

/// Sends one browser-level CDP command and returns its `result`.
pub(super) fn call(
    endpoint: &str,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let (port, path) = address(endpoint)?;
    let deadline = Instant::now() + timeout;
    let mut stream = TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        Duration::from_secs(2).min(timeout),
    )
    .map_err(|e| format!("The browser is not answering: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|e| e.to_string())?;
    let key = base64(&uuid::Uuid::new_v4().as_bytes()[..16]);
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    .map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let mut read = |stream: &mut TcpStream, buffer: &mut Vec<u8>| -> Result<(), String> {
        if Instant::now() >= deadline {
            return Err("The browser did not answer in time.".into());
        }
        match stream.read(&mut chunk) {
            Ok(0) => Err("The browser closed the connection.".into()),
            Ok(count) => {
                buffer.extend_from_slice(&chunk[..count]);
                if buffer.len() > RESPONSE_LIMIT {
                    return Err("The browser response is too large.".into());
                }
                Ok(())
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                Ok(())
            }
            Err(error) => Err(error.to_string()),
        }
    };
    let header_end = loop {
        if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            break end + 4;
        }
        read(&mut stream, &mut buffer)?;
    };
    if !buffer.starts_with(b"HTTP/1.1 101") {
        return Err("The browser refused the DevTools connection.".into());
    }
    buffer.drain(..header_end);
    let request = json!({"id": 1, "method": method, "params": params});
    stream
        .write_all(&frame(request.to_string().as_bytes()))
        .map_err(|e| e.to_string())?;
    let mut message = Vec::new();
    loop {
        while let Some((opcode, fin, payload, used)) = parse_frame(&buffer) {
            buffer.drain(..used);
            match opcode {
                0x8 => return Err("The browser closed the connection.".into()),
                0x1 | 0x0 => {
                    message.extend_from_slice(&payload);
                    if !fin {
                        continue;
                    }
                    let value: Value = serde_json::from_slice(&std::mem::take(&mut message))
                        .map_err(|_| "Invalid DevTools response")?;
                    if value["id"] != 1 {
                        continue;
                    }
                    if let Some(error) = value.get("error") {
                        return Err(error["message"]
                            .as_str()
                            .unwrap_or("DevTools command failed")
                            .chars()
                            .take(500)
                            .collect());
                    }
                    return Ok(value["result"].clone());
                }
                _ => {}
            }
        }
        if method == "Browser.close" && buffer.is_empty() && message.is_empty() {
            // Chromium may exit before it answers a close request.
            if let Err(error) = read(&mut stream, &mut buffer) {
                return if error.contains("closed") {
                    Ok(Value::Null)
                } else {
                    Err(error)
                };
            }
            continue;
        }
        read(&mut stream, &mut buffer)?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_browser_endpoints_are_used() {
        assert_eq!(
            address("ws://127.0.0.1:9222/devtools/browser/abc").unwrap(),
            (9222, "/devtools/browser/abc")
        );
        for endpoint in [
            "ws://example.com:9222/devtools/browser/abc",
            "ws://127.0.0.1:9222/devtools/page/abc",
            "ws://127.0.0.1:x/devtools/browser/abc",
            "wss://127.0.0.1:9222/devtools/browser/abc",
        ] {
            assert!(address(endpoint).is_err(), "{endpoint}");
        }
    }

    #[test]
    fn handshake_key_is_standard_base64() {
        assert_eq!(base64(b"hello world!"), "aGVsbG8gd29ybGQh");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(&[0u8; 16]).len(), 24);
    }

    #[test]
    fn frames_round_trip_through_masking_and_extended_lengths() {
        for size in [5, 300, 70_000] {
            let payload = vec![b'x'; size];
            let (opcode, fin, decoded, used) = parse_frame(&frame(&payload)).unwrap();
            assert_eq!((opcode, fin, used > size), (1, true, true));
            assert_eq!(decoded, payload);
        }
        assert!(parse_frame(&[0x81]).is_none());
        assert!(parse_frame(&[0x81, 10, b'a']).is_none());
    }
}
