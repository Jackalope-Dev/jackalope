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

/// A host reply read as JSON; a refusal carries its reason in `error`.
pub fn reply(success: bool, body: &[u8]) -> Result<Value, String> {
    let value: Value =
        serde_json::from_slice(body).map_err(|_| "The host returned an unreadable response.")?;
    if !success {
        return Err(value["error"]
            .as_str()
            .unwrap_or("The host declined this request.")
            .into());
    }
    Ok(value)
}
