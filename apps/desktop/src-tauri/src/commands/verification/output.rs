use super::Verification;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OutputRequest {
    pub check_id: Option<String>,
    #[serde(default = "stdout_stream")]
    pub stream: String,
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
}

fn stdout_stream() -> String {
    "stdout".into()
}

pub(super) fn response(check: &Verification) -> Value {
    response_with_reports(
        check,
        crate::commands::experiments::is("JACKALOPE_VERIFICATION_OUTPUT", "test-report"),
    )
}

fn response_with_reports(check: &Verification, test_reports: bool) -> Value {
    let result = &check.result;
    let reports = if test_reports {
        super::test_report::reports(&result.stdout)
    } else {
        Vec::new()
    };
    let mut omitted = 0;
    let mut stdout = if result.success
        && !result.timed_out
        && !result.truncated
        && !super::test_report::has_failures(&reports)
        && result.stdout.len() > 2000
    {
        let (projected, projected_lines) = if test_reports {
            super::test_report::compact(&result.stdout, &reports)
        } else {
            (result.stdout.clone(), 0)
        };
        omitted += projected_lines;
        let lines: Vec<_> = projected
            .lines()
            .filter(|line| {
                let line = line.trim();
                let passing = (line.starts_with("test ") && line.ends_with(" ... ok"))
                    || (line.starts_with("✔ ") && line.ends_with("ms)"));
                omitted += usize::from(passing);
                !passing
            })
            .collect();
        if omitted > 0 {
            format!("[Jackalope omitted {omitted} successful-test progress/detail lines. Use verification_output to read the stored output.]\n{}", lines.join("\n"))
        } else {
            result.stdout.clone()
        }
    } else {
        result.stdout.clone()
    };
    if stdout.len() >= result.stdout.len() {
        stdout.clone_from(&result.stdout);
        omitted = 0;
    }
    let mut response = json!({"check_id":check.checked_at,"exit_code":result.exit_code,"stdout":stdout,
        "stderr":result.stderr,"success":result.success,"timed_out":result.timed_out,
        "truncated":result.truncated,"omitted_passing_lines":omitted,
        "stored_stdout_bytes":result.stdout.len(),"stored_stderr_bytes":result.stderr.len()});
    if !reports.is_empty() {
        response["reported_test_summaries"] = json!(reports);
    }
    response
}

