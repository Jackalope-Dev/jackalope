//! The pairing and request contract between a host's remote access and its clients.
//! Compiled into the desktop app and, through `#[path]`, into the mobile companion, so it
//! uses only std and serde_json.

use serde_json::Value;
use std::time::Duration;

/// Crockford base32: no I, L, O or U, so a typed code has no look-alike letters.
pub const SHORT_ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const SHORT_LENGTH: usize = 10;
/// A device token is 64 hex characters.
pub const TOKEN_LENGTH: usize = 64;
pub const TIMEOUT: Duration = Duration::from_secs(30);
pub const RESPONSE_LIMIT: usize = 4_000_000;
pub const UNREACHABLE: &str =
    "The host is unreachable. Work continues there; reconnect to check whether your last action completed.";
pub const TOO_LARGE: &str = "The host response is too large.";
pub const PAIR_ROUTE: &str = "/api/pair";
pub const REQUEST_ROUTE: &str = "/api/request";

/// The code as the host compares it: a link's 64-hex code, or a short code with its
/// dashes, spaces and case removed and look-alike letters read as digits.
pub fn pairing_code(value: &str) -> Option<String> {
    let compact: String = value
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    if compact.len() == 64 && compact.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(compact.to_ascii_lowercase());
    }
    let short: String = compact
        .to_ascii_uppercase()
        .chars()
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    (short.len() == SHORT_LENGTH && short.bytes().all(|b| SHORT_ALPHABET.contains(&b)))
        .then_some(short)
}

/// The device token in a `/api/pair` reply.
pub fn device_token(reply: &Value) -> Result<&str, String> {
    reply["token"]
        .as_str()
        .filter(|token| token.len() == TOKEN_LENGTH)
        .ok_or_else(|| "The host did not return a device token.".into())
}

/// A host reply read as JSON; a refusal carries its reason in `error`. A reply that isn't
/// Jackalope's JSON names what answered instead: most often an HTTPS proxy (such as
/// Tailscale Serve) whose Jackalope behind it isn't running or listens on another port.
pub fn reply(
    status: u16,
    content_type: Option<&str>,
    body: &[u8],
    host: &str,
) -> Result<Value, String> {
    let success = (200..300).contains(&status);
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        if success {
            return Ok(value);
        }
        if let Some(error) = value["error"].as_str() {
            return Err(error.into());
        }
    }
    let host = if host.trim().is_empty() {
        "The computer"
    } else {
        host.trim()
    };
    let empty = body.iter().all(u8::is_ascii_whitespace);
    if matches!(status, 502..=504) || (empty && !success) {
        return Err(format!(
            "{host}'s address answered, but Jackalope isn't responding behind it (HTTP {status}). Open Jackalope on {host}, and check that Remote access's private HTTPS points to the port it listens on."
        ));
    }
    let what = match content_type.map(|t| t.split(';').next().unwrap_or(t).trim()) {
        Some(kind) if !kind.is_empty() && !empty => kind.to_owned(),
        _ if empty => "an empty reply".to_owned(),
        _ => "a reply that isn't JSON".to_owned(),
    };
    Err(format!(
        "{host} answered HTTP {status} with {what}, not Jackalope. Check the address and that Jackalope's Remote access is on there."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_replies_and_refusals_read_as_before() {
        assert_eq!(
            reply(200, Some("application/json"), br#"{"ok":1}"#, "Reindeer").unwrap()["ok"],
            1
        );
        assert_eq!(
            reply(
                403,
                Some("application/json"),
                br#"{"error":"Pair this device again."}"#,
                "Reindeer"
            )
            .unwrap_err(),
            "Pair this device again."
        );
    }

    #[test]
    fn a_proxy_with_nothing_behind_it_says_jackalope_is_not_responding() {
        for status in [502, 503, 504] {
            let error = reply(status, None, b"", "Reindeer").unwrap_err();
            assert!(
                error.starts_with("Reindeer's address answered, but Jackalope isn't responding"),
                "{error}"
            );
            assert!(error.contains(&format!("HTTP {status}")));
        }
        assert!(reply(500, None, b"  ", "Reindeer")
            .unwrap_err()
            .contains("isn't responding"));
    }

    #[test]
    fn other_non_json_replies_name_the_status_and_content_type() {
        let error =
            reply(404, Some("text/html; charset=utf-8"), b"<html>", "Reindeer").unwrap_err();
        assert!(
            error.contains("HTTP 404 with text/html, not Jackalope"),
            "{error}"
        );
        let error = reply(200, None, b"hello", "").unwrap_err();
        assert!(
            error.starts_with("The computer answered HTTP 200 with a reply that isn't JSON"),
            "{error}"
        );
    }
}
