//! Evidence strength for agent requirement assessments and the optional safety fact.
//!
//! Agents claim a level; Jackalope checks only what it can verify locally and
//! cheaply (file references, a command with output, a recorded capture) and keeps
//! both. The check never calls a model and never proves the claim is true: it only
//! lowers a level whose supporting evidence is missing.

use super::harness::{RecordValidationInput, ValidationStep};
use super::tasks::TaskRun;
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

/// Weakest to strongest. The derived order is the ladder order.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceLevel {
    Stated,
    Cited,
    Reasoned,
    Ran,
    Reproduced,
}

const LADDER: [EvidenceLevel; 5] = [
    EvidenceLevel::Stated,
    EvidenceLevel::Cited,
    EvidenceLevel::Reasoned,
    EvidenceLevel::Ran,
    EvidenceLevel::Reproduced,
];

/// The one fact a change is safe because of, with its own evidence.
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SafetyFact {
    #[schemars(description = "The single fact the change is safe because of, in one sentence")]
    pub fact: String,
    #[schemars(
        description = "How far you proved it: stated, cited (real file:line), reasoned (walked the failure case), ran (command and output) or reproduced (capture in the running app)"
    )]
    pub level: EvidenceLevel,
    #[serde(default)]
    #[schemars(
        description = "References: file:line citations, screenshot IDs or names, preview URLs"
    )]
    pub evidence: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "For reasoned: the failure case walked step by step")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "For ran: the exact command that exercised the real code")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(description = "For ran: the relevant output, up to 4,000 bytes")]
    pub output: Option<String>,
    /// Set by Jackalope from the evidence; agent-supplied values are replaced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(skip)]
    pub checked_level: Option<EvidenceLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(skip)]
    pub check_note: Option<String>,
}

/// What a claim offers as support, borrowed from an assessment or a safety fact.
pub struct Claim<'a> {
    pub level: EvidenceLevel,
    pub evidence: &'a [String],
    pub reasoning: Option<&'a str>,
    pub command: Option<&'a str>,
    pub output: Option<&'a str>,
}

/// Local facts a claim is checked against.
pub struct Context {
    workspace: Option<PathBuf>,
    captures: Vec<String>,
    /// Local preview paths the agent opened in its task browser, such as `/settings`.
    pages: Vec<String>,
}

impl Context {
    pub fn for_run(run: &TaskRun) -> Self {
        let mut captures = Vec::new();
        for shot in run.screenshots.iter().chain(
            run.desktop_actions
                .iter()
                .filter_map(|a| a.capture.as_ref()),
        ) {
            captures.push(shot.id.clone());
            captures.push(format!("screenshot:{}", shot.id));
            captures.push(shot.name.clone());
            captures.push(normalized(&shot.file_path));
        }
        Self {
            workspace: std::fs::canonicalize(&run.workspace).ok(),
            captures: captures.into_iter().filter(|c| !c.is_empty()).collect(),
            pages: run.visited_pages.clone(),
        }
    }
}

fn normalized(path: &str) -> String {
    path.replace('\\', "/")
}

/// The path of a URL (`http://localhost:5173/a?b` -> `/a`), or the reference itself.
fn page_path(reference: &str) -> &str {
    let path = match reference.split_once("://") {
        Some((_, rest)) => rest.find('/').map_or("/", |index| &rest[index..]),
        None => reference,
    };
    path.split(['?', '#']).next().unwrap_or(path)
}

fn filled(value: Option<&str>) -> bool {
    value.is_some_and(|text| !text.trim().is_empty())
}

/// A `path:line`, `path:line:col`, `path:start-end` or `path#Lline` reference.
fn citation(reference: &str) -> Option<(&str, usize)> {
    let reference = reference.trim();
    if reference.contains("://") || reference.contains(char::is_whitespace) {
        return None;
    }
    if let Some((path, line)) = reference.split_once("#L") {
        let digits: String = line.chars().take_while(char::is_ascii_digit).collect();
        return (!path.is_empty() && !digits.is_empty())
            .then(|| digits.parse().ok().map(|n| (path, n)))
            .flatten();
    }
    // Skip a Windows drive prefix such as C:\ before looking for the line separator.
    let bytes = reference.as_bytes();
    let start = if bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
    {
        2
    } else {
        0
    };
    let colon = start + reference[start..].find(':')?;
    let (path, rest) = (&reference[..colon], &reference[colon + 1..]);
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let tail = &rest[digits.len()..];
    let tail_ok = tail.is_empty()
        || ((tail.starts_with('-') || tail.starts_with(':'))
            && tail.len() > 1
            && tail[1..].chars().all(|c| c.is_ascii_digit()));
    if path.is_empty()
        || digits.is_empty()
        || !tail_ok
        || !(path.contains('.') || path.contains('/') || path.contains('\\'))
    {
        return None;
    }
    digits.parse().ok().map(|line| (path, line))
}

