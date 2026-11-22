use super::detect::*;
use super::store::*;
use super::*;
use std::process::Command;

struct Folder(PathBuf);

impl Folder {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("jackalope-skills-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(dunce::canonicalize(&path).unwrap())
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .current_dir(dir)
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_WORK_TREE")
        .output()
        .unwrap();
    assert!(status.status.success(), "git {args:?}: {status:?}");
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn skill_text(name: &str, body: &str) -> String {
    format!("---\nname: {name}\ndescription: Use for {name}.\n---\n\n{body}\n")
}

fn project(root: &Path) -> ProjectRef {
    ProjectRef {
        id: "project".into(),
        name: "Fixture".into(),
        path: root.to_path_buf(),
        key: Some("c".repeat(64)),
    }
}

fn synced(name: &str, body: &str) -> SyncedSkill {
    let files = vec![SkillFile {
        path: "SKILL.md".into(),
        content: skill_text(name, body),
    }];
    SyncedSkill {
        location: Location {
            scope: Scope::Project,
            root: Root::Claude,
            project: Some("c".repeat(64)),
            name: name.into(),
        },
        description: format!("Use for {name}."),
        hash: content_hash(&files),
        files,
    }
}

/// A repository with one committed, one untracked, one ignored and one partly
/// committed project skill.
fn repository() -> Folder {
    let folder = Folder::new();
    let root = &folder.0;
    git(root, &["init", "-q"]);
    write(&root.join("README.md"), "fixture\n");
    write(
        &root.join(".claude/skills/committed/SKILL.md"),
        &skill_text("committed", "In the repository."),
    );
    write(
        &root.join(".claude/skills/partly/SKILL.md"),
        &skill_text("partly", "Half committed."),
    );
    write(&root.join(".gitignore"), ".agents/skills/ignored/\n");
    git(
        root,
        &[
            "add",
            "README.md",
            ".gitignore",
            ".claude/skills/committed",
            ".claude/skills/partly/SKILL.md",
        ],
    );
    git(root, &["commit", "-q", "-m", "fixture"]);
    write(
        &root.join(".claude/skills/partly/notes.md"),
        "Local notes.\n",
    );
    write(
        &root.join(".claude/skills/untracked/SKILL.md"),
        &skill_text("untracked", "Only here."),
    );
    write(
        &root.join(".agents/skills/ignored/SKILL.md"),
        &skill_text("ignored", "Ignored by Git."),
    );
    folder
}

fn find<'a>(skills: &'a [LocalSkill], name: &str) -> &'a LocalSkill {
    skills.iter().find(|skill| skill.name == name).unwrap()
}

#[test]
fn project_skills_are_classified_by_how_git_sees_them() {
    let folder = repository();
    let skills = scan_project(&project(&folder.0));
    assert_eq!(skills.len(), 4);
    let committed = find(&skills, "committed");
    assert_eq!(committed.tracking, Tracking::Tracked);
    assert_eq!(committed.files, Err(Blocked::Repository));
    let partly = find(&skills, "partly");
    assert_eq!(partly.tracking, Tracking::Mixed);
    assert_eq!(partly.files, Err(Blocked::PartlyTracked));
    let untracked = find(&skills, "untracked");
    assert_eq!(untracked.tracking, Tracking::Untracked);
    assert_eq!(untracked.root, Root::Claude);
    assert_eq!(untracked.description, "Use for untracked.");
    assert!(untracked.files.is_ok());
    let ignored = find(&skills, "ignored");
    assert_eq!(ignored.tracking, Tracking::Ignored);
    assert_eq!(ignored.root, Root::Agents);
    assert_eq!(
        ignored.location().unwrap(),
        Location {
            scope: Scope::Project,
            root: Root::Agents,
            project: Some("c".repeat(64)),
            name: "ignored".into(),
        }
    );
}

