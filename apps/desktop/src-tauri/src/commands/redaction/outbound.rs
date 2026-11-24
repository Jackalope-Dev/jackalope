//! One-way masking for text Jackalope sends off this device or writes where
//! others read it: feedback reports, phone and web companion responses, Jev
//! requests and exported plans. Values Jackalope knows are secret are replaced
//! first, then credential shapes. Nothing stored locally or given to an agent
//! is changed.
//!
//! The credential shapes and the secret-named environment rule adapt
//! oh-my-pi's secret obfuscation (MIT); see public/licenses/oh-my-pi.txt.

use super::{MARK, STRUCTURAL};
use aho_corasick::{AhoCorasick, MatchKind};
use regex::{Regex, RegexSet};
use serde_json::Value;
use std::{
    borrow::Cow,
    collections::VecDeque,
    sync::{Arc, LazyLock},
};

/// The most values remembered at once; the least recently given are
/// forgotten first. Secrets in the app's own environment are always kept.
const MAX_KNOWN: usize = 1024;
/// Fields of companion responses, besides [`STRUCTURAL`], that name a task,
/// session or project the companion sends back in later requests.
const IDENTIFIERS: &[&str] = &["taskId", "sessionId", "projectId"];

#[derive(Clone, Copy)]
enum Kind {
    /// A whole token, standing alone: not part of a longer identifier.
    Token,
    /// The credential after an introducer such as `Bearer `.
    Credential,
    /// The password in `scheme://user:password@host`.
    Password,
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
            Kind::Credential => found.bytes().any(|b| b.is_ascii_digit()),
            Kind::Password => !found.starts_with(['$', '{', '<', '*', '[', '%']),
            Kind::Token => {
                boundary_before(&text[..start])
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

/// Whether a token may start after `before`: at a word boundary, or right
/// after an escape (`\n`, `"`) or percent-encoding (`%3A`), whose last
/// character would otherwise look like part of the token.
fn boundary_before(before: &str) -> bool {
    if !before.chars().next_back().is_some_and(continues) {
        return true;
    }
    let bytes = before.as_bytes();
    let tail = |len: usize| bytes.len().checked_sub(len).map(|at| &bytes[at..]);
    let hex = |part: &[u8]| part.iter().all(u8::is_ascii_hexdigit);
    matches!(tail(2), Some([b'\\', b'n' | b'r' | b't']))
        || tail(3).is_some_and(|part| part[0] == b'%' && hex(&part[1..]))
        || tail(6).is_some_and(|part| part.starts_with(b"\\u") && hex(&part[2..]))
}

const KEY_MARK: &str = "[redacted private key]";

static KEY_BEGIN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----").expect("key header compiles")
});
static KEY_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\A-----END [A-Z0-9 ]*PRIVATE KEY-----").expect("key footer compiles")
});

/// A line of a key's body: base64 long enough to hold a digit or symbol, or
/// an encrypted key's headers. `before_end` accepts the short last line.
fn key_line(body: &str, before_end: bool, after_dek: bool) -> bool {
    let body = body.trim_end();
    let base64 = !body.is_empty()
        && body
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='));
    (base64 && (before_end || (body.len() >= 16 && body.bytes().any(|b| !b.is_ascii_alphabetic()))))
        || body.starts_with("Proc-Type:")
        || body.starts_with("DEK-Info:")
        || (body.is_empty() && after_dek)
}

/// The prefix a line of a key carries before its content, matching the
/// header line's `header` prefix: the same text, such as `> ` in a quote, or
/// a diff marker (` `, `+`, `-`) where the header line has one.
fn line_prefix<'a>(header: &str, line: &'a str) -> &'a str {
    if !header.is_empty() && line.starts_with(header) {
        return &line[..header.len()];
    }
    if header.starts_with([' ', '+', '-']) && line.starts_with([' ', '+', '-']) {
        return if line[1..].starts_with(&header[1..]) {
            &line[..header.len()]
        } else {
            &line[..1]
        };
    }
    ""
}

