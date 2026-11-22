//! Parses test and build summaries from captured output and omits passing detail
//! only when every recognized summary is clean. Runner recognition for Jest,
//! Vitest, Playwright, Cargo, Go and TypeScript adapts oh-my-pi's
//! `crates/shell` minimizer filters (MIT); see `public/licenses/oh-my-pi.txt`.

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

/// Requires the parts to add up to the stated total, which rejects partial
/// runs such as Jest's `2 of 3 total`.
fn totalled(counts: BTreeMap<String, u64>, total: u64, runner: &'static str) -> Option<TestReport> {
    (counts.values().sum::<u64>() == total).then_some(TestReport { runner, counts })
}

fn jest(line: &str) -> Option<TestReport> {
    let totals = line
        .strip_prefix("Tests:")
        .or_else(|| line.strip_prefix("Test Suites:"))?;
    let mut counts = counts(
        totals,
        ',',
        &["passed", "failed", "skipped", "todo", "total"],
    )?;
    let total = counts.remove("total")?;
    totalled(counts, total, "jest")
}

fn vitest(line: &str) -> Option<TestReport> {
    let line = line.trim();
    if let Some(errors) = line.strip_prefix("Errors ") {
        let counts = counts(errors, ',', &["error", "errors"])?;
        return Some(TestReport {
            runner: "vitest",
            counts,
        });
    }
    let (totals, total) = line
        .strip_prefix("Test Files ")
        .or_else(|| line.strip_prefix("Tests "))?
        .strip_suffix(')')?
        .rsplit_once(" (")?;
    let counts = counts(totals, '|', &["passed", "failed", "skipped", "todo"])?;
    totalled(counts, total.parse().ok()?, "vitest")
}

fn playwright_header(line: &str) -> bool {
    line.trim()
        .strip_prefix("Running ")
        .and_then(|rest| rest.split_once(' '))
        .is_some_and(|(count, rest)| {
            count.parse::<u64>().is_ok()
                && (rest.starts_with("test using ") || rest.starts_with("tests using "))
                && rest.contains(" worker")
        })
}

/// Sums repeated summaries, so a later failing run in the same output is never
/// hidden behind an earlier passing one.
fn playwright(text: &str) -> Option<TestReport> {
    let mut lines = text.lines();
    lines.find(|line| playwright_header(line))?;
    let mut counts = BTreeMap::new();
    for line in lines {
        let Some((number, label)) = line.trim().split_once(' ') else {
            continue;
        };
        let Ok(number) = number.parse::<u64>() else {
            continue;
        };
        let label = match label.split_once(" (") {
            Some((label, duration)) if label == "passed" && duration.ends_with(')') => label,
            _ if label.contains(" not a part of any test") => "errors",
            _ => label,
        };
        if [
            "passed",
            "failed",
            "flaky",
            "skipped",
            "did not run",
            "interrupted",
            "errors",
        ]
        .contains(&label)
        {
            *counts.entry(label.to_string()).or_insert(0) += number;
        }
    }
    (counts.contains_key("passed") || counts.contains_key("failed")).then_some(TestReport {
        runner: "playwright",
        counts,
    })
}

fn go_package_ok(line: &str) -> bool {
    let Some(rest) = line.strip_prefix("ok  \t") else {
        return false;
    };
    let mut parts = rest.split('\t');
    let package = parts.next().unwrap_or_default();
    let elapsed = parts.next().unwrap_or_default();
    !package.is_empty()
        && !package.contains(char::is_whitespace)
        && (elapsed == "(cached)"
            || elapsed
                .strip_suffix('s')
                .is_some_and(|value| value.parse::<f64>().is_ok()))
}

fn go_no_tests(line: &str) -> bool {
    line.starts_with("?   \t") && line.ends_with("\t[no test files]")
}

