use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    output: String,
    exit_code: i32,
    truncated: bool,
}

pub fn project(input: Input) -> Value {
    if input.exit_code != 0 || input.truncated || !(2001..=50_000).contains(&input.output.len()) {
        return Value::Null;
    }
    let reports = super::test_report::reports(&input.output);
    if reports.is_empty() || super::test_report::has_failures(&reports) {
        return Value::Null;
    }
    let (output, omitted) = super::test_report::compact(&input.output, &reports);
    if omitted == 0 || output.len() + 512 >= input.output.len() {
        return Value::Null;
    }
    json!({"output":output,"omitted_lines":omitted,"reports":reports})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_requires_complete_success_and_preserves_diagnostics() {
        let progress = (0..90)
            .map(|n| format!("tests/test_values.py::test_value_{n} PASSED [100%]\n"))
            .collect::<String>();
        let input = |exit_code, truncated, summary| Input {
            output: format!("{progress}warning: inspect deprecated input\n{summary}\n"),
            exit_code,
            truncated,
        };
        let projected = project(input(0, false, "90 passed in 0.13s"));
        assert_eq!(projected["omitted_lines"], 90);
        assert_eq!(
            projected["output"],
            "warning: inspect deprecated input\n90 passed in 0.13s"
        );
        for rejected in [
            input(1, false, "90 passed in 0.13s"),
            input(0, true, "90 passed in 0.13s"),
            input(0, false, "90 passed, 1 failed in 0.13s"),
            input(0, false, "incomplete test run"),
        ] {
            assert!(project(rejected).is_null());
        }
    }

    #[test]
    fn failing_runs_are_returned_unchanged_even_after_a_zero_exit() {
        let padding = (0..100)
            .map(|n| format!("setup: prepared fixture {n}\n"))
            .collect::<String>();
        let mixed = format!(
            "{}{}",
            include_str!("fixtures/vitest-pass.txt"),
            include_str!("fixtures/tsc-errors.txt")
        );
        for (name, text) in super::super::test_report::tests::FAILING
            .iter()
            .copied()
            .chain([("vitest with type errors", mixed.as_str())])
        {
            let output = format!("{padding}{text}");
            assert!(output.len() > 2000);
            let input = Input {
                output,
                exit_code: 0,
                truncated: false,
            };
            assert!(project(input).is_null(), "{name}");
        }
    }

    #[test]
    fn recognized_build_and_test_output_reports_what_was_omitted() {
        let output = include_str!("fixtures/cargo-test-pass.txt").repeat(3);
        let projected = project(Input {
            output: output.clone(),
            exit_code: 0,
            truncated: false,
        });
        assert_eq!(projected["omitted_lines"], 54);
        let text = projected["output"].as_str().unwrap();
        assert!(text.len() + 512 < output.len());
        assert!(text.contains("warning: unused import: `std::collections::HashMap`"));
        assert_eq!(text.matches("test result: ok.").count(), 6);
    }
}
