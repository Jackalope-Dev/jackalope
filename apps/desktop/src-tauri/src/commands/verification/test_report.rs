use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Serialize)]
pub(super) struct TestReport {
    runner: &'static str,
    counts: BTreeMap<String, u64>,
}

fn counts(text: &str, separator: char, allowed: &[&str]) -> Option<BTreeMap<String, u64>> {
    let mut counts = BTreeMap::new();
    for part in text.split(separator) {
        let (number, label) = part.trim().split_once(' ')?;
        if !allowed.contains(&label) || counts.insert(label.into(), number.parse().ok()?).is_some()
        {
            return None;
        }
    }
    Some(counts)
}

fn pytest(line: &str) -> Option<TestReport> {
    let (totals, duration) = line.trim().trim_matches('=').trim().rsplit_once(" in ")?;
    let seconds: f64 = duration
        .split_whitespace()
        .next()?
        .strip_suffix('s')?
        .parse()
        .ok()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    let counts = counts(
        totals,
        ',',
        &[
            "passed",
            "failed",
            "skipped",
            "deselected",
            "xfailed",
            "xpassed",
            "warning",
            "warnings",
            "error",
            "errors",
        ],
    )?;
    if !counts
        .keys()
        .any(|key| !matches!(key.as_str(), "warning" | "warnings" | "deselected"))
    {
        return None;
    }
    Some(TestReport {
        runner: "pytest",
        counts,
    })
}

fn cargo(line: &str) -> Option<TestReport> {
    let (status, totals) = line
        .trim()
        .strip_prefix("test result: ")?
        .split_once(". ")?;
    if !["ok", "FAILED"].contains(&status) {
        return None;
    }
    let (totals, _) = totals.rsplit_once("; finished in ")?;
    let counts = counts(
        totals,
        ';',
        &["passed", "failed", "ignored", "measured", "filtered out"],
    )?;
    if !counts.contains_key("passed") || !counts.contains_key("failed") {
        return None;
    }
    Some(TestReport {
        runner: "cargo",
        counts,
    })
}

pub(super) fn reports(text: &str) -> Vec<TestReport> {
    let mut reports: Vec<_> = text
        .lines()
        .filter_map(|line| pytest(line).or_else(|| cargo(line)))
        .take(17)
        .collect();
    if reports.len() > 16 {
        return Vec::new();
    }
    let mut tap_counts = BTreeMap::new();
    let mut duplicate = false;
    for line in text.lines() {
        let Some((key, value)) = line
            .strip_prefix("# ")
            .and_then(|line| line.split_once(' '))
        else {
            continue;
        };
        if [
            "tests",
            "suites",
            "pass",
            "fail",
            "cancelled",
            "skipped",
            "todo",
        ]
        .contains(&key)
        {
            if let Ok(count) = value.parse::<u64>() {
                duplicate |= tap_counts.insert(key.to_string(), count).is_some();
            }
        }
    }
    if !duplicate && tap_counts.len() == 7 && reports.len() < 16 {
        reports.push(TestReport {
            runner: "node-tap",
            counts: tap_counts,
        });
    }
    reports
}

fn successful(reports: &[TestReport], runner: &str) -> bool {
    let matching: Vec<_> = reports
        .iter()
        .filter(|report| report.runner == runner)
        .collect();
    !matching.is_empty()
        && matching.iter().all(|report| {
            ["failed", "fail", "error", "errors", "cancelled"]
                .iter()
                .all(|key| report.counts.get(*key).copied().unwrap_or(0) == 0)
        })
}

pub(super) fn has_failures(reports: &[TestReport]) -> bool {
    reports.iter().any(|report| {
        ["failed", "fail", "error", "errors", "cancelled"]
            .iter()
            .any(|key| report.counts.get(*key).copied().unwrap_or(0) > 0)
    })
}

fn pytest_progress(line: &str) -> bool {
    let Some((body, percentage)) = line
        .trim()
        .strip_suffix(']')
        .and_then(|line| line.rsplit_once('['))
    else {
        return false;
    };
    let Some(percent) = percentage
        .trim()
        .strip_suffix('%')
        .and_then(|value| value.parse::<u8>().ok())
    else {
        return false;
    };
    if percent > 100 {
        return false;
    }
    let body = body.trim();
    if body.ends_with(" PASSED") && body.contains(".py::") && body.split_whitespace().count() == 2 {
        return true;
    }
    let progress = if let Some((path, progress)) = body.rsplit_once(".py ") {
        if path.is_empty() || path.chars().any(char::is_whitespace) {
            return false;
        }
        progress.trim()
    } else {
        body
    };
    !progress.is_empty() && progress.bytes().all(|byte| b".sx".contains(&byte))
}