fn go(text: &str) -> Option<TestReport> {
    let (mut ok, mut failed, mut untested) = (0, 0, 0);
    for line in text.lines() {
        if go_package_ok(line) {
            ok += 1;
        } else if go_no_tests(line) {
            untested += 1;
        } else if line == "FAIL"
            || line.starts_with("FAIL\t")
            || line.starts_with("panic: ")
            || line.trim_start().starts_with("--- FAIL: ")
        {
            failed += 1;
        }
    }
    (ok + failed > 0).then(|| TestReport {
        runner: "go",
        counts: BTreeMap::from([
            ("ok".into(), ok),
            ("failed".into(), failed),
            ("no test files".into(), untested),
        ]),
    })
}

/// Cargo right-aligns its status verb in a twelve-column field.
fn cargo_status(line: &str) -> Option<(&str, &str)> {
    let verb = line.get(..12)?.trim_start_matches(' ');
    let rest = line.get(12..)?.strip_prefix(' ')?;
    (!verb.is_empty() && verb.bytes().all(|byte| byte.is_ascii_alphabetic()))
        .then_some((verb, rest))
}

fn cargo_build(text: &str) -> Option<TestReport> {
    let (mut finished, mut errors, mut warnings) = (false, 0, 0);
    for line in text.lines() {
        finished |= cargo_status(line)
            .is_some_and(|(verb, rest)| verb == "Finished" && rest.contains(" target(s) in "));
        if line.starts_with("error:") || line.starts_with("error[") {
            errors += 1;
        }
        if let Some(count) = line
            .strip_prefix("warning: ")
            .and_then(|line| line.split_once(") generated "))
            .and_then(|(_, rest)| rest.split_whitespace().next())
            .and_then(|count| count.parse::<u64>().ok())
        {
            warnings += count;
        }
    }
    finished.then(|| TestReport {
        runner: "cargo-build",
        counts: BTreeMap::from([("errors".into(), errors), ("warnings".into(), warnings)]),
    })
}

/// Strips the `[10:22:31 AM] ` prefix TypeScript adds in build and watch modes.
fn tsc_message(line: &str) -> &str {
    line.strip_prefix('[')
        .and_then(|rest| rest.split_once("] "))
        .filter(|(time, _)| time.len() <= 12 && time.contains(':'))
        .map_or(line, |(_, message)| message)
}

fn tsc_diagnostic(line: &str) -> bool {
    line.match_indices("error TS").any(|(index, needle)| {
        let code = &line[index + needle.len()..];
        let digits = code.bytes().take_while(u8::is_ascii_digit).count();
        digits > 0 && code[digits..].starts_with(':')
    })
}

fn tsc(text: &str) -> Option<TestReport> {
    let (mut recognized, mut diagnostics, mut found) = (false, 0, 0);
    for line in text.lines() {
        let message = tsc_message(line);
        if tsc_diagnostic(line) {
            diagnostics += 1;
        } else if message.trim_end() == "Projects in this build:" {
            recognized = true;
        } else if let Some((count, label)) = message
            .strip_prefix("Found ")
            .and_then(|rest| rest.split_once(' '))
        {
            if let (Ok(count), true) = (count.parse::<u64>(), label.starts_with("error")) {
                recognized = true;
                found = found.max(count);
            }
        }
    }
    (recognized || diagnostics > 0).then(|| TestReport {
        runner: "tsc",
        counts: BTreeMap::from([("errors".into(), found.max(diagnostics))]),
    })
}

pub(super) fn reports(text: &str) -> Vec<TestReport> {
    let mut reports: Vec<_> = text
        .lines()
        .filter_map(|line| {
            pytest(line)
                .or_else(|| cargo(line))
                .or_else(|| jest(line))
                .or_else(|| vitest(line))
        })
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
    if !duplicate && tap_counts.len() == 7 {
        reports.push(TestReport {
            runner: "node-tap",
            counts: tap_counts,
        });
    }
    reports.extend(
        [playwright(text), go(text), cargo_build(text), tsc(text)]
            .into_iter()
            .flatten(),
    );
    if reports.len() > 16 {
        return Vec::new();
    }
    reports
}

/// Counts that mean a run did not cleanly pass. Playwright's flaky tests pass
/// on retry, yet their first failure stays in the output and must be read.
const FAILURE_KEYS: &[&str] = &[
    "failed",
    "fail",
    "error",
    "errors",
    "cancelled",
    "flaky",
    "interrupted",
    "did not run",
];

