use super::*;

fn fixture() -> (std::path::PathBuf, KnowledgeStore, String) {
    let root = std::env::temp_dir().join(format!("jackalope-export-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("project")).unwrap();
    let store = KnowledgeStore::new(root.join("profile/knowledge/entries.json"));
    let path = canonical(root.join("project").to_str().unwrap()).unwrap();
    (root.join("project"), store, path)
}

fn active_lesson(store: &KnowledgeStore, path: &str, text: &str) -> KnowledgeEntry {
    let observation = Observation {
        kind: ObservationKind::Statement,
        text: text.into(),
        reference: "Task t".into(),
        run_id: None,
    };
    let existing = store.list("p", path).unwrap();
    store
        .promote("p", path, reflect(&[observation], &existing), "reflection")
        .unwrap();
    let id = store
        .list("p", path)
        .unwrap()
        .into_iter()
        .find(|entry| entry.content.contains(text))
        .unwrap()
        .id;
    for run in ["r1", "r2"] {
        store
            .record_delivery(
                "p",
                path,
                &format!("{run}-{id}"),
                std::slice::from_ref(&id),
                true,
            )
            .unwrap();
    }
    store
        .list("p", path)
        .unwrap()
        .into_iter()
        .find(|entry| entry.id == id)
        .unwrap()
}

#[test]
fn the_managed_section_round_trips_without_touching_other_text() {
    let original = "# Agents\r\n\r\nRun the tests.\r\n";
    let block = section(&["- Always run pnpm verify.".into()]);
    let added = updated_agents(Some(original), Some(&block))
        .unwrap()
        .unwrap();
    assert!(added
        .starts_with("# Agents\r\n\r\nRun the tests.\r\n\r\n<!-- jackalope:lessons:start -->\r\n"));
    assert!(
        !added.replace("\r\n", "").contains('\n'),
        "line endings follow the file"
    );
    let changed = updated_agents(
        Some(&added),
        Some(&section(&["- Prefer rebase merges.".into()])),
    )
    .unwrap()
    .unwrap();
    assert!(changed.contains("Prefer rebase merges.") && !changed.contains("pnpm verify"));
    assert!(changed.starts_with("# Agents\r\n\r\nRun the tests."));
    let removed = updated_agents(Some(&changed), None).unwrap().unwrap();
    assert_eq!(removed, original);

    let user_after = format!("{block}\n\n## Notes\nKeep me.\n");
    assert_eq!(
        updated_agents(Some(&user_after), None).unwrap().unwrap(),
        "## Notes\nKeep me.\n"
    );
    assert_eq!(
        updated_agents(Some(&format!("{block}\n")), None).unwrap(),
        None
    );
    assert_eq!(
        updated_agents(None, Some(&block)).unwrap().unwrap(),
        format!("{block}\n")
    );
    for broken in [
        format!("{START}\nno end"),
        format!("{END}\n{START}"),
        format!("{block}\n{block}"),
    ] {
        assert!(updated_agents(Some(&broken), Some(&block)).is_err());
    }
}

#[test]
fn export_mirrors_active_lessons_and_removes_them_when_off() {
    let (root, store, path) = fixture();
    let agents = root.join("AGENTS.md");
    let skill = root.join(SKILL_PATH);
    std::fs::write(&agents, "# Project rules\n\nUse tabs.\n").unwrap();
    // Nothing is written while no lesson is active.
    let observation = Observation {
        kind: ObservationKind::Statement,
        text: "Prefer rebase merges for feature branches.".into(),
        reference: "Task t".into(),
        run_id: None,
    };
    store
        .promote("p", &path, reflect(&[observation], &[]), "reflection")
        .unwrap();
    assert!(!export_project(&store, "p", &path, true).unwrap());
    assert!(!skill.exists());

    active_lesson(&store, &path, "Always run pnpm verify before committing.");
    assert!(export_project(&store, "p", &path, true).unwrap());
    let text = std::fs::read_to_string(&agents).unwrap();
    assert!(text.starts_with("# Project rules\n\nUse tabs.\n\n<!-- jackalope:lessons:start -->"));
    assert!(text.contains("- Always run pnpm verify before committing."));
    assert!(
        !text.contains("rebase"),
        "lessons on probation are not exported"
    );
    let skill_text = std::fs::read_to_string(&skill).unwrap();
    assert!(skill_text.starts_with("---\nname: jackalope-lessons\n"));
    assert!(skill_text.contains("- Always run pnpm verify before committing."));
    // Unchanged lessons rewrite nothing.
    assert!(!export_project(&store, "p", &path, true).unwrap());

    assert!(export_project(&store, "p", &path, false).unwrap());
    assert_eq!(
        std::fs::read_to_string(&agents).unwrap(),
        "# Project rules\n\nUse tabs.\n"
    );
    assert!(!skill.exists());
    assert!(!export_project(&store, "p", &path, false).unwrap());
}

#[test]
fn hand_written_skills_and_created_agents_files_are_handled_safely() {
    let (root, store, path) = fixture();
    active_lesson(&store, &path, "Always run pnpm verify before committing.");
    assert!(export_project(&store, "p", &path, true).unwrap());
    let agents = root.join("AGENTS.md");
    assert!(agents.exists());
    assert!(export_project(&store, "p", &path, false).unwrap());
    assert!(
        !agents.exists(),
        "a file that only held the section is removed"
    );

    let skill = root.join(SKILL_PATH);
    std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
    std::fs::write(&skill, "---\nname: jackalope-lessons\n---\nMy own notes.\n").unwrap();
    assert!(export_project(&store, "p", &path, true).is_err());
    assert_eq!(
        std::fs::read_to_string(&skill).unwrap(),
        "---\nname: jackalope-lessons\n---\nMy own notes.\n"
    );
    // Turning export off leaves a hand-written skill alone without complaint.
    export_project(&store, "p", &path, false).unwrap();
    assert_eq!(
        std::fs::read_to_string(&skill).unwrap(),
        "---\nname: jackalope-lessons\n---\nMy own notes.\n"
    );
}
