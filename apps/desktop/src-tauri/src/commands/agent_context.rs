//! Context Jackalope holds for a project that its task agents need without the
//! person committing, copying or pasting anything.
//!
//! Jackalope-owned files live under the project's `.jackalope` folder, which task
//! preparation hides from Git through `info/exclude`, so a task worktree would not
//! otherwise contain them. [`place`] copies the current versions into each attempt's
//! workspace before the agent starts and replaces an older or edited copy; the files
//! stay ignored there, so they never reach commits, swarm snapshots or the changes
//! an agent on a computer sends back. A computer upload adds them explicitly (see
//! `computers::runs::archive`). [`launch_section`] summarises them, with the
//! project instructions, for the agent's launch input within a fixed budget.

use super::git_command::{command, Policy};
use std::{path::Path, process::Stdio};

/// Jackalope-owned files every task workspace receives when the project has them.
pub(crate) const FILES: [&str; 1] = [super::cloudflare_resources::MANIFEST_PATH];
/// Pasted prompt images (see `attachments.rs`). A workspace receives the ones its
/// prompt names.
pub(crate) const ATTACHMENTS: &str = ".jackalope/attachments";
const FILE_LIMIT: u64 = 1024 * 1024;
const ATTACHMENT_LIMIT: u64 = 20 * 1024 * 1024;
const ATTACHMENTS_TOTAL: u64 = 64 * 1024 * 1024;
const MAX_ATTACHMENTS: usize = 16;
/// Upper bound on the Jackalope context part of the launch input, in bytes.
pub(crate) const SUMMARY_LIMIT: usize = 1200;
/// Upper bound on the project instructions part of the launch input, in characters.
pub(crate) const INSTRUCTIONS_LIMIT: usize = 4000;

/// Whether a workspace-relative path is Jackalope context an agent must not change.
pub(crate) fn is_context_path(relative: &str) -> bool {
    let relative = relative.replace('\\', "/");
    let relative = relative.trim_start_matches("./");
    FILES.iter().any(|file| relative.eq_ignore_ascii_case(file))
        || relative
            .to_ascii_lowercase()
            .starts_with(&format!("{ATTACHMENTS}/"))
}

/// `git apply --exclude` patterns that keep an agent's edits to context out of the
/// changes brought back from a computer.
pub(crate) fn apply_exclusions() -> Vec<String> {
    FILES
        .iter()
        .map(|file| format!("--exclude={file}"))
        .chain([format!("--exclude={ATTACHMENTS}/*")])
        .collect()
}

fn same_folder(left: &Path, right: &Path) -> bool {
    match (dunce::canonicalize(left), dunce::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// Pasted images in the project that `prompt` names, newest first.
fn named_attachments(project: &Path, prompt: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(project.join(ATTACHMENTS)) else {
        return Vec::new();
    };
    let mut found: Vec<(std::time::SystemTime, String)> = entries
        .filter_map(Result::ok)
        .take(5000)
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if !plain_name(&name) || !prompt.contains(&name) {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, format!("{ATTACHMENTS}/{name}")))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found
        .into_iter()
        .take(MAX_ATTACHMENTS)
        .map(|(_, path)| path)
        .collect()
}

/// Lines Git prints for `args` followed by `paths`, or `None` when Git fails.
fn git_lines(workspace: &Path, args: &[&str], paths: &[String]) -> Option<Vec<String>> {
    let mut git = command(workspace, args, Policy::Inspection);
    git.arg("--").args(paths).stdin(Stdio::null());
    let output = git.output().ok()?;
    // check-ignore exits 1 when nothing matches.
    if !output.status.success()
        && !(args.first() == Some(&"check-ignore") && output.status.code() == Some(1))
    {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .split(['\0', '\n'])
            .map(|line| line.trim().replace('\\', "/"))
            .filter(|line| !line.is_empty())
            .collect(),
    )
}

fn read_regular(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > limit {
        return None;
    }
    super::platform::read_capped(path, limit).ok().flatten()
}

fn write_replacing(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target.parent().ok_or("Invalid context path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if std::fs::symlink_metadata(target).is_ok_and(|metadata| !metadata.is_file()) {
        return Err(format!("{} is not a file", target.display()));
    }
    let temporary = parent.join(format!(".context-{}.tmp", uuid::Uuid::new_v4().simple()));
    std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, target).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })
}