fn clean(report: &TestReport) -> bool {
    FAILURE_KEYS
        .iter()
        .all(|key| report.counts.get(*key).copied().unwrap_or(0) == 0)
}

fn successful(reports: &[TestReport], runner: &str) -> bool {
    let matching: Vec<_> = reports
        .iter()
        .filter(|report| report.runner == runner)
        .collect();
    !matching.is_empty() && matching.into_iter().all(clean)
}

pub(super) fn has_failures(reports: &[TestReport]) -> bool {
    !reports.iter().all(clean)
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

/// `✓ name (3 ms)` rows and `PASS file` headers from Jest, and `✓ file (4 tests)`
/// or verbose `✓ suite > name` rows from Vitest. `√` is the Windows mark.
fn node_test_passed(line: &str, jest: bool) -> bool {
    let line = line.trim_start();
    line.starts_with("✓ ") || line.starts_with("√ ") || (jest && line.starts_with("PASS "))
}

fn playwright_passed(line: &str) -> bool {
    let line = line.trim();
    if !line.is_empty() && line.chars().all(|mark| matches!(mark, '·' | '°')) {
        return true;
    }
    let Some(rest) = line
        .strip_prefix('✓')
        .or_else(|| line.strip_prefix("ok"))
        .filter(|rest| rest.starts_with(' '))
    else {
        return false;
    };
    let Some((index, title)) = rest.trim_start().split_once(' ') else {
        return false;
    };
    index.parse::<u64>().is_ok() && title.contains(" › ") && title.ends_with(')')
}

fn go_row(line: &str) -> bool {
    let trimmed = line.trim_start();
    ["=== RUN ", "=== PAUSE ", "=== CONT ", "=== NAME "]
        .iter()
        .any(|prefix| line.starts_with(prefix))
        || trimmed.starts_with("--- PASS: ")
}

fn go_summary(line: &str) -> bool {
    line == "PASS" || go_package_ok(line) || go_no_tests(line)
}

fn tsc_up_to_date(line: &str) -> bool {
    let message = tsc_message(line);
    message != line && message.starts_with("Project '") && message.contains("' is up to date")
}

pub(super) fn compact(text: &str, reports: &[TestReport]) -> (String, usize) {
    let pytest = successful(reports, "pytest");
    let tap = successful(reports, "node-tap");
    let cargo = successful(reports, "cargo");
    let cargo_build = successful(reports, "cargo-build");
    let jest = successful(reports, "jest");
    let vitest = successful(reports, "vitest");
    let playwright = successful(reports, "playwright");
    let go = successful(reports, "go");
    let tsc = successful(reports, "tsc");
    let lines: Vec<_> = text.lines().collect();
    let mut kept = Vec::new();
    let mut omitted = 0;
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        // Go prints test logs after the row that names the test, so a row is
        // dropped only when no log line depends on it.
        let go_detail = go
            && (line == "PASS"
                || go_no_tests(line)
                || (go_row(line)
                    && lines
                        .get(index + 1)
                        .is_none_or(|next| go_row(next) || go_summary(next))));
        if (pytest && pytest_progress(line))
            || (cargo && line.starts_with("test ") && line.ends_with(" ... ok"))
            || (cargo_build
                && cargo_status(line).is_some_and(|(verb, _)| {
                    [
                        "Compiling",
                        "Checking",
                        "Documenting",
                        "Downloaded",
                        "Downloading",
                        "Fresh",
                        "Blocking",
                    ]
                    .contains(&verb)
                }))
            || ((jest || vitest) && node_test_passed(line, jest))
            || (playwright && playwright_passed(line))
            || go_detail
        {
            omitted += 1;
            index += 1;
            continue;
        }
        if tsc && tsc_up_to_date(line) {
            let blank = lines.get(index + 1).is_some_and(|next| next.is_empty());
            omitted += 1 + usize::from(blank);
            index += 1 + usize::from(blank);
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
pub(super) mod tests {
    use super::*;

    macro_rules! fixture {
        ($name:literal) => {
            include_str!(concat!("fixtures/", $name))
        };
    }

    /// Captured output from runs that failed, or that passed only after a
    /// retry. Callers must deliver each of these unchanged.
    pub(in super::super) const FAILING: &[(&str, &str)] = &[
        ("vitest", fixture!("vitest-fail.txt")),
        ("jest", fixture!("jest-fail.txt")),
        ("playwright", fixture!("playwright-fail.txt")),
        ("playwright flaky", fixture!("playwright-flaky.txt")),
        ("cargo test", fixture!("cargo-test-fail.txt")),
        ("cargo build", fixture!("cargo-build-error.txt")),
        ("go test", fixture!("go-test-fail.txt")),
        ("tsc", fixture!("tsc-errors.txt")),
    ];

    fn kept(text: &str) -> (String, usize, Vec<TestReport>) {
        let reports = reports(text);
        let (projected, omitted) = compact(text, &reports);
        assert!(!has_failures(&reports), "{text}");
        for line in projected.lines() {
            assert!(text.lines().any(|original| original == line));
        }
        (projected, omitted, reports)
    }

    fn report<'a>(reports: &'a [TestReport], runner: &str) -> &'a BTreeMap<String, u64> {
        &reports
            .iter()
            .find(|report| report.runner == runner)
            .unwrap_or_else(|| panic!("no {runner} report"))
            .counts
    }

    #[test]
    fn vitest_and_jest_keep_summaries_skips_and_console_output() {
        let (projected, omitted, reports) = kept(fixture!("vitest-pass.txt"));
        assert_eq!(omitted, 7);
        assert_eq!(report(&reports, "vitest")["passed"], 7);
        assert!(!projected.contains('✓'));
        for retained in [
            "stderr | src/checkout/payment.test.ts > payment > retries a declined card",
            "warning: card processor returned a soft decline; retrying once",
            " ↓ src/legacy/importer.test.ts (4 tests | 4 skipped)",
            " Test Files  7 passed | 1 skipped (8)",
            "      Tests  113 passed | 4 skipped (117)",
        ] {
            assert!(projected.lines().any(|line| line == retained), "{retained}");
        }

        let (projected, omitted, reports) = kept(fixture!("jest-pass.txt"));
        assert_eq!(omitted, 10);
        assert_eq!(report(&reports, "jest")["passed"], 4);
        assert!(!projected.contains("PASS ") && !projected.contains('✓'));
        for retained in [
            "    console.warn",
            "      Deprecated option \"timeoutMs\" passed to createClient; use \"timeout\" instead.",
            "    ○ skipped shows a tooltip on hover",
            "    ✎ todo announces state changes to screen readers",
            "Tests:       1 skipped, 1 todo, 48 passed, 50 total",
        ] {
            assert!(projected.lines().any(|line| line == retained), "{retained}");
        }
        assert!(jest("Test Suites: 1 passed, 1 of 3 total").is_none());
        assert!(jest("Tests:       4 passed, 5 total").is_none());
    }

    #[test]
    fn playwright_keeps_skips_test_logs_and_summary() {
        let (projected, omitted, reports) = kept(fixture!("playwright-pass.txt"));
        assert_eq!(omitted, 8);
        assert_eq!(report(&reports, "playwright")["passed"], 8);
        for retained in [
            "  -  5 [webkit] › tests/home.spec.ts:16:8 › home › opens the mobile menu",
            "[chromium] › tests/checkout.spec.ts:8:5 › checkout › accepts a saved card",
            "payment sandbox responded slowly (1840ms)",
            "  1 skipped",
            "  8 passed (9.8s)",
        ] {
            assert!(projected.lines().any(|line| line == retained), "{retained}");
        }

        let (projected, omitted, _) = kept(fixture!("playwright-dot-pass.txt"));
        assert_eq!(omitted, 2);
        assert!(projected.contains("  1 skipped\n  119 passed (41.2s)"));
        assert!(super::reports("  5 passed (1.0s)").is_empty());
    }

    #[test]
    fn cargo_keeps_warnings_ignored_tests_and_summaries() {
        let text = fixture!("cargo-test-pass.txt");
        let (projected, omitted, reports) = kept(text);
        assert_eq!(omitted, 18);
        assert_eq!(report(&reports, "cargo-build")["warnings"], 1);
        assert!(!projected.contains("Compiling") && !projected.contains("Checking"));
        let warning = text
            .split("    Finished")
            .next()
            .unwrap()
            .split_once("warning: unused import")
            .unwrap()
            .1;
        assert!(projected.contains(warning.trim_end()));
        for retained in [
            "    Finished `test` profile [unoptimized + debuginfo] target(s) in 14.82s",
            "     Running unittests src/lib.rs (target/debug/deps/ledger-4f1c2a9e8b7d6c5a)",
            "test ledger::tests::slow_reconciliation ... ignored, needs fixture database",
            "test result: ok. 8 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.02s",
            "   Doc-tests ledger",
            "test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.41s",
        ] {
            assert!(projected.lines().any(|line| line == retained), "{retained}");
        }

        let (projected, omitted, _) = kept(fixture!("cargo-build-warnings.txt"));
        assert_eq!(omitted, 9);
        assert!(projected.starts_with("    Updating crates.io index\nwarning: field `created_at`"));
        assert!(projected.contains("   = note: `#[warn(dead_code)]` on by default"));
        assert!(projected.ends_with(
            "warning: `ledger` (lib) generated 1 warning\n    Finished `release` profile [optimized] target(s) in 22.07s"
        ));
        assert!(cargo_status("    Compiling misaligned v1.0.0").is_none());
    }

    #[test]
    fn go_keeps_rows_that_name_logged_or_skipped_tests() {
        let (projected, omitted, reports) = kept(fixture!("go-test-pass.txt"));
        assert_eq!(omitted, 20);
        assert_eq!(report(&reports, "go")["ok"], 2);
        assert_eq!(
            projected,
            "=== RUN   TestReconcile\n    ledger_test.go:58: reconciling 1200 entries against fixture snapshot\n=== RUN   TestExportCSV\n    export_test.go:21: skipping: CSV fixtures require LEDGER_FIXTURES\n--- SKIP: TestExportCSV (0.00s)\nok  \texample.com/ledger\t0.123s\tcoverage: 84.2% of statements\nok  \texample.com/ledger/report\t(cached)"
        );
    }

    #[test]
    fn tsc_omits_only_up_to_date_build_projects() {
        let (projected, omitted, reports) = kept(fixture!("tsc-build-verbose.txt"));
        assert_eq!(omitted, 4);
        assert_eq!(report(&reports, "tsc")["errors"], 0);
        assert!(!projected.contains("is up to date"));
        assert!(projected
            .contains("[10:22:31 AM] Projects in this build:\n    * packages/brand/tsconfig.json"));
        assert!(projected.contains("is out of date because output"));
        assert!(projected.contains("Building project '/home/dev/shop/apps/web/tsconfig.json'..."));
    }

    #[test]
    fn failing_and_flaky_runs_are_never_compacted() {
        for (name, text) in FAILING {
            let reports = reports(text);
            let (projected, omitted) = compact(text, &reports);
            assert_eq!(omitted, 0, "{name}");
            assert_eq!(
                projected,
                text.lines().collect::<Vec<_>>().join("\n"),
                "{name}"
            );
            assert!(has_failures(&reports) || reports.is_empty(), "{name}");
        }
        let flaky = reports(fixture!("playwright-flaky.txt"));
        assert_eq!(report(&flaky, "playwright")["flaky"], 1);
        assert_eq!(
            report(&reports(fixture!("tsc-errors.txt")), "tsc")["errors"],
            4
        );
        assert_eq!(
            report(&reports(fixture!("go-test-fail.txt")), "go")["failed"],
            4
        );
        // A type error elsewhere in the same output blocks every runner's projection.
        let mixed = format!(
            "{}{}",
            fixture!("vitest-pass.txt"),
            fixture!("tsc-errors.txt")
        );
        assert!(has_failures(&reports(&mixed)));
        let repeated = format!(
            "{}{}",
            fixture!("playwright-pass.txt"),
            fixture!("playwright-fail.txt")
        );
        assert_eq!(report(&reports(&repeated), "playwright")["failed"], 1);
    }

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