/// True when the cited file exists inside the workspace and has the cited line.
fn cited_line_exists(workspace: &Path, path: &str, line: usize) -> bool {
    let candidate = Path::new(path);
    if candidate
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return false;
    }
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        workspace.join(candidate)
    };
    let Ok(resolved) = std::fs::canonicalize(joined) else {
        return false;
    };
    if !resolved.starts_with(workspace) || !resolved.is_file() {
        return false;
    }
    match std::fs::metadata(&resolved) {
        Ok(meta) if meta.len() <= 8 * 1024 * 1024 => {}
        // Large files are not read; existence is enough.
        Ok(_) => return line >= 1,
        Err(_) => return false,
    }
    std::fs::read(&resolved).is_ok_and(|bytes| line >= 1 && bytecount_lines(&bytes) >= line)
}

fn bytecount_lines(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    bytes.iter().filter(|b| **b == b'\n').count() + usize::from(bytes.last() != Some(&b'\n'))
}

/// The highest level at or below the claim that the evidence supports, with a
/// short reason when it is lower than claimed.
pub fn check(claim: &Claim, context: &Context) -> (EvidenceLevel, Option<String>) {
    let mut valid = 0;
    let mut missing = Vec::new();
    for reference in claim.evidence {
        if let Some((path, line)) = citation(reference) {
            match &context.workspace {
                Some(workspace) if cited_line_exists(workspace, path, line) => valid += 1,
                _ => missing.push(reference.trim().to_string()),
            }
        }
    }
    let captured = claim.evidence.iter().any(|reference| {
        let reference = normalized(reference.trim());
        context.captures.contains(&reference)
            || context
                .pages
                .iter()
                .any(|page| page == page_path(&reference))
    });
    let supports = |level: EvidenceLevel| match level {
        EvidenceLevel::Stated => true,
        _ if !missing.is_empty() => false,
        EvidenceLevel::Cited => valid > 0,
        EvidenceLevel::Reasoned => valid > 0 && filled(claim.reasoning),
        EvidenceLevel::Ran => filled(claim.command) && filled(claim.output),
        EvidenceLevel::Reproduced => captured,
    };
    let checked = LADDER
        .into_iter()
        .filter(|level| *level <= claim.level && supports(*level))
        .max()
        .unwrap_or(EvidenceLevel::Stated);
    if checked == claim.level {
        return (checked, None);
    }
    let reason = if !missing.is_empty() {
        format!("Not found in the workspace: {}", missing.join(", "))
    } else {
        match claim.level {
            EvidenceLevel::Reproduced => {
                "No recorded capture or preview matches the evidence".into()
            }
            EvidenceLevel::Ran => "A command and its output are both needed".into(),
            EvidenceLevel::Reasoned if valid == 0 => {
                "Reasoning needs a real file:line citation".into()
            }
            EvidenceLevel::Reasoned => "No step-by-step reasoning was given".into(),
            _ => "No file:line citation was given".into(),
        }
    };
    (checked, Some(reason))
}

fn bounded(value: &Option<String>, limit: usize) -> bool {
    value
        .as_ref()
        .is_none_or(|text| text.len() <= limit && !text.contains('\0'))
}

/// Bounds shared by assessment and safety-fact evidence fields.
pub fn valid_proof(
    reasoning: &Option<String>,
    command: &Option<String>,
    output: &Option<String>,
) -> bool {
    bounded(reasoning, 2000) && bounded(command, 1000) && bounded(output, 4000)
}

