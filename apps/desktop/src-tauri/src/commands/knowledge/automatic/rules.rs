//! Rule files written for other coding tools (Cursor, Windsurf, Cline and GitHub
//! Copilot), offered as paused project lessons.

use super::*;

/// Rule files offered per project scan.
const MAX_FILES: usize = 20;
/// Larger rule files are skipped rather than truncated mid-read.
const MAX_FILE_BYTES: u64 = 64_000;
/// Directory entries examined across all rule folders.
const MAX_DIRECTORY_ENTRIES: usize = 200;
const MAX_DEPTH: usize = 4;

#[derive(Debug, PartialEq)]
pub(super) enum Scope {
    Always,
    Paths(Vec<String>),
    /// The tool applies it when the agent judges it relevant or it is mentioned.
    Described,
}

#[derive(Debug, PartialEq)]
pub(super) struct Rule {
    pub tool: &'static str,
    pub path: String,
    pub name: String,
    pub scope: Scope,
    pub description: Option<String>,
    pub body: String,
}

#[derive(Clone, Copy)]
enum Format {
    Cursor,
    Windsurf,
    Cline,
    CopilotPaths,
    /// A single legacy or repository-wide file with no scoping.
    Plain(&'static str),
}

/// Splits optional `---` frontmatter into simple `key: value` fields. Values
/// may be quoted, an inline `[a, b]` list or an indented `- item` list. Cursor
/// globs are often unquoted (`globs: **/*.ts`), which strict YAML rejects.
pub(super) fn frontmatter(text: &str) -> (BTreeMap<String, Vec<String>>, &str) {
    let mut fields = BTreeMap::new();
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return (fields, text);
    };
    let mut offset = 0;
    let mut end = None;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            end = Some(offset + line.len());
            break;
        }
        offset += line.len();
    }
    let Some(end) = end else {
        return (fields, text);
    };
    let mut key: Option<String> = None;
    for line in rest[..offset].lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let (Some(item), Some(key)) = (trimmed.strip_prefix("- "), &key) {
            if line.starts_with([' ', '\t', '-']) {
                fields
                    .entry(key.clone())
                    .or_insert_with(Vec::new)
                    .push(unquote(item).to_string());
                continue;
            }
        }
        let Some((name, value)) = line.split_once(':') else {
            key = None;
            continue;
        };
        if name.starts_with([' ', '\t']) || name.trim().is_empty() {
            key = None;
            continue;
        }
        let name = name.trim().to_string();
        let value = value.trim();
        let values = match value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            Some(list) => list
                .split(',')
                .map(|item| unquote(item.trim()).to_string())
                .filter(|item| !item.is_empty())
                .collect(),
            None if value.is_empty() => vec![],
            None => vec![unquote(value).to_string()],
        };
        fields.insert(name.clone(), values);
        key = Some(name);
    }
    (fields, &rest[end..])
}

fn unquote(value: &str) -> &str {
    let value = value.trim();
    for quote in ['"', '\''] {
        if let Some(inner) = value
            .strip_prefix(quote)
            .and_then(|v| v.strip_suffix(quote))
        {
            return inner;
        }
    }
    value
}

fn field<'a>(fields: &'a BTreeMap<String, Vec<String>>, name: &str) -> Option<&'a str> {
    fields
        .get(name)
        .and_then(|values| values.first())
        .map(String::as_str)
        .filter(|value| !value.is_empty())
}

/// Glob lists are comma-separated in Cursor and Copilot; commas inside
/// `{a,b}` alternatives stay with their pattern.
fn globs(fields: &BTreeMap<String, Vec<String>>, name: &str) -> Vec<String> {
    let mut globs = vec![];
    for value in fields.get(name).into_iter().flatten() {
        let mut depth = 0usize;
        let mut current = String::new();
        for c in value.chars() {
            match c {
                '{' => depth += 1,
                '}' => depth = depth.saturating_sub(1),
                ',' if depth == 0 => {
                    globs.push(std::mem::take(&mut current));
                    continue;
                }
                _ => {}
            }
            current.push(c);
        }
        globs.push(current);
    }
    globs
        .into_iter()
        .map(|glob| unquote(&glob).to_string())
        .filter(|glob| !glob.is_empty())
        .collect()
}

