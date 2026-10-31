use super::*;

fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("jackalope-profiles-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn each_owner_gets_one_profile_that_persists_until_deleted() {
    let root = root();
    let project = ensure(&root, PROJECT, "project-1", "Project browser").unwrap();
    assert_eq!(
        ensure(&root, PROJECT, "project-1", "Project browser").unwrap(),
        project
    );
    let other = ensure(&root, PROJECT, "project-2", "Project browser").unwrap();
    let bot = ensure(&root, BOT, "project-1", "Scout browser").unwrap();
    assert_ne!(project.id, other.id);
    assert_ne!(
        project.id, bot.id,
        "a bot ID never reaches a project's profile"
    );
    assert!(data_directory(&root, &project.id).is_dir());
    assert_eq!(find(&root, BOT, "project-1").unwrap().name, "Scout browser");
    assert!(ensure(&root, "team", "x", "X").is_err());
    assert!(ensure(&root, PROJECT, " ", "X").is_err());

    std::fs::write(
        data_directory(&root, &project.id).join("Cookies"),
        vec![0u8; 2048],
    )
    .unwrap();
    assert!(status(&root, project.clone()).size_bytes >= 2048);
    delete(&root, &project.id).unwrap();
    assert!(!root.join(&project.id).exists());
    assert!(find(&root, PROJECT, "project-1").is_none());
    assert!(find(&root, PROJECT, "project-2").is_some());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn recorded_sites_are_domain_names_and_older_records_still_load() {
    let root = root();
    let profile = ensure(&root, PROJECT, "p", "Project browser").unwrap();
    record(&root, &profile.id, Some(vec!["example.com".into()]));
    let saved = find(&root, PROJECT, "p").unwrap();
    assert_eq!(saved.signed_in_sites, ["example.com"]);
    assert!(saved.last_used_at.is_some());
    record(&root, &profile.id, None);
    assert_eq!(
        find(&root, PROJECT, "p").unwrap().signed_in_sites,
        ["example.com"]
    );

    let older: Index = serde_json::from_value(serde_json::json!({"profiles":[{"id":"a","name":"Project browser","ownerKind":"project","ownerId":"p","createdAt":"2026-10-01T00:00:00Z"}]})).unwrap();
    assert!(older.profiles[0].signed_in_sites.is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn one_live_session_per_profile() {
    let root = root();
    let profile = ensure(&root, PROJECT, "busy", "Project browser").unwrap();
    let lease = acquire(&profile, "a task in Demo").unwrap();
    let error = acquire(&profile, "the sign-in window").err().unwrap();
    assert!(error.contains("in use by a task in Demo"), "{error}");
    assert!(delete(&root, &profile.id).is_err());
    assert!(clear_site(&root, &profile.id, "example.com").is_err());
    assert_eq!(
        status(&root, profile.clone()).in_use.as_deref(),
        Some("a task in Demo")
    );
    drop(lease);
    assert!(holder(&profile.id).is_none());
    assert!(acquire(&profile, "the sign-in window").is_ok());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn site_cleanup_accepts_only_site_names() {
    let root = root();
    let profile = ensure(&root, PROJECT, "clean", "Project browser").unwrap();
    for site in ["", "https://example.com/path", "a b", "file:///etc"] {
        assert!(clear_site(&root, &profile.id, site).is_err(), "{site}");
    }
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn site_choices_match_desktop_control() {
    let options = site_options("example.com", "Demo");
    let labels: Vec<_> = options.iter().map(|(label, _)| label.as_str()).collect();
    assert_eq!(
        labels,
        [
            "Allow example.com for this task",
            "Always allow example.com in Demo",
            "Not example.com",
            "Never allow example.com in Demo"
        ]
    );
    assert_eq!(options[1].1, (true, true));
    assert_eq!(options[3].1, (false, true));
    assert!(loopback("localhost") && loopback("127.0.0.1") && !loopback("example.com"));
}

#[test]
#[ignore = "Launches a headless browser on a temporary persistent profile"]
fn real_persistent_profile_keeps_cookies_and_clears_one_site() {
    let root = root();
    let profile = ensure(&root, PROJECT, "real", "Project browser").unwrap();
    let directory = data_directory(&root, &profile.id);
    {
        let window = ProfileWindow::open(&directory, None, false).unwrap();
        window.set_test_cookies();
    }
    let window = ProfileWindow::open(&directory, None, false).unwrap();
    assert_eq!(window.sites().unwrap(), ["example.com", "example.org"]);
    drop(window);
    assert_eq!(clear_site(&root, &profile.id, "example.com").unwrap(), 1);
    assert_eq!(
        find(&root, PROJECT, "real").unwrap().signed_in_sites,
        ["example.org"]
    );
    let _ = std::fs::remove_dir_all(root);
}