/// Copies the project's Jackalope context into `workspace` and returns the
/// workspace-relative context paths it now holds. Copies are replaced when the
/// project's version differs and removed when the project no longer has the file.
/// A path the workspace's Git tracks (the person committed it) or does not ignore
/// is left alone, so placing context never creates a change. When the workspace is
/// the project checkout itself, nothing is copied.
pub(crate) fn place(project: &Path, workspace: &Path, prompt: &str) -> Result<Vec<String>, String> {
    if !workspace.is_dir() {
        return Ok(Vec::new());
    }
    let mut candidates: Vec<String> = FILES.iter().map(|file| file.to_string()).collect();
    candidates.extend(named_attachments(project, prompt));
    if same_folder(project, workspace) {
        return Ok(candidates
            .into_iter()
            .filter(|path| workspace.join(path).is_file())
            .collect());
    }
    super::tasks::preparation::exclude_marker(workspace);
    // Git matches the `/.jackalope/` folder pattern only against a folder that exists.
    let folder = super::workspace_setup::no_links(workspace, Path::new(".jackalope"))?;
    std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let tracked = git_lines(workspace, &["ls-files"], &candidates)
        .ok_or("Git could not list the task workspace's files")?;
    let ignored = git_lines(workspace, &["check-ignore"], &candidates)
        .ok_or("Git could not check which context files it ignores")?;
    let mut placed = Vec::new();
    let mut total = 0u64;
    let mut failures = Vec::new();
    for relative in candidates {
        if tracked.contains(&relative) {
            if workspace.join(&relative).is_file() {
                placed.push(relative);
            }
            continue;
        }
        if !ignored.contains(&relative) {
            continue;
        }
        let target = match super::workspace_setup::no_links(workspace, Path::new(&relative)) {
            Ok(target) => target,
            Err(error) => {
                failures.push(format!("{relative}: {error}"));
                continue;
            }
        };
        let attachment = relative.starts_with(ATTACHMENTS);
        let limit = if attachment {
            ATTACHMENT_LIMIT
        } else {
            FILE_LIMIT
        };
        let source = super::workspace_setup::no_links(project, Path::new(&relative))
            .ok()
            .and_then(|source| read_regular(&source, limit));
        let Some(bytes) = source else {
            if !attachment && std::fs::symlink_metadata(&target).is_ok_and(|m| m.is_file()) {
                let _ = std::fs::remove_file(&target);
            }
            continue;
        };
        total += bytes.len() as u64;
        if attachment && total > ATTACHMENTS_TOTAL {
            failures.push(format!(
                "{relative}: attachments are larger than 64 MB in all"
            ));
            continue;
        }
        if read_regular(&target, limit).as_deref() != Some(bytes.as_slice()) {
            if let Err(error) = write_replacing(&target, &bytes) {
                failures.push(format!("{relative}: {error}"));
                continue;
            }
        }
        placed.push(relative);
    }
    if placed.is_empty() && !failures.is_empty() {
        return Err(failures.join("; "));
    }
    Ok(placed)
}

/// Context files present in `workspace` for a computer upload, within the same
/// bounds as [`place`]: the Jackalope files and the newest attachments.
pub(crate) fn present(workspace: &Path) -> Vec<String> {
    let mut files: Vec<String> = FILES
        .iter()
        .filter(|file| read_regular(&workspace.join(file), FILE_LIMIT).is_some())
        .map(|file| file.to_string())
        .collect();
    let folder = workspace.join(ATTACHMENTS);
    if std::fs::symlink_metadata(&folder).is_ok_and(|metadata| metadata.is_dir()) {
        let mut attachments: Vec<(std::time::SystemTime, u64, String)> = std::fs::read_dir(&folder)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .take(5000)
            .filter_map(|entry| {
                let name = entry.file_name().to_str()?.to_string();
                let metadata = std::fs::symlink_metadata(entry.path()).ok()?;
                if !plain_name(&name) || !metadata.is_file() || metadata.len() > ATTACHMENT_LIMIT {
                    return None;
                }
                Some((metadata.modified().ok()?, metadata.len(), name))
            })
            .collect();
        attachments.sort_by(|a, b| b.0.cmp(&a.0));
        let mut total = 0;
        for (_, size, name) in attachments.into_iter().take(MAX_ATTACHMENTS) {
            total += size;
            if total > ATTACHMENTS_TOTAL {
                break;
            }
            files.push(format!("{ATTACHMENTS}/{name}"));
        }
    }
    files
}

