//! Workspaces that travel as Git bundles (runner capability `git-sync`).
//!
//! The runner keeps one bare repository per project (keyed by the local
//! repository's common directory) and reports which base commits it holds.
//! [`prepare`] records the workspace's uncommitted state as a synthetic
//! snapshot commit on its `HEAD` and bundles it without anything the runner
//! already has, so a retry or a later attempt sends only what changed. All of
//! this happens in a scratch repository that borrows the workspace's objects
//! through `objects/info/alternates`: the snapshot's objects, its ref and the
//! index used to build it never enter the person's repository, so the
//! snapshot cannot appear in their history. Copied setup files and Jackalope
//! context are ignored by Git, so they go beside the bundle as a small tar.
//!
//! The result comes back as a bundle of the agent's commits plus a synthetic
//! commit of its uncommitted work, and the uploaded snapshot, against the
//! base. [`result_patch`] diffs snapshot to result, which is the same binary
//! patch the tar path returns, in another scratch
//! repository, and [`super::runs::apply`] applies it with the same guarantees:
//! context excluded, all or nothing, only `git apply` in the workspace.
//! `.jackalope/artifacts` output comes back separately as artifacts.
//!
//! A workspace that a bundle cannot represent faithfully (not its own
//! repository, no commits yet, shallow or partial clones, SHA-256 object
//! format, Git filters such as LFS, or history above the upload limit) goes
//! as files instead; [`Prepared::Archive`] says why.

use super::artifacts::{self, Digest};
use super::protocol::protocol;
use super::runs::Session;
use crate::commands::{git_command, process_control};
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

const GIT_TIMEOUT: Duration = Duration::from_secs(600);
const SYNC_TIMEOUT: Duration = Duration::from_secs(660);
/// Where an agent's saved output lives in a workspace.
pub(crate) const ARTIFACT_FOLDER: &str = ".jackalope/artifacts/";
/// The commit identity the runner also uses, as Git environment variables.
fn identity() -> [(&'static str, &'static str); 4] {
    let identity = &protocol().git_identity;
    [
        ("GIT_AUTHOR_NAME", &identity.name),
        ("GIT_AUTHOR_EMAIL", &identity.email),
        ("GIT_COMMITTER_NAME", &identity.name),
        ("GIT_COMMITTER_EMAIL", &identity.email),
    ]
}

