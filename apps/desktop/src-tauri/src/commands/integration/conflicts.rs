//! Conflict blocks in a reconciliation worktree, read and resolved one block at a
//! time instead of by editing marker text.
//!
//! The reconciliation input is merged with `merge.conflictStyle=diff3`, so each
//! block carries the common ancestor's text as well as both sides. A resolution
//! names every block of one file once (ours, theirs, base, both or custom text);
//! the file is rewritten only when the result has no marker lines left.
//! Per-block choices follow oh-my-pi's `conflict://` resolutions (MIT); see
//! `public/licenses/oh-my-pi.txt`.

use super::repo::{self, Policy::Snapshot};
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

/// Files listed per call, and characters of each side returned per block.
const FILE_LIMIT: usize = 50;
const SIDE_LIMIT: usize = 8_000;
const FILE_BYTES: u64 = 4_000_000;

#[derive(Clone, Debug, PartialEq)]
enum Marker {
    Start,
    Base,
    Separator,
    End,
}

/// The marker a line is, as Git writes them: seven characters, then a space
/// and a label or the end of the line.
fn marker(line: &str) -> Option<Marker> {
    let line = line.trim_end_matches(['\n', '\r']);
    let (head, rest) = line.split_at(line.len().min(7));
    let labelled = rest.is_empty() || rest.starts_with(' ');
    match head {
        "<<<<<<<" if labelled => Some(Marker::Start),
        "|||||||" if labelled => Some(Marker::Base),
        "=======" if rest.is_empty() => Some(Marker::Separator),
        ">>>>>>>" if labelled => Some(Marker::End),
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Block {
    line: usize,
    ours_label: String,
    theirs_label: String,
    ours: String,
    base: Option<String>,
    theirs: String,
}

#[derive(Clone, Debug, PartialEq)]
enum Segment {
    Text(String),
    Block(Block),
}

fn label(line: &str) -> String {
    line.trim_end_matches(['\n', '\r'])
        .get(8..)
        .unwrap_or_default()
        .to_string()
}

/// Splits `text` into plain text and conflict blocks. Nested, unterminated or
/// stray markers are refused rather than guessed.
fn parse(text: &str) -> Result<Vec<Segment>, String> {
    #[derive(Clone, Copy)]
    enum Part {
        Ours,
        Base,
        Theirs,
    }
    let mut segments = vec![];
    let mut plain = String::new();
    let mut open: Option<(Block, Part)> = None;
    for (number, line) in text.split_inclusive('\n').enumerate() {
        let number = number + 1;
        let found = marker(line);
        let Some((block, part)) = open.as_mut() else {
            match found {
                Some(Marker::Start) => {
                    if !plain.is_empty() {
                        segments.push(Segment::Text(std::mem::take(&mut plain)));
                    }
                    open = Some((
                        Block {
                            line: number,
                            ours_label: label(line),
                            theirs_label: String::new(),
                            ours: String::new(),
                            base: None,
                            theirs: String::new(),
                        },
                        Part::Ours,
                    ));
                }
                Some(_) => {
                    return Err(format!(
                        "Line {number} has a conflict marker outside a conflict."
                    ))
                }
                None => plain.push_str(line),
            }
            continue;
        };
        match (found, *part) {
            (None, Part::Ours) => block.ours.push_str(line),
            (None, Part::Base) => block.base.get_or_insert_default().push_str(line),
            (None, Part::Theirs) => block.theirs.push_str(line),
            (Some(Marker::Base), Part::Ours) => {
                block.base = Some(String::new());
                *part = Part::Base;
            }
            (Some(Marker::Separator), Part::Ours | Part::Base) => *part = Part::Theirs,
            (Some(Marker::End), Part::Theirs) => {
                block.theirs_label = label(line);
                let (block, _) = open.take().expect("open conflict");
                segments.push(Segment::Block(block));
            }
            _ => {
                return Err(format!(
                    "Line {number} has a conflict marker out of order. Fix that conflict by editing the file."
                ))
            }
        }
    }
    if let Some((block, _)) = open {
        return Err(format!(
            "The conflict starting on line {} never ends.",
            block.line
        ));
    }
    if !plain.is_empty() {
        segments.push(Segment::Text(plain));
    }
    Ok(segments)
}

fn has_markers(text: &str) -> bool {
    text.split_inclusive('\n').any(|line| marker(line).is_some())
}

fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub(in crate::commands) enum Choice {
    Ours,
    Theirs,
    Base,
    /// Ours, then theirs.
    Both,
    Custom,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(in crate::commands) struct Resolution {
    #[schemars(description = "The block's index from conflicts, starting at 0.")]
    pub block: usize,
    pub choice: Choice,
    #[schemars(description = "The replacement text for choice custom, without markers.")]
    #[serde(default)]
    pub text: Option<String>,
}

/// The file's text with each block replaced as `resolutions` says. Every block
/// must be resolved exactly once.
fn resolve(text: &str, resolutions: &[Resolution]) -> Result<(String, usize), String> {
    let segments = parse(text)?;
    let blocks = segments
        .iter()
        .filter(|segment| matches!(segment, Segment::Block(_)))
        .count();
    if blocks == 0 {
        return Err("This file has no conflict blocks.".into());
    }
    let mut chosen: Vec<Option<&Resolution>> = vec![None; blocks];
    for resolution in resolutions {
        let slot = chosen.get_mut(resolution.block).ok_or_else(|| {
            format!(
                "Block {} does not exist; this file has blocks 0 to {}.",
                resolution.block,
                blocks - 1
            )
        })?;
        if slot.replace(resolution).is_some() {
            return Err(format!("Block {} is resolved twice.", resolution.block));
        }
        if (resolution.choice == Choice::Custom) != resolution.text.is_some() {
            return Err(format!(
                "Block {}: give text only, and always, with choice custom.",
                resolution.block
            ));
        }
    }
    if let Some(missing) = chosen.iter().position(Option::is_none) {
        return Err(format!(
            "Resolve every block of the file in one call; block {missing} has no resolution."
        ));
    }
    let ending = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut output = String::with_capacity(text.len());
    let mut index = 0;
    for (position, segment) in segments.iter().enumerate() {
        let block = match segment {
            Segment::Text(text) => {
                output.push_str(text);
                continue;
            }
            Segment::Block(block) => block,
        };
        let resolution = chosen[index].expect("every block resolved");
        index += 1;
        match resolution.choice {
            Choice::Ours => output.push_str(&block.ours),
            Choice::Theirs => output.push_str(&block.theirs),
            Choice::Both => {
                output.push_str(&block.ours);
                output.push_str(&block.theirs);
            }
            Choice::Base => output.push_str(block.base.as_deref().ok_or_else(|| {
                format!(
                    "Block {} has no base text to choose.",
                    resolution.block
                )
            })?),
            Choice::Custom => {
                let text = resolution.text.as_deref().unwrap_or_default();
                output.push_str(text);
                // Keep the next line on its own line.
                if !text.is_empty() && !text.ends_with('\n') && position + 1 < segments.len() {
                    output.push_str(ending);
                }
            }
        }
    }
    if has_markers(&output) {
        return Err(
            "The result would still contain conflict marker lines. Nothing was written.".into(),
        );
    }
    Ok((output, blocks))
}

/// A workspace-relative path that stays inside the workspace and names a
/// regular file, not a link.
fn inside(workspace: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    if path.is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Give a path relative to the workspace, without '..'.".into());
    }
    let root = fs::canonicalize(workspace).map_err(|e| format!("Cannot open the workspace: {e}"))?;
    let file = root.join(relative);
    let metadata =
        fs::symlink_metadata(&file).map_err(|_| format!("{path} does not exist in the workspace."))?;
    if !metadata.is_file() {
        return Err(format!("{path} is not a regular file."));
    }
    if metadata.len() > FILE_BYTES {
        return Err(format!("{path} is too large to resolve here; edit it directly."));
    }
    let real = fs::canonicalize(&file).map_err(|e| e.to_string())?;
    if !real.starts_with(&root) {
        return Err(format!("{path} is outside the workspace."));
    }
    Ok(real)
}

fn read_text(file: &Path, path: &str) -> Result<(String, String), String> {
    let bytes = fs::read(file).map_err(|e| format!("Cannot read {path}: {e}"))?;
    let digest = hash(&bytes);
    let text =
        String::from_utf8(bytes).map_err(|_| format!("{path} is not UTF-8 text; edit it directly."))?;
    Ok((text, digest))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::commands) struct BlockView {
    pub index: usize,
    pub line: usize,
    pub ours_label: String,
    pub theirs_label: String,
    pub ours: String,
    pub base: Option<String>,
    pub theirs: String,
    /// A side was cut to the character limit; resolve with custom text after
    /// reading the file if the full text matters.
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::commands) struct FileView {
    pub path: String,
    /// Pass back to `resolve_file`; it changes whenever the file does.
    pub hash: String,
    pub blocks: Vec<BlockView>,
    /// Why the file's blocks could not be read, such as an unfinished marker.
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::commands) struct Listing {
    pub files: Vec<FileView>,
    /// Conflicted files beyond the listing limit.
    pub more: usize,
}

fn clip(text: &str, truncated: &mut bool) -> String {
    match text.char_indices().nth(SIDE_LIMIT) {
        Some((end, _)) => {
            *truncated = true;
            text[..end].to_string()
        }
        None => text.to_string(),
    }
}

fn view(path: String, text: &str, digest: String) -> FileView {
    let segments = match parse(text) {
        Ok(segments) => segments,
        Err(error) => {
            return FileView {
                path,
                hash: digest,
                blocks: vec![],
                error: Some(error),
            }
        }
    };
    let blocks = segments
        .into_iter()
        .filter_map(|segment| match segment {
            Segment::Block(block) => Some(block),
            Segment::Text(_) => None,
        })
        .enumerate()
        .map(|(index, block)| {
            let mut truncated = false;
            BlockView {
                index,
                line: block.line,
                ours: clip(&block.ours, &mut truncated),
                base: block.base.as_deref().map(|base| clip(base, &mut truncated)),
                theirs: clip(&block.theirs, &mut truncated),
                ours_label: block.ours_label,
                theirs_label: block.theirs_label,
                truncated,
            }
        })
        .collect();
    FileView {
        path,
        hash: digest,
        blocks,
        error: None,
    }
}

/// Files in `workspace`, tracked or new and not ignored, with a line that starts
/// a conflict, or just `only` when given.
pub(in crate::commands) fn list(workspace: &Path, only: Option<&str>) -> Result<Listing, String> {
    let paths = match only {
        Some(path) => vec![path.to_string()],
        None => {
            let output = repo::output(
                workspace,
                &[
                    "grep",
                    "--untracked",
                    "-l",
                    "-z",
                    "-I",
                    "-E",
                    "^<<<<<<<( |$)",
                ],
                Snapshot,
            )?;
            if !output.status.success() && output.status.code() != Some(1) {
                return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
            }
            String::from_utf8_lossy(&output.stdout)
                .split('\0')
                .filter(|path| !path.is_empty())
                .map(str::to_string)
                .collect()
        }
    };
    let more = paths.len().saturating_sub(FILE_LIMIT);
    let mut files = vec![];
    for path in paths.into_iter().take(FILE_LIMIT) {
        let file = inside(workspace, &path)?;
        let (text, digest) = read_text(&file, &path)?;
        files.push(view(path, &text, digest));
    }
    Ok(Listing { files, more })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::commands) struct Resolved {
    pub path: String,
    pub resolved: usize,
    pub hash: String,
}

/// Rewrites `path` with every block resolved. `expected` is the hash `list`
/// returned, so a file edited since then is refused instead of overwritten.
pub(in crate::commands) fn resolve_file(
    workspace: &Path,
    path: &str,
    expected: &str,
    resolutions: &[Resolution],
) -> Result<Resolved, String> {
    let file = inside(workspace, path)?;
    let (text, digest) = read_text(&file, path)?;
    if digest != expected {
        return Err(format!(
            "{path} changed since its conflicts were listed. List them again."
        ));
    }
    let (output, resolved) = resolve(&text, resolutions)?;
    fs::write(&file, &output).map_err(|e| format!("Cannot write {path}: {e}"))?;
    Ok(Resolved {
        path: path.to_string(),
        resolved,
        hash: hash(output.as_bytes()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choose(block: usize, choice: Choice) -> Resolution {
        Resolution {
            block,
            choice,
            text: None,
        }
    }

    fn git(path: &Path, args: &[&str]) -> String {
        repo::git(path, args, Snapshot).unwrap()
    }

    /// A worktree checked out at a diff3 merge of two edits to the same lines,
    /// the way reconciliation input is built.
    fn conflicted() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "jackalope-conflicts-{}-{}",
            std::process::id(),
            super::super::unique_id()
        ));
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        git(&project, &["init", "--initial-branch=main"]);
        git(&project, &["config", "user.name", "Fixture"]);
        git(&project, &["config", "user.email", "fixture@example.invalid"]);
        git(&project, &["config", "core.autocrlf", "false"]);
        fs::write(project.join("app.txt"), "top\nvalue = 1\nmiddle\n\n\n\n\nlimit = 5\nend\n").unwrap();
        fs::write(project.join("clean.txt"), "untouched\n").unwrap();
        git(&project, &["add", "."]);
        git(&project, &["commit", "-m", "base"]);
        git(&project, &["checkout", "-b", "theirs"]);
        fs::write(project.join("app.txt"), "top\nvalue = 3\nmiddle\n\n\n\n\nlimit = 9\nend\n").unwrap();
        git(&project, &["commit", "-am", "theirs"]);
        git(&project, &["checkout", "main"]);
        fs::write(project.join("app.txt"), "top\nvalue = 2\nmiddle\n\n\n\n\nlimit = 7\nend\n").unwrap();
        git(&project, &["commit", "-am", "ours"]);
        let output = repo::output(
            &project,
            &["-c", "merge.conflictStyle=diff3", "merge-tree", "--write-tree", "main", "theirs"],
            Snapshot,
        )
        .unwrap();
        assert_eq!(output.status.code(), Some(1));
        let tree = String::from_utf8_lossy(&output.stdout).lines().next().unwrap().to_string();
        let commit = git(&project, &["commit-tree", &tree, "-m", "combined"]);
        let workspace = root.join("workspace");
        git(
            &project,
            &["worktree", "add", "--detach", workspace.to_str().unwrap(), &commit],
        );
        (root, workspace)
    }

    #[test]
    fn diff3_blocks_list_both_sides_and_the_base() {
        let (root, workspace) = conflicted();
        let listing = list(&workspace, None).unwrap();
        assert_eq!(listing.files.len(), 1);
        let file = &listing.files[0];
        assert_eq!(file.path, "app.txt");
        assert!(file.error.is_none());
        assert_eq!(file.blocks.len(), 2);
        let first = &file.blocks[0];
        assert_eq!((first.index, first.line), (0, 2));
        assert_eq!(first.ours, "value = 2\n");
        assert_eq!(first.theirs, "value = 3\n");
        assert_eq!(first.base.as_deref(), Some("value = 1\n"));
        assert_eq!(first.ours_label, "main");
        assert_eq!(first.theirs_label, "theirs");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolutions_rewrite_the_file_without_markers_and_refuse_stale_or_partial_input() {
        let (root, workspace) = conflicted();
        let listing = list(&workspace, None).unwrap();
        let hash = listing.files[0].hash.clone();
        let error =
            resolve_file(&workspace, "app.txt", &hash, &[choose(0, Choice::Ours)]).unwrap_err();
        assert!(error.contains("block 1 has no resolution"), "{error}");
        let error = resolve_file(
            &workspace,
            "app.txt",
            &hash,
            &[choose(0, Choice::Ours), choose(0, Choice::Theirs)],
        )
        .unwrap_err();
        assert!(error.contains("twice"), "{error}");
        let error = resolve_file(
            &workspace,
            "app.txt",
            &hash,
            &[
                choose(0, Choice::Ours),
                Resolution {
                    block: 1,
                    choice: Choice::Custom,
                    text: Some("<<<<<<< sneaky\n".into()),
                },
            ],
        )
        .unwrap_err();
        assert!(error.contains("marker"), "{error}");
        assert!(resolve_file(&workspace, "app.txt", "stale", &[]).is_err());
        assert!(resolve_file(&workspace, "../project/app.txt", &hash, &[]).is_err());

        let done = resolve_file(
            &workspace,
            "app.txt",
            &hash,
            &[
                choose(0, Choice::Base),
                Resolution {
                    block: 1,
                    choice: Choice::Custom,
                    text: Some("limit = 8".into()),
                },
            ],
        )
        .unwrap();
        assert_eq!(done.resolved, 2);
        assert_eq!(
            fs::read_to_string(workspace.join("app.txt")).unwrap(),
            "top\nvalue = 1\nmiddle\n\n\n\n\nlimit = 8\nend\n"
        );
        assert!(list(&workspace, None).unwrap().files.is_empty());
        // The integration gate's own marker search agrees.
        let gate = repo::output(
            &workspace,
            &["grep", "-n", "-I", "-E", "^(<<<<<<< |=======$|>>>>>>> )"],
            Snapshot,
        )
        .unwrap();
        assert_eq!(gate.status.code(), Some(1));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn both_keeps_ours_then_theirs_and_two_way_blocks_have_no_base() {
        let text = "a\n<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\nb\n";
        let (output, count) = resolve(text, &[choose(0, Choice::Both)]).unwrap();
        assert_eq!((output.as_str(), count), ("a\nx\ny\nb\n", 1));
        assert!(resolve(text, &[choose(0, Choice::Base)])
            .unwrap_err()
            .contains("no base"));
        assert!(parse("a\n=======\nb\n").is_err());
        assert!(parse("<<<<<<< a\nx\n=======\ny\n").is_err());
        assert!(parse("<<<<<<< a\n<<<<<<< b\n").is_err());
        // Seven equals signs followed by text are content, not a separator.
        assert_eq!(parse("======= heading\n").unwrap().len(), 1);
    }
}