/// The prompt with absolute paths to the project's pasted images rewritten to
/// workspace-relative ones, which resolve in a worktree and on a computer alike.
pub(crate) fn portable_prompt(prompt: &str, project: &Path) -> String {
    let root = project
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string();
    if root.is_empty() || !prompt.contains(".jackalope") {
        return prompt.to_string();
    }
    let mut text = prompt.to_string();
    for (separator, root) in [
        ('\\', root.replace('/', "\\")),
        ('/', root.replace('\\', "/")),
    ] {
        let prefix = format!("{root}{separator}.jackalope{separator}attachments{separator}");
        text = replace_ignoring_case(&text, &prefix, &format!("{ATTACHMENTS}/"));
    }
    text
}

fn replace_ignoring_case(text: &str, from: &str, to: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let needle = from.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut rest = 0;
    while let Some(found) = lower[rest..].find(&needle) {
        out.push_str(&text[rest..rest + found]);
        out.push_str(to);
        rest += found + needle.len();
    }
    out.push_str(&text[rest..]);
    out
}

fn clean(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}

/// The Jackalope context part of the launch input: what the workspace holds and
/// where, at most [`SUMMARY_LIMIT`] bytes. Empty when there is nothing to say.
pub(crate) fn summary(workspace: &Path) -> String {
    let Some(resources) = super::cloudflare_resources::agent_summary(workspace) else {
        return String::new();
    };
    if resources.is_empty() {
        return String::new();
    }
    let head = "\nJackalope context (kept current by Jackalope and ignored by Git; read it, do not edit or commit it):\n- Cloudflare resources for this project: ";
    let tail = format!(
        ". Full details, IDs and a wrangler bindings snippet: {}.\n",
        super::cloudflare_resources::MANIFEST_PATH
    );
    // Room for a closing "; and N more" when the list does not fit.
    const MORE: usize = 24;
    let mut listed = String::new();
    for (index, resource) in resources.iter().enumerate() {
        let clause = clean(resource, 120);
        let separator = if listed.is_empty() { "" } else { "; " };
        if head.len() + listed.len() + separator.len() + clause.len() + MORE + tail.len()
            > SUMMARY_LIMIT
        {
            listed.push_str(&format!("{separator}and {} more", resources.len() - index));
            break;
        }
        listed.push_str(separator);
        listed.push_str(&clause);
    }
    let text = format!("{head}{listed}{tail}");
    debug_assert!(text.len() <= SUMMARY_LIMIT);
    text
}

/// Project instructions and the Jackalope context summary for an agent's launch
/// input. Instructions already in the prompt (scheduled work and remote tasks add
/// them themselves) are not repeated.
pub(crate) fn launch_section(workspace: &Path, instructions: Option<&str>, prompt: &str) -> String {
    let mut text = String::new();
    if let Some(instructions) = instructions
        .map(str::trim)
        .filter(|value| !value.is_empty() && !prompt.contains(value))
    {
        let count = instructions.chars().count();
        let shown: String = instructions.chars().take(INSTRUCTIONS_LIMIT).collect();
        text.push_str("\nProject instructions from the person:\n");
        text.push_str(&shown);
        if count > INSTRUCTIONS_LIMIT {
            text.push_str(" (shortened)");
        }
        text.push('\n');
    }
    text.push_str(&summary(workspace));
    text
}

#[cfg(test)]
mod tests;
