//! Cloudflare's v4 account API. Every answer is `{success, errors, result}`;
//! `errors[0].code` is Cloudflare's stable error number.

use crate::commands::http;
use serde_json::Value;
use std::time::Duration;

pub(crate) const API_ROOT: &str = "https://api.cloudflare.com/client/v4/accounts";
const MAX_RESPONSE: usize = 4_000_000;
/// Characters of Cloudflare's own error message repeated to the person.
const DETAIL_LIMIT: usize = 300;

pub(crate) enum Body<'a> {
    Empty,
    Json(&'a Value),
    /// A content type and the bytes to send with it.
    Raw(String, Vec<u8>),
}

/// One answer from the API, whether or not it succeeded.
#[derive(Debug)]
pub(crate) struct Reply {
    pub status: u16,
    pub body: Value,
}

impl Reply {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status) && self.body["success"] == true
    }

    /// Cloudflare's error number, or 0 when it gave none.
    pub fn code(&self) -> u64 {
        code(&self.body)
    }

    /// Cloudflare's own error message without control characters, shortened.
    pub fn detail(&self) -> String {
        self.body["errors"][0]["message"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .filter(|c| !c.is_control())
            .take(DETAIL_LIMIT)
            .collect()
    }

    /// 401/403, or Cloudflare's 10000 authentication error.
    pub fn refused_access(&self) -> bool {
        matches!(self.status, 401 | 403) || self.code() == 10000
    }
}

pub(crate) fn code(body: &Value) -> u64 {
    body["errors"][0]["code"].as_u64().unwrap_or_default()
}

/// Calls under `/accounts/{account_id}` with one token.
pub(crate) struct Api {
    root: String,
    token: String,
    client: reqwest::Client,
}

impl Api {
    pub fn new(account_id: &str, token: &str, timeout: Duration) -> Result<Self, String> {
        Ok(Self {
            root: format!("{API_ROOT}/{account_id}"),
            token: token.into(),
            client: http::client(timeout)?,
        })
    }

    /// An API rooted somewhere else, such as a local test server.
    #[cfg(test)]
    pub fn at(root: String, token: &str) -> Self {
        Self {
            root,
            token: token.into(),
            client: reqwest::Client::new(),
        }
    }

    /// Sends `route` (relative to the account) and reads the answer. Errors only
    /// when Cloudflare could not be reached or its answer could not be read.
    pub async fn send(
        &self,
        method: reqwest::Method,
        route: &str,
        body: Body<'_>,
    ) -> Result<Reply, String> {
        let mut request = self
            .client
            .request(method, format!("{}{route}", self.root))
            .bearer_auth(&self.token);
        request = match body {
            Body::Empty => request,
            Body::Json(value) => request.json(value),
            Body::Raw(content_type, bytes) => {
                request.header("content-type", content_type).body(bytes)
            }
        };
        let mut response = request
            .send()
            .await
            .map_err(|_| "Could not reach Cloudflare. Check your connection and retry.")?;
        let status = response.status().as_u16();
        let bytes = http::read_bounded(&mut response, MAX_RESPONSE)
            .await
            .map_err(|error| match error {
                http::BodyError::Interrupted => "The Cloudflare response was interrupted. Retry.",
                http::BodyError::TooLarge => "Cloudflare returned an unexpectedly large response.",
            })?;
        Ok(Reply {
            status,
            body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn replies_expose_cloudflares_code_and_a_clean_detail() {
        let reply = Reply {
            status: 400,
            body: json!({"success": false, "errors": [{"code": 10000, "message": "boom\u{7}"}]}),
        };
        assert!(!reply.ok());
        assert_eq!(reply.code(), 10000);
        assert_eq!(reply.detail(), "boom");
        assert!(reply.refused_access());
        let empty = Reply {
            status: 200,
            body: Value::Null,
        };
        assert!(!empty.ok());
        assert_eq!(empty.code(), 0);
        assert!(empty.detail().is_empty());
    }
}