#[test]
fn a_project_without_a_commit_cannot_sync_and_outside_git_is_outside() {
    let folder = Folder::new();
    write(
        &folder.0.join(".claude/skills/notes/SKILL.md"),
        &skill_text("notes", "x"),
    );
    let mut project = project(&folder.0);
    project.key = None;
    let skills = scan_project(&project);
    assert_eq!(skills[0].tracking, Tracking::Outside);
    assert_eq!(skills[0].files, Err(Blocked::NoCommit));
    assert_eq!(skills[0].location(), None);
}

#[test]
fn skills_that_cannot_sync_say_why() {
    let folder = Folder::new();
    let case = |name: &str| folder.0.join(name);
    write(&case("large/SKILL.md"), &"x".repeat(MAX_CHARACTERS + 1));
    write(&case("binary/SKILL.md"), "text");
    std::fs::write(case("binary/logo.bin"), [0xff, 0xfe, 0x00]).unwrap();
    write(
        &case("secret/SKILL.md"),
        &format!("Use {} to deploy.", ["ghp_", &"a".repeat(30)].concat()),
    );
    write(&case("hidden/SKILL.md"), "text");
    write(&case("hidden/.env"), "IGNORED=1");
    write(&case("deep/SKILL.md"), "text");
    write(&case("deep/a/b/c/d.md"), "too deep");
    write(&case("many/SKILL.md"), "text");
    for index in 0..MAX_FILES {
        write(&case(&format!("many/f{index}.md")), "x");
    }
    assert_eq!(read_skill(&case("large")).files, Err(Blocked::TooLarge));
    assert_eq!(read_skill(&case("binary")).files, Err(Blocked::Binary));
    assert_eq!(read_skill(&case("secret")).files, Err(Blocked::Sensitive));
    assert_eq!(read_skill(&case("deep")).files, Err(Blocked::FileName));
    assert_eq!(read_skill(&case("many")).files, Err(Blocked::TooManyFiles));
    // Dot files are never read or sent.
    let hidden = read_skill(&case("hidden"));
    assert_eq!(hidden.paths, vec!["SKILL.md".to_string()]);
    assert!(hidden.files.is_ok());
    assert!(!valid_name("Release Notes"));
    assert!(valid_name("release-notes"));
}

#[test]
fn credentials_match_what_the_service_refuses() {
    assert!(credential("-----BEGIN OPENSSH PRIVATE KEY-----"));
    assert!(credential(&["AKIA", "ABCDEFGHIJKLMNOP"].concat()));
    assert!(credential(&["xoxb-", "1234567890ab"].concat()));
    assert!(credential(&["sk-", &"A".repeat(24)].concat()));
    assert!(!credential(
        "Run the token refresh, then check the password policy."
    ));
    assert!(!credential("-----BEGIN CERTIFICATE-----"));
    assert!(!credential("task-runner and desk-lamp"));
}

fn entry(revision: u64, hash: Option<&str>) -> Entry {
    let mut entry = Entry::new(synced("notes", "v1").location);
    entry.revision = revision;
    entry.hash = hash.map(str::to_string);
    entry
}

fn incoming(revision: u64, skill: SyncedSkill) -> Remote {
    Remote {
        id: uuid::Uuid::new_v4().to_string(),
        revision,
        updated_at: 1,
        deleted: false,
        skill: Some(skill),
    }
}

