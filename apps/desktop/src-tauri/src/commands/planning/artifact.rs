//! The plan document: one Markdown file with a small front matter block and
//! fixed sections. Rendering and parsing are inverse so a person can edit the
//! text directly and Jackalope can still read its tasks and criteria.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_DOCUMENT_BYTES: usize = 96_000;
pub const MAX_TASKS: usize = 8;
pub const MAX_CRITERIA: usize = 12;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontMatter {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub revision: u32,
    /// `draft`, `approved`, `running` or `done`.
    #[serde(default = "draft")]
    pub status: String,
    #[serde(default)]
    pub source_head: String,
    #[serde(default)]
    pub approved_by: String,
    #[serde(default)]
    pub approved_at: String,
    /// The shape chosen at approval: `single`, `subtasks` or `swarm`.
    #[serde(default)]
    pub shape: String,
    /// The planner's recommendation, its one-line reason and rough worker count.
    #[serde(default)]
    pub recommended_shape: String,
    #[serde(default)]
    pub shape_reason: String,
    #[serde(default)]
    pub workers: u32,
}

fn draft() -> String {
    "draft".into()
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clarification {
    pub question: String,
    pub answer: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTask {
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Can run beside other tasks once its dependencies finish.
    #[serde(default)]
    pub parallel: bool,
    /// Acceptance criterion IDs this task satisfies.
    #[serde(default)]
    pub covers: Vec<String>,
    #[serde(default)]
    pub briefing: String,
    /// `done` once a re-plan preserves a finished task; empty otherwise.
    #[serde(default)]
    pub status: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerifyKind {
    Command,
    Test,
    Browser,
    #[default]
    Manual,
}

impl VerifyKind {
    fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "command" => Some(Self::Command),
            "test" => Some(Self::Test),
            "browser" => Some(Self::Browser),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Command => "command",
            Self::Test => "test",
            Self::Browser => "browser",
            Self::Manual => "manual",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Criterion {
    pub id: String,
    pub verify: VerifyKind,
    /// The command or test to run for `command` and `test` criteria.
    #[serde(default)]
    pub check: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDocument {
    pub front: FrontMatter,
    pub title: String,
    pub goal: String,
    pub context: String,
    #[serde(default)]
    pub coverage: Vec<(String, String)>,
    pub clarifications: Vec<Clarification>,
    pub assumptions: Vec<String>,
    pub out_of_scope: Vec<String>,
    pub approach: String,
    pub tasks: Vec<PlanTask>,
    pub criteria: Vec<Criterion>,
    pub risks: Vec<String>,
    pub decision_log: Vec<String>,
    pub surprises: Vec<String>,
}

/// Section headings in document order. Parsing matches them case-insensitively.
pub const SECTIONS: &[&str] = &[
    "Goal",
    "Context",
    "Clarifications",
    "Assumptions",
    "Out of scope",
    "Approach & Interfaces",
    "Tasks",
    "Acceptance criteria",
    "Risks",
    "Decision log",
    "Surprises",
];

fn one_line(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn bullets(items: &[String]) -> String {
    if items.is_empty() {
        return "- None\n".into();
    }
    items
        .iter()
        .map(|item| format!("- {}\n", one_line(item)))
        .collect()
}

fn list(items: &[String]) -> String {
    items.join(", ")
}

impl PlanDocument {
    pub fn render(&self) -> String {
        let front = &self.front;
        let mut out = String::from("---\n");
        for (key, value) in [
            ("id", front.id.clone()),
            ("project", front.project.clone()),
            ("revision", front.revision.to_string()),
            ("status", front.status.clone()),
            ("sourceHead", front.source_head.clone()),
            ("approvedBy", front.approved_by.clone()),
            ("approvedAt", front.approved_at.clone()),
            ("shape", front.shape.clone()),
            ("recommendedShape", front.recommended_shape.clone()),
            ("shapeReason", front.shape_reason.clone()),
            ("workers", front.workers.to_string()),
        ] {
            out.push_str(&format!("{key}: {}\n", one_line(&value)));
        }
        out.push_str("---\n\n");
        out.push_str(&format!("# {}\n\n", one_line(&self.title)));
        out.push_str(&format!("## Goal\n\n{}\n\n", self.goal.trim()));
        out.push_str(&format!("## Context\n\n{}\n\n", self.context.trim()));
        out.push_str("## Clarifications\n\n");
        if !self.coverage.is_empty() {
            out.push_str(&format!(
                "Coverage: {}\n\n",
                self.coverage
                    .iter()
                    .map(|(area, state)| format!("{area} {state}"))
                    .collect::<Vec<_>>()
                    .join(" · ")
            ));
        }
        if self.clarifications.is_empty() {
            out.push_str("- None\n");
        }
        for item in &self.clarifications {
            out.push_str(&format!(
                "- Q: {}\n  A: {}\n",
                one_line(&item.question),
                one_line(&item.answer)
            ));
        }
        out.push_str(&format!(
            "\n## Assumptions\n\n{}",
            bullets(&self.assumptions)
        ));
        out.push_str(&format!(
            "\n## Out of scope\n\n{}",
            bullets(&self.out_of_scope)
        ));
        out.push_str(&format!(
            "\n## Approach & Interfaces\n\n{}\n\n## Tasks\n\n",
            self.approach.trim()
        ));
        for task in &self.tasks {
            out.push_str(&format!("### {} · {}\n\n", task.key, one_line(&task.title)));
            out.push_str(&format!("- scopes: {}\n", list(&task.scopes)));
            out.push_str(&format!(
                "- dependsOn: {}\n",
                if task.depends_on.is_empty() {
                    "none".into()
                } else {
                    list(&task.depends_on)
                }
            ));
            out.push_str(&format!(
                "- parallel: {}\n",
                if task.parallel { "yes" } else { "no" }
            ));
            out.push_str(&format!("- covers: {}\n", list(&task.covers)));
            if !task.status.is_empty() {
                out.push_str(&format!("- status: {}\n", task.status));
            }
            if !task.briefing.trim().is_empty() {
                out.push_str(&format!("\n{}\n", task.briefing.trim()));
            }
            out.push('\n');
        }
        out.push_str("## Acceptance criteria\n\n");
        for criterion in &self.criteria {
            let tag = if criterion.check.trim().is_empty() {
                criterion.verify.as_str().to_string()
            } else {
                format!(
                    "{}: {}",
                    criterion.verify.as_str(),
                    one_line(&criterion.check)
                )
            };
            out.push_str(&format!(
                "- {} [{}] {}\n",
                criterion.id,
                tag,
                one_line(&criterion.text)
            ));
        }
        out.push_str(&format!("\n## Risks\n\n{}", bullets(&self.risks)));
        out.push_str(&format!(
            "\n## Decision log\n\n{}",
            bullets(&self.decision_log)
        ));
        out.push_str(&format!("\n## Surprises\n\n{}", bullets(&self.surprises)));
        out
    }

    /// The body that approval binds to: every section, without front matter,
    /// so recording an approval does not change the hash it approved.
    pub fn content_hash(&self) -> String {
        let rendered = self.render();
        let body = rendered
            .split_once("\n---\n")
            .map(|(_, body)| body)
            .unwrap_or(&rendered);
        Sha256::digest(body.trim().as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    pub fn criterion(&self, id: &str) -> Option<&Criterion> {
        self.criteria.iter().find(|criterion| criterion.id == id)
    }

    /// Structural checks shared by planner output and direct edits.
    pub fn validate(&self) -> Result<(), String> {
        if self.title.trim().is_empty() || self.title.len() > 160 {
            return Err("Give the plan a title up to 160 characters.".into());
        }
        if self.goal.trim().is_empty() {
            return Err("The plan needs a Goal section.".into());
        }
        if self.tasks.is_empty() || self.tasks.len() > MAX_TASKS {
            return Err(format!("A plan needs between one and {MAX_TASKS} tasks."));
        }
        if self.criteria.is_empty() || self.criteria.len() > MAX_CRITERIA {
            return Err(format!(
                "A plan needs between one and {MAX_CRITERIA} acceptance criteria."
            ));
        }
        let mut keys = std::collections::HashSet::new();
        for task in &self.tasks {
            if task.key.is_empty()
                || task.key.len() > 80
                || !task
                    .key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                || !keys.insert(task.key.as_str())
            {
                return Err(format!(
                    "Task keys must be unique letters, digits, - or _ ({}).",
                    task.key
                ));
            }
            if task.scopes.is_empty() {
                return Err(format!("Task {} needs at least one scope.", task.key));
            }
        }
        let mut ids = std::collections::HashSet::new();
        for criterion in &self.criteria {
            if !ids.insert(criterion.id.as_str()) {
                return Err(format!(
                    "Acceptance criterion {} is repeated.",
                    criterion.id
                ));
            }
            if criterion.text.trim().is_empty() || criterion.text.len() > 480 {
                return Err(format!("Describe {} in 1–480 characters.", criterion.id));
            }
            if matches!(criterion.verify, VerifyKind::Command | VerifyKind::Test)
                && criterion.check.len() > 400
            {
                return Err(format!("The check for {} is too long.", criterion.id));
            }
        }
        for task in &self.tasks {
            for dependency in &task.depends_on {
                if !keys.contains(dependency.as_str()) {
                    return Err(format!(
                        "Task {} depends on unknown task {dependency}.",
                        task.key
                    ));
                }
            }
            for id in &task.covers {
                if !ids.contains(id.as_str()) {
                    return Err(format!("Task {} covers unknown criterion {id}.", task.key));
                }
            }
        }
        Ok(())
    }
}

/// Marks an assumption the planner confirmed by reading the code or running a
/// read-only command, written `Checked: <fact> — evidence: <file:line, or the
/// command and its output>`. Other assumptions are choices the planner made.
/// The marker lives in the bullet text, so plans saved before it existed parse,
/// render and hash exactly as they did.
pub const CHECKED: &str = "Checked:";

/// The fact and evidence of a checked assumption, or `None` for a decided one.
pub fn checked_assumption(text: &str) -> Option<&str> {
    let text = text.trim_start();
    let prefix = text.get(..CHECKED.len())?;
    prefix
        .eq_ignore_ascii_case(CHECKED)
        .then(|| text[CHECKED.len()..].trim())
}

fn split_list(value: &str) -> Vec<String> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("none") || value == "-" {
        return vec![];
    }
    value
        .split(',')
        .map(|item| item.trim().trim_matches('`').to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn parse_bullets(text: &str) -> Vec<String> {
    let mut items: Vec<String> = vec![];
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(item) = trimmed.strip_prefix("- ").or(trimmed.strip_prefix("* ")) {
            items.push(item.trim().to_string());
        } else if !trimmed.is_empty() {
            if let Some(last) = items.last_mut() {
                last.push(' ');
                last.push_str(trimmed);
            } else {
                items.push(trimmed.to_string());
            }
        }
    }
    items.retain(|item| !item.eq_ignore_ascii_case("none"));
    items
}

/// Removes a surrounding code fence and anything an agent wrote before the
/// document, so a final message with a short preamble still parses.
fn document_text(text: &str) -> &str {
    let mut text = text.trim();
    if let Some(start) = text.find("```markdown\n").or_else(|| text.find("```md\n")) {
        let inner = &text[start..];
        let inner = &inner[inner.find('\n').map(|i| i + 1).unwrap_or(0)..];
        text = inner
            .rsplit_once("```")
            .map(|(body, _)| body)
            .unwrap_or(inner);
    }
    if let Some(start) = text.find("---\n") {
        if !text[..start].lines().any(|line| line.starts_with("# ")) {
            return text[start..].trim();
        }
    }
    text.find("# ")
        .map(|start| &text[start..])
        .unwrap_or(text)
        .trim()
}

pub fn parse(text: &str) -> Result<PlanDocument, String> {
    if text.len() > MAX_DOCUMENT_BYTES {
        return Err("The plan is too large.".into());
    }
    let normalized = text.replace("\r\n", "\n");
    let mut body = document_text(&normalized);
    let mut doc = PlanDocument::default();
    doc.front.status = draft();
    if let Some(rest) = body.strip_prefix("---\n") {
        let (front, after) = rest
            .split_once("\n---")
            .ok_or("The plan's front matter is not closed with ---.")?;
        for line in front.lines() {
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let value = value.trim().trim_matches('"').to_string();
            match key.trim() {
                "id" => doc.front.id = value,
                "project" => doc.front.project = value,
                "revision" => doc.front.revision = value.parse().unwrap_or(0),
                "status" => {
                    if !value.is_empty() {
                        doc.front.status = value
                    }
                }
                "sourceHead" => doc.front.source_head = value,
                "approvedBy" => doc.front.approved_by = value,
                "approvedAt" => doc.front.approved_at = value,
                "shape" => doc.front.shape = value,
                "recommendedShape" => doc.front.recommended_shape = value,
                "shapeReason" => doc.front.shape_reason = value,
                "workers" => doc.front.workers = value.parse().unwrap_or(0),
                _ => {}
            }
        }
        body = after.trim_start_matches('-').trim();
    }
    let mut sections: Vec<(String, String)> = vec![];
    for line in body.lines() {
        if let Some(title) = line.strip_prefix("# ") {
            doc.title = title.trim().to_string();
        } else if let Some(heading) = line.strip_prefix("## ") {
            sections.push((heading.trim().to_string(), String::new()));
        } else if let Some((_, content)) = sections.last_mut() {
            content.push_str(line);
            content.push('\n');
        }
    }
    let section = |name: &str| {
        sections
            .iter()
            .find(|(heading, _)| heading.eq_ignore_ascii_case(name))
            .map(|(_, content)| content.trim().to_string())
            .unwrap_or_default()
    };
    doc.goal = section("Goal");
    doc.context = section("Context");
    doc.approach = section("Approach & Interfaces");
    if doc.approach.is_empty() {
        doc.approach = section("Approach");
    }
    doc.assumptions = parse_bullets(&section("Assumptions"));
    doc.out_of_scope = parse_bullets(&section("Out of scope"));
    doc.risks = parse_bullets(&section("Risks"));
    if doc.risks.is_empty() {
        doc.risks = parse_bullets(&section("Risks/spikes"));
    }
    doc.decision_log = parse_bullets(&section("Decision log"));
    doc.surprises = parse_bullets(&section("Surprises"));
    let clarifications = section("Clarifications");
    for line in clarifications.lines() {
        let trimmed = line.trim();
        if let Some(coverage) = trimmed.strip_prefix("Coverage:") {
            doc.coverage = coverage
                .split('·')
                .filter_map(|part| {
                    let part = part.trim();
                    let (area, state) = part.rsplit_once(' ')?;
                    Some((area.trim().to_string(), state.trim().to_string()))
                })
                .collect();
        } else if let Some(question) = trimmed.strip_prefix("- Q:").or(trimmed.strip_prefix("Q:")) {
            doc.clarifications.push(Clarification {
                question: question.trim().into(),
                answer: String::new(),
            });
        } else if let Some(answer) = trimmed.strip_prefix("A:") {
            if let Some(last) = doc.clarifications.last_mut() {
                last.answer = answer.trim().into();
            }
        }
    }
    doc.tasks = parse_tasks(&section("Tasks"))?;
    doc.criteria = parse_criteria(&section("Acceptance criteria"))?;
    if doc.title.is_empty() {
        return Err("The plan needs a # title line.".into());
    }
    Ok(doc)
}

fn parse_tasks(text: &str) -> Result<Vec<PlanTask>, String> {
    let mut tasks: Vec<PlanTask> = vec![];
    let mut briefing = false;
    for line in text.lines() {
        if let Some(heading) = line.strip_prefix("### ") {
            let (key, title) = heading
                .split_once('·')
                .or_else(|| heading.split_once(" - "))
                .or_else(|| heading.split_once(':'))
                .ok_or_else(|| format!("Write task headings as `### key · title` ({heading})."))?;
            tasks.push(PlanTask {
                key: key.trim().trim_matches('`').into(),
                title: title.trim().into(),
                ..Default::default()
            });
            briefing = false;
            continue;
        }
        let Some(task) = tasks.last_mut() else {
            continue;
        };
        let trimmed = line.trim();
        let field = trimmed
            .strip_prefix("- ")
            .and_then(|rest| rest.split_once(':'))
            .filter(|_| !briefing);
        match field.map(|(key, value)| (key.trim().to_ascii_lowercase(), value)) {
            Some((key, value)) if key == "scopes" => task.scopes = split_list(value),
            Some((key, value)) if key == "dependson" || key == "depends on" => {
                task.depends_on = split_list(value)
            }
            Some((key, value)) if key == "parallel" => {
                task.parallel = matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "yes" | "true" | "[p]" | "p"
                )
            }
            Some((key, value)) if key == "covers" => task.covers = split_list(value),
            Some((key, value)) if key == "status" => task.status = value.trim().into(),
            _ if trimmed.is_empty() && task.briefing.is_empty() => {}
            _ => {
                briefing = true;
                task.briefing.push_str(line);
                task.briefing.push('\n');
            }
        }
    }
    for task in &mut tasks {
        task.briefing = task.briefing.trim().to_string();
    }
    Ok(tasks)
}

fn parse_criteria(text: &str) -> Result<Vec<Criterion>, String> {
    let mut criteria = vec![];
    for item in parse_bullets(text) {
        let item = item.trim_start_matches("**").to_string();
        let (id, rest) = item
            .split_once(char::is_whitespace)
            .ok_or_else(|| format!("Start each criterion with its ID, like AC-1 ({item})."))?;
        let id = id.trim_matches(|c| c == '*' || c == ':').to_string();
        if !id.starts_with("AC-") {
            return Err(format!(
                "Start each criterion with its ID, like AC-1 ({item})."
            ));
        }
        let rest = rest.trim().trim_start_matches("**").trim();
        let (verify, check, text) = match rest.strip_prefix('[').and_then(|r| r.split_once(']')) {
            Some((tag, text)) => {
                let (kind, check) = tag.split_once(':').unwrap_or((tag, ""));
                let kind = VerifyKind::parse(kind)
                    .ok_or_else(|| format!("{id} has an unknown verify tag [{tag}]."))?;
                (
                    kind,
                    check.trim().trim_matches('`').to_string(),
                    text.trim(),
                )
            }
            None => (VerifyKind::Manual, String::new(), rest),
        };
        criteria.push(Criterion {
            id,
            verify,
            check,
            text: text.to_string(),
        });
    }
    Ok(criteria)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionChange {
    pub section: String,
    /// `added`, `removed` or `changed`.
    pub change: &'static str,
    pub before: String,
    pub after: String,
}

fn section_texts(markdown: &str) -> Vec<(String, String)> {
    let mut sections: Vec<(String, String)> = vec![];
    let body = markdown
        .strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n").map(|(_, body)| body))
        .unwrap_or(markdown);
    for line in body.lines() {
        if let Some(title) = line.strip_prefix("# ") {
            sections.push(("Title".into(), title.trim().into()));
        } else if let Some(heading) = line.strip_prefix("## ") {
            sections.push((heading.trim().into(), String::new()));
        } else if let Some((_, content)) = sections.last_mut() {
            content.push_str(line);
            content.push('\n');
        }
    }
    for (_, content) in &mut sections {
        *content = content.trim().to_string();
    }
    sections
}

/// Section-level differences between two rendered revisions, in document order.
pub fn diff(before: &str, after: &str) -> Vec<SectionChange> {
    let old = section_texts(before);
    let new = section_texts(after);
    let mut changes = vec![];
    for (name, text) in &new {
        match old.iter().find(|(heading, _)| heading == name) {
            None => changes.push(SectionChange {
                section: name.clone(),
                change: "added",
                before: String::new(),
                after: text.clone(),
            }),
            Some((_, previous)) if previous != text => changes.push(SectionChange {
                section: name.clone(),
                change: "changed",
                before: previous.clone(),
                after: text.clone(),
            }),
            _ => {}
        }
    }
    for (name, text) in &old {
        if !new.iter().any(|(heading, _)| heading == name) {
            changes.push(SectionChange {
                section: name.clone(),
                change: "removed",
                before: text.clone(),
                after: String::new(),
            });
        }
    }
    changes
}