pub(super) fn compact(text: &str, reports: &[TestReport]) -> (String, usize) {
    let pytest = successful(reports, "pytest");
    let tap = successful(reports, "node-tap");
    let lines: Vec<_> = text.lines().collect();
    let mut kept = Vec::new();
    let mut omitted = 0;
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        if pytest && pytest_progress(line) {
            omitted += 1;
            index += 1;
            continue;
        }
        if tap
            && line.starts_with("# Subtest: ")
            && lines
                .get(index + 1)
                .is_some_and(|line| line.starts_with("ok ") && !line.contains(" # "))
            && lines.get(index + 2) == Some(&"  ---")
        {
            let mut end = index + 3;
            while end < lines.len()
                && (lines[end]
                    .strip_prefix("  duration_ms: ")
                    .is_some_and(|value| value.parse::<f64>().is_ok())
                    || lines[end] == "  type: 'test'")
            {
                end += 1;
            }
            if end > index + 3 && lines.get(end) == Some(&"  ...") {
                omitted += end + 1 - index;
                index = end + 1;
                continue;
            }
        }
        kept.push(line);
        index += 1;
    }
    (kept.join("\n"), omitted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_complete_recognized_summaries_allow_progress_projection() {
        let progress =
            "tests/unit/test_api.py ..s.. [ 50%]\ntests/unit/test_api.py::test_value PASSED [100%]";
        for summary in [
            "1 failed, 4 passed in 0.10s",
            "1 error in 0.10s",
            "5 passed eventually",
            "2 warnings in 0.10s",
        ] {
            let text = format!("{progress}\n{summary}");
            assert_eq!(compact(&text, &reports(&text)).1, 0);
        }
        let text = format!(
            "{progress}\nwarning: do not discard diagnostics\nwarning: source.py ... [100%]\n5 passed, 1 skipped in 0.10s"
        );
        let (projected, omitted) = compact(&text, &reports(&text));
        assert_eq!(omitted, 2);
        assert_eq!(
            projected,
            "warning: do not discard diagnostics\nwarning: source.py ... [100%]\n5 passed, 1 skipped in 0.10s"
        );
        assert_eq!(reports(&text)[0].counts["skipped"], 1);
        assert!(!pytest_progress("source.py::case SKIPPED (reason) [100%]"));
        assert!(!pytest_progress("source.py unexpected diagnostic [100%]"));
    }

    #[test]
    fn tap_projection_preserves_unknown_diagnostics_and_skips() {
        let good =
            "# Subtest: valid\nok 1 - valid\n  ---\n  duration_ms: 0.5\n  type: 'test'\n  ...";
        let diagnostic = "# Subtest: custom\nok 2 - custom\n  ---\n  duration_ms: 0.1\n  detail: preserve me\n  ...";
        let totals = "1..3\n# tests 3\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 1.0";
        let text = format!(
            "TAP version 13\n{good}\n{diagnostic}\nok 3 - other # SKIP unavailable\n{totals}"
        );
        let (projected, omitted) = compact(&text, &reports(&text));
        assert_eq!(omitted, 6);
        assert!(projected.contains(diagnostic));
        assert!(projected.contains("SKIP unavailable"));
        assert!(projected.contains(totals));
        let failure = text.replace("# fail 0", "# fail 1");
        assert_eq!(compact(&failure, &reports(&failure)).1, 0);
        let multiple = format!("{text}\n{totals}");
        assert_eq!(compact(&multiple, &reports(&multiple)).1, 0);
    }

    #[test]
    fn cargo_and_pytest_reports_do_not_infer_process_success() {
        let text = "test result: FAILED. 10 passed; 1 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.01s\n=== 1 failed, 2 passed, 3 warnings in 0.25s ===";
        let parsed = reports(text);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].counts["failed"], 1);
        assert_eq!(parsed[1].counts["warnings"], 3);
        assert_eq!(compact(text, &parsed).1, 0);
        assert!(reports("custom output: 2 passed\n3 passed, 2 passed in 0.5s").is_empty());
    }
}
