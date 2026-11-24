//! One-way masking for text Jackalope sends off this device or writes where
//! others read it: feedback reports, phone and web companion responses, Jev
//! requests and exported plans. Values Jackalope knows are secret are replaced
//! first, then credential shapes. Nothing stored locally or given to an agent
//! is changed.
//!
//! The credential shapes and the secret-named environment rule adapt
//! oh-my-pi's secret obfuscation (MIT); see public/licenses/oh-my-pi.txt.

use super::{KnownSecrets, STRUCTURAL};
use regex::{Regex, RegexSet};
use serde_json::Value;
use std::{
    borrow::Cow,
    collections::BTreeSet,
    sync::{Arc, LazyLock, RwLock},
};

/// The most values remembered in one app session.
const MAX_KNOWN: usize = 1024;

#[derive(Clone, Copy)]
enum Kind {
    /// A whole token, standing alone: not part of a longer identifier.
    Token,
    /// The credential after an introducer such as `Bearer `.
    Credential,
    /// The password in `scheme://user:password@host`.
    Password,
    /// A multi-line block, such as a PEM private key.
    Block,
}

struct Shape {
    label: &'static str,
    pattern: &'static str,
    kind: Kind,
}

/// Vendor-prefixed credential shapes. There is no generic keyword or entropy
/// rule, so identifiers such as `token_expiry_seconds`, Git object ids and
/// UUIDs are left alone.
const SHAPES: &[Shape] = &[
    Shape {
        label: "private key",
        pattern: r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?s:.*?)(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|\z)",
        kind: Kind::Block,
    },
    Shape {
        label: "GitHub token",
        pattern: r"gh[opusr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{36,}",
        kind: Kind::Token,
    },
    Shape {
        label: "GitLab token",
        pattern: r"glpat-[A-Za-z0-9_-]{20,}",
        kind: Kind::Token,
    },
    Shape {
        label: "Anthropic key",
        pattern: r"sk-ant-[A-Za-z0-9_-]{32,}",
        kind: Kind::Token,
    },
    Shape {
        label: "OpenAI key",
        pattern: r"sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{32,}|sk-[A-Za-z0-9_-]{48,}",
        kind: Kind::Token,
    },
    Shape {
        label: "AWS access key",
        pattern: r"(?:AKIA|ASIA)[A-Z0-9]{16}",
        kind: Kind::Token,
    },
    Shape {
        label: "Google API key",
        pattern: r"AIza[A-Za-z0-9_-]{30,}",
        kind: Kind::Token,
    },
    Shape {
        label: "Slack token",
        pattern: r"xox[abprs]-[A-Za-z0-9-]{10,}",
        kind: Kind::Token,
    },
    Shape {
        label: "npm token",
        pattern: r"npm_[A-Za-z0-9]{30,}",
        kind: Kind::Token,
    },
    Shape {
        label: "Stripe key",
        pattern: r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}",
        kind: Kind::Token,
    },
    Shape {
        label: "Hugging Face token",
        pattern: r"hf_[A-Za-z0-9]{30,}",
        kind: Kind::Token,
    },
    Shape {
        label: "SendGrid key",
        pattern: r"SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}",
        kind: Kind::Token,
    },
    Shape {
        label: "JWT",
        pattern: r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
        kind: Kind::Token,
    },
    Shape {
        label: "bearer token",
        pattern: r"(?i)\bbearer[ \t]+([A-Za-z0-9._~+/=-]{20,})",
        kind: Kind::Credential,
    },
    Shape {
        label: "password",
        pattern: r"\b[A-Za-z][A-Za-z0-9+.-]*://[^\s/?#@:]*:([^\s/?#@]+)@",
        kind: Kind::Password,
    },
];

static PATTERNS: LazyLock<(RegexSet, Vec<Regex>)> = LazyLock::new(|| {
    let sources = SHAPES.iter().map(|shape| shape.pattern);
    (
        RegexSet::new(sources.clone()).expect("credential shapes compile"),
        sources
            .map(|source| Regex::new(source).expect("credential shape compiles"))
            .collect(),
    )
});

