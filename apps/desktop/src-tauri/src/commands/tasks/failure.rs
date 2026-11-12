//! Why an attempt failed: a small typed kind kept beside the agent's own message.
//! The kind only describes the failure. Quota handoff still follows
//! `routing::quota_failure`, which this never changes.

use super::routing::QuotaFailure;
use super::TaskRun;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// The provider rejected the account's credentials or the CLI is signed out.
    Authentication,
    /// A usage allowance, credit balance or billing limit is used up until it resets.
    QuotaExhausted,
    /// Too many requests in a short window; the account still has allowance.
    RateLimited,
    /// The provider declined the request under its content or safety policy.
    ProviderRefused,
    /// The model does not exist or the account cannot use it.
    ModelUnavailable,
    /// The conversation no longer fits the model's context window.
    ContextTooLong,
    /// The agent stopped without reporting a reason; the message is its last output or exit code.
    AgentExited,
    /// A kind saved by a newer version of Jackalope.
    #[serde(other)]
    Other,
}

/// The longest reply still read as a provider error rather than an answer about one.
const PROVIDER_ERROR_MAX: usize = 4000;

/// Prefixes agent CLIs print as the turn's answer when the provider failed it:
/// Claude Code's "API Error: …" (Qwen Code wraps it in brackets) and goose's
/// "Ran into this error: …". Prefixes as observed by HarnessRouter (Apache-2.0).
const PROVIDER_ERROR_PREFIXES: [&str; 3] = [
    "api error:",
    "ran into this error:",
    "ran into this error trying to compact:",
];

/// A CLI-printed provider error, when `text` is one rather than an answer.
pub(in crate::commands) fn provider_error_text(text: &str) -> Option<String> {
    let text = text.trim();
    if text.len() > PROVIDER_ERROR_MAX {
        return None;
    }
    let bracketed = text.starts_with('[');
    let inner = text.trim_start_matches('[').trim_start();
    let matched = PROVIDER_ERROR_PREFIXES.iter().any(|prefix| {
        inner
            .as_bytes()
            .get(..prefix.len())
            .is_some_and(|start| start.eq_ignore_ascii_case(prefix.as_bytes()))
    });
    if !matched {
        return None;
    }
    let inner = if bracketed {
        inner.strip_suffix(']').unwrap_or(inner).trim_end()
    } else {
        inner
    };
    Some(inner.to_string())
}

/// Fails a turn whose only answer is a provider error the CLI printed.
pub(super) fn reject_error_answer(run: &mut TaskRun) {
    if run.error.is_none() {
        if let Some(error) = provider_error_text(&run.result) {
            run.error = Some(error);
            run.result.clear();
        }
    }
}

/// Gives a failed attempt its reason and kind. A message an event reported stays; without
/// one, the most informative of a printed provider error, the quota error, the agent's
/// last output and its exit code is used.
pub(super) fn explain(run: &mut TaskRun, exit_code: Option<i32>) {
    let mut unexplained = false;
    if run
        .error
        .as_deref()
        .is_none_or(|e| e.trim().is_empty() || e == "null")
    {
        let exit = exit_code.map_or("no exit code".into(), |c| c.to_string());
        run.error = Some(if let Some(error) = run.provider_error.take() {
            error
        } else if let Some(failure) = &run.quota_failure {
            failure.message.clone()
        } else {
            unexplained = true;
            match stderr_reason(&run.diagnostics) {
                Some(output) => format!("{output}\n\nAgent exited with {exit} without reporting an error; the lines above are its last output."),
                None => format!("Agent exited with {exit}. Inspect activity for details; no successful result was reported."),
            }
        });
    }
    let message = run.error.as_deref().unwrap_or_default();
    run.failure_kind = classify(message, run.quota_failure.as_ref())
        .or(unexplained.then_some(FailureKind::AgentExited));
}

/// The agent's last meaningful stderr lines, for a failure no event explained.
fn stderr_reason(diagnostics: &[String]) -> Option<String> {
    let lines: Vec<&str> = diagnostics
        .iter()
        .flat_map(|entry| entry.lines())
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                // Box-drawing borders and gutters of a formatted traceback are not a reason.
                && !line
                    .chars()
                    .next()
                    .is_some_and(|c| ('\u{2500}'..='\u{257f}').contains(&c) || c == '\u{276f}')
                // Hints meant for someone at the CLI's own terminal.
                && !line.starts_with("To resume this session")
                && !line.starts_with("See log: ")
        })
        .collect();
    let tail = lines[lines.len().saturating_sub(4)..].join("\n");
    (!tail.is_empty()).then(|| tail.chars().take(2000).collect())
}

