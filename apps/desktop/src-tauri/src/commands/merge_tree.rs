//! Git merges that resolve Xcode project file conflicts by structure.
//!
//! [`merge_tree`] runs `git merge-tree --write-tree` and merges each `.pbxproj`
//! file that has only a content conflict from its three index stages with
//! [`pbxproj::merge`], then rebuilds Git's result tree through a private index.
//! When those were the only conflicts the caller sees a clean merge; otherwise
//! the remaining paths are still reported, with Git's conflict text. A project
//! file in any other kind of conflict, or one that does not merge by structure,
//! keeps Git's result. [`resolve_project_files`] does the same for a `git merge`
//! stopped in a checkout, and only when it clears every conflict.

use super::pbxproj;
use super::repo::{self, Policy, Seed};
use std::{collections::BTreeMap, io::Write, path::Path, process::Stdio};

/// The result of a merge-tree run.
#[derive(Debug)]
pub(super) struct Merged {
    pub tree: String,
    /// Conflicted paths in Git's order, each once; empty for a clean merge.
    pub conflicts: Vec<String>,
}

/// One `<mode> <object> <stage>\t<path>` entry, as `merge-tree -z` and
/// `ls-files -u -z` write conflicted files.
#[derive(Debug, PartialEq)]
struct Stage {
    mode: String,
    object: String,
    stage: u8,
    path: String,
}

fn parse_stage(field: &str) -> Option<Stage> {
    let (info, path) = field.split_once('\t')?;
    let mut parts = info.split(' ');
    let (mode, object, stage) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || path.is_empty() {
        return None;
    }
    Some(Stage {
        mode: mode.into(),
        object: object.into(),
        stage: stage.parse().ok()?,
        path: path.into(),
    })
}

/// `git <config> merge-tree --write-tree ours theirs`, with project files merged
/// by structure. `config` holds `-c` options such as `merge.conflictStyle=diff3`,
/// which shape the conflict text left behind.
pub(super) fn merge_tree(
    repo: &Path,
    config: &[&str],
    ours: &str,
    theirs: &str,
    policy: Policy,
) -> Result<Merged, String> {
    let mut args = config.to_vec();
    args.extend(["merge-tree", "--write-tree", "-z", ours, theirs]);
    let output = repo::output(repo, &args, policy)?;
    let code = output.status.code();
    if code != Some(0) && code != Some(1) {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            "Git could not merge the two versions.".into()
        } else {
            error
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut fields = stdout.split('\0');
    let tree = fields
        .next()
        .filter(|tree| repo::is_object_id(tree))
        .ok_or("Git did not produce a merged tree.")?
        .to_string();
    if code == Some(0) {
        return Ok(Merged {
            tree,
            conflicts: vec![],
        });
    }
    let stages: Vec<Stage> = fields
        .by_ref()
        .take_while(|field| !field.is_empty())
        .filter_map(parse_stage)
        .collect();
    let mut conflicts: Vec<String> = vec![];
    for stage in &stages {
        if !conflicts.contains(&stage.path) {
            conflicts.push(stage.path.clone());
        }
    }
    if conflicts.is_empty() {
        conflicts.push("Git reported a merge conflict.".into());
        return Ok(Merged { tree, conflicts });
    }
    // Messages: a path count, that many paths, a type and the message text. A
    // path in any conflict other than a content conflict keeps Git's result.
    let rest: Vec<&str> = fields.collect();
    let mut excluded: Vec<&str> = vec![];
    let mut at = 0;
    while let Some(count) = rest.get(at).and_then(|count| count.parse::<usize>().ok()) {
        let kind = rest.get(at + 1 + count).copied().unwrap_or_default();
        if kind.starts_with("CONFLICT") && kind != "CONFLICT (contents)" {
            excluded.extend(rest.iter().skip(at + 1).take(count));
        }
        at += count + 3;
    }
    let files: Vec<(String, String)> = project_stages(&stages)
        .into_iter()
        .filter(|(path, _)| !excluded.contains(path))
        .filter_map(|(path, objects)| {
            merge_project_file(repo, objects, policy).map(|text| (path.to_string(), text))
        })
        .collect();
    if files.is_empty() {
        return Ok(Merged { tree, conflicts });
    }
    let Some(tree) = replaced_tree(repo, &tree, &files, policy) else {
        return Ok(Merged { tree, conflicts });
    };
    conflicts.retain(|path| !files.iter().any(|(merged, _)| merged == path));
    Ok(Merged { tree, conflicts })
}

/// The base, ours and theirs objects of each conflicted project file kept as a
/// regular file; a missing stage is `None`.
fn project_stages(stages: &[Stage]) -> BTreeMap<&str, [Option<&str>; 3]> {
    let mut by_path: BTreeMap<&str, [Option<&str>; 3]> = BTreeMap::new();
    let mut other: Vec<&str> = vec![];
    for stage in stages {
        let index = usize::from(stage.stage).wrapping_sub(1);
        if !pbxproj::is_project_file(&stage.path) || stage.mode != "100644" || index > 2 {
            other.push(&stage.path);
            continue;
        }
        by_path.entry(&stage.path).or_default()[index] = Some(&stage.object);
    }
    by_path.retain(|path, _| !other.contains(path));
    by_path
}

/// The structured merge of one project file's three stages, when it has all
/// three and they merge without conflict.
fn merge_project_file(repo: &Path, objects: [Option<&str>; 3], policy: Policy) -> Option<String> {
    let [Some(base), Some(ours), Some(theirs)] = objects else {
        return None;
    };
    let text = |object: &str| {
        let output = repo::output(repo, &["cat-file", "blob", object], policy).ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8(output.stdout).ok())
            .flatten()
    };
    pbxproj::merge(&text(base)?, &text(ours)?, &text(theirs)?).ok()
}

