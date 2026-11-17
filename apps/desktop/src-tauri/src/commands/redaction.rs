//! Exact secret values Jackalope gave an agent, kept out of what it records
//! about the attempt. The learning redactor recognizes secret-shaped words in
//! text Jackalope keeps as evidence; this one replaces known values wherever
//! they appear, in any shape, and leaves everything else as the agent wrote it.

use base64::Engine as _;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

/// What a value is replaced with.
pub(crate) const MARK: &str = "[redacted]";
/// Shorter values are left alone: replacing a common word everywhere would
/// mangle the record more than it protects.
const MIN_CHARS: usize = 8;
/// How far back streaming text is searched for the start of a value.
const HOLD_BACK: usize = 4096;
/// Fields of Jackalope's own records that identify, date or classify an entry.
/// They are never the agent's words, and changing one could break the record.
const STRUCTURAL: &[&str] = &[
    "id",
    "runId",
    "status",
    "inputType",
    "kind",
    "type",
    "phase",
    "supersedes",
    "filePath",
    "at",
    "createdAt",
    "answeredAt",
    "recordedAt",
    "checkedAt",
    "timestamp",
];

#[derive(Default)]
pub(crate) struct KnownSecrets {
    values: Vec<String>,
    /// Every form a value is looked for in, longest first so a value that
    /// contains another is replaced whole.
    forms: Vec<String>,
    /// The forms as they appear inside a serialized JSON string.
    serialized: Vec<String>,
}

impl std::fmt::Debug for KnownSecrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "KnownSecrets({} values)", self.values.len())
    }
}

impl KnownSecrets {
    /// The values long enough to redact, or `None` when there are none.
    pub(crate) fn new(values: impl IntoIterator<Item = String>) -> Option<Self> {
        let mut values: Vec<String> = values
            .into_iter()
            .filter(|value| value.chars().count() >= MIN_CHARS)
            .collect();
        values.sort();
        values.dedup();
        if values.is_empty() {
            return None;
        }
        let mut forms: Vec<String> = values.iter().flat_map(|value| forms(value)).collect();
        forms.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        forms.dedup();
        let mut serialized: Vec<String> = forms.iter().map(|form| json_escaped(form)).collect();
        serialized.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        serialized.dedup();
        Some(Self {
            values,
            forms,
            serialized,
        })
    }

    /// These values and `more`.
    pub(crate) fn with(this: Option<&Self>, more: Vec<String>) -> Option<Self> {
        Self::new(
            this.into_iter()
                .flat_map(|this| this.values.clone())
                .chain(more),
        )
    }

    /// Replaces every value in `text`, returning whether anything was.
    pub(crate) fn text(&self, text: &mut String) -> bool {
        let mut changed = false;
        for form in &self.forms {
            if text.contains(form.as_str()) {
                *text = text.replace(form.as_str(), MARK);
                changed = true;
            }
        }
        changed
    }

    pub(crate) fn redacted<'a>(&self, text: &'a str) -> std::borrow::Cow<'a, str> {
        if self.forms.iter().any(|form| text.contains(form.as_str())) {
            let mut text = text.to_string();
            self.text(&mut text);
            std::borrow::Cow::Owned(text)
        } else {
            std::borrow::Cow::Borrowed(text)
        }
    }

    /// Text the agent is still writing: redacted, and without a trailing start
    /// of a value that the next part may complete.
    pub(crate) fn streaming(&self, text: &mut String) {
        self.text(text);
        let bytes = text.as_bytes();
        let mut cut = bytes.len();
        for form in &self.forms {
            let form = form.as_bytes();
            let start = bytes.len().saturating_sub((form.len() - 1).min(HOLD_BACK));
            if let Some(at) = (start..bytes.len())
                .find(|&at| bytes[at] == form[0] && form.starts_with(&bytes[at..]))
            {
                cut = cut.min(at);
            }
        }
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
    }

    /// Replaces every value in the strings of `value`, leaving object keys and
    /// [`STRUCTURAL`] fields as they are. Returns whether anything changed.
    pub(crate) fn value(&self, value: &mut Value) -> bool {
        match value {
            Value::String(text) => self.text(text),
            Value::Array(items) => items
                .iter_mut()
                .fold(false, |changed, item| self.value(item) | changed),
            Value::Object(fields) => fields
                .iter_mut()
                .filter(|(key, _)| !STRUCTURAL.contains(&key.as_str()))
                .fold(false, |changed, (_, item)| self.value(item) | changed),
            _ => false,
        }
    }

    /// Redacts a structured record field through its serialized form, only
    /// when a value appears in it. A record that would no longer deserialize
    /// is left unchanged.
    pub(crate) fn record<T: Serialize + DeserializeOwned>(&self, field: &mut T) {
        let Ok(text) = serde_json::to_string(field) else {
            return;
        };
        if !self
            .serialized
            .iter()
            .any(|form| text.contains(form.as_str()))
        {
            return;
        }
        let Ok(mut value) = serde_json::to_value(&*field) else {
            return;
        };
        if self.value(&mut value) {
            if let Ok(redacted) = serde_json::from_value(value) {
                *field = redacted;
            }
        }
    }
}