fn paths(globs: Vec<String>) -> Scope {
    // GitHub, Cursor and omp treat these as matching every file.
    if globs.is_empty() {
        Scope::Described
    } else if globs
        .iter()
        .any(|glob| matches!(glob.as_str(), "*" | "**" | "**/*"))
    {
        Scope::Always
    } else {
        Scope::Paths(globs)
    }
}

/// Interprets one rule file, or `None` when its frontmatter turns it off or it is empty.
fn parse(format: Format, path: &str, text: &str) -> Option<Rule> {
    let (fields, body) = frontmatter(text);
    if field(&fields, "enabled") == Some("false") || body.trim().is_empty() {
        return None;
    }
    let file = path.rsplit('/').next().unwrap_or(path);
    let stem = file
        .strip_suffix(".instructions.md")
        .or_else(|| file.strip_suffix(".mdc"))
        .or_else(|| file.strip_suffix(".md"))
        .or_else(|| file.strip_suffix(".txt"))
        .unwrap_or(file)
        .trim_start_matches('.')
        .to_string();
    let always = field(&fields, "alwaysApply") == Some("true");
    let (tool, scope) = match format {
        Format::Cursor if always => ("Cursor", Scope::Always),
        Format::Cursor => ("Cursor", paths(globs(&fields, "globs"))),
        Format::Windsurf => (
            "Windsurf",
            match field(&fields, "trigger") {
                Some("always_on") => Scope::Always,
                Some("glob") => paths(globs(&fields, "globs")),
                Some(_) => Scope::Described,
                None if always || fields.is_empty() => Scope::Always,
                None => paths(globs(&fields, "globs")),
            },
        ),
        Format::Cline => (
            "Cline",
            match globs(&fields, "paths") {
                globs if globs.is_empty() => Scope::Always,
                globs => paths(globs),
            },
        ),
        Format::CopilotPaths => ("GitHub Copilot", paths(globs(&fields, "applyTo"))),
        Format::Plain(tool) => (tool, Scope::Always),
    };
    Some(Rule {
        tool,
        path: path.into(),
        name: stem,
        scope,
        description: field(&fields, "description").map(str::to_string),
        body: body.trim().to_string(),
    })
}

fn truncate(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.into();
    }
    let mut end = limit.saturating_sub('…'.len_utf8());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", text[..end].trim_end())
}

fn keywords(rule: &Rule) -> Vec<String> {
    let generic = [
        "src", "lib", "app", "apps", "packages", "dist", "index", "md", "mdc",
    ];
    let mut words: Vec<String> = vec![];
    if let Scope::Paths(globs) = &rule.scope {
        for glob in globs {
            words.extend(
                glob.to_lowercase()
                    .split(|c: char| !c.is_alphanumeric())
                    .map(str::to_string),
            );
        }
    }
    let subject = format!(
        "{} {}",
        rule.name.replace(['-', '_', '.'], " "),
        rule.description.as_deref().unwrap_or("")
    );
    words.extend(phrases(&subject));
    words.extend(phrases(&rule.body));
    let mut keywords: Vec<String> = vec![];
    for word in words {
        if (2..=60).contains(&word.len())
            && !generic.contains(&word.as_str())
            && !keywords.contains(&word)
        {
            keywords.push(word);
        }
    }
    if keywords.is_empty() {
        keywords.push(
            rule.tool
                .split(' ')
                .next_back()
                .unwrap_or("rules")
                .to_lowercase(),
        );
    }
    keywords.truncate(10);
    keywords
}

