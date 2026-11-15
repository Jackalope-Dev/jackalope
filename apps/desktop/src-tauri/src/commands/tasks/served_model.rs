//! The model an agent reports serving, compared with the model Jackalope asked for.

use super::*;
use serde::{Deserialize, Serialize};

/// A served model that is not the requested one, beyond a provider's prefix or dated alias.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMismatch {
    pub requested: String,
    pub served: String,
    /// The served model is the overload fallback Jackalope configured for Claude Code.
    #[serde(default)]
    pub fallback: bool,
}

/// Aliases that let the CLI pick the model per request, so any served model matches them.
const OPEN_ALIASES: [&str; 4] = ["default", "auto", "best", "opusplan"];

/// Records the model the agent reports serving. The first one that differs from the
/// requested model is kept as a finding and noted in activity.
pub(in crate::commands) fn observe(run: &mut TaskRun, served: &str) {
    let served = served.trim();
    // Claude Code names the messages it writes itself, such as API errors, "<synthetic>".
    if served.is_empty() || served == "<synthetic>" {
        return;
    }
    let served: String = served.chars().take(160).collect();
    if run.model_mismatch.is_none() {
        if let Some(requested) = run
            .requested_model
            .clone()
            .filter(|requested| !same_model(requested, &served))
        {
            let fallback = run
                .fallback_model
                .as_deref()
                .is_some_and(|fallback| same_model(fallback, &served));
            let note = if fallback {
                format!("Claude switched to its overload fallback model {served} (requested {requested}).")
            } else {
                format!("The agent reports serving {served}, not the requested {requested}.")
            };
            activity(run, &note);
            run.model_mismatch = Some(ModelMismatch {
                requested,
                served: served.clone(),
                fallback,
            });
        }
    }
    run.model = Some(served);
    run.model_reported = true;
}

/// Whether `served` names the `requested` model. A vendor prefix (`anthropic/…`) and a
/// dated or versioned suffix (`-20251001`, `-001`, `-preview`) are the provider's alias of
/// the same model; another family, number or tier (`-lite`) is not. The rules follow
/// HarnessRouter's support-matrix comparison (Apache-2.0), plus CLI family aliases.
pub(super) fn same_model(requested: &str, served: &str) -> bool {
    let (asked, served) = (normalize(requested), normalize(served));
    if asked.is_empty() || served.is_empty() {
        return false;
    }
    if asked == served {
        return true;
    }
    // A CLI alias such as Claude's "opus" or Gemini's "flash" names a family, not a version.
    if !asked.bytes().any(|b| b.is_ascii_digit()) {
        let family: Vec<&str> = asked.split('-').collect();
        let tokens: Vec<&str> = served.split('-').collect();
        return OPEN_ALIASES.contains(&asked.as_str())
            || tokens.windows(family.len()).any(|window| window == family);
    }
    let (long, short) = if served.len() > asked.len() {
        (&served, &asked)
    } else {
        (&asked, &served)
    };
    long.strip_prefix(short.as_str())
        .and_then(|rest| rest.strip_prefix('-'))
        .is_some_and(|suffix| suffix.split('-').all(version_part))
}

fn normalize(model: &str) -> String {
    let model = model.trim().to_ascii_lowercase();
    let name = model.rsplit('/').next().unwrap_or_default();
    // Claude Code marks a context-window variant as `opus[1m]`.
    let name = name.split('[').next().unwrap_or_default();
    name.trim().replace('.', "-")
}

fn version_part(part: &str) -> bool {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    (part.len() >= 2 && digits(part))
        || part.strip_prefix('v').is_some_and(digits)
        || matches!(part, "preview" | "latest")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_providers_alias_of_the_same_model_is_the_same_model() {
        for (asked, served) in [
            ("claude-fable-5", "anthropic/claude-fable-5"),
            ("gpt-5.6-sol", "openai/gpt-5.6-sol"),
            ("mistral-medium-3.5", "mistralai/mistral-medium-3-5"),
            ("qwen3.8-max", "qwen/qwen3.8-max-0902"),
            ("claude-haiku-4-5", "claude-haiku-4-5-20251001"),
            ("gemini-3.5-flash", "gemini-3.5-flash-001"),
            ("gemini-3.5-flash", "gemini-3.5-flash-preview-05-20"),
            ("anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"),
            ("opus", "claude-opus-4-5-20251101"),
            ("sonnet[1m]", "claude-sonnet-4-5-20250929"),
            ("flash-lite", "gemini-2.5-flash-lite"),
            ("default", "claude-sonnet-4-5-20250929"),
        ] {
            assert!(same_model(asked, served), "{asked} / {served}");
        }
    }

    #[test]
    fn another_family_number_or_tier_is_a_finding() {
        for (asked, served) in [
            ("gemini-3.8-flash", "google/gemini-3-flash-preview"),
            ("gemini-3.5-flash", "gemini-3.5-flash-lite"),
            ("claude-sonnet-5", "claude-opus-5"),
            ("claude-opus-4", "claude-opus-4-5"),
            ("gemini-3.8-flash", ""),
            ("opus", "claude-sonnet-4-5-20250929"),
        ] {
            assert!(!same_model(asked, served), "{asked} / {served}");
        }
    }

    fn run(requested: Option<&str>, fallback: Option<&str>) -> TaskRun {
        TaskRun {
            requested_model: requested.map(str::to_string),
            fallback_model: fallback.map(str::to_string),
            ..TaskRun::default()
        }
    }

    #[test]
    fn a_served_alias_records_no_finding() {
        let mut run = run(Some("claude-haiku-4-5"), None);
        observe(&mut run, "<synthetic>");
        assert!(!run.model_reported);
        observe(&mut run, "claude-haiku-4-5-20251001");
        assert!(run.model_reported);
        assert_eq!(run.model.as_deref(), Some("claude-haiku-4-5-20251001"));
        assert!(run.model_mismatch.is_none());
        assert!(run.activity.is_empty());
    }

    #[test]
    fn a_different_model_is_recorded_once() {
        let mut run = run(Some("gemini-3.8-flash"), None);
        observe(&mut run, "gemini-3-flash-preview");
        observe(&mut run, "gemini-3-flash-preview");
        assert_eq!(
            run.model_mismatch,
            Some(ModelMismatch {
                requested: "gemini-3.8-flash".into(),
                served: "gemini-3-flash-preview".into(),
                fallback: false,
            })
        );
        assert_eq!(run.activity.len(), 1);
        assert_eq!(run.model.as_deref(), Some("gemini-3-flash-preview"));
    }

    #[test]
    fn claudes_overload_fallback_is_labeled_as_fallback() {
        let mut run = run(Some("opus"), Some("sonnet"));
        observe(&mut run, "claude-opus-4-5-20251101");
        assert!(run.model_mismatch.is_none());
        observe(&mut run, "claude-sonnet-4-5-20250929");
        assert!(run.model_mismatch.as_ref().is_some_and(|m| m.fallback));
        assert!(run.activity[0].contains("overload fallback"));
    }

    #[test]
    fn the_cli_default_model_is_never_a_finding() {
        let mut run = run(None, None);
        observe(&mut run, "claude-opus-4-5-20251101");
        assert!(run.model_mismatch.is_none());
        assert_eq!(run.model.as_deref(), Some("claude-opus-4-5-20251101"));
    }
}
