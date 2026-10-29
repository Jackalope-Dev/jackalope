//! Native-format export. When a project turns it on, its active learned
//! lessons are mirrored into a marked section of the project's AGENTS.md and a
//! Claude Code skill, so agents started outside Jackalope see them too. Only
//! the marked section and the skill file Jackalope created are ever written;
//! text outside the markers and hand-written skills are left alone. Writes are
//! atomic, nothing is committed, and turning export off removes the content.

use super::*;
use std::path::Path;

pub const START: &str = "<!-- jackalope:lessons:start -->";
pub const END: &str = "<!-- jackalope:lessons:end -->";
/// Identifies a skill file Jackalope owns.
const SKILL_MARKER: &str = "<!-- jackalope:lessons:managed -->";
const SKILL_PATH: &str = ".claude/skills/jackalope-lessons/SKILL.md";
const MAX_FILE: u64 = 1_000_000;

/// One bullet per active learned lesson, oldest first.
fn lines(entries: &[KnowledgeEntry]) -> Vec<String> {
    let mut active: Vec<&KnowledgeEntry> = entries
        .iter()
        .filter(|entry| {
            entry.enabled
                && !entry.dismissed
                && lifecycle(entry).is_some_and(|state| state.status == ACTIVE)
        })
        .collect();
    active.sort_by(|a, b| {
        let born = |entry: &KnowledgeEntry| lifecycle(entry).map(|state| state.born_at.clone());
        born(a).cmp(&born(b)).then_with(|| a.id.cmp(&b.id))
    });
    active
        .into_iter()
        .filter_map(|entry| {
            let managed = entry
                .automatic
                .as_ref()
                .is_some_and(|source| source.managed);
            let statement = lifecycle(entry)
                .map(|state| state.statement.as_str())
                .unwrap_or("");
            let text = if managed && !statement.is_empty() {
                statement.to_string()
            } else {
                entry
                    .content
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            };
            let text: String = text.replace("<!--", "<! --").chars().take(500).collect();
            (!text.is_empty() && sync::shareable(&text)).then(|| format!("- {text}"))
        })
        .collect()
}

fn section(lines: &[String]) -> String {
    format!(
        "{START}\n## Lessons learned by Jackalope\n\nJackalope keeps this section in sync with the project's active learned lessons. Edits here are replaced; change lessons in Jackalope under Project → Context.\n\n{}\n{END}",
        lines.join("\n")
    )
}

fn skill(lines: &[String]) -> String {
    format!(
        "---\nname: jackalope-lessons\ndescription: Lessons Jackalope learned in this project from the user's instructions and passing checks. Use when planning or changing code in this project.\n---\n{SKILL_MARKER}\n\n# Lessons learned by Jackalope\n\nJackalope maintains this skill from the project's active learned lessons; edits here are replaced. Newer instructions take precedence.\n\n{}\n",
        lines.join("\n")
    )
}

fn read_text(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = history::read_bounded(path, MAX_FILE)?;
    String::from_utf8(bytes).map(Some).map_err(|_| {
        format!(
            "{} is not UTF-8 text; it was left unchanged.",
            path.display()
        )
    })
}

/// The new AGENTS.md text, `None` to delete a file that held only the managed
/// section, or an error when the markers are not one ordered pair.
pub(super) fn updated_agents(
    existing: Option<&str>,
    block: Option<&str>,
) -> Result<Option<String>, String> {
    let current = existing.unwrap_or("");
    let newline = if current.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let block = block.map(|block| block.replace('\n', newline));
    let (starts, ends) = (current.matches(START).count(), current.matches(END).count());
    let span = match (starts, ends) {
        (0, 0) => None,
        (1, 1) => {
            let start = current.find(START).unwrap();
            let end = current.find(END).unwrap() + END.len();
            if end <= start {
                return Err(
                    "AGENTS.md has Jackalope lesson markers out of order; it was left unchanged."
                        .into(),
                );
            }
            Some((start, end))
        }
        _ => {
            return Err(
                "AGENTS.md has unmatched Jackalope lesson markers; it was left unchanged.".into(),
            )
        }
    };
    let next = match (span, block) {
        (Some((start, end)), Some(block)) => {
            format!("{}{block}{}", &current[..start], &current[end..])
        }
        (Some((start, end)), None) => {
            let before = current[..start].trim_end_matches(['\r', '\n']);
            let after = current[end..].trim_start_matches(['\r', '\n']);
            match (before.is_empty(), after.is_empty()) {
                (true, true) => String::new(),
                (true, false) => after.to_string(),
                (false, true) => format!("{before}{newline}"),
                (false, false) => format!("{before}{newline}{newline}{after}"),
            }
        }
        (None, Some(block)) => {
            let before = current.trim_end_matches(['\r', '\n']);
            if before.is_empty() {
                format!("{block}{newline}")
            } else {
                format!("{before}{newline}{newline}{block}{newline}")
            }
        }
        (None, None) => current.to_string(),
    };
    if existing.is_some() && next.trim().is_empty() && !current.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(next))
}

/// Brings one project's exported lessons up to date. Returns whether a file
/// changed.
pub fn export_project(
    store: &KnowledgeStore,
    project_id: &str,
    project_path: &str,
    enabled: bool,
) -> Result<bool, String> {
    let root = canonical(project_path)?;
    let root = Path::new(&root);
    let lines = if enabled {
        lines(&store.list(project_id, &root.to_string_lossy())?)
    } else {
        vec![]
    };
    let mut changed = false;

    let agents = root.join("AGENTS.md");
    let existing = read_text(&agents)?;
    let block = (!lines.is_empty()).then(|| section(&lines));
    if existing.is_some() || block.is_some() {
        match updated_agents(existing.as_deref(), block.as_deref())? {
            None => {
                std::fs::remove_file(&agents).map_err(|error| error.to_string())?;
                changed = true;
            }
            Some(next) if Some(next.as_str()) != existing.as_deref() => {
                history::write_atomic(&agents, next.as_bytes())?;
                changed = true;
            }
            Some(_) => {}
        }
    }

    let skill_path = root.join(SKILL_PATH);
    let current = read_text(&skill_path)?;
    let hand_written = current
        .as_deref()
        .is_some_and(|text| !text.contains(SKILL_MARKER));
    if lines.is_empty() {
        if current.is_some() && !hand_written {
            std::fs::remove_file(&skill_path).map_err(|error| error.to_string())?;
            if let Some(folder) = skill_path.parent() {
                let _ = std::fs::remove_dir(folder);
            }
            changed = true;
        }
    } else {
        if hand_written {
            return Err(format!(
                "{SKILL_PATH} was not written by Jackalope; it was left unchanged."
            ));
        }
        let next = skill(&lines);
        if current.as_deref() != Some(next.as_str()) {
            if let Some(folder) = skill_path.parent() {
                std::fs::create_dir_all(folder).map_err(|error| error.to_string())?;
            }
            history::write_atomic(&skill_path, next.as_bytes())?;
            changed = true;
        }
    }
    Ok(changed)
}

#[cfg(test)]
mod tests;
