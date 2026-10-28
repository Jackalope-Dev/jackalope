//! Redaction for learned lessons and their evidence. Lessons containing
//! anything sensitive are refused; evidence excerpts are kept with sensitive
//! words replaced.

const SECRET_PREFIXES: &[&str] = &[
    "sk-",
    "sk_live_",
    "sk_test_",
    "pk_live_",
    "rk_live_",
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "ghr_",
    "github_pat_",
    "glpat-",
    "xoxb-",
    "xoxp-",
    "xoxa-",
    "xoxs-",
    "akia",
    "asia",
    "aiza",
    "ya29.",
    "npm_",
    "hf_",
];

const SECRET_KEYS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "api-key",
    "authorization",
    "auth_token",
    "credential",
    "private_key",
    "access_key",
];

/// Words that mark text as credential-bearing even when no value is visible,
/// matching the extractors' existing exclusions.
pub(super) fn unsafe_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "password",
        "secret",
        "token",
        "credential",
        "api key",
        "api_key",
        "bearer",
        "-----begin",
        "authorization",
    ]
    .iter()
    .any(|word| lower.contains(word))
}

fn email(word: &str) -> bool {
    let Some((local, domain)) = word.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.starts_with('.')
        && domain.contains('.')
        && !domain.ends_with('.')
        && local
            .chars()
            .all(|c| c.is_alphanumeric() || "._%+-".contains(c))
}

fn identifier(word: &str) -> bool {
    let hex = word.chars().all(|c| c.is_ascii_hexdigit());
    // Git object ids and UUIDs identify things; they are not secrets.
    (hex && (word.len() == 40 || word.len() == 64))
        || uuid::Uuid::parse_str(word).is_ok_and(|_| word.len() == 36)
}

fn high_entropy(word: &str) -> bool {
    word.len() >= 32
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_/+=.".contains(c))
        && word.chars().any(|c| c.is_ascii_digit())
        && word.chars().any(|c| c.is_ascii_alphabetic())
        && !word.contains("//")
        && !identifier(word)
}

fn secret_value(word: &str) -> bool {
    let lower = word.to_lowercase();
    let jwt = lower.starts_with("eyj") && word.matches('.').count() == 2;
    (word.len() >= 12
        && (jwt
            || SECRET_PREFIXES
                .iter()
                .any(|prefix| lower.starts_with(prefix))))
        || high_entropy(word)
}

fn home() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|home| home.len() > 3)
}

/// The text with sensitive words replaced, and whether anything other than
/// the person's home folder was replaced.
pub(super) fn scan(text: &str) -> (String, bool) {
    let mut text = text.to_string();
    if let Some(home) = home() {
        for variant in [home.clone(), home.replace('\\', "/")] {
            text = text.replace(&variant, "~");
        }
    }
    if let Some(index) = text.find("-----BEGIN") {
        text.truncate(index);
        text.push_str("[private key]");
        return (text, true);
    }
    let mut sensitive = false;
    let mut after_marker = false;
    let mut out = Vec::new();
    for raw in text.split(' ') {
        let word = raw.trim_matches(|c: char| "\"'`()[]{}<>,;".contains(c) || c == '.');
        let lower = word.to_lowercase();
        let replacement = if word.is_empty() {
            None
        } else if after_marker {
            Some("[redacted]".to_string())
        } else if let Some((scheme, rest)) = word.split_once("://") {
            let authority = rest.split('/').next().unwrap_or_default();
            if authority.contains('@') {
                Some(format!("{scheme}://[redacted]"))
            } else if rest.split_once('?').is_some_and(|(_, query)| {
                let query = query.to_lowercase();
                SECRET_KEYS.iter().any(|key| query.contains(key)) || query.contains("sig=")
            }) {
                Some(format!(
                    "{scheme}://{}",
                    rest.split('?').next().unwrap_or_default()
                ))
            } else {
                None
            }
        } else if email(word) {
            Some("[email]".into())
        } else if let Some((key, _)) = word.split_once(['=', ':']).filter(|(key, value)| {
            !value.is_empty() && {
                let key = key.to_lowercase();
                key.ends_with("key") || SECRET_KEYS.iter().any(|secret| key.contains(secret))
            }
        }) {
            Some(format!("{key}=[redacted]"))
        } else if secret_value(word) {
            Some("[redacted]".into())
        } else {
            None
        };
        after_marker = matches!(lower.as_str(), "bearer" | "basic" | "token");
        match replacement {
            Some(replacement) => {
                sensitive = true;
                out.push(raw.replacen(word, &replacement, 1));
            }
            None => out.push(raw.to_string()),
        }
    }
    (out.join(" "), sensitive)
}

/// Text safe to keep as evidence.
pub fn redact(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    scan(&collapsed).0
}
