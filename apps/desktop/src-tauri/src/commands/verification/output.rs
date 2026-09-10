use super::Verification;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OutputRequest {
    pub check_id: String,
    pub stream: String,
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
}

pub(super) fn response(check: &Verification) -> Value {
    let result = &check.result;
    let mut omitted = 0;
    let mut stdout = if result.success && result.stdout.len() > 2000 {
        let lines: Vec<_> = result
            .stdout
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
            format!("[Jackalope omitted {omitted} passing-test lines. Use verification_output to read the stored output.]\n{}", lines.join("\n"))
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
    json!({"check_id":check.checked_at,"exit_code":result.exit_code,"stdout":stdout,
        "stderr":result.stderr,"success":result.success,"timed_out":result.timed_out,
        "truncated":result.truncated,"omitted_passing_lines":omitted,
        "stored_stdout_bytes":result.stdout.len(),"stored_stderr_bytes":result.stderr.len()})
}

pub fn read(check: Option<&Verification>, input: OutputRequest) -> Result<Value, String> {
    let check = check.ok_or("This attempt has no saved verification output")?;
    if input.check_id != check.checked_at {
        return Err(
            "Verification changed. Read the latest check before requesting its output.".into(),
        );
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
            check_id: id.into(),
            stream: "stdout".into(),
            offset: 3,
            limit: Some(1),
        };
        let page = read(Some(&check), input("receipt-1")).unwrap();
        assert_eq!(page["text"], "🦊");
        assert_eq!(page["next_offset"], 4);
        assert!(read(Some(&check), input("older-receipt")).is_err());
    }
}