/// The forms one value takes in what an agent prints: as written, inside a
/// JSON string (with and without escaped non-ASCII), and encoded as base64 or
/// for a URL.
fn forms(value: &str) -> Vec<String> {
    let escaped = json_escaped(value);
    let ascii: String = escaped
        .chars()
        .flat_map(|c| {
            if c.is_ascii() {
                vec![c.to_string()]
            } else {
                c.encode_utf16(&mut [0; 2])
                    .iter()
                    .map(|unit| format!("\\u{unit:04x}"))
                    .collect()
            }
        })
        .collect();
    let bytes = value.as_bytes();
    let base64 = |engine: &base64::engine::GeneralPurpose| {
        engine.encode(bytes).trim_end_matches('=').to_string()
    };
    let url: String = bytes
        .iter()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(byte) {
                (*byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect();
    vec![
        value.to_string(),
        escaped,
        ascii,
        base64(&base64::engine::general_purpose::STANDARD),
        base64(&base64::engine::general_purpose::URL_SAFE),
        url,
    ]
}

fn json_escaped(text: &str) -> String {
    let quoted = serde_json::to_string(text).unwrap_or_default();
    quoted[1..quoted.len() - 1].to_string()
}

/// The values of the variables Jackalope gave an agent that the attempt's
/// record must not show: the project secrets in `secret_names`, and every
/// credential, such as a managed account's key or the attempt's bridge token.
pub(crate) fn injected<N: AsRef<str>, V: AsRef<str>>(
    environment: impl IntoIterator<Item = (N, V)>,
    secret_names: &[String],
) -> Vec<String> {
    environment
        .into_iter()
        .filter(|(name, _)| {
            let name = name.as_ref();
            super::process_control::credential_variable(name)
                || secret_names.iter().any(|secret| secret == name)
        })
        .map(|(_, value)| value.as_ref().to_string())
        .collect()
}

/// [`injected`] for the variables set on `command`.
pub(crate) fn injected_into(
    command: &std::process::Command,
    secret_names: &[String],
) -> Vec<String> {
    injected(
        command
            .get_envs()
            .filter_map(|(name, value)| Some((name.to_str()?, value?.to_str()?))),
        secret_names,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_form_of_a_value_is_replaced_longest_first() {
        let secret = "sk-\"quoted\"\\back-пароль-42";
        let longer = format!("{secret}-and-more");
        let secrets = KnownSecrets::new([secret.to_string(), longer.clone()]).unwrap();
        let shapes = forms(secret);
        assert!(shapes[2].contains("\\u043f"), "{}", shapes[2]);
        assert_eq!(shapes.len(), 6);
        let mut text = format!("{longer} | {}", shapes.join(" | "));
        assert!(secrets.text(&mut text));
        for form in forms(secret).iter().chain(&forms(&longer)) {
            assert!(!text.contains(form.as_str()), "{form} in {text}");
        }
        assert!(text.starts_with("[redacted] | [redacted] | "), "{text}");
        assert!(!text.contains("-and-more"), "{text}");
    }

    #[test]
    fn short_values_are_never_redacted() {
        assert!(KnownSecrets::new(["short".to_string()]).is_none());
        let secrets = KnownSecrets::new(["short".to_string(), "longer-value".into()]).unwrap();
        let mut text = "short longer-value".to_string();
        secrets.text(&mut text);
        assert_eq!(text, "short [redacted]");
    }

    #[test]
    fn structure_is_kept_while_its_text_is_redacted() {
        let secrets = KnownSecrets::new(["tok_0123456789abcdef".to_string()]).unwrap();
        let mut value = serde_json::json!({
            "id": "tok_0123456789abcdef",
            "question": "use tok_0123456789abcdef?",
            "tok_0123456789abcdef": ["tok_0123456789abcdef", 1, null],
        });
        assert!(secrets.value(&mut value));
        assert_eq!(
            value,
            serde_json::json!({
                "id": "tok_0123456789abcdef",
                "question": "use [redacted]?",
                "tok_0123456789abcdef": ["[redacted]", 1, null],
            })
        );
    }

    #[test]
    fn streaming_text_holds_back_the_start_of_a_value() {
        let secrets = KnownSecrets::new(["sk-live-0123456789".to_string()]).unwrap();
        let mut text = "key is sk-live-01".to_string();
        secrets.streaming(&mut text);
        assert_eq!(text, "key is ");
        let mut text = "key is sk-live-0123456789 ok".to_string();
        secrets.streaming(&mut text);
        assert_eq!(text, "key is [redacted] ok");
        let mut text = "nothing to hold".to_string();
        secrets.streaming(&mut text);
        assert_eq!(text, "nothing to hold");
    }

    #[test]
    fn credentials_and_named_secrets_are_the_injected_values() {
        let mut command = std::process::Command::new("fixture");
        command
            .env("HIGGSFIELD", "project-secret-value")
            .env("OPENAI_API_KEY", "sk-managed-0123456789")
            .env("JACKALOPE_BRIDGE_TOKEN", "bridge-token-0123456789")
            .env("CODEX_HOME", "/profiles/codex")
            .env_remove("ANTHROPIC_API_KEY");
        let mut values = injected_into(&command, &["HIGGSFIELD".into()]);
        values.sort();
        assert_eq!(
            values,
            [
                "bridge-token-0123456789",
                "project-secret-value",
                "sk-managed-0123456789"
            ]
        );
    }
}
