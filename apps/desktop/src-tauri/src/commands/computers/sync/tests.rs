use super::*;
use crate::commands::computers::{
    artifacts::tests::{Fake, Store},
    runs, Transport,
};
use std::{
    collections::HashMap,
    io::Seek,
    sync::{atomic::AtomicBool, Arc, Mutex},
};

struct Folder(PathBuf);

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn folder() -> Folder {
    let path = std::env::temp_dir().join(format!("jackalope-sync-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).unwrap();
    Folder(dunce::canonicalize(&path).unwrap())
}

fn run_git(path: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "core.autocrlf=false",
        ])
        .args([
            "-c",
            "init.defaultBranch=main",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn write(path: &Path, name: &str, data: &[u8]) {
    let path = path.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, data).unwrap();
}

fn read(path: &Path, name: &str) -> String {
    std::fs::read_to_string(path.join(name))
        .unwrap()
        .replace("\r\n", "\n")
}

/// A person's repository with a committed base, then uncommitted changes, an
/// ignored setup file and Jackalope context.
fn local(root: &Path) -> (PathBuf, String) {
    let path = root.join("local");
    std::fs::create_dir_all(&path).unwrap();
    run_git(&path, &["init", "-q"]);
    write(&path, ".gitignore", b".env.local\n.jackalope/\n");
    write(&path, "a.txt", b"one\n");
    write(&path, "gone.txt", b"bye\n");
    let noise: Vec<u8> = (0..300_000u32)
        .map(|n| (n.wrapping_mul(2_654_435_761) >> 13) as u8)
        .collect();
    write(&path, "big.bin", &noise);
    run_git(&path, &["add", "-A"]);
    run_git(&path, &["commit", "-qm", "base"]);
    let base = run_git(&path, &["rev-parse", "HEAD"]);
    write(&path, "a.txt", b"two\n");
    write(&path, "new.txt", b"new\n");
    std::fs::remove_file(path.join("gone.txt")).unwrap();
    write(&path, ".env.local", b"KEY=1\n");
    write(&path, ".jackalope/cloudflare.json", b"{\"version\":1}");
    (path, base)
}

/// The runner's side, as agent.py does it, in one project repository.
struct Runner {
    repo: PathBuf,
    runs: PathBuf,
    extras: HashMap<String, Vec<String>>,
    bases: HashMap<String, String>,
}

impl Runner {
    fn new(root: &Path) -> Self {
        let repo = root.join("runner.git");
        Self {
            runs: root.join("runs"),
            repo,
            extras: HashMap::new(),
            bases: HashMap::new(),
        }
    }

    fn workspace(&self, run: &str) -> PathBuf {
        self.runs.join(run)
    }

    fn have(&self) -> Vec<String> {
        if !self.repo.exists() {
            return Vec::new();
        }
        run_git(
            &self.repo,
            &[
                "for-each-ref",
                "--format=%(objectname)",
                "refs/jackalope/base/",
            ],
        )
        .split_whitespace()
        .map(str::to_string)
        .collect()
    }

    fn checkout(
        &mut self,
        run: &str,
        bundle: &Path,
        base: &str,
        snapshot: &str,
        extras: Option<&[u8]>,
    ) {
        if !self.repo.exists() {
            std::fs::create_dir_all(&self.repo).unwrap();
            run_git(&self.repo, &["init", "-q", "--bare"]);
        }
        std::fs::write(self.repo.join("info").join("exclude"), "/.jackalope/\n").unwrap();
        let bundle = bundle.to_string_lossy().into_owned();
        run_git(&self.repo, &["bundle", "verify", "-q", &bundle]);
        run_git(
            &self.repo,
            &[
                "fetch",
                "-q",
                &bundle,
                &format!("+refs/heads/*:refs/jackalope/incoming/{run}/*"),
            ],
        );
        assert_eq!(
            run_git(&self.repo, &["rev-parse", &format!("{snapshot}^1")]),
            base
        );
        run_git(
            &self.repo,
            &["update-ref", &format!("refs/jackalope/base/{base}"), base],
        );
        let workspace = self.workspace(run);
        let target = workspace.to_string_lossy().into_owned();
        run_git(
            &self.repo,
            &[
                "worktree",
                "add",
                "-q",
                "-f",
                "-B",
                &format!("jackalope/{run}"),
                &target,
                base,
            ],
        );
        run_git(&workspace, &["read-tree", "-u", "--reset", snapshot]);
        run_git(&workspace, &["reset", "-q"]);
        let mut names = Vec::new();
        if let Some(extras) = extras {
            let mut archive = tar::Archive::new(std::io::Cursor::new(extras));
            for entry in archive.entries().unwrap() {
                let mut entry = entry.unwrap();
                let name = entry.path().unwrap().to_string_lossy().replace('\\', "/");
                assert!(!name.starts_with('/') && !name.contains(".."));
                let path = workspace.join(&name);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                entry.unpack(&path).unwrap();
                names.push(name);
            }
        }
        self.extras.insert(run.into(), names);
        self.bases.insert(run.into(), base.into());
    }

    /// The result bundle and its commit.
    fn result(&self, run: &str) -> (Vec<u8>, String) {
        let workspace = self.workspace(run);
        let index = self.runs.join(format!("{run}.index"));
        let index_env = index.to_string_lossy().into_owned();
        let with_index = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .args([
                    "-c",
                    "user.name=t",
                    "-c",
                    "user.email=t@t",
                    "-c",
                    "core.autocrlf=false",
                ])
                .args(args)
                .env("GIT_INDEX_FILE", &index_env)
                .env("GIT_LITERAL_PATHSPECS", "1")
                .current_dir(&workspace)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        with_index(&["read-tree", "HEAD"]);
        with_index(&["add", "-A"]);
        let mut dropped = self.extras[run].clone();
        dropped.retain(|name| !name.starts_with(".jackalope/"));
        if !dropped.is_empty() {
            let mut args = vec!["rm", "--cached", "-q", "--ignore-unmatch", "--"];
            args.extend(dropped.iter().map(String::as_str));
            with_index(&args);
        }
        let tree = with_index(&["write-tree"]);
        let result = with_index(&["commit-tree", &tree, "-p", "HEAD", "-m", "result"]);
        let reference = format!("refs/jackalope/result/{run}");
        run_git(&workspace, &["update-ref", &reference, &result]);
        let bundle = self.runs.join(format!("{run}.bundle"));
        let path = bundle.to_string_lossy().into_owned();
        let snapshot = format!("refs/jackalope/incoming/{run}/snapshot");
        run_git(
            &workspace,
            &[
                "bundle",
                "create",
                "-q",
                &path,
                &reference,
                &snapshot,
                "--not",
                &self.bases[run],
            ],
        );
        (std::fs::read(bundle).unwrap(), result)
    }
}

fn bundle_of(upload: &Upload) -> Vec<u8> {
    std::fs::read(&upload.bundle).unwrap()
}

fn extras_of(upload: &mut Upload) -> Option<Vec<u8>> {
    upload.extras.as_mut().map(|file| {
        file.seek(std::io::SeekFrom::Start(0)).unwrap();
        let mut data = Vec::new();
        std::io::Read::read_to_end(file, &mut data).unwrap();
        data
    })
}

fn ready(prepared: Prepared) -> Upload {
    match prepared {
        Prepared::Bundle(upload) => upload,
        Prepared::Archive(reason) => panic!("went as files: {reason}"),
    }
}

/// Applies a runner's result to the local workspace as the device does.
fn bring_back(
    local: &Path,
    root: &Path,
    bundle: &[u8],
    result: &str,
    from: &str,
) -> Result<(), String> {
    let file = root.join(format!("{}.bundle", uuid::Uuid::new_v4().simple()));
    std::fs::write(&file, bundle).unwrap();
    let patch = result_patch(local, &file, result, from)?;
    runs::apply(local, &patch)
}

#[test]
fn bundle_round_trip_carries_history_uncommitted_work_and_results() {
    let root = folder();
    let (local, base) = local(&root.0);
    let mut upload = ready(prepare(&local, &[".env.local".into()], &[]).unwrap());
    assert_eq!(upload.base, base);
    assert!(!upload.delta);
    let extras = extras_of(&mut upload).unwrap();
    let mut runner = Runner::new(&root.0);
    let bundle = root.0.join("upload.bundle");
    std::fs::write(&bundle, bundle_of(&upload)).unwrap();
    runner.checkout("w1", &bundle, &upload.base, &upload.snapshot, Some(&extras));
    let remote = runner.workspace("w1");
    assert_eq!(read(&remote, "a.txt"), "two\n");
    assert_eq!(read(&remote, "new.txt"), "new\n");
    assert_eq!(read(&remote, ".env.local"), "KEY=1\n");
    assert_eq!(
        read(&remote, ".jackalope/cloudflare.json"),
        "{\"version\":1}"
    );
    assert!(!remote.join("gone.txt").exists());
    assert_eq!(run_git(&remote, &["rev-parse", "HEAD"]), base);
    assert!(run_git(&remote, &["log", "--format=%s"]).contains("base"));

    // The agent commits, leaves work uncommitted and edits setup and context.
    write(&remote, "a.txt", b"three\n");
    run_git(&remote, &["commit", "-qam", "agent"]);
    write(&remote, "b.txt", b"b\n");
    write(&remote, ".env.local", b"KEY=2\n");
    write(&remote, ".jackalope/cloudflare.json", b"changed");
    let (bundle, result) = runner.result("w1");
    bring_back(&local, &root.0, &bundle, &result, &upload.snapshot).unwrap();
    assert_eq!(read(&local, "a.txt"), "three\n");
    assert_eq!(read(&local, "b.txt"), "b\n");
    assert_eq!(read(&local, "new.txt"), "new\n");
    assert!(!local.join("gone.txt").exists());
    assert_eq!(read(&local, ".env.local"), "KEY=1\n");
    assert_eq!(
        read(&local, ".jackalope/cloudflare.json"),
        "{\"version\":1}"
    );
}

#[test]
fn later_attempts_send_only_what_the_computer_lacks() {
    let root = folder();
    let (local, base) = local(&root.0);
    let full = ready(prepare(&local, &[], &[]).unwrap());
    let mut runner = Runner::new(&root.0);
    let first = root.0.join("first.bundle");
    std::fs::write(&first, bundle_of(&full)).unwrap();
    runner.checkout("w1", &first, &full.base, &full.snapshot, None);
    assert_eq!(runner.have(), [base.clone()]);

    write(&local, "a.txt", b"retry\n");
    let unknown = "0123456789abcdef0123456789abcdef01234567".to_string();
    let have = vec![unknown, "not a commit".into(), base.clone()];
    let delta = ready(prepare(&local, &[], &have).unwrap());
    assert!(delta.delta);
    let (full_size, delta_size) = (bundle_of(&full).len(), bundle_of(&delta).len());
    assert!(delta_size * 10 < full_size, "{delta_size} vs {full_size}");
    let second = root.0.join("second.bundle");
    std::fs::write(&second, bundle_of(&delta)).unwrap();
    runner.checkout("w2", &second, &delta.base, &delta.snapshot, None);
    assert_eq!(read(&runner.workspace("w2"), "a.txt"), "retry\n");

    // After a checkpoint commit the earlier base is still a prerequisite.
    run_git(&local, &["add", "-A"]);
    run_git(&local, &["commit", "-qm", "checkpoint"]);
    let next = ready(prepare(&local, &[], &runner.have()).unwrap());
    assert!(next.delta);
    assert!(bundle_of(&next).len() * 10 < full_size);
}

#[test]
fn the_snapshot_never_enters_the_persons_repository() {
    let root = folder();
    let (local, _) = local(&root.0);
    let observe = || {
        (
            run_git(
                &local,
                &["for-each-ref", "--format=%(refname) %(objectname)"],
            ),
            run_git(&local, &["log", "--all", "--reflog", "--format=%H"]),
            run_git(&local, &["--no-optional-locks", "status", "--porcelain"]),
            run_git(&local, &["count-objects", "-v"]),
            run_git(&local, &["stash", "list"]),
            std::fs::read(local.join(".git").join("index")).unwrap(),
        )
    };
    let before = observe();
    let upload = ready(prepare(&local, &[], &[]).unwrap());
    assert_eq!(observe(), before);
    let missing = std::process::Command::new("git")
        .args(["cat-file", "-e", &upload.snapshot])
        .current_dir(&local)
        .output()
        .unwrap();
    assert!(
        !missing.status.success(),
        "the snapshot commit is not in the person's objects"
    );

    let mut runner = Runner::new(&root.0);
    let bundle = root.0.join("upload.bundle");
    std::fs::write(&bundle, bundle_of(&upload)).unwrap();
    runner.checkout("w1", &bundle, &upload.base, &upload.snapshot, None);
    write(&runner.workspace("w1"), "c.txt", b"c\n");
    let (bundle, result) = runner.result("w1");
    bring_back(&local, &root.0, &bundle, &result, &upload.snapshot).unwrap();
    let after = observe();
    assert_eq!(
        (&after.0, &after.1, &after.3, &after.4, &after.5),
        (&before.0, &before.1, &before.3, &before.4, &before.5)
    );
    assert!(after.2.contains("?? c.txt"), "{}", after.2);
}

#[test]
fn context_stays_out_and_conflicts_or_bad_bundles_leave_the_workspace_unchanged() {
    let root = folder();
    let (local, base) = local(&root.0);
    let upload = ready(prepare(&local, &[], &[]).unwrap());
    let mut runner = Runner::new(&root.0);
    let bundle = root.0.join("upload.bundle");
    std::fs::write(&bundle, bundle_of(&upload)).unwrap();
    runner.checkout("w1", &bundle, &upload.base, &upload.snapshot, None);
    let remote = runner.workspace("w1");
    // An agent that force-commits context still cannot change it here.
    write(&remote, ".jackalope/cloudflare.json", b"tampered");
    write(&remote, ".jackalope/attachments/new.png", b"\x89PNG");
    run_git(&remote, &["add", "-f", ".jackalope"]);
    run_git(&remote, &["commit", "-qm", "context"]);
    write(&remote, "a.txt", b"agent\n");
    write(&remote, "b.txt", b"b\n");
    let (bundle, result) = runner.result("w1");

    // The person changed the same line meanwhile: nothing is applied.
    write(&local, "a.txt", b"person\n");
    let snapshot = |path: &Path| {
        let mut files: Vec<(String, Vec<u8>)> = ignore::WalkBuilder::new(path)
            .hidden(false)
            .git_ignore(false)
            .filter_entry(|entry| entry.file_name() != ".git")
            .build()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_some_and(|kind| kind.is_file()))
            .map(|entry| {
                (
                    entry
                        .path()
                        .strip_prefix(path)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    std::fs::read(entry.path()).unwrap(),
                )
            })
            .collect();
        files.sort();
        files
    };
    let before = snapshot(&local);
    let from = upload.snapshot.as_str();
    assert!(bring_back(&local, &root.0, &bundle, &result, from).is_err());
    assert_eq!(snapshot(&local), before);
    let mut corrupt = bundle.clone();
    let middle = corrupt.len() / 2;
    corrupt[middle] ^= 0xff;
    corrupt.truncate(corrupt.len() - 5);
    assert!(bring_back(&local, &root.0, &corrupt, &result, from).is_err());
    assert!(bring_back(&local, &root.0, &bundle, &"f".repeat(40), from).is_err());
    assert_eq!(snapshot(&local), before);
    assert_eq!(base.len(), 40);

    write(&local, "a.txt", b"two\n");
    bring_back(&local, &root.0, &bundle, &result, from).unwrap();
    assert_eq!(read(&local, "a.txt"), "agent\n");
    assert_eq!(
        read(&local, ".jackalope/cloudflare.json"),
        "{\"version\":1}"
    );
    assert!(!local.join(".jackalope/attachments/new.png").exists());
}

#[test]
fn workspaces_a_bundle_cannot_carry_go_as_files() {
    let root = folder();
    let plain = root.0.join("plain");
    write(&plain, "a.txt", b"x");
    let reason = |path: &Path| match prepare(path, &[], &[]).unwrap() {
        Prepared::Archive(reason) => reason,
        Prepared::Bundle(_) => panic!("{} went as a bundle", path.display()),
    };
    assert!(reason(&plain).contains("not a Git repository"));
    let unborn = root.0.join("unborn");
    std::fs::create_dir_all(&unborn).unwrap();
    run_git(&unborn, &["init", "-q"]);
    assert!(reason(&unborn).contains("no commits"));
    write(&unborn, "sub/a.txt", b"x");
    run_git(&unborn, &["add", "-A"]);
    run_git(&unborn, &["commit", "-qm", "x"]);
    assert!(reason(&unborn.join("sub")).contains("inside another repository"));
    write(
        &unborn,
        ".gitattributes",
        b"*.psd filter=lfs diff=lfs merge=lfs -text\n",
    );
    run_git(&unborn, &["add", "-A"]);
    run_git(&unborn, &["commit", "-qm", "lfs"]);
    assert!(reason(&unborn).contains("LFS"));
    assert!(repo_key(&plain).is_none());
}

#[test]
fn artifact_paths_stay_inside_the_artifact_folder() {
    for bad in [
        "../x",
        ".jackalope/artifacts/",
        ".jackalope/artifacts/../x",
        ".jackalope/artifactsx/a",
        ".jackalope/artifacts/a\\b",
        ".jackalope/artifacts/c:x",
        ".jackalope/attachments/a.png",
        "src/main.rs",
    ] {
        assert!(!safe_artifact_path(bad), "{bad}");
        let listed = json!([{ "path": bad, "sha256": "a".repeat(64), "size": 1 }]);
        assert!(parse_artifacts(&listed).is_err(), "{bad}");
    }
    assert!(safe_artifact_path(".jackalope/artifacts/screenshots/a.png"));
    let too_big = json!([{ "path": ".jackalope/artifacts/a", "sha256": "a".repeat(64), "size": protocol().sync.result_artifact_bytes + 1 }]);
    assert!(parse_artifacts(&too_big).is_err());
}

/// The runner over the run protocol: artifacts in memory, git-sync through
/// [`Runner`].
struct Remote {
    store: Arc<Mutex<Store>>,
    runner: Arc<Mutex<Runner>>,
    root: PathBuf,
}

impl Transport for Remote {
    fn call(
        &mut self,
        payload: &Value,
        _: Duration,
        _: &AtomicBool,
    ) -> Result<Value, crate::commands::computers::AgentError> {
        let mut store = self.store.lock().unwrap();
        if let Some(result) = Fake::answer(&mut store, payload) {
            return result;
        }
        let mut runner = self.runner.lock().unwrap();
        let blob = |sha: &str| store.stored[sha].clone();
        match payload["action"].as_str().unwrap() {
            "run_status" => {
                Ok(json!({"runs": 4, "capabilities": ["git-sync", "artifacts"], "exists": false}))
            }
            "sync_status" => Ok(json!({"have": runner.have()})),
            "sync_checkout" => {
                let bundle = self.root.join("received.bundle");
                std::fs::write(&bundle, blob(payload["bundle"].as_str().unwrap())).unwrap();
                let extras = payload["extras"].as_str().map(blob);
                let run = payload["run"].as_str().unwrap();
                runner.checkout(
                    run,
                    &bundle,
                    payload["base"].as_str().unwrap(),
                    payload["snapshot"].as_str().unwrap(),
                    extras.as_deref(),
                );
                Ok(json!({}))
            }
            "sync_result" => {
                let run = payload["run"].as_str().unwrap();
                let (bundle, result) = runner.result(run);
                let snapshot = run_git(
                    &runner.repo,
                    &[
                        "rev-parse",
                        &format!("refs/jackalope/incoming/{run}/snapshot"),
                    ],
                );
                let digest = artifacts::digest_reader(&mut bundle.as_slice()).unwrap();
                store.stored.insert(digest.sha256.clone(), bundle);
                let shot = b"PNG".to_vec();
                let shot_digest = artifacts::digest_reader(&mut shot.as_slice()).unwrap();
                store.stored.insert(shot_digest.sha256.clone(), shot);
                Ok(json!({
                    "bundle": {"sha256": digest.sha256, "size": digest.size},
                    "result": result,
                    "base": runner.bases[run],
                    "snapshot": snapshot,
                    "artifacts": [{"path": ".jackalope/artifacts/screenshots/s.png", "sha256": shot_digest.sha256, "size": 3}],
                }))
            }
            other => Err(format!("Unsupported action {other}").into()),
        }
    }
}

#[test]
fn a_session_syncs_and_brings_back_changes_and_artifacts() {
    let root = folder();
    let (local, base) = local(&root.0);
    let store = Arc::new(Mutex::new(Store::default()));
    let runner = Arc::new(Mutex::new(Runner::new(&root.0)));
    let remote = Remote {
        store: store.clone(),
        runner: runner.clone(),
        root: root.0.clone(),
    };
    let mut session = runs::Session::with_transport(Box::new(remote), "w1".into());
    session.status().unwrap();
    assert!(runs::uses_git_sync(&session.capabilities));
    let sent = session
        .sync_upload(&local, &[".env.local".into()], &|_, _| {})
        .unwrap();
    assert!(matches!(sent, Sent::Bundle { delta: false, .. }));
    assert!(session.synced);
    let workspace = runner.lock().unwrap().workspace("w1");
    assert_eq!(read(&workspace, ".env.local"), "KEY=1\n");
    write(&workspace, "a.txt", b"agent\n");

    let collected = session.collect_changes(&local).unwrap();
    runs::apply(&local, &collected.patch).unwrap();
    assert_eq!(read(&local, "a.txt"), "agent\n");
    assert_eq!(
        session
            .fetch_artifacts(&local, &collected.artifacts)
            .unwrap(),
        1
    );
    assert_eq!(
        read(&local, ".jackalope/artifacts/screenshots/s.png"),
        "PNG"
    );
    let gets = store.lock().unwrap().gets;
    assert_eq!(
        session
            .fetch_artifacts(&local, &collected.artifacts)
            .unwrap(),
        0
    );
    assert_eq!(
        store.lock().unwrap().gets,
        gets,
        "identical output is not fetched again"
    );

    // A retry of the same workspace sends only the delta.
    let mut retry = runs::Session::with_transport(
        Box::new(Remote {
            store,
            runner,
            root: root.0.clone(),
        }),
        "w2".into(),
    );
    retry.status().unwrap();
    let sent = retry.sync_upload(&local, &[], &|_, _| {}).unwrap();
    assert!(matches!(sent, Sent::Bundle { delta: true, .. }));
    assert_eq!(base.len(), 40);
}

#[test]
fn older_runners_keep_the_tar_and_patch() {
    let store = Arc::new(Mutex::new(Store::default()));
    let mut session = runs::Session::with_transport(Box::new(Fake(store.clone())), "w1".into());
    // An agent before capabilities answers run_status without them.
    session.status().unwrap();
    assert!(!runs::uses_git_sync(&session.capabilities));
    assert!(!session.synced);
    let only_sync = crate::commands::computers::runner::RunnerCapabilities::from_status(Some(
        &json!({"runs": 4, "capabilities": ["git-sync"]}),
    ));
    assert!(
        !runs::uses_git_sync(&only_sync),
        "bundles need the artifact channel"
    );
    // Without a synced run, changes come back through workspace_diff.
    let _ = session.collect_changes(Path::new("."));
    let store = store.lock().unwrap();
    assert_eq!(store.other.last().unwrap()["action"], "workspace_diff");
}