/// The end of the key whose header is `start..header_end` in `text`, and its
/// replacement. A key spans its key lines and its END line when present, so a
/// header with nothing key-like after it masks only itself. When every line of
/// the key carries a prefix, such as a diff marker, the replacement keeps one
/// prefixed line per line so diff hunks stay valid.
fn key(text: &str, start: usize, header_end: usize) -> (usize, String) {
    let rest = &text[header_end..];
    if rest.starts_with("\\n") || rest.starts_with("\\r\\n") {
        return (escaped_key(text, header_end), KEY_MARK.into());
    }
    if !rest.starts_with('\n') && !rest.starts_with("\r\n") {
        return (header_end, KEY_MARK.into());
    }
    let header = &text[text[..start].rfind('\n').map_or(0, |at| at + 1)..start];
    let lines: Vec<(usize, &str)> = text[header_end..]
        .split('\n')
        .scan(header_end, |at, line| {
            let found = (*at, line);
            *at += line.len() + 1;
            Some(found)
        })
        .collect();
    // The header line's own ending, then each key line's prefix and ending.
    let mut kept: Vec<(&str, &str)> = Vec::new();
    let mut end = header_end;
    let mut after_dek = false;
    for (index, &(at, line)) in lines.iter().enumerate().skip(1) {
        let own = line_prefix(header, line);
        let body = &line[own.len()..];
        if let Some(footer) = KEY_END.find(body) {
            kept.push((own, ""));
            end = at + own.len() + footer.end();
            break;
        }
        let before_end = lines
            .get(index + 1)
            .is_some_and(|&(_, next)| KEY_END.is_match(&next[line_prefix(header, next).len()..]));
        if !key_line(body, before_end, after_dek) {
            break;
        }
        after_dek = body.starts_with("DEK-Info:");
        let ending = if line.ends_with('\r') { "\r" } else { "" };
        kept.push((own, ending));
        end = at + line.len() - ending.len();
    }
    let header_ending = if lines[0].1 == "\r" { "\r" } else { "" };
    let mut out = String::from(KEY_MARK);
    if kept.is_empty() {
        return (header_end, out);
    }
    if kept.iter().all(|(own, _)| !own.is_empty()) {
        out.push_str(header_ending);
        for (index, (own, ending)) in kept.iter().enumerate() {
            out.push('\n');
            out.push_str(own);
            if index + 1 < kept.len() {
                out.push_str(ending);
            }
        }
    }
    (end, out)
}

/// The end of a key written with escaped line breaks (`\n` inside a JSON or
/// code string) whose header ends at `header_end`.
fn escaped_key(text: &str, header_end: usize) -> usize {
    let mut end = header_end;
    let mut after_dek = false;
    loop {
        let rest = &text[end..];
        let Some(segment) = rest
            .strip_prefix("\\r\\n")
            .or_else(|| rest.strip_prefix("\\n"))
        else {
            return end;
        };
        let start = text.len() - segment.len();
        if let Some(footer) = KEY_END.find(segment) {
            return start + footer.end();
        }
        let length = segment
            .find(|c: char| !(c.is_ascii_alphanumeric() || "+/=:,- ".contains(c)))
            .unwrap_or(segment.len());
        let body = &segment[..length];
        let next = &segment[length..];
        let before_end = KEY_END.is_match(
            next.strip_prefix("\\r\\n")
                .or_else(|| next.strip_prefix("\\n"))
                .unwrap_or(""),
        );
        if !key_line(body, before_end, after_dek) {
            return end;
        }
        after_dek = body.starts_with("DEK-Info:");
        end = start + length;
    }
}

/// `text` with private keys masked.
fn private_keys(text: &str) -> Cow<'_, str> {
    let mut out = String::new();
    let mut last = 0;
    let mut changed = false;
    for header in KEY_BEGIN.find_iter(text) {
        if header.start() < last {
            continue;
        }
        let (end, replacement) = key(text, header.start(), header.end());
        out.push_str(&text[last..header.start()]);
        out.push_str(&replacement);
        last = end;
        changed = true;
    }
    if !changed {
        return Cow::Borrowed(text);
    }
    out.push_str(&text[last..]);
    Cow::Owned(out)
}

/// `text` with credential shapes masked.
fn shapes(text: &str) -> Cow<'_, str> {
    let mut text = private_keys(text);
    let (set, regexes) = &*PATTERNS;
    let matched = set.matches(&text);
    if !matched.matched_any() {
        return text;
    }
    for index in matched.iter() {
        if let Some(replaced) = SHAPES[index].replace(&regexes[index], &text) {
            text = Cow::Owned(replaced);
        }
    }
    text
}