/// A temporary bare repository, removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    /// A bare repository whose object lookups fall back to `objects`.
    fn borrowing(objects: &Path) -> Result<Self, String> {
        let path =
            std::env::temp_dir().join(format!("jackalope-sync-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        let scratch = Self(path);
        git(&scratch.0, &["init", "-q", "--bare", "."], &[])?;
        let alternates = scratch.0.join("objects").join("info").join("alternates");
        // Git reads forward slashes on every platform.
        let target = objects.to_string_lossy().replace('\\', "/");
        std::fs::write(alternates, format!("{target}\n")).map_err(|e| e.to_string())?;
        Ok(scratch)
    }

    fn git(&self, args: &[&str]) -> Result<String, String> {
        git(&self.0, args, &[("GIT_DIR", self.0.as_os_str())])
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Runs Git with a time limit, isolated from the caller's `GIT_DIR`, and
/// returns its trimmed standard output.
fn git(cwd: &Path, args: &[&str], env: &[(&str, &std::ffi::OsStr)]) -> Result<String, String> {
    let mut command = git_command::command(cwd, args, git_command::Policy::Isolated);
    command.env("GIT_TERMINAL_PROMPT", "0");
    for (name, value) in env {
        command.env(name, value);
    }
    let result = process_control::run(command, GIT_TIMEOUT)?;
    let name = args
        .iter()
        .find(|arg| !arg.starts_with('-') && !arg.contains('='))
        .unwrap_or(&"");
    if result.timed_out {
        return Err(format!("git {name} took too long"));
    }
    if !result.success {
        let detail: String = result.stderr.trim().chars().take(300).collect();
        return Err(format!("git {name} failed: {detail}"));
    }
    Ok(result.stdout.trim().to_string())
}

fn is_object_id(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn same_folder(left: &Path, right: &Path) -> bool {
    match (dunce::canonicalize(left), dunce::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

/// The local repository's object directory and the runner's name for it.
fn repository(workspace: &Path) -> Result<(PathBuf, String), String> {
    let common = git(
        workspace,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        &[],
    )?;
    let common = dunce::canonicalize(&common).map_err(|e| e.to_string())?;
    let mut name = common.to_string_lossy().replace('\\', "/");
    if cfg!(any(windows, target_os = "macos")) {
        name = name.to_lowercase();
    }
    let digest = Sha256::digest(name.as_bytes());
    let key: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
    Ok((common.join("objects"), format!("p{key}")))
}

/// Why this workspace cannot travel as a bundle, if it cannot.
fn unsuitable(workspace: &Path) -> Option<String> {
    let Ok(top) = git(workspace, &["rev-parse", "--show-toplevel"], &[]) else {
        return Some("it is not a Git repository".into());
    };
    if !same_folder(Path::new(&top), workspace) {
        return Some("it is a folder inside another repository".into());
    }
    if git(
        workspace,
        &["rev-parse", "--verify", "-q", "HEAD^{commit}"],
        &[],
    )
    .is_err()
    {
        return Some("its repository has no commits yet".into());
    }
    if git(workspace, &["rev-parse", "--show-object-format"], &[]).as_deref() != Ok("sha1") {
        return Some("its repository uses SHA-256 object names".into());
    }
    if git(workspace, &["rev-parse", "--is-shallow-repository"], &[]).as_deref() != Ok("false") {
        return Some("it is a shallow clone".into());
    }
    if git(
        workspace,
        &["config", "--get", "extensions.partialclone"],
        &[],
    )
    .is_ok_and(|value| !value.is_empty())
    {
        return Some("it is a partial clone".into());
    }
    if uses_filters(workspace) {
        return Some("it uses Git filters such as LFS, whose files a bundle does not carry".into());
    }
    None
}

/// Whether any attributes file assigns a filter (Git LFS and similar), whose
/// working files differ from what Git stores.
fn uses_filters(workspace: &Path) -> bool {
    let mut files: Vec<PathBuf> = git(
        workspace,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--",
            ".gitattributes",
            "*/.gitattributes",
        ],
        &[],
    )
    .unwrap_or_default()
    .split('\0')
    .filter(|name| !name.is_empty())
    .map(|name| workspace.join(name))
    .collect();
    if let Ok(path) = git(
        workspace,
        &["rev-parse", "--git-path", "info/attributes"],
        &[],
    ) {
        files.push(workspace.join(path));
    }
    if let Ok(path) = git(
        workspace,
        &["config", "--path", "--get", "core.attributesfile"],
        &[],
    ) {
        files.push(PathBuf::from(path));
    }
    files.iter().any(|path| {
        std::fs::read_to_string(path).is_ok_and(|text| {
            text.lines()
                .any(|line| !line.trim_start().starts_with('#') && line.contains("filter="))
        })
    })
}

/// A workspace ready to send as a bundle.
pub(crate) struct Upload {
    _scratch: Scratch,
    pub bundle: PathBuf,
    pub base: String,
    pub snapshot: String,
    pub repo: String,
    /// The side tar of copied setup files and Jackalope context.
    pub extras: Option<std::fs::File>,
    /// The bundle leaves out commits the runner already has.
    pub delta: bool,
}

pub(crate) enum Prepared {
    Bundle(Upload),
    /// The workspace goes as a tar, for this reason.
    Archive(String),
}

/// The runner's name for this workspace's repository, or `None` when the
/// workspace is not a repository of its own.
pub(crate) fn repo_key(workspace: &Path) -> Option<String> {
    repository(workspace).ok().map(|(_, key)| key)
}

/// Builds the bundle for a workspace: its `HEAD` and a synthetic commit of its
/// tracked and untracked files that Git does not ignore, without the commits
/// in `have` that this repository also has.
pub(crate) fn prepare(
    workspace: &Path,
    setup: &[String],
    have: &[String],
) -> Result<Prepared, String> {
    if let Some(reason) = unsuitable(workspace) {
        return Ok(Prepared::Archive(reason));
    }
    let (objects, repo) = repository(workspace)?;
    let base = git(workspace, &["rev-parse", "--verify", "HEAD^{commit}"], &[])?;
    let scratch = Scratch::borrowing(&objects)?;
    let known = present(&scratch, have)?;
    if known.is_empty() && history_bytes(workspace) > protocol().transfer.upload {
        return Ok(Prepared::Archive(
            "its Git history is larger than 512 MB; later attempts can send it as a bundle once the computer has it"
                .into(),
        ));
    }
    let index = scratch.0.join("snapshot.index");
    let scratch_objects = scratch.0.join("objects");
    // Objects are written to the scratch repository only; reads fall back to
    // the workspace's own through the alternates file.
    let mut env: Vec<(&str, &std::ffi::OsStr)> = vec![
        ("GIT_INDEX_FILE", index.as_os_str()),
        ("GIT_OBJECT_DIRECTORY", scratch_objects.as_os_str()),
    ];
    git(workspace, &["read-tree", &base], &env)?;
    git(workspace, &["add", "-A"], &env)?;
    let tree = git(workspace, &["write-tree"], &env)?;
    env.extend(
        identity()
            .into_iter()
            .map(|(name, value)| (name, std::ffi::OsStr::new(value))),
    );
    let snapshot = git(
        workspace,
        &[
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            &tree,
            "-p",
            &base,
            "-m",
            "Jackalope workspace snapshot",
        ],
        &env,
    )?;
    if !is_object_id(&snapshot) {
        return Err("Git did not record the workspace snapshot.".into());
    }
    scratch.git(&["update-ref", "refs/heads/snapshot", &snapshot])?;
    let bundle = scratch.0.join("upload.bundle");
    let bundle_arg = bundle.to_string_lossy().into_owned();
    let mut args = vec!["bundle", "create", "-q", &bundle_arg, "refs/heads/snapshot"];
    if !known.is_empty() {
        args.push("--not");
        args.extend(known.iter().map(String::as_str));
    }
    scratch.git(&args)?;
    let size = std::fs::metadata(&bundle).map_err(|e| e.to_string())?.len();
    if size > protocol().transfer.upload {
        return Ok(Prepared::Archive(
            "its Git bundle would be larger than 512 MB".into(),
        ));
    }
    let extras = super::runs::extras_archive(workspace, setup)?;
    Ok(Prepared::Bundle(Upload {
        _scratch: scratch,
        bundle,
        base,
        snapshot,
        repo,
        extras,
        delta: !known.is_empty(),
    }))
}

/// The commits of `have` that this repository holds, so they can be left out
/// of the bundle as prerequisites the runner already has.
fn present(scratch: &Scratch, have: &[String]) -> Result<Vec<String>, String> {
    let candidates: Vec<&String> = have
        .iter()
        .filter(|id| is_object_id(id))
        .take(protocol().sync.known_bases)
        .collect();
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let mut command = git_command::command(
        &scratch.0,
        &["cat-file", "--batch-check=%(objectname) %(objecttype)"],
        git_command::Policy::Isolated,
    );
    command.env("GIT_DIR", &scratch.0);
    let input: String = candidates.iter().map(|id| format!("{id}\n")).collect();
    let result = process_control::run_with_input(command, GIT_TIMEOUT, input.into_bytes())?;
    if !result.success {
        return Err("Git could not check which commits the computer has.".into());
    }
    Ok(result
        .stdout
        .lines()
        .filter_map(|line| line.strip_suffix(" commit"))
        .filter(|id| candidates.iter().any(|candidate| candidate == id))
        .map(str::to_string)
        .collect())
}

/// Approximate size of the repository's stored history.
fn history_bytes(workspace: &Path) -> u64 {
    let counted = git(workspace, &["count-objects", "-v"], &[]).unwrap_or_default();
    counted
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(": ")?;
            ["size", "size-pack"]
                .contains(&key)
                .then(|| value.trim().parse::<u64>().ok())
                .flatten()
        })
        .sum::<u64>()
        * 1024
}

/// The binary patch from the uploaded snapshot (`from`) to the result commit,
/// both in a bundle from the computer, so the workspace's own uncommitted
/// changes are not applied twice. The bundle may only need commits this
/// workspace has.
pub(crate) fn result_patch(
    workspace: &Path,
    bundle: &Path,
    result: &str,
    from: &str,
) -> Result<Vec<u8>, String> {
    if !is_object_id(result) || !is_object_id(from) {
        return Err("The computer named its result without valid commits.".into());
    }
    let (objects, _) = repository(workspace)?;
    let scratch = Scratch::borrowing(&objects)?;
    let bundle = bundle.to_string_lossy().into_owned();
    scratch
        .git(&["bundle", "verify", "-q", &bundle])
        .map_err(|error| {
            format!("The changes from the computer do not fit this workspace: {error}")
        })?;
    scratch.git(&[
        "fetch",
        "-q",
        "--no-tags",
        &bundle,
        "+refs/*:refs/incoming/*",
    ])?;
    for commit in [result, from] {
        if scratch
            .git(&[
                "rev-parse",
                "--verify",
                "-q",
                &format!("{commit}^{{commit}}"),
            ])
            .as_deref()
            != Ok(commit)
        {
            return Err("The computer's bundle does not hold its result.".into());
        }
    }
    let patch = scratch.0.join("result.patch");
    let output = format!("--output={}", patch.to_string_lossy());
    scratch.git(&[
        "diff",
        "--binary",
        "--full-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--no-relative",
        "--submodule=short",
        "--ignore-submodules=none",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        &output,
        from,
        result,
    ])?;
    let size = std::fs::metadata(&patch).map_err(|e| e.to_string())?.len();
    if size > protocol().transfer.patch as u64 {
        return Err("The agent changed more than 256 MB of files.".into());
    }
    std::fs::read(&patch).map_err(|e| e.to_string())
}

/// How a workspace went to the computer.
pub(crate) enum Sent {
    Bundle { bytes: u64, delta: bool },
    Archive(String),
}

/// One file the agent saved under `.jackalope/artifacts`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Artifact {
    pub path: String,
    pub digest: Digest,
}

/// A run's changes, ready to apply.
pub(crate) struct Collected {
    pub patch: Vec<u8>,
    pub artifacts: Vec<Artifact>,
    /// The computer listed only some of the agent's saved output.
    pub truncated: bool,
}

impl Collected {
    pub fn from_patch(patch: Vec<u8>) -> Self {
        Self {
            patch,
            artifacts: Vec::new(),
            truncated: false,
        }
    }
}

/// Whether a returned artifact path is a plain file under the artifact folder.
fn safe_artifact_path(path: &str) -> bool {
    path.strip_prefix(ARTIFACT_FOLDER).is_some_and(|rest| {
        !rest.is_empty()
            && !path.contains(['\\', ':', '\0'])
            && rest
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != "..")
    })
}

pub(crate) fn parse_artifacts(value: &Value) -> Result<Vec<Artifact>, String> {
    let mut artifacts = Vec::new();
    let mut total = 0u64;
    for item in value.as_array().into_iter().flatten() {
        let path = item["path"].as_str().unwrap_or_default();
        if !safe_artifact_path(path) {
            return Err(format!(
                "The computer returned an unsafe artifact path: {}",
                path.chars().take(200).collect::<String>()
            ));
        }
        let digest = Digest::parse(item)?;
        total += digest.size;
        if artifacts.len() >= protocol().sync.result_artifacts
            || total > protocol().sync.result_artifact_bytes
        {
            return Err("The computer returned more saved output than Jackalope accepts.".into());
        }
        artifacts.push(Artifact {
            path: path.into(),
            digest,
        });
    }
    Ok(artifacts)
}

/// Where an artifact goes under `root`, refusing links on the way so output
/// cannot be written outside it.
fn destination(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut current = root.to_path_buf();
    let parts: Vec<&str> = relative.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("{relative} is behind a link in the workspace."))
            }
            Ok(metadata) if index + 1 < parts.len() && !metadata.is_dir() => {
                return Err(format!("{relative} is behind a file in the workspace."))
            }
            Ok(_) => {}
            Err(_) if index + 1 < parts.len() => {
                std::fs::create_dir(&current).map_err(|e| e.to_string())?
            }
            Err(_) => {}
        }
    }
    Ok(current)
}

