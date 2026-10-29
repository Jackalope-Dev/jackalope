use super::*;

fn fixture() -> (PathBuf, KnowledgeStore, String) {
    let root = std::env::temp_dir().join(format!("jackalope-stale-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("src/routes")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/.bin")).unwrap();
    std::fs::write(root.join("src/routes/index.ts"), "export {};\n").unwrap();
    std::fs::write(
        root.join("package.json"),
        r#"{"scripts":{"lint":"biome check","verify":"pnpm lint"}}"#,
    )
    .unwrap();
    std::fs::write(root.join("node_modules/.bin/vitest"), "").unwrap();
    std::fs::write(root.join("Makefile"), "build:\n\tcargo build\n").unwrap();
    let store = KnowledgeStore::new(root.join("knowledge/entries.json"));
    let path = canonical(root.to_str().unwrap()).unwrap();
    (root, store, path)
}

fn learn(store: &KnowledgeStore, path: &str, observations: &[Observation]) {
    let existing = store.list("p", path).unwrap();
    let report = store
        .promote("p", path, reflect(observations, &existing), "reflection")
        .unwrap();
    assert!(report.rejected.is_empty(), "{report:?}");
}

fn said(text: &str) -> Observation {
    Observation {
        kind: ObservationKind::Statement,
        text: text.into(),
        reference: "Task a".into(),
        run_id: None,
    }
}

fn find(store: &KnowledgeStore, path: &str, needle: &str) -> KnowledgeEntry {
    store
        .list("p", path)
        .unwrap()
        .into_iter()
        .find(|entry| entry.content.contains(needle))
        .unwrap()
}

fn named(root: &Path, text: &str, check: bool) -> Vec<Reference> {
    references(root, text, check, 8)
}

#[test]
fn references_are_paths_scripts_and_targets_written_as_such() {
    let (root, _store, _path) = fixture();
    let root = root.as_path();
    // Slash words count under an existing top folder or with a file extension.
    assert_eq!(
        named(
            root,
            "Keep (src/routes/index.ts) and docs/gone.md current.",
            false
        ),
        [
            Reference::Path("src/routes/index.ts".into()),
            Reference::Path("docs/gone.md".into())
        ]
    );
    for prose in [
        "Prefer descriptive branch names, such as feature/short-topic.",
        "Use and/or sparingly in the client/server docs.",
        "See https://example.com/a/b.md and @types/node.",
        "Never touch ../outside/file.rs or /etc/hosts.txt.",
        // Without `run`, prose is not a command.
        "Use pnpm only and make sure nothing else installs packages.",
    ] {
        assert!(named(root, prose, false).is_empty(), "{prose}");
    }
    assert_eq!(
        named(
            root,
            "Always run pnpm run lint, then yarn run e2e:ci.",
            false
        ),
        [
            Reference::Script {
                name: "lint".into(),
                bare: false
            },
            Reference::Script {
                name: "e2e:ci".into(),
                bare: false
            }
        ]
    );
    // Backticks and check commands are commands: bare scripts and make targets count.
    assert_eq!(
        named(root, "Run `pnpm verify` and `make build` first.", false),
        [
            Reference::Script {
                name: "verify".into(),
                bare: true
            },
            Reference::Make("build".into())
        ]
    );
    assert!(named(
        root,
        "The check command pnpm --filter web test passed for this project.",
        true
    )
    .is_empty());
    assert_eq!(
        named(
            root,
            "The check command pnpm vitest passed for this project.",
            true
        ),
        [Reference::Script {
            name: "vitest".into(),
            bare: true
        }]
    );
}

#[test]
fn missing_paths_scripts_and_targets_are_found_and_unknowns_are_kept() {
    let (root, _store, _path) = fixture();
    let project = Project::read(&root);
    let missing = |reference: Reference| project.missing(&reference);
    assert!(!missing(Reference::Path("src/routes/index.ts".into())));
    assert!(missing(Reference::Path("src/routes/old.ts".into())));
    let script = |name: &str, bare| Reference::Script {
        name: name.into(),
        bare,
    };
    assert!(!missing(script("lint", false)));
    assert!(missing(script("storybook", false)));
    // A bare `pnpm vitest` runs an installed binary.
    assert!(!missing(script("vitest", true)));
    assert!(missing(script("playwright", true)));
    assert!(!missing(Reference::Make("build".into())));
    assert!(missing(Reference::Make("deploy".into())));

    // Without node_modules a bare name cannot be judged, and without a
    // package.json no script can.
    std::fs::remove_dir_all(root.join("node_modules")).unwrap();
    let project = Project::read(&root);
    assert!(!project.missing(&script("playwright", true)));
    std::fs::remove_file(root.join("package.json")).unwrap();
    std::fs::write(root.join("Makefile"), "include rules.mk\n").unwrap();
    let project = Project::read(&root);
    assert!(!project.missing(&script("storybook", false)));
    assert!(!project.missing(&Reference::Make("deploy".into())));
}