pub(super) fn lesson(project_id: &str, path: &str, rule: &Rule) -> KnowledgeEntry {
    let (scope, summary) = match &rule.scope {
        Scope::Always => (
            "for the whole project".to_string(),
            "always applies".to_string(),
        ),
        Scope::Paths(globs) => {
            let globs = truncate(&globs.join(", "), 160);
            (
                format!("for files matching {globs}"),
                format!("applies to {globs}"),
            )
        }
        Scope::Described => (
            "when relevant".to_string(),
            "applied when relevant".to_string(),
        ),
    };
    let mut head = format!("{} rule in {}, {scope}.", rule.tool, rule.path);
    if let Some(description) = &rule.description {
        head.push_str(&format!(" {}", truncate(description, 200)));
    }
    let tail = format!(
        "Written for {}; read the full file before relying on it.",
        rule.tool
    );
    let room = 790usize.saturating_sub(head.len() + tail.len() + 2);
    let excerpt = truncate(&rule.body, room);
    let mut entry = candidate(
        project_id,
        path,
        &format!("rules:{}", rule.path),
        &format!("{} rule: {}", rule.tool, rule.name),
        format!("{head}\n{excerpt}\n{tail}"),
        keywords(rule),
        "rules",
        format!("{} · {summary}", rule.path),
        None,
    );
    // Offered, not used: the person turns a rule on before tasks receive it.
    entry.enabled = false;
    entry
}

/// Files under `folder` (relative to `root`), sorted, without following links.
fn walk(root: &Path, folder: &str, budget: &mut usize, keep: impl Fn(&str) -> bool) -> Vec<String> {
    let mut found = vec![];
    let mut pending = vec![(folder.to_string(), 0usize)];
    'folders: while let Some((relative, depth)) = pending.pop() {
        let Ok(read) = std::fs::read_dir(root.join(&relative)) else {
            continue;
        };
        let mut children: Vec<_> = read.flatten().collect();
        children.sort_by_key(|entry| entry.file_name());
        let mut folders = vec![];
        for entry in children {
            if *budget == 0 {
                break 'folders;
            }
            *budget -= 1;
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let child = format!("{relative}/{name}");
            if kind.is_dir() && depth + 1 < MAX_DEPTH {
                folders.push((child, depth + 1));
            } else if kind.is_file() && keep(&name) {
                found.push(child);
            }
        }
        pending.extend(folders.into_iter().rev());
    }
    found.sort();
    found
}

fn sources(root: &Path) -> Vec<(Format, String)> {
    let mut budget = MAX_DIRECTORY_ENTRIES;
    let mut files = vec![];
    let single = |name: &str| root.join(name).is_file().then(|| name.to_string());
    files.extend(single(".cursorrules").map(|p| (Format::Plain("Cursor"), p)));
    for path in walk(root, ".cursor/rules", &mut budget, |name| {
        name.ends_with(".mdc") || name.ends_with(".md")
    }) {
        files.push((Format::Cursor, path));
    }
    files.extend(single(".windsurfrules").map(|p| (Format::Plain("Windsurf"), p)));
    for path in walk(root, ".windsurf/rules", &mut budget, |name| {
        name.ends_with(".md")
    }) {
        files.push((Format::Windsurf, path));
    }
    if root.join(".clinerules").is_dir() {
        for path in walk(root, ".clinerules", &mut budget, |name| {
            name.ends_with(".md") || name.ends_with(".txt")
        }) {
            files.push((Format::Cline, path));
        }
    } else {
        files.extend(single(".clinerules").map(|p| (Format::Plain("Cline"), p)));
    }
    files.extend(
        single(".github/copilot-instructions.md").map(|p| (Format::Plain("GitHub Copilot"), p)),
    );
    for path in walk(root, ".github/instructions", &mut budget, |name| {
        name.ends_with(".instructions.md")
    }) {
        files.push((Format::CopilotPaths, path));
    }
    files
}

/// Lessons for the rule files in the project folder. Unreadable, oversized,
/// non-UTF-8 and outside-project files are skipped.
pub(super) fn candidates(project_id: &str, path: &str) -> Vec<KnowledgeEntry> {
    let root = Path::new(path);
    sources(root)
        .into_iter()
        .filter_map(|(format, relative)| {
            let resolved = dunce::canonicalize(root.join(&relative)).ok()?;
            if !resolved.starts_with(root) || !resolved.is_file() {
                return None;
            }
            let bytes =
                crate::commands::platform::read_capped(&resolved, MAX_FILE_BYTES).ok()??;
            let text = String::from_utf8(bytes).ok()?;
            if text.contains('\0') {
                return None;
            }
            parse(format, &relative, &text)
        })
        .take(MAX_FILES)
        .map(|rule| lesson(project_id, path, &rule))
        .collect()
}

#[cfg(test)]
mod tests;