/// A character that continues a token, so a match next to one is part of a
/// longer identifier rather than a credential.
fn continues(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

impl Shape {
    /// Whether `found`, at `start..end` of `text`, is a credential to mask.
    /// Random credentials of these lengths virtually always hold a digit;
    /// placeholders and long names such as `YOUR_ACCESS_TOKEN_HERE` do not.
    fn accepts(&self, text: &str, start: usize, end: usize) -> bool {
        let found = &text[start..end];
        match self.kind {
            Kind::Block => true,
            Kind::Credential => found.bytes().any(|b| b.is_ascii_digit()),
            Kind::Password => !found.starts_with(['$', '{', '<', '*', '[', '%']),
            Kind::Token => {
                !text[..start].chars().next_back().is_some_and(continues)
                    && !text[end..].chars().next().is_some_and(continues)
                    && found.bytes().any(|b| b.is_ascii_digit())
            }
        }
    }

    fn replace(&self, regex: &Regex, text: &str) -> Option<String> {
        let mark = format!("[redacted {}]", self.label);
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        for captures in regex.captures_iter(text) {
            let Some(secret) = captures.get(1).or_else(|| captures.get(0)) else {
                continue;
            };
            if self.accepts(text, secret.start(), secret.end()) {
                out.push_str(&text[last..secret.start()]);
                out.push_str(&mark);
                last = secret.end();
            }
        }
        (last > 0).then(|| {
            out.push_str(&text[last..]);
            out
        })
    }
}

/// `text` with credential shapes masked.
fn shapes(text: &str) -> Cow<'_, str> {
    let (set, regexes) = &*PATTERNS;
    let matched = set.matches(text);
    if !matched.matched_any() {
        return Cow::Borrowed(text);
    }
    let mut text = Cow::Borrowed(text);
    for index in matched.iter() {
        if let Some(replaced) = SHAPES[index].replace(&regexes[index], &text) {
            text = Cow::Owned(replaced);
        }
    }
    text
}

struct Known {
    values: BTreeSet<String>,
    secrets: Option<Arc<KnownSecrets>>,
}

static KNOWN: LazyLock<RwLock<Known>> = LazyLock::new(|| {
    let values: BTreeSet<String> = environment(std::env::vars()).into_iter().collect();
    RwLock::new(Known {
        secrets: KnownSecrets::new(values.iter().cloned()).map(Arc::new),
        values,
    })
});

/// Adds secret values Jackalope handled, such as those it gave an agent, to
/// what outbound text never shows for the rest of this app session. Kept in
/// memory only.
pub(crate) fn remember(values: &[String]) {
    let Ok(mut known) = KNOWN.write() else {
        return;
    };
    let before = known.values.len();
    for value in values {
        if known.values.len() >= MAX_KNOWN {
            break;
        }
        if value.chars().count() >= super::MIN_CHARS {
            known.values.insert(value.clone());
        }
    }
    if known.values.len() != before {
        known.secrets = KnownSecrets::new(known.values.iter().cloned()).map(Arc::new);
    }
}

fn known() -> Option<Arc<KnownSecrets>> {
    KNOWN.read().ok()?.secrets.clone()
}

/// `text` as it may leave this device: known secret values and credential
/// shapes replaced, everything else as written.
pub(crate) fn outbound(text: &str) -> Cow<'_, str> {
    let known = known();
    match known
        .as_ref()
        .map_or(Cow::Borrowed(text), |known| known.redacted(text))
    {
        Cow::Borrowed(text) => shapes(text),
        Cow::Owned(text) => Cow::Owned(shapes(&text).into_owned()),
    }
}

/// [`outbound`] for every string in `value`, leaving object keys and the
/// fields that identify, date or classify a record as they are.
pub(crate) fn outbound_value(value: &mut Value) {
    match value {
        Value::String(text) => {
            if let Cow::Owned(redacted) = outbound(text) {
                *text = redacted;
            }
        }
        Value::Array(items) => items.iter_mut().for_each(outbound_value),
        Value::Object(fields) => fields
            .iter_mut()
            .filter(|(key, _)| !STRUCTURAL.contains(&key.as_str()))
            .for_each(|(_, item)| outbound_value(item)),
        _ => {}
    }
}

static SECRET_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL|PRIVATE|OAUTH)(?:_|$)")
        .expect("secret name pattern compiles")
});