#[test]
fn stale_learned_lessons_are_archived_and_hand_written_ones_only_flagged() {
    let (root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[
            said("Always update src/routes/legacy.ts when routing tables change."),
            said("Prefer pnpm run storybook for visual reviews of widgets."),
            said("Always run pnpm run lint before pushing branches."),
        ],
    );
    learn(
        &store,
        &path,
        &[Observation {
            kind: ObservationKind::Check,
            text: "pnpm playwright".into(),
            reference: "Task b".into(),
            run_id: None,
        }],
    );
    let manual = store
        .save(KnowledgeEntry {
            automatic: None,
            dismissed: false,
            process: Default::default(),
            stale: None,
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "p".into(),
            project_path: path.clone(),
            kind: KnowledgeKind::Memory,
            title: "Release notes".into(),
            content: "Keep docs/releases.md in step with each release.".into(),
            keywords: vec!["release".into()],
            enabled: true,
            source_run_id: None,
            source_head: None,
            revision: 0,
            updated_at: String::new(),
        })
        .unwrap();

    let applied = store.check_stale("p", &path, &THRESHOLDS).unwrap();
    assert_eq!(applied.len(), 4, "{applied:?}");

    let legacy = find(&store, &path, "legacy.ts");
    let state = lifecycle(&legacy).unwrap();
    assert_eq!(
        (state.archived(), state.archived_reason.as_deref()),
        (true, Some(STALE))
    );
    assert!(!legacy.enabled);
    assert_eq!(legacy.stale.as_deref(), Some("src/routes/legacy.ts"));
    let history = store.history("p", &legacy.id, 10);
    assert_eq!(history.last().unwrap().action, "stale");
    assert!(
        history
            .last()
            .unwrap()
            .reason
            .contains("no longer exists: src/routes/legacy.ts"),
        "{history:?}"
    );
    assert!(lifecycle(&find(&store, &path, "storybook"))
        .unwrap()
        .archived());
    assert!(lifecycle(&find(&store, &path, "playwright"))
        .unwrap()
        .archived());
    let lint = find(&store, &path, "pnpm run lint");
    assert!(!lifecycle(&lint).unwrap().archived() && lint.stale.is_none());

    // The hand-written lesson keeps its text, revision and availability.
    let flagged = find(&store, &path, "docs/releases.md");
    assert_eq!(flagged.revision, manual.revision);
    assert_eq!(flagged.content, manual.content);
    assert!(flagged.enabled);
    assert_eq!(flagged.stale.as_deref(), Some("docs/releases.md"));

    // Flagging again changes nothing; the file reappearing clears the flag.
    assert!(store
        .check_stale("p", &path, &THRESHOLDS)
        .unwrap()
        .is_empty());
    std::fs::create_dir_all(root.join("docs")).unwrap();
    std::fs::write(root.join("docs/releases.md"), "# Releases\n").unwrap();
    store.check_stale("p", &path, &THRESHOLDS).unwrap();
    let cleared = find(&store, &path, "docs/releases.md");
    assert!(cleared.stale.is_none());
    assert_eq!(cleared.revision, manual.revision);

    // Restoring a stale lesson clears its note; the next pass archives it again.
    let restored = store
        .set_archived(&legacy.id, legacy.revision, false)
        .unwrap();
    assert!(restored.stale.is_none() && restored.enabled);
    store.check_stale("p", &path, &THRESHOLDS).unwrap();
    assert!(lifecycle(&find(&store, &path, "legacy.ts"))
        .unwrap()
        .archived());

    let metrics = store.metrics("p", &path).unwrap();
    assert_eq!(metrics.stale, 5);
}

#[test]
fn an_edited_learned_lesson_is_only_flagged() {
    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[said(
            "Always update src/routes/legacy.ts when routing tables change.",
        )],
    );
    let mut entry = find(&store, &path, "legacy.ts");
    entry.content = "Update src/routes/legacy.ts whenever routing tables change.".into();
    let edited = store.save(entry).unwrap();
    store.check_stale("p", &path, &THRESHOLDS).unwrap();
    let flagged = find(&store, &path, "legacy.ts");
    assert!(!lifecycle(&flagged).unwrap().archived() && flagged.enabled);
    assert_eq!(flagged.revision, edited.revision);
    assert_eq!(flagged.stale.as_deref(), Some("src/routes/legacy.ts"));
    assert_eq!(
        attention(&flagged).as_deref(),
        Some("names src/routes/legacy.ts, which no longer exists")
    );
}