impl Session {
    /// Sends the workspace as a bundle with only what the computer lacks, and
    /// checks the run's workspace out from it. Returns [`Sent::Archive`] when
    /// the workspace must go as a tar instead.
    pub fn sync_upload(
        &mut self,
        workspace: &Path,
        setup: &[String],
        progress: &dyn Fn(u64, u64),
    ) -> Result<Sent, String> {
        let Some(repo) = repo_key(workspace) else {
            return Ok(Sent::Archive("it is not a Git repository".into()));
        };
        let status = self.call(
            json!({"action":"sync_status","repo":repo}),
            super::runs::CALL_TIMEOUT,
        )?;
        let have: Vec<String> = status["have"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str().map(str::to_string))
            .collect();
        let mut upload = match prepare(workspace, setup, &have)? {
            Prepared::Archive(reason) => return Ok(Sent::Archive(reason)),
            Prepared::Bundle(upload) => upload,
        };
        let bundle = self.put_artifact_file(&upload.bundle, progress)?;
        let extras = match upload.extras.as_mut() {
            Some(file) => Some(self.put_artifact(file, &|_, _| {})?.sha256),
            None => None,
        };
        self.call(
            json!({
                "action": "sync_checkout",
                "repo": upload.repo,
                "bundle": bundle.sha256,
                "base": upload.base,
                "snapshot": upload.snapshot,
                "extras": extras,
            }),
            SYNC_TIMEOUT,
        )?;
        self.synced = true;
        Ok(Sent::Bundle {
            bytes: bundle.size,
            delta: upload.delta,
        })
    }