/// A file or socket location, such as `SSH_AUTH_SOCK`'s, rather than a secret.
fn location(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.starts_with(['/', '~', '\\'])
        || (bytes.len() > 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/'))
}

/// The secret values in an environment: secret-named variables, and the
/// password in any connection URL (raw and percent-decoded).
fn environment(variables: impl IntoIterator<Item = (String, String)>) -> Vec<String> {
    let mut values = Vec::new();
    for (name, value) in variables {
        if (SECRET_NAME.is_match(&name)
            || super::super::process_control::credential_variable(&name))
            && !location(&value)
        {
            values.push(value.clone());
        }
        if let Some(password) = reqwest::Url::parse(&value)
            .ok()
            .and_then(|url| url.password().map(str::to_string))
        {
            if let Some(decoded) = percent_decoded(&password).filter(|decoded| *decoded != password)
            {
                values.push(decoded);
            }
            values.push(password);
        }
    }
    values.retain(|value| value.chars().count() >= super::MIN_CHARS);
    values
}

fn percent_decoded(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = std::str::from_utf8(bytes.get(at + 1..at + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Credential-shaped fixtures are built at runtime so the repository's
    /// secret scan does not mistake them for real ones.
    fn random(len: usize) -> String {
        "a1B2c3D4e5F6g7H8i9J0kLmN"
            .chars()
            .cycle()
            .take(len)
            .collect()
    }

    fn masked(text: &str) -> String {
        shapes(text).into_owned()
    }

    fn assert_masked(token: &str, label: &str) {
        let text = format!("value: {token} (end)");
        assert_eq!(
            masked(&text),
            format!("value: [redacted {label}] (end)"),
            "{token}"
        );
    }

    fn assert_kept(text: &str) {
        assert_eq!(masked(text), text);
    }

    #[test]
    fn github_tokens() {
        for prefix in ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"] {
            assert_masked(&format!("{prefix}{}", random(36)), "GitHub token");
        }
        assert_kept(&format!("ghp_{}", random(20)));
        assert_kept(&format!("xghp_{}", random(36)));
        assert_kept(&format!("ghx_{}", random(36)));
    }

    #[test]
    fn gitlab_tokens() {
        assert_masked(&format!("glpat-{}", random(20)), "GitLab token");
        assert_kept(&format!("glpat-{}", random(12)));
        assert_kept(&format!("glpat-{}", "example-token-value-here"));
    }

    #[test]
    fn anthropic_and_openai_keys() {
        assert_masked(&format!("sk-ant-api03-{}", random(80)), "Anthropic key");
        assert_masked(&format!("sk-proj-{}", random(64)), "OpenAI key");
        assert_masked(&format!("sk-svcacct-{}", random(40)), "OpenAI key");
        assert_masked(&format!("sk-{}", random(48)), "OpenAI key");
        assert_kept(&format!("sk-{}", random(30)));
        assert_kept("sk-this-is-a-long-kebab-case-identifier-without-any-numbers-in-it");
        assert_kept(&format!("task-{}", random(60)));
    }

    #[test]
    fn aws_access_keys() {
        let body: String = random(16).to_ascii_uppercase();
        assert_masked(&format!("AKIA{body}"), "AWS access key");
        assert_masked(&format!("ASIA{body}"), "AWS access key");
        assert_kept(&format!("AKIA{}", &body[..12]));
        assert_kept(&format!("AKIA{body}X"));
        assert_kept(&format!("AKIA{}", random(16)));
    }

    #[test]
    fn google_api_keys() {
        assert_masked(&format!("AIza{}", random(35)), "Google API key");
        assert_kept(&format!("AIza{}", random(20)));
        assert_kept(&format!("MAIza{}", random(35)));
    }

    #[test]
    fn slack_tokens() {
        for prefix in ["xoxb-", "xoxp-", "xoxa-", "xoxr-", "xoxs-"] {
            assert_masked(
                &format!("{prefix}{}-{}", random(12), random(24)),
                "Slack token",
            );
        }
        assert_kept("xoxb-short");
        assert_kept(&format!("xoxz-{}", random(24)));
    }

    #[test]
    fn npm_tokens() {
        assert_masked(&format!("npm_{}", random(36)), "npm token");
        assert_kept(&format!("npm_{}", random(12)));
        assert_kept("npm_config_registry_url_for_the_workspace_x");
    }

    #[test]
    fn stripe_keys() {
        assert_masked(&format!("sk_live_{}", random(24)), "Stripe key");
        assert_masked(&format!("rk_test_{}", random(24)), "Stripe key");
        assert_masked(&format!("whsec_{}", random(32)), "Stripe key");
        assert_kept(&format!("pk_live_{}", random(24)));
        assert_kept(&format!("sk_live_{}", random(8)));
    }

    #[test]
    fn hugging_face_tokens() {
        assert_masked(&format!("hf_{}", random(34)), "Hugging Face token");
        assert_kept(&format!("hf_{}", random(10)));
        assert_kept("hf_transformers_cache_directory_setting");
    }

    #[test]
    fn sendgrid_keys() {
        assert_masked(&format!("SG.{}.{}", random(22), random(43)), "SendGrid key");
        assert_kept(&format!("SG.{}.{}", random(22), random(20)));
    }

    #[test]
    fn json_web_tokens() {
        let header = format!("eyJ{}", random(20));
        let claims = format!("eyJ{}", random(40));
        assert_masked(&format!("{header}.{claims}.{}", random(43)), "JWT");
        assert_kept(&format!("{header}.{}", random(40)));
        assert_kept("eyJhbGciOi.notaclaim.short");
    }

    #[test]
    fn bearer_tokens() {
        let token = random(32);
        assert_eq!(
            masked(&format!("Authorization: Bearer {token}\nnext")),
            "Authorization: Bearer [redacted bearer token]\nnext"
        );
        assert_eq!(
            masked(&format!("authorization: bearer {token}")),
            "authorization: bearer [redacted bearer token]"
        );
        assert_kept("Authorization: Bearer YOUR_ACCESS_TOKEN_HERE");
        assert_kept("Authorization: Bearer ${API_TOKEN}");
        assert_kept("the bearer of bad news");
    }

    #[test]
    fn private_key_blocks() {
        let begin = format!("-----BEGIN RSA {} KEY-----", "PRIVATE");
        let end = format!("-----END RSA {} KEY-----", "PRIVATE");
        let body = format!("{}\n{}", random(64), random(64));
        assert_eq!(
            masked(&format!("key:\n{begin}\n{body}\n{end}\nafter")),
            "key:\n[redacted private key]\nafter"
        );
        assert_eq!(
            masked(&format!("cut off: {begin}\n{body}")),
            "cut off: [redacted private key]"
        );
        assert_kept("-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----");
        assert_kept("-----BEGIN CERTIFICATE-----");
    }

    #[test]
    fn connection_url_passwords() {
        let password = random(16);
        assert_eq!(
            masked(&format!(
                "DATABASE_URL=postgres://app:{password}@db.internal:5432/app"
            )),
            "DATABASE_URL=postgres://app:[redacted password]@db.internal:5432/app"
        );
        assert_eq!(
            masked(&format!("https://:{password}@example.com")),
            "https://:[redacted password]@example.com"
        );
        assert_kept("postgres://app:${DB_PASSWORD}@db/app");
        assert_kept("https://example.com:8443/path@v2");
        assert_kept("git@github.com:org/repo.git");
        assert_kept("ssh://git@github.com/org/repo.git");
    }

    #[test]
    fn identifiers_are_never_masked() {
        assert_kept("commit 3f6c2a1e9b8d7c6f5e4d3c2b1a0f9e8d7c6b5a49 and 3f6c2a1");
        assert_kept(&format!("sha256 {}", "a1b2c3d4".repeat(8)));
        assert_kept("run 0b6f8a52-1c3d-4e5f-8a9b-0c1d2e3f4a5b");
        assert_kept("token_expiry_seconds = 3600; api_key_header = \"X-Api-Key\"");
        assert_kept("C:\\Users\\me\\project and /Users/me/project");
    }

    #[test]
    fn several_shapes_in_one_text() {
        let github = format!("ghp_{}", random(36));
        let stripe = format!("sk_live_{}", random(24));
        assert_eq!(
            masked(&format!("{github} then {stripe} and {github}")),
            "[redacted GitHub token] then [redacted Stripe key] and [redacted GitHub token]"
        );
    }

    #[test]
    fn remembered_values_and_shapes_are_masked_outbound() {
        let value = format!("remembered-{}", random(12));
        remember(&[value.clone(), "short".into()]);
        let token = format!("hf_{}", random(34));
        let text = format!("use {value} with {token}; keep short");
        assert_eq!(
            outbound(&text),
            "use [redacted] with [redacted Hugging Face token]; keep short"
        );
        assert!(matches!(outbound("nothing secret"), Cow::Borrowed(_)));
    }

    #[test]
    fn values_keep_identifying_fields() {
        let token = format!("ghp_{}", random(36));
        let mut value = serde_json::json!({
            "id": token,
            "result": format!("pushed with {token}"),
            "activity": [format!("Bearer {}", random(32))],
            "count": 3,
        });
        outbound_value(&mut value);
        assert_eq!(
            value,
            serde_json::json!({
                "id": token,
                "result": "pushed with [redacted GitHub token]",
                "activity": ["Bearer [redacted bearer token]"],
                "count": 3,
            })
        );
    }

    #[test]
    fn environment_secrets_follow_names_and_connection_urls() {
        let password = format!("p@ss {}", random(10));
        let encoded = password.replace('@', "%40").replace(' ', "%20");
        let values = environment(
            [
                ("SERVICE_API_KEY", "service-key-value"),
                ("GH_TOKEN", "github-token-value"),
                ("SSH_AUTH_SOCK", "/private/tmp/launchd/Listeners"),
                ("DATABASE_URL", &format!("postgres://app:{encoded}@db/app")),
                ("EDITOR", "code --wait --new-window"),
                ("SHORT_SECRET", "tiny"),
            ]
            .map(|(name, value)| (name.to_string(), value.to_string())),
        );
        assert_eq!(
            values,
            [
                "service-key-value".to_string(),
                "github-token-value".into(),
                password,
                encoded,
            ]
        );
    }
}