/// Stores `text` as a blob exactly as given, without clean filters.
fn write_blob(repo: &Path, text: &str, policy: Policy) -> Result<String, String> {
    let mut command = repo::command(
        repo,
        &["hash-object", "-w", "--no-filters", "--stdin"],
        policy,
    );
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not run Git: {e}"))?;
    let written = child
        .stdin
        .take()
        .ok_or("Git's input is unavailable.")?
        .write_all(text.as_bytes());
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    written.map_err(|e| e.to_string())?;
    let blob = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || !repo::is_object_id(&blob) {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(blob)
}

/// `tree` with each of `files` replaced by the given text.
fn replaced_tree(
    repo: &Path,
    tree: &str,
    files: &[(String, String)],
    policy: Policy,
) -> Option<String> {
    repo::with_temp_index(repo, &std::env::temp_dir(), Seed::Empty, policy, |index| {
        index.git(&["read-tree", tree])?;
        for (path, text) in files {
            let blob = write_blob(repo, text, policy)?;
            index.git(&[
                "update-index",
                "--cacheinfo",
                &format!("100644,{blob},{path}"),
            ])?;
        }
        index.git(&["write-tree"])
    })
    .ok()
}

/// Finishes the structured part of a `git merge` that stopped in `checkout`:
/// when every unmerged path is a project file that merges by structure, stages
/// the merged files and writes them to the checkout. Returns whether it did;
/// the caller then commits the merge or aborts it.
pub(super) fn resolve_project_files(checkout: &Path) -> Result<bool, String> {
    let policy = Policy::Isolated;
    let listing = repo::git_exact(checkout, &["ls-files", "-u", "-z"], policy)?;
    let stages: Vec<Stage> = listing
        .split('\0')
        .filter(|field| !field.is_empty())
        .map(|field| parse_stage(field).ok_or("Git listed unmerged files in an unexpected form."))
        .collect::<Result<_, _>>()?;
    let projects = project_stages(&stages);
    if projects.is_empty()
        || stages
            .iter()
            .any(|stage| !projects.contains_key(stage.path.as_str()))
    {
        return Ok(false);
    }
    let mut files = vec![];
    for (path, objects) in projects {
        let Some(text) = merge_project_file(checkout, objects, policy) else {
            return Ok(false);
        };
        files.push((path.to_string(), text));
    }
    for (path, text) in &files {
        let blob = write_blob(checkout, text, policy)?;
        repo::git(
            checkout,
            &[
                "update-index",
                "--cacheinfo",
                &format!("100644,{blob},{path}"),
            ],
            policy,
        )?;
        repo::git(checkout, &["checkout", "--", path], policy)?;
    }
    Ok(repo::git_exact(checkout, &["ls-files", "-u", "-z"], policy)?.is_empty())
}

#[cfg(test)]
mod tests;