/// Every form of `values` matched in one pass, longest first where several
/// start at the same place.
fn matcher<'a>(values: impl Iterator<Item = &'a String>) -> Option<Arc<AhoCorasick>> {
    let mut forms: Vec<String> = values
        .filter(|value| value.chars().count() >= super::MIN_CHARS)
        .flat_map(|value| super::forms(value))
        .collect();
    forms.sort();
    forms.dedup();
    if forms.is_empty() {
        return None;
    }
    AhoCorasick::builder()
        .match_kind(MatchKind::LeftmostLongest)
        .build(forms)
        .ok()
        .map(Arc::new)
}

#[derive(Default)]
struct Known {
    /// Secrets in this app's own environment.
    environment: Vec<String>,
    /// Values Jackalope handled since, least recently given first.
    remembered: VecDeque<String>,
    matcher: Option<Arc<AhoCorasick>>,
}

impl Known {
    #[cfg(not(test))]
    fn new(environment: Vec<String>) -> Self {
        let mut known = Self {
            environment,
            ..Self::default()
        };
        known.rebuild();
        known
    }

    fn rebuild(&mut self) {
        self.matcher = matcher(self.environment.iter().chain(&self.remembered));
    }

    fn remember(&mut self, values: &[String]) {
        let mut added = false;
        for value in values {
            if value.chars().count() < super::MIN_CHARS {
                continue;
            }
            if let Some(at) = self.remembered.iter().position(|known| known == value) {
                self.remembered.remove(at);
            } else {
                added = true;
            }
            self.remembered.push_back(value.clone());
        }
        while self.remembered.len() > MAX_KNOWN {
            self.remembered.pop_front();
        }
        if added {
            self.rebuild();
        }
    }
}

#[cfg(not(test))]
static KNOWN: LazyLock<std::sync::RwLock<Known>> = LazyLock::new(|| {
    // `vars_os`: `vars` panics on a variable that is not Unicode.
    let variables = std::env::vars_os()
        .filter_map(|(name, value)| Some((name.into_string().ok()?, value.into_string().ok()?)));
    std::sync::RwLock::new(Known::new(environment(variables)))
});

/// Adds secret values Jackalope handled, such as those it gave an agent, to
/// what outbound text never shows for the rest of this app session. Kept in
/// memory only.
#[cfg(not(test))]
pub(crate) fn remember(values: &[String]) {
    if let Ok(mut known) = KNOWN.write() {
        known.remember(values);
    }
}

#[cfg(not(test))]
fn known() -> Option<Arc<AhoCorasick>> {
    KNOWN.read().ok()?.matcher.clone()
}

// Tests run in parallel threads of one process, so each test thread keeps its
// own values, starting without the test process's environment.
#[cfg(test)]
thread_local! {
    static KNOWN: std::cell::RefCell<Known> = std::cell::RefCell::default();
}

#[cfg(test)]
pub(crate) fn remember(values: &[String]) {
    KNOWN.with(|known| known.borrow_mut().remember(values));
}

#[cfg(test)]
fn known() -> Option<Arc<AhoCorasick>> {
    KNOWN.with(|known| known.borrow().matcher.clone())
}

/// `text` as it may leave this device: known secret values and credential
/// shapes replaced, everything else as written.
pub(crate) fn outbound(text: &str) -> Cow<'_, str> {
    match known().filter(|known| known.is_match(text)) {
        None => shapes(text),
        Some(known) => {
            let mut masked = String::with_capacity(text.len());
            known.replace_all_with(text, &mut masked, |_, _, out| {
                out.push_str(MARK);
                true
            });
            Cow::Owned(shapes(&masked).into_owned())
        }
    }
}

/// [`outbound`] cut to its first `max` characters. Masking comes first, so a
/// credential the cut would shorten is still recognized.
pub(crate) fn outbound_clipped(text: &str, max: usize) -> String {
    outbound(text).chars().take(max).collect()
}