/// Classifies a failure from its message, or from the quota error routing recorded.
fn classify(message: &str, quota: Option<&QuotaFailure>) -> Option<FailureKind> {
    if let Some(quota) = quota {
        return Some(quota_kind(&quota.message));
    }
    let text: String = message
        .chars()
        .take(4000)
        .collect::<String>()
        .to_lowercase();
    let first = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    if contains_any(&text, REFUSED) {
        Some(FailureKind::ProviderRefused)
    } else if contains_any(&text, CONTEXT) {
        Some(FailureKind::ContextTooLong)
    } else if contains_any(&text, MODEL) {
        Some(FailureKind::ModelUnavailable)
    } else if authentication(first) {
        Some(FailureKind::Authentication)
    } else if let Some(quota) =
        super::routing::quota_failure(&serde_json::json!({"type": "error", "message": message}))
    {
        Some(quota_kind(&quota.message))
    } else {
        None
    }
}

const REFUSED: &[&str] = &[
    "safeguards flagged",
    "content filter",
    "content_filter",
    "content policy",
    "content_policy",
    "usage policy",
    "usage policies",
    "blocked due to safety",
    "finish reason: safety",
    "prohibited_content",
    "responsible ai policy",
];

const CONTEXT: &[&str] = &[
    "prompt is too long",
    "prompt too long",
    "context length",
    "context_length",
    "context window",
    "maximum context",
    "input is too long",
    "input too long",
    "exceeds the context",
    "too many input tokens",
];

const MODEL: &[&str] = &[
    "model not found",
    "model_not_found",
    "modelnotfound",
    "unknown model",
    "invalid model",
    "unsupported model",
    "model is not supported",
    "model is not available",
    "model not available",
    "issue with the selected model",
    "model does not exist",
    "does not exist or you do not have access",
    "not supported when using codex",
];

fn contains_any(text: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| text.contains(pattern))
}

/// Judged on the first line only: a bad request's body or a retry note further down
/// can mention authentication without the credentials having been refused.
fn authentication(first_line: &str) -> bool {
    has_status(first_line, "401")
        || has_status(first_line, "403")
        || contains_any(
            first_line,
            &[
                "unauthorized",
                "unauthorised",
                "authentication",
                "authenticate",
                "invalid api key",
                "invalid_api_key",
                "incorrect api key",
                "invalid x-api-key",
                "api key not",
                "not logged in",
                "please run /login",
                "login required",
                "sign in again",
                "oauth token has expired",
                "token has expired",
                "invalid credentials",
                "permission_denied: forbidden",
            ],
        )
}

/// An HTTP status code standing alone, not part of a longer number.
fn has_status(text: &str, code: &str) -> bool {
    text.match_indices(code).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + code.len()..].chars().next();
        !before.is_some_and(|c| c.is_ascii_alphanumeric())
            && !after.is_some_and(|c| c.is_ascii_alphanumeric())
    })
}

