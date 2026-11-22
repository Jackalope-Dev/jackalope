use super::*;

fn rule(format: Format, path: &str, text: &str) -> Rule {
    parse(format, path, text).unwrap()
}

#[test]
fn frontmatter_reads_unquoted_globs_lists_and_quotes() {
    let (fields, body) = frontmatter(
        "---\ndescription: \"React components\"\nglobs: **/*.tsx, src/{a,b}/*.ts\nalwaysApply: false\npaths:\n  - 'apps/web/**'\n  - docs/*.md\ntags: [one, \"two\"]\n---\nUse hooks.\n",
    );
    assert_eq!(body, "Use hooks.\n");
    assert_eq!(field(&fields, "description"), Some("React components"));
    assert_eq!(globs(&fields, "globs"), ["**/*.tsx", "src/{a,b}/*.ts"]);
    assert_eq!(globs(&fields, "paths"), ["apps/web/**", "docs/*.md"]);
    assert_eq!(fields["tags"], ["one", "two"]);
    let (fields, body) = frontmatter("No frontmatter\n---\n");
    assert!(fields.is_empty());
    assert_eq!(body, "No frontmatter\n---\n");
    let (fields, body) = frontmatter("---\nunterminated: yes\n");
    assert!(fields.is_empty());
    assert!(body.starts_with("---"));
}

#[test]
fn each_format_maps_to_always_paths_or_described() {
    let cursor = |text| rule(Format::Cursor, ".cursor/rules/react-ui.mdc", text).scope;
    assert_eq!(
        cursor("---\nalwaysApply: true\nglobs: *.ts\n---\nx"),
        Scope::Always
    );
    assert_eq!(
        cursor("---\nglobs: apps/web/**/*.tsx\n---\nx"),
        Scope::Paths(vec!["apps/web/**/*.tsx".into()])
    );
    assert_eq!(cursor("---\nglobs: **/*\n---\nx"), Scope::Always);
    assert_eq!(
        cursor("---\ndescription: Styling\n---\nx"),
        Scope::Described
    );
    assert_eq!(cursor("x"), Scope::Described);

    let windsurf = |text| rule(Format::Windsurf, ".windsurf/rules/a.md", text).scope;
    assert_eq!(windsurf("---\ntrigger: always_on\n---\nx"), Scope::Always);
    assert_eq!(
        windsurf("---\ntrigger: glob\nglobs: '*.py'\n---\nx"),
        Scope::Paths(vec!["*.py".into()])
    );
    assert_eq!(
        windsurf("---\ntrigger: model_decision\n---\nx"),
        Scope::Described
    );
    assert_eq!(windsurf("Plain rule"), Scope::Always);

    let cline = |text| rule(Format::Cline, ".clinerules/b.md", text).scope;
    assert_eq!(cline("x"), Scope::Always);
    assert_eq!(
        cline("---\npaths:\n  - \"src/api/**\"\n---\nx"),
        Scope::Paths(vec!["src/api/**".into()])
    );

    let copilot = |text| {
        rule(
            Format::CopilotPaths,
            ".github/instructions/rust.instructions.md",
            text,
        )
    };
    let scoped = copilot("---\napplyTo: \"**/*.rs,**/Cargo.toml\"\n---\nUse clippy.");
    assert_eq!(scoped.name, "rust");
    assert_eq!(
        scoped.scope,
        Scope::Paths(vec!["**/*.rs".into(), "**/Cargo.toml".into()])
    );
    assert_eq!(copilot("---\napplyTo: '**'\n---\nx").scope, Scope::Always);
    assert_eq!(copilot("No applyTo").scope, Scope::Described);

    let legacy = rule(Format::Plain("Cursor"), ".cursorrules", "Use tabs.");
    assert_eq!(
        (legacy.tool, legacy.name.as_str()),
        ("Cursor", "cursorrules")
    );
    assert_eq!(legacy.scope, Scope::Always);
    assert!(parse(Format::Cursor, "a.mdc", "---\nenabled: false\n---\nx").is_none());
    assert!(parse(Format::Cursor, "a.mdc", "---\nglobs: x\n---\n\n").is_none());
}