    /// The run's changes: from its result bundle when it was synced, otherwise
    /// the binary patch of the tar path.
    pub fn collect_changes(&mut self, workspace: &Path) -> Result<Collected, String> {
        if !self.synced {
            return self.collect().map(Collected::from_patch);
        }
        let result = self.call(json!({"action":"sync_result"}), SYNC_TIMEOUT)?;
        let bundle = Digest::parse(&result["bundle"])?;
        if bundle.size > protocol().transfer.patch as u64 {
            return Err("The agent changed more than 256 MB of files.".into());
        }
        let artifacts = parse_artifacts(&result["artifacts"])?;
        let file = super::runs::tempfile_path("bundle");
        let fetched = self.fetch_artifact(&bundle, &file);
        let patch = fetched.and_then(|()| {
            result_patch(
                workspace,
                &file,
                result["result"].as_str().unwrap_or_default(),
                result["snapshot"].as_str().unwrap_or_default(),
            )
        });
        let _ = std::fs::remove_file(&file);
        Ok(Collected {
            patch: patch?,
            artifacts,
            truncated: result["artifactsTruncated"] == true,
        })
    }

    /// Fetches artifacts into `root` (the workspace, or a folder beside the
    /// attempt's history). Files already there with the same content are
    /// kept. Returns how many were written.
    pub fn fetch_artifacts(&mut self, root: &Path, list: &[Artifact]) -> Result<usize, String> {
        let mut written = 0;
        if !list.is_empty() {
            std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        }
        for artifact in list {
            let path = destination(root, &artifact.path)?;
            if path.is_file() && artifacts::digest_file(&path).as_ref() == Ok(&artifact.digest) {
                continue;
            }
            self.fetch_artifact(&artifact.digest, &path)?;
            written += 1;
        }
        Ok(written)
    }
}

#[cfg(test)]
mod tests;