pub fn read(check: Option<&Verification>, input: OutputRequest) -> Result<Value, String> {
    let check = check.ok_or("This attempt has no saved verification output")?;
    if input
        .check_id
        .as_ref()
        .is_some_and(|id| id != &check.checked_at)
    {
        return Err(
            "Verification changed. Call verification_output with {} to read the latest check."
                .into(),
        );
    }
    if input.offset > 0 && input.check_id.is_none() {
        return Err("Provide check_id when continuing a stored output page.".into());
    }
    let text = match input.stream.as_str() {
        "stdout" => &check.result.stdout,
        "stderr" => &check.result.stderr,
        _ => return Err("Choose stdout or stderr".into()),
    };
    let total = text.chars().count();
    if input.offset > total {
        return Err("Output offset exceeds the stored character count".into());
    }
    let content: String = text
        .chars()
        .skip(input.offset)
        .take(input.limit.unwrap_or(4000).clamp(1, 16000))
        .collect();
    let next = input.offset + content.chars().count();
    Ok(
        json!({"check_id":check.checked_at,"stream":input.stream,"text":content,
        "command":check.command,"success":check.result.success,"exit_code":check.result.exit_code,
        "timed_out":check.result.timed_out,"duration_ms":check.result.duration_ms,
        "offset":input.offset,"next_offset":if next<total {Some(next)}else{None},
        "total_characters":total,"capture_truncated":check.result.truncated}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn check(success: bool) -> Verification {
        Verification { command:"fixture".into(),checked_at:"receipt-1".into(),tree:None,
            result:serde_json::from_value(json!({"exitCode":if success {0}else{1},"success":success,"timedOut":false,"truncated":false,"durationMs":1,
                "stdout":format!("warning: preserve this diagnostic\n{}\n81 tests passed\n",(0..160).map(|n|format!("✔ preserves behavior for fixture {n} (1.25ms)")).collect::<Vec<_>>().join("\n")),
                "stderr":"warning: stderr stays intact"})).unwrap() }
    }
    #[test]
    fn compact_success_retains_diagnostics_and_full_failure_output() {
        let good = check(true);
        let response = response(&good);
        assert_eq!(response["omitted_passing_lines"], 160);
        assert!(response["stdout"]
            .as_str()
            .unwrap()
            .contains("preserve this diagnostic"));
        assert!(response["stdout"]
            .as_str()
            .unwrap()
            .contains("81 tests passed"));
        assert_eq!(response["stderr"], good.result.stderr);
        let bad = check(false);
        assert_eq!(super::response(&bad)["stdout"], bad.result.stdout);
    }
    #[test]
    fn output_ranges_are_unicode_safe_and_bound_to_the_check() {
        let mut check = check(true);
        check.result.stdout = "one🦊two".into();
        let input = |id: &str| OutputRequest {
            check_id: Some(id.into()),
            stream: "stdout".into(),
            offset: 3,
            limit: Some(1),
        };
        let page = read(Some(&check), input("receipt-1")).unwrap();
        assert_eq!(page["text"], "🦊");
        assert_eq!(page["next_offset"], 4);
        assert!(read(Some(&check), input("older-receipt")).is_err());
    }

    #[test]
    fn lost_response_can_be_recovered_without_a_check_id() {
        for success in [true, false] {
            let check = check(success);
            let page = read(Some(&check), serde_json::from_value(json!({})).unwrap()).unwrap();
            assert_eq!(page["check_id"], "receipt-1");
            assert_eq!(page["success"], success);
            assert_eq!(page["exit_code"], if success { 0 } else { 1 });
            assert_eq!(page["stream"], "stdout");
            assert!(page["text"]
                .as_str()
                .unwrap()
                .contains("preserve this diagnostic"));
            assert!(read(
                Some(&check),
                serde_json::from_value(json!({"offset": 1})).unwrap()
            )
            .is_err());
        }
        assert!(read(None, serde_json::from_value(json!({})).unwrap()).is_err());
    }

    #[test]
    fn pytest_projection_is_recoverable_and_never_discards_failed_or_incomplete_output() {
        let mut check = check(true);
        check.result.stdout = format!(
            "{}\nwarning: retained\n=== 100 passed in 0.01s ===\n",
            (0..100)
                .map(|n| format!("tests/test_api.py::test_case_{n} PASSED [100%]"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let projected = response_with_reports(&check, true);
        assert_eq!(projected["omitted_passing_lines"], 100);
        assert_eq!(
            projected["reported_test_summaries"][0]["counts"]["passed"],
            100
        );
        assert!(projected["stdout"]
            .as_str()
            .unwrap()
            .contains("warning: retained"));
        assert!(
            serde_json::to_vec(&projected).unwrap().len()
                < serde_json::to_vec(&response_with_reports(&check, false))
                    .unwrap()
                    .len()
        );
        let recovered = read(
            Some(&check),
            serde_json::from_value(json!({"limit":16000})).unwrap(),
        )
        .unwrap();
        assert_eq!(recovered["text"], check.result.stdout);
        for kind in ["failed", "timed_out", "truncated"] {
            let mut incomplete = check.clone();
            match kind {
                "failed" => incomplete.result.success = false,
                "timed_out" => incomplete.result.timed_out = true,
                _ => incomplete.result.truncated = true,
            }
            let result = response_with_reports(&incomplete, true);
            assert_eq!(result["stdout"], incomplete.result.stdout);
            assert_eq!(result["stderr"], incomplete.result.stderr);
            assert_eq!(result["omitted_passing_lines"], 0);
        }
        check
            .result
            .stdout
            .push_str("\n=== 1 failed in 0.01s ===\n");
        let reported_failure = response_with_reports(&check, true);
        assert_eq!(reported_failure["stdout"], check.result.stdout);
        assert_eq!(reported_failure["success"], true);
    }

    #[test]
    #[ignore = "Replays private captured Verification JSON records without running their commands"]
    fn replay_captured_verification() {
        let source =
            std::path::PathBuf::from(std::env::var("JACKALOPE_VERIFICATION_REPLAY").unwrap());
        let checks: Vec<Verification> =
            serde_json::from_slice(&std::fs::read(&source).unwrap()).unwrap();
        let mut responses = Vec::new();
        for check in checks {
            let started = std::time::Instant::now();
            let candidate = response_with_reports(&check, true);
            let elapsed = started.elapsed().as_micros();
            let legacy = response_with_reports(&check, false);
            let mut recovered = String::new();
            loop {
                let page = read(Some(&check), serde_json::from_value(json!({"check_id":check.checked_at,"offset":recovered.chars().count(),"limit":16000})).unwrap()).unwrap();
                recovered.push_str(page["text"].as_str().unwrap());
                if page["next_offset"].is_null() {
                    break;
                }
            }
            assert_eq!(recovered, check.result.stdout);
            assert_eq!(candidate["stderr"], check.result.stderr);
            responses.push(json!({"check_id":check.checked_at,"candidate":candidate,"legacy":legacy,"projection_us":elapsed,"stdout_recovered":true}));
        }
        std::fs::write(
            source.with_extension("projected.json"),
            serde_json::to_vec_pretty(&responses).unwrap(),
        )
        .unwrap();
    }
}