#[test]
fn local_and_account_changes_are_merged_or_become_conflicts() {
    let remote = synced("notes", "v2");
    let base = "a".repeat(64);
    let edited = "e".repeat(64);
    let mut current = entry(1, Some(&base));
    // Nothing changed.
    assert_eq!(plan(&current, true, Some(&base)), Plan::Nothing);
    // Edited only here: upload on top of the last exchanged revision.
    assert_eq!(plan(&current, true, Some(&edited)), Plan::Push { base: 1 });
    // Changed only on the account: write it here.
    current.incoming = Some(incoming(2, remote.clone()));
    assert_eq!(plan(&current, true, Some(&base)), Plan::Apply);
    assert_eq!(status(&current, true, true, Some(&base)), Status::Update);
    // Missing here: write it.
    assert_eq!(plan(&current, false, None), Plan::Apply);
    // Both copies already match.
    assert_eq!(plan(&current, true, Some(&remote.hash)), Plan::Adopt);
    // Changed in both places: never overwrite either.
    assert_eq!(plan(&current, true, Some(&edited)), Plan::Conflict);
    assert_eq!(
        status(&current, true, true, Some(&edited)),
        Status::Conflict
    );
    // A copy here that can no longer sync is never overwritten either.
    assert_eq!(plan(&current, true, None), Plan::Conflict);
    current.resolve = Some(Keep::Local);
    assert_eq!(plan(&current, true, Some(&edited)), Plan::Push { base: 2 });
    current.resolve = Some(Keep::Account);
    assert_eq!(plan(&current, true, Some(&edited)), Plan::Apply);
    // The account stopped syncing it.
    current.incoming = Some(Remote {
        deleted: true,
        skill: None,
        ..incoming(3, remote)
    });
    assert_eq!(plan(&current, true, Some(&edited)), Plan::Forget);
    // Synced elsewhere and not here.
    let away = entry(1, Some(&base));
    assert_eq!(status(&away, false, false, None), Status::Elsewhere);
    assert_eq!(status(&away, true, true, Some(&base)), Status::Synced);
    assert_eq!(status(&away, true, true, Some(&edited)), Status::Changed);
}

#[test]
fn synced_content_is_never_written_into_tracked_files() {
    let folder = repository();
    let committed = folder.0.join(".claude/skills/committed");
    let before = std::fs::read_to_string(committed.join("SKILL.md")).unwrap();
    let error =
        write_skill(&committed, &synced("committed", "From another computer.")).unwrap_err();
    assert!(error.contains("tracked"), "{error}");
    assert_eq!(
        std::fs::read_to_string(committed.join("SKILL.md")).unwrap(),
        before
    );
    // A partly committed skill is refused for its tracked file too.
    let partly = folder.0.join(".claude/skills/partly");
    assert!(write_skill(&partly, &synced("partly", "x")).is_err());
    // An untracked skill is replaced, and files the account copy dropped go.
    let untracked = folder.0.join(".claude/skills/untracked");
    write(&untracked.join("old.md"), "stale\n");
    let next = synced("untracked", "From another computer.");
    write_skill(&untracked, &next).unwrap();
    assert_eq!(
        std::fs::read_to_string(untracked.join("SKILL.md")).unwrap(),
        next.files[0].content
    );
    assert!(!untracked.join("old.md").exists());
    assert_eq!(
        read_skill(&untracked)
            .files
            .map(|files| content_hash(&files)),
        Ok(next.hash.clone())
    );
    // A new folder is created.
    let fresh = folder.0.join(".claude/skills/fresh");
    write_skill(&fresh, &synced("fresh", "New.")).unwrap();
    assert!(fresh.join("SKILL.md").is_file());
    // An account copy that fails validation is never written.
    let mut forged = synced("forged", "x");
    forged.files[0].path = "../escape.md".into();
    assert!(write_skill(&folder.0.join(".claude/skills/forged"), &forged).is_err());
    assert!(!folder.0.join(".claude/escape.md").exists());
}

#[test]
fn a_project_skill_can_be_kept_out_of_commits_locally() {
    let folder = repository();
    let untracked = folder.0.join(".claude/skills/untracked");
    assert!(keep_out_of_commits(&untracked).unwrap());
    assert!(!keep_out_of_commits(&untracked).unwrap());
    let skills = scan_project(&project(&folder.0));
    assert_eq!(find(&skills, "untracked").tracking, Tracking::Ignored);
    // Already ignored: nothing to add.
    assert!(!keep_out_of_commits(&folder.0.join(".agents/skills/ignored")).unwrap());
    let exclude = std::fs::read_to_string(folder.0.join(".git/info/exclude")).unwrap();
    assert_eq!(exclude.matches("/.claude/skills/untracked/").count(), 1);
}