/// [`outbound`] for every string in `value`, leaving object keys and the
/// fields that identify, date or classify a record as they are. The result is
/// the same JSON shape with only string contents changed.
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
            .filter(|(key, _)| {
                !STRUCTURAL.contains(&key.as_str()) && !IDENTIFIERS.contains(&key.as_str())
            })
            .for_each(|(_, item)| outbound_value(item)),
        _ => {}
    }
}

/// A variable named for a secret: its name ends in a secret word, so
/// `NEXTAUTH_URL` and `SSH_AUTH_SOCK` are not.
static SECRET_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|AUTH|CREDENTIALS?|KEY_BASE)$")
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

/// An address with no credentials in it: no user, password, query or fragment.
fn plain_url(value: &str) -> bool {
    value.contains("://")
        && reqwest::Url::parse(value).is_ok_and(|url| {
            url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
        })
}

/// The secret values in an environment: secret-named variables, and the
/// password in any connection URL (raw and percent-decoded).
fn environment(variables: impl IntoIterator<Item = (String, String)>) -> Vec<String> {
    let mut values = Vec::new();
    for (name, value) in variables {
        if SECRET_NAME.is_match(&name) && !location(&value) && !plain_url(&value) {
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
    fn a_header_without_a_key_masks_only_what_follows_it_that_looks_like_a_key() {
        let begin = format!("-----BEGIN {} KEY-----", "PRIVATE");
        let end = format!("-----END {} KEY-----", "PRIVATE");
        let (one, two) = (random(64), random(40));
        assert_eq!(
            masked(&format!("Paste the line {begin}\nthen the key.\nDone")),
            "Paste the line [redacted private key]\nthen the key.\nDone"
        );
        assert_eq!(
            masked(&format!(
                "{begin}\n{one}\n{two}\nThe rest stays.\nAnd this."
            )),
            "[redacted private key]\nThe rest stays.\nAnd this."
        );
        assert_eq!(
            masked(&format!(
                "{begin} goes first.\nNotes\n{begin}\n{one}\n{end}\nafter"
            )),
            "[redacted private key] goes first.\nNotes\n[redacted private key]\nafter"
        );
        let encrypted = format!(
            "{begin}\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,{}\n\n{one}\n{end}\nafter",
            random(32)
        );
        assert_eq!(masked(&encrypted), "[redacted private key]\nafter");
    }

    #[test]
    fn escaped_private_keys_are_masked_through_their_escaped_breaks() {
        let begin = format!("-----BEGIN {} KEY-----", "PRIVATE");
        let end = format!("-----END {} KEY-----", "PRIVATE");
        let (one, two) = (random(64), random(40));
        assert_eq!(
            masked(&format!(
                r#""key": "{begin}\n{one}\n{two}\n{end}\n", "next": 1"#
            )),
            r#""key": "[redacted private key]\n", "next": 1"#
        );
        assert_eq!(
            masked(&format!(r#""key": "{begin}\n{one}\nnext words"#)),
            r#""key": "[redacted private key]\nnext words"#
        );
    }

    #[test]
    fn private_keys_in_a_diff_keep_its_line_count() {
        let begin = format!("-----BEGIN {} KEY-----", "PRIVATE");
        let end = format!("-----END {} KEY-----", "PRIVATE");
        let (one, two) = (random(64), random(40));
        let diff = format!("@@ -0,0 +1,5 @@\n+key:\n+{begin}\n+{one}\n+{two}\n+{end}\n");
        let result = masked(&diff);
        assert_eq!(
            result,
            "@@ -0,0 +1,5 @@\n+key:\n+[redacted private key]\n+\n+\n+\n"
        );
        assert_eq!(result.lines().count(), diff.lines().count());
        assert_eq!(
            masked(&format!("> {begin}\n{one}\n{end}\nafter")),
            "> [redacted private key]\nafter"
        );
        let mixed = format!("@@ -1,4 +1,4 @@\n {begin}\n-{one}\n+{two}\n {end}\n other\n");
        assert_eq!(
            masked(&mixed),
            "@@ -1,4 +1,4 @@\n [redacted private key]\n-\n+\n \n other\n"
        );
        let unclosed = format!(
            "@@ -0,0 +1,2 @@\n+{begin}\n+not a key line\ndiff --git a/b b/b\n@@ -1 +1 @@\n-x\n+y\n"
        );
        assert_eq!(
            masked(&unclosed),
            unclosed.replace(&begin, "[redacted private key]")
        );
    }

    #[test]
    fn tokens_after_escapes_and_percent_encoding() {
        let github = format!("ghp_{}", random(36));
        let stripe = format!("sk_live_{}", random(24));
        assert_eq!(
            masked(&format!(r"line\n{github}\tend")),
            r"line\n[redacted GitHub token]\tend"
        );
        assert_eq!(
            masked(&format!("user%3A{github}%40host")),
            "user%3A[redacted GitHub token]%40host"
        );
        assert_eq!(
            masked(&format!("key=%20{stripe}")),
            "key=%20[redacted Stripe key]"
        );
        assert_eq!(
            masked(&format!(r"\u0022{github}\u0022")),
            r"\u0022[redacted GitHub token]\u0022"
        );
        assert_kept(&format!("n{github}"));
        assert_kept(&format!("%zz{github}"));
        assert_kept(&format!("1{stripe}"));
    }

    #[test]
    fn clipping_comes_after_masking() {
        let token = format!("ghp_{}", random(36));
        let clipped = outbound_clipped(&format!("{} {token} more", "x".repeat(9)), 30);
        assert_eq!(clipped, format!("{} [redacted GitHub tok", "x".repeat(9)));
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
    fn the_least_recently_given_values_are_forgotten_first() {
        let mut known = Known {
            environment: vec![format!("environment-{}", random(12))],
            ..Known::default()
        };
        let value = |n: usize| format!("value-{n:08}");
        known.remember(&[value(0)]);
        known.remember(&(1..MAX_KNOWN).map(value).collect::<Vec<_>>());
        known.remember(&[value(0)]);
        known.remember(&[value(MAX_KNOWN)]);
        assert_eq!(known.remembered.len(), MAX_KNOWN);
        assert_eq!(known.remembered.front(), Some(&value(2)));
        let matcher = known.matcher.unwrap();
        for kept in [value(0), value(MAX_KNOWN), known.environment[0].clone()] {
            assert!(matcher.is_match(kept.as_str()), "{kept}");
        }
        assert!(!matcher.is_match(value(1).as_str()));
    }

    #[test]
    fn masked_values_stay_valid_json() {
        let quoted = format!("pa\"ss\\word-{}", random(8));
        remember(std::slice::from_ref(&quoted));
        let token = format!("ghp_{}", random(36));
        let mut value = serde_json::json!({
            "projectId": token,
            "messages": [format!("{{\"env\":\"{quoted}\",\"t\":\"{token}\"}}")],
            "nested": {"text": format!("{quoted}\n{token}")},
        });
        outbound_value(&mut value);
        let text = serde_json::to_string(&value).unwrap();
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["projectId"], token);
        assert_eq!(
            parsed["messages"][0],
            "{\"env\":\"[redacted]\",\"t\":\"[redacted GitHub token]\"}"
        );
        assert_eq!(
            parsed["nested"]["text"],
            "[redacted]\n[redacted GitHub token]"
        );
        assert!(!text.contains("pa\\\"ss"));
    }

    #[test]
    fn values_keep_identifying_fields() {
        let token = format!("ghp_{}", random(36));
        let mut value = serde_json::json!({
            "id": token,
            "taskId": token,
            "result": format!("pushed with {token}"),
            "activity": [format!("Bearer {}", random(32))],
            "count": 3,
        });
        outbound_value(&mut value);
        assert_eq!(
            value,
            serde_json::json!({
                "id": token,
                "taskId": token,
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
                ("NEXTAUTH_URL", "http://localhost:3000"),
                ("OAUTH_TOKEN_URL", "https://auth.example.com/token"),
                ("AUTH0_AUTH_DOMAIN", "tenant.example.auth0.com"),
                ("SERVICE_TOKEN", "https://api.example.com/v1"),
                ("WEBHOOK_SECRET", "https://hooks.example.com/in?sig=abc123"),
                ("PGPASSWORD", "database-password"),
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
                "https://hooks.example.com/in?sig=abc123".into(),
                "database-password".into(),
            ]
        );
    }
}