#[test]
fn lessons_are_paused_bounded_and_matched_by_scope_words() {
    let long = "Prefer server components for data loading. ".repeat(60);
    let rule = rule(
        Format::Cursor,
        ".cursor/rules/react-ui.mdc",
        &format!("---\ndescription: Component conventions\nglobs: apps/web/**/*.tsx\n---\n{long}"),
    );
    let entry = lesson("p", "/project", &rule);
    assert!(!entry.enabled);
    assert!(entry.content.len() <= 800, "{}", entry.content.len());
    assert!(entry
        .content
        .starts_with("Cursor rule in .cursor/rules/react-ui.mdc, for files matching apps/web/**/*.tsx. Component conventions\nPrefer server"));
    assert!(entry
        .content
        .ends_with("read the full file before relying on it."));
    assert_eq!(entry.title, "Cursor rule: react-ui");
    let source = entry.automatic.as_ref().unwrap();
    assert_eq!(source.kind, "rules");
    assert_eq!(
        source.evidence,
        [".cursor/rules/react-ui.mdc · applies to apps/web/**/*.tsx"]
    );
    assert!(entry.keywords.len() <= 10);
    for word in ["web", "tsx", "react", "component"] {
        assert!(entry.keywords.iter().any(|k| k.starts_with(word)), "{word}");
    }
    assert!(!entry.keywords.iter().any(|k| k == "apps"));
    let multibyte = truncate("ééééé", 6);
    assert_eq!(multibyte, "é…");
}

#[test]
fn project_scan_offers_rules_paused_and_follows_the_files() {
    let root = std::env::temp_dir().join(format!("jackalope-rules-{}", uuid::Uuid::new_v4()));
    let write = |path: &str, text: &str| {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, text).unwrap();
    };
    write(
        ".cursor/rules/nested/api.mdc",
        "---\nglobs: server/**/*.go\n---\nWrap errors.",
    );
    write(".cursor/rules/notes.txt", "ignored extension");
    write(
        ".github/copilot-instructions.md",
        "Run the linter before committing.",
    );
    write(
        ".github/instructions/docs.instructions.md",
        "---\napplyTo: docs/**\n---\nShort sentences.",
    );
    write(".clinerules", "Keep functions small.");
    write(
        ".windsurf/rules/big.md",
        &"x".repeat(MAX_FILE_BYTES as usize + 1),
    );
    let path = dunce::canonicalize(&root).unwrap();
    let path = path.to_str().unwrap();
    let found: Vec<_> = candidates("p", path)
        .into_iter()
        .map(|entry| entry.automatic.unwrap().evidence[0].clone())
        .collect();
    assert_eq!(
        found,
        [
            ".cursor/rules/nested/api.mdc · applies to server/**/*.go",
            ".clinerules · always applies",
            ".github/copilot-instructions.md · always applies",
            ".github/instructions/docs.instructions.md · applies to docs/**",
        ]
    );

    let store = KnowledgeStore::new(root.join("profile/knowledge/entries.json"));
    store.learn("p", path, &[]).unwrap();
    let rules = |store: &KnowledgeStore| -> Vec<KnowledgeEntry> {
        store
            .list("p", path)
            .unwrap()
            .into_iter()
            .filter(|e| e.automatic.as_ref().is_some_and(|a| a.kind == "rules"))
            .collect()
    };
    assert_eq!(rules(&store).len(), 4);
    assert!(rules(&store).iter().all(|entry| !entry.enabled));
    let request = "Fix the server error handling in go";
    assert!(store
        .select("p", path, request, &Default::default())
        .unwrap()
        .entries
        .iter()
        .all(|e| e.automatic.as_ref().is_none_or(|a| a.kind != "rules")));
    let mut api = rules(&store)
        .into_iter()
        .find(|e| e.title == "Cursor rule: api")
        .unwrap();
    api.enabled = true;
    store.save(api).unwrap();
    store.learn("p", path, &[]).unwrap();
    let selected = store
        .select("p", path, request, &Default::default())
        .unwrap();
    assert!(selected
        .entries
        .iter()
        .any(|e| e.title == "Cursor rule: api"));

    std::fs::remove_file(root.join(".cursor/rules/nested/api.mdc")).unwrap();
    store.learn("p", path, &[]).unwrap();
    let api = rules(&store)
        .into_iter()
        .find(|e| e.title == "Cursor rule: api")
        .unwrap();
    assert!(!api.enabled);
    assert_eq!(
        std::fs::read_to_string(root.join(".clinerules")).unwrap(),
        "Keep functions small."
    );
    std::fs::remove_dir_all(root).unwrap();
}