#[test]
fn cards_combine_local_skills_with_synced_ones_from_other_devices() {
    let folder = repository();
    let projects = vec![project(&folder.0)];
    let skills = scan_project(&projects[0]);
    let untracked = find(&skills, "untracked");
    let mut account = AccountState::default();
    let mut shared = Entry::new(untracked.location().unwrap());
    shared.revision = 2;
    shared.hash = untracked.hash();
    account.skills.insert("shared".into(), shared);
    let mut away = Entry::new(Location {
        scope: Scope::Project,
        root: Root::Claude,
        project: Some("d".repeat(64)),
        name: "elsewhere".into(),
    });
    away.revision = 1;
    account.skills.insert("away".into(), away);
    account.devices = vec![
        DeviceView {
            id: "laptop".into(),
            name: Some("Laptop".into()),
            platform: Some("macos".into()),
            here: true,
        },
        DeviceView {
            id: "desk".into(),
            name: None,
            platform: Some("windows".into()),
            here: false,
        },
    ];
    account.holdings = vec![
        Holding {
            skill: "shared".into(),
            device: "laptop".into(),
            revision: 2,
        },
        Holding {
            skill: "shared".into(),
            device: "desk".into(),
            revision: 1,
        },
        Holding {
            skill: "shared".into(),
            device: "removed".into(),
            revision: 2,
        },
    ];
    let cards = cards(&skills, Some(&account), &projects);
    let card = |name: &str| cards.iter().find(|card| card.name == name).unwrap();
    assert_eq!(card("untracked").status, Status::Synced);
    assert_eq!(card("untracked").synced_id.as_deref(), Some("shared"));
    assert_eq!(
        card("untracked").holders,
        vec![
            HolderView {
                device: "desk".into(),
                current: false
            },
            HolderView {
                device: "laptop".into(),
                current: true
            },
        ]
    );
    assert_eq!(card("ignored").status, Status::Local);
    assert_eq!(card("committed").status, Status::Blocked);
    assert_eq!(card("committed").blocked, Some(Blocked::Repository));
    assert_eq!(card("elsewhere").status, Status::Elsewhere);
    assert_eq!(card("elsewhere").path, None);
    // Every card id is stable and distinct.
    let ids: HashSet<&str> = cards.iter().map(|card| card.id.as_str()).collect();
    assert_eq!(ids.len(), cards.len());
}

#[test]
fn account_copies_are_validated_before_use() {
    let good = synced("notes", "x");
    assert!(good.validate());
    let mut wrong_hash = good.clone();
    wrong_hash.hash = "f".repeat(64);
    assert!(!wrong_hash.validate());
    let mut no_skill = good.clone();
    no_skill.files[0].path = "README.md".into();
    no_skill.hash = content_hash(&no_skill.files);
    assert!(!no_skill.validate());
    let mut codex_project = good.clone();
    codex_project.location.root = Root::Codex;
    assert!(!codex_project.validate());
    let mut personal_with_key = good;
    personal_with_key.location.scope = Scope::Personal;
    assert!(!personal_with_key.validate());
    assert!(!valid_file_path(".hidden"));
    assert!(!valid_file_path("a/../b"));
    assert!(valid_file_path("scripts/run.sh"));
}

#[test]
fn imported_files_are_named_from_their_folder_front_matter_or_file_name() {
    assert_eq!(
        import_name(Path::new("/x/release-notes/SKILL.md"), "body").as_deref(),
        Some("release-notes")
    );
    assert_eq!(
        import_name(Path::new("/x/notes.md"), "---\nname: Weekly Review\n---\n").as_deref(),
        Some("weekly-review")
    );
    assert_eq!(
        import_name(Path::new("/x/My Notes.md"), "body").as_deref(),
        Some("my-notes")
    );
    assert!(template("release-notes", "Use it.").starts_with("---\nname: release-notes\n"));
}
