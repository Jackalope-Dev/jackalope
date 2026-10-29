use super::*;

fn fixture() -> (KnowledgeStore, String) {
    let root = std::env::temp_dir().join(format!("jackalope-agent-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store = KnowledgeStore::new(root.join("knowledge/entries.json"));
    let path = canonical(root.to_str().unwrap()).unwrap();
    (store, path)
}

fn said(text: &str) -> Observation {
    Observation {
        kind: ObservationKind::Statement,
        text: text.into(),
        reference: "Task t1".into(),
        run_id: Some("t1".into()),
    }
}

#[test]
fn the_budget_caps_calls_per_hour_and_day() {
    let mut budget = AgentBudget::default();
    let start = Instant::now();
    let allowed = (0..10).filter(|_| budget.allow(start, &THRESHOLDS)).count();
    assert_eq!(allowed, THRESHOLDS.agent_reflections_per_hour);
    let later = start + Duration::from_secs(61 * 60);
    assert!(budget.allow(later, &THRESHOLDS));
    let mut daily = AgentBudget::default();
    let mut granted = 0;
    for hour in 0..24 {
        let now = start + Duration::from_secs(hour * 60 * 60);
        while daily.allow(now, &THRESHOLDS) {
            granted += 1;
        }
    }
    assert_eq!(granted, THRESHOLDS.agent_reflections_per_day);
}

#[test]
fn the_prompt_reads_only_the_persons_redacted_words_within_a_window() {
    let email = ["dev", "@example.com"].concat();
    let observations = vec![
        said(&format!("Always ask {email} before releasing.")),
        Observation {
            kind: ObservationKind::Answer {
                question: "Which branch?".into(),
            },
            text: "Use main for releases.".into(),
            reference: "Task t1".into(),
            run_id: None,
        },
        Observation {
            kind: ObservationKind::Check,
            text: "pnpm verify".into(),
            reference: "Task t1".into(),
            run_id: None,
        },
        said(&"long words ".repeat(2000)),
    ];
    let prompt = prompt(&observations, &[], &THRESHOLDS).unwrap();
    assert!(!prompt.contains(&email));
    assert!(prompt.contains("[email]"));
    assert!(prompt.contains("Use main for releases."));
    assert!(!prompt.contains("pnpm verify"));
    assert!(prompt.len() < THRESHOLDS.agent_window_bytes + 3000);
    let checks_only = [Observation {
        kind: ObservationKind::Check,
        text: "pnpm test".into(),
        reference: "Task t1".into(),
        run_id: None,
    }];
    assert!(super::prompt(&checks_only, &[], &THRESHOLDS).is_none());
}

#[test]
fn agent_proposals_pass_the_same_gate() {
    let (store, path) = fixture();
    let existing = store.list("p", &path).unwrap();
    store
        .promote(
            "p",
            &path,
            reflect(
                &[said("Always run pnpm verify before committing.")],
                &existing,
            ),
            "reflection",
        )
        .unwrap();
    let existing = store.list("p", &path).unwrap();
    let target = existing[0].id.clone();
    let credential = ["sk-", "abcdefghijklmnopqrstuvwxyz123456"].concat();
    let items = [
        r#"{"action":"add","title":"Release branch","statement":"Releases are cut from the main branch.","keywords":["release","main"]}"#.to_string(),
        format!(r#"{{"action":"add","title":"Key","statement":"Use the key {credential} for uploads to staging.","keywords":["upload"]}}"#),
        format!(r#"{{"action":"merge","target":"{target}","statement":"Always run pnpm verify before committing."}}"#),
        r#"{"action":"retire","target":"not-a-lesson","reason":"gone"}"#.to_string(),
    ];
    let answer = format!("Here you go: {{\"proposals\":[{}]}}", items.join(","));
    // A malformed item makes the whole answer unusable.
    let malformed = format!(
        r#"{{"proposals":[{},{{"action":"delete","target":"{target}"}}]}}"#,
        items.join(",")
    );
    assert!(parse(&malformed, &existing, "Task t1", Some("t1")).is_empty());
    let proposals = parse(&answer, &existing, "Task t1", Some("t1"));
    assert_eq!(proposals.len(), 3, "{proposals:?}");
    assert!(matches!(&proposals[2], Proposal::Merge { target: id, .. } if *id == target));
    let report = store.promote("p", &path, proposals, "agent").unwrap();
    assert_eq!(report.applied.len(), 1, "{report:?}");
    assert_eq!(report.rejected.len(), 1, "{report:?}");
    let added = store
        .list("p", &path)
        .unwrap()
        .into_iter()
        .find(|entry| entry.content.contains("main branch"))
        .unwrap();
    assert_eq!(lifecycle(&added).unwrap().origin, "agent");
    assert_eq!(store.history("p", &added.id, 5)[0].origin, "agent");
    assert!(parse("no json here", &existing, "Task t1", None).is_empty());
}