/// Validates a validation report against the run and records claimed and
/// checked evidence levels.
pub fn checked_step(run: &TaskRun, input: RecordValidationInput) -> Result<ValidationStep, String> {
    super::outcomes::validate_assessments(&input.requirements, Some(&run.contract))?;
    if let Some(fact) = &input.safety_fact {
        if fact.fact.trim().is_empty()
            || fact.fact.len() > 500
            || fact.fact.contains('\0')
            || fact.evidence.len() > 8
            || fact
                .evidence
                .iter()
                .any(|s| s.trim().is_empty() || s.len() > 500 || s.contains('\0'))
            || !valid_proof(&fact.reasoning, &fact.command, &fact.output)
        {
            return Err("Give the safety fact in up to 500 bytes with up to eight evidence references; reasoning, command and output are limited to 2,000, 1,000 and 4,000 bytes.".into());
        }
    }
    let context = Context::for_run(run);
    let mut requirements = input.requirements;
    for item in &mut requirements {
        (item.checked_level, item.check_note) = match item.level {
            Some(level) => {
                let (checked, note) = check(
                    &Claim {
                        level,
                        evidence: &item.evidence,
                        reasoning: item.reasoning.as_deref(),
                        command: item.command.as_deref(),
                        output: item.output.as_deref(),
                    },
                    &context,
                );
                (Some(checked), note)
            }
            None => (None, None),
        };
    }
    let safety_fact = input.safety_fact.map(|mut fact| {
        let (checked, note) = check(
            &Claim {
                level: fact.level,
                evidence: &fact.evidence,
                reasoning: fact.reasoning.as_deref(),
                command: fact.command.as_deref(),
                output: fact.output.as_deref(),
            },
            &context,
        );
        fact.checked_level = Some(checked);
        fact.check_note = note;
        fact
    });
    Ok(ValidationStep {
        id: uuid::Uuid::new_v4().to_string(),
        step: input.step,
        status: input.status,
        notes: input.notes,
        evidence: input.evidence,
        timestamp: chrono::Utc::now().to_rfc3339(),
        requirements,
        finding: input.finding.map(super::harness::ChallengeFinding::bounded),
        safety_fact,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (PathBuf, Context) {
        let dir = std::env::temp_dir().join(format!("jackalope-evidence-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/lib.rs"), "one\ntwo\nthree\n").unwrap();
        let context = Context {
            workspace: Some(std::fs::canonicalize(&dir).unwrap()),
            captures: vec!["shot-1".into(), "screenshot:shot-1".into()],
            pages: vec!["/settings".into()],
        };
        (dir, context)
    }

    fn claim<'a>(level: EvidenceLevel, evidence: &'a [String]) -> Claim<'a> {
        Claim {
            level,
            evidence,
            reasoning: None,
            command: None,
            output: None,
        }
    }

    #[test]
    fn citations_parse_common_reference_forms() {
        assert_eq!(citation("src/lib.rs:12"), Some(("src/lib.rs", 12)));
        assert_eq!(citation("src/lib.rs:12:4"), Some(("src/lib.rs", 12)));
        assert_eq!(citation("src/lib.rs:12-20"), Some(("src/lib.rs", 12)));
        assert_eq!(citation("src/lib.rs#L7"), Some(("src/lib.rs", 7)));
        assert_eq!(
            citation(r"C:\repo\src\lib.rs:3"),
            Some((r"C:\repo\src\lib.rs", 3))
        );
        for other in [
            "screenshot:abc",
            "http://localhost:5173",
            "pnpm test",
            "src/lib.rs",
            "note:5",
        ] {
            assert_eq!(citation(other), None, "{other}");
        }
    }

    #[test]
    fn real_citations_hold_and_missing_paths_drop_to_stated() {
        let (dir, context) = workspace();
        let real = vec!["src/lib.rs:2".to_string()];
        assert_eq!(
            check(&claim(EvidenceLevel::Cited, &real), &context),
            (EvidenceLevel::Cited, None)
        );
        let past_end = vec!["src/lib.rs:9".to_string()];
        let (level, note) = check(&claim(EvidenceLevel::Cited, &past_end), &context);
        assert_eq!(level, EvidenceLevel::Stated);
        assert!(note.unwrap().contains("src/lib.rs:9"));
        let invented = vec!["src/lib.rs:1".to_string(), "src/missing.rs:4".to_string()];
        let mut ran = claim(EvidenceLevel::Ran, &invented);
        ran.command = Some("cargo test");
        ran.output = Some("1 passed");
        assert_eq!(check(&ran, &context).0, EvidenceLevel::Stated);
        let escape = vec!["../outside.rs:1".to_string()];
        assert_eq!(
            check(&claim(EvidenceLevel::Cited, &escape), &context).0,
            EvidenceLevel::Stated
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ran_and_reproduced_need_their_own_evidence() {
        let (dir, context) = workspace();
        let cite = vec!["src/lib.rs:1".to_string()];
        let mut ran = claim(EvidenceLevel::Ran, &cite);
        ran.command = Some("cargo test evidence");
        let (level, note) = check(&ran, &context);
        assert_eq!(
            level,
            EvidenceLevel::Cited,
            "falls to what the citation supports"
        );
        assert!(note.unwrap().contains("command and its output"));
        ran.output = Some("test result: ok. 3 passed");
        assert_eq!(check(&ran, &context).0, EvidenceLevel::Ran);
        let mut reasoned = claim(EvidenceLevel::Reasoned, &cite);
        assert_eq!(check(&reasoned, &context).0, EvidenceLevel::Cited);
        reasoned.reasoning =
            Some("An empty list returns before indexing, so the panic path is unreachable.");
        assert_eq!(check(&reasoned, &context).0, EvidenceLevel::Reasoned);
        let none: Vec<String> = vec![];
        assert_eq!(
            check(&claim(EvidenceLevel::Reproduced, &none), &context).0,
            EvidenceLevel::Stated
        );
        let shot = vec!["screenshot:shot-1".to_string()];
        assert_eq!(
            check(&claim(EvidenceLevel::Reproduced, &shot), &context),
            (EvidenceLevel::Reproduced, None)
        );
        let page = vec!["http://localhost:5173/settings?tab=a".to_string()];
        assert_eq!(
            check(&claim(EvidenceLevel::Reproduced, &page), &context).0,
            EvidenceLevel::Reproduced
        );
        let other = vec!["http://localhost:5173/other".to_string()];
        assert_eq!(
            check(&claim(EvidenceLevel::Reproduced, &other), &context).0,
            EvidenceLevel::Stated
        );
        assert_eq!(
            check(&claim(EvidenceLevel::Stated, &none), &context),
            (EvidenceLevel::Stated, None)
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reports_record_claimed_and_checked_levels_and_ignore_agent_checked_values() {
        let (dir, _) = workspace();
        let mut run = TaskRun {
            workspace: dir.to_string_lossy().into_owned(),
            contract: super::super::outcomes::TaskContract {
                requirements: vec![super::super::outcomes::Requirement {
                    id: "requirement-0".into(),
                    title: "Works".into(),
                    checkpoint: false,
                    receipt: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        };
        run.visited_pages.push("/settings".into());
        let input: RecordValidationInput = serde_json::from_value(serde_json::json!({
            "step": "Final", "status": "passed",
            "requirements": [{
                "requirementId": "requirement-0", "status": "met", "summary": "Shown working",
                "evidence": ["src/lib.rs:3"], "level": "reproduced", "checkedLevel": "reproduced"
            }],
            "safety_fact": {"fact": "Only empty caches are dropped", "level": "cited", "evidence": ["src/lib.rs:1"]}
        }))
        .unwrap();
        let step = checked_step(&run, input).unwrap();
        let answer = &step.requirements[0];
        assert_eq!(answer.level, Some(EvidenceLevel::Reproduced));
        assert_eq!(answer.checked_level, Some(EvidenceLevel::Cited));
        assert!(answer.check_note.is_some());
        let fact = step.safety_fact.as_ref().unwrap();
        assert_eq!(fact.checked_level, Some(EvidenceLevel::Cited));
        let value = serde_json::to_value(&step).unwrap();
        assert_eq!(value["requirements"][0]["checkedLevel"], "cited");
        assert_eq!(value["safetyFact"]["level"], "cited");
        let unrated: RecordValidationInput = serde_json::from_value(serde_json::json!({
            "step": "Final", "status": "passed",
            "requirements": [{"requirementId": "requirement-0", "status": "met", "summary": "Done", "checkedLevel": "ran"}]
        }))
        .unwrap();
        let step = checked_step(&run, unrated).unwrap();
        assert_eq!(step.requirements[0].checked_level, None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