fn quota_kind(message: &str) -> FailureKind {
    let text = message.to_lowercase();
    let exhausted = contains_any(
        &text,
        &[
            "quota",
            "usage limit",
            "usage_limit",
            "credit",
            "billing",
            "resets",
            "hit your limit",
            "reached your limit",
            "limit reached",
            "limit_reached",
            "exhausted",
            "daily",
            "weekly",
            "monthly",
            "out of",
        ],
    );
    let transient = contains_any(
        &text,
        &[
            "rate limit",
            "rate_limit",
            "too many requests",
            "retry after",
        ],
    ) || has_status(&text, "429");
    if transient && !exhausted {
        FailureKind::RateLimited
    } else {
        FailureKind::QuotaExhausted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quota(message: &str) -> QuotaFailure {
        QuotaFailure {
            model_only: false,
            message: message.into(),
        }
    }

    #[test]
    fn classifies_representative_agent_failures() {
        for (message, kind) in [
            ("API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"Invalid bearer token\"}} · Please run /login", FailureKind::Authentication),
            ("Invalid API key · Please run /login", FailureKind::Authentication),
            ("unexpected status 401 Unauthorized: Missing bearer or basic authentication in header", FailureKind::Authentication),
            ("Gemini CLI could not authenticate. Sign in to the selected account in Agents, then retry the task.", FailureKind::Authentication),
            ("API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/legal/aup).", FailureKind::ProviderRefused),
            ("API Error: Opus 5's safeguards flagged this message. Try rephrasing the request.", FailureKind::ProviderRefused),
            ("Response was blocked due to SAFETY", FailureKind::ProviderRefused),
            ("API Error: 400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"prompt is too long: 215000 tokens > 200000 maximum\"}}", FailureKind::ContextTooLong),
            ("Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.", FailureKind::ContextTooLong),
            ("There's an issue with the selected model (claude-opus-9). It may not exist or you may not have access to it. Run --model to pick a different model.", FailureKind::ModelUnavailable),
            ("The 'gpt-9' model is not supported when using Codex with a ChatGPT account.", FailureKind::ModelUnavailable),
            ("ProviderModelNotFoundError: Model not found: anthropic/claude-x", FailureKind::ModelUnavailable),
            ("You've hit your usage limit. Upgrade to Pro or try again at 4:12 PM.", FailureKind::QuotaExhausted),
            ("stream error: exceeded retry limit, last status: 429 Too Many Requests", FailureKind::RateLimited),
        ] {
            assert_eq!(classify(message, None), Some(kind), "{message}");
        }
        for message in [
            "Agent attempted a tool call in a helper that has tools disabled. Update the CLI before retrying.",
            "Claude was denied a required permission. Allow the operation and continue the task, or review what was blocked.",
            "Error on line 4013: unexpected token",
        ] {
            assert_eq!(classify(message, None), None, "{message}");
        }
    }

    #[test]
    fn authentication_is_read_from_the_first_line_only() {
        let bad_request = "API Error: 400 invalid_request_error: tools.3.name is invalid\nRetried after 401 from a stale proxy credential";
        assert_eq!(classify(bad_request, None), None);
        assert_eq!(classify("Error: something\nunauthorized", None), None);
    }

    #[test]
    fn recorded_quota_failures_split_exhaustion_from_rate_limits() {
        assert_eq!(
            classify(
                "anything",
                Some(&quota("You've hit your limit · resets 10pm"))
            ),
            Some(FailureKind::QuotaExhausted)
        );
        assert_eq!(
            classify(
                "",
                Some(&quota(
                    "insufficient_quota: You exceeded your current quota"
                ))
            ),
            Some(FailureKind::QuotaExhausted)
        );
        assert_eq!(
            classify(
                "",
                Some(&quota(
                    "The provider rejected further requests because its rate limit was reached."
                ))
            ),
            Some(FailureKind::RateLimited)
        );
        assert_eq!(
            classify("", Some(&quota("429 Too Many Requests"))),
            Some(FailureKind::RateLimited)
        );
    }

    #[test]
    fn cli_printed_provider_errors_are_recognized_but_answers_are_not() {
        assert_eq!(
            provider_error_text("API Error: 529 {\"type\":\"overloaded_error\"}").as_deref(),
            Some("API Error: 529 {\"type\":\"overloaded_error\"}")
        );
        assert_eq!(
            provider_error_text(" [API Error: Model stream ended with empty response text.]")
                .as_deref(),
            Some("API Error: Model stream ended with empty response text.")
        );
        assert_eq!(
            provider_error_text("Ran into this error: Server error: system disk overloaded.")
                .as_deref(),
            Some("Ran into this error: Server error: system disk overloaded.")
        );
        assert!(provider_error_text(
            "Ran into this error trying to compact: context window exceeded"
        )
        .is_some());
        for answer in [
            "Fixed the API Error: handling in client.ts.",
            "The CLI printed `API Error: 529` because the provider was overloaded.",
            "Ran into this error and fixed it: the test now passes.",
            "",
            &format!("API Error: {}", "x".repeat(5000)),
        ] {
            assert_eq!(provider_error_text(answer), None, "{answer}");
        }
    }

    #[test]
    fn stderr_reason_keeps_the_clis_words_and_drops_frames_and_terminal_hints() {
        let diagnostics = [
            "Loading configuration".to_string(),
            "MCP Server 'plugs': Failed to initialize\nDetails: MCPError: Not Found".into(),
            "╭── Traceback ──╮\n│   579 │   try:\n╰───────────────╯".into(),
            "To resume this session: kimi -r 1234".into(),
            "See log: /tmp/private/agent.log".into(),
        ];
        assert_eq!(
            stderr_reason(&diagnostics).as_deref(),
            Some("Loading configuration\nMCP Server 'plugs': Failed to initialize\nDetails: MCPError: Not Found")
        );
        assert_eq!(stderr_reason(&["│ 1 │ x".into(), "   ".into()]), None);
    }

    fn failed(diagnostics: &[&str]) -> TaskRun {
        TaskRun {
            diagnostics: diagnostics.iter().map(|line| line.to_string()).collect(),
            ..TaskRun::default()
        }
    }

    #[test]
    fn explain_prefers_reported_then_printed_then_quota_then_output_then_exit_code() {
        let mut run = failed(&["Error: 401 Unauthorized"]);
        run.error = Some("You've hit your usage limit. Try again at 4:12 PM.".into());
        explain(&mut run, Some(1));
        assert_eq!(
            run.error.as_deref(),
            Some("You've hit your usage limit. Try again at 4:12 PM.")
        );
        assert_eq!(run.failure_kind, Some(FailureKind::QuotaExhausted));

        let mut run = failed(&["Error: 401 Unauthorized"]);
        run.provider_error = Some("API Error: 401 Invalid bearer token".into());
        run.quota_failure = Some(quota("usage limit"));
        explain(&mut run, Some(1));
        assert_eq!(
            run.error.as_deref(),
            Some("API Error: 401 Invalid bearer token")
        );
        assert_eq!(run.failure_kind, Some(FailureKind::QuotaExhausted));

        let mut run = failed(&["Error: 401 Unauthorized"]);
        run.quota_failure = Some(quota("429 Too Many Requests"));
        explain(&mut run, Some(1));
        assert_eq!(run.error.as_deref(), Some("429 Too Many Requests"));
        assert_eq!(run.failure_kind, Some(FailureKind::RateLimited));

        let mut run = failed(&["Starting", "Error: 401 Unauthorized"]);
        explain(&mut run, Some(1));
        let error = run.error.as_deref().unwrap();
        assert!(
            error.starts_with("Starting\nError: 401 Unauthorized\n\nAgent exited with 1"),
            "{error}"
        );
        assert_eq!(run.failure_kind, Some(FailureKind::AgentExited));

        let mut run = failed(&["Error: 401 Unauthorized"]);
        explain(&mut run, Some(1));
        assert_eq!(run.failure_kind, Some(FailureKind::Authentication));

        let mut run = failed(&[]);
        explain(&mut run, None);
        assert!(run
            .error
            .as_deref()
            .unwrap()
            .starts_with("Agent exited with no exit code."));
        assert_eq!(run.failure_kind, Some(FailureKind::AgentExited));

        let mut run = failed(&[]);
        run.error = Some("Agent attempted a tool call in a helper that has tools disabled.".into());
        explain(&mut run, Some(0));
        assert_eq!(run.failure_kind, None);
    }

    #[test]
    fn an_answer_that_is_only_a_printed_provider_error_fails_the_turn() {
        let mut run = failed(&[]);
        run.result = "Ran into this error: Server error: system disk overloaded.".into();
        reject_error_answer(&mut run);
        assert!(run.result.is_empty());
        assert_eq!(
            run.error.as_deref(),
            Some("Ran into this error: Server error: system disk overloaded.")
        );

        let mut run = failed(&[]);
        run.result = "Done. The API Error: handler now retries.".into();
        reject_error_answer(&mut run);
        assert!(run.error.is_none());
        assert!(!run.result.is_empty());
    }

    #[test]
    fn unknown_saved_kinds_still_load() {
        let kind: FailureKind = serde_json::from_str("\"provider_overloaded\"").unwrap();
        assert_eq!(kind, FailureKind::Other);
        assert_eq!(
            serde_json::to_string(&FailureKind::QuotaExhausted).unwrap(),
            "\"quota_exhausted\""
        );
    }
}
