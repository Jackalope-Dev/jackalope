use super::*;

fn computer(id: &str, limit: usize, running: usize) -> Host {
    Host {
        id: id.into(),
        name: id.into(),
        device: false,
        pinned: false,
        limit,
        running,
        lost: None,
        browser: None,
    }
}

fn pinned(limit: usize, running: usize) -> Host {
    Host {
        pinned: true,
        ..computer("Box", limit, running)
    }
}

fn placed(decision: Decision) -> RunHost {
    match decision {
        Decision::Place(host) => host,
        other => panic!("expected a placement, got {other:?}"),
    }
}

fn device_only(why: &str) -> Needs {
    Needs {
        device_only: Some(why.into()),
        ..Default::default()
    }
}

#[test]
fn the_default_places_work_where_it_ran_before_the_pool() {
    let none = Needs::default();
    // A project with a computer runs its forks there, and waits for it when
    // it is full rather than spilling onto this device.
    let hosts = [Host::device(4, 0), pinned(8, 3)];
    let host = placed(place(SwarmHosts::default(), &hosts, &none, 5, None));
    assert_eq!(host.id, "Box");
    assert_eq!(
        host.reason,
        "Placed on Box, the project's computer (3 of 8 in use)."
    );
    let full = [Host::device(4, 0), pinned(8, 8)];
    assert!(matches!(
        place(SwarmHosts::default(), &full, &none, 0, None),
        Decision::Wait(_)
    ));
    // Without one, forks run on this device.
    let host = placed(place(
        SwarmHosts::default(),
        &[Host::device(4, 1)],
        &none,
        8,
        None,
    ));
    assert!(host.is_device());
    assert_eq!(host.reason, "Placed on this device (1 of 4 in use).");
    // An agent that cannot run on a computer runs here, as it did.
    let host = placed(place(
        SwarmHosts::default(),
        &hosts,
        &device_only("Kimi cannot run on a computer"),
        5,
        None,
    ));
    assert!(host.is_device());
    assert!(host
        .reason
        .starts_with("Needs this device: Kimi cannot run on a computer."));
}

#[test]
fn requirements_keep_forks_where_their_tools_exist() {
    let browser = Needs {
        browser: true,
        ..Default::default()
    };
    // The project's computer is trusted until a run shows it lacks them.
    let hosts = [Host::device(4, 0), pinned(8, 0)];
    assert_eq!(
        placed(place(SwarmHosts::Anywhere, &hosts, &browser, 8, None)).id,
        "Box"
    );
    let older = [
        Host::device(4, 0),
        Host {
            browser: Some(false),
            ..pinned(8, 0)
        },
    ];
    let host = placed(place(SwarmHosts::Anywhere, &older, &browser, 8, None));
    assert!(host.is_device());
    assert!(host.reason.starts_with("Needs the browser tools."));
    // An added computer must have reported them.
    let added = [Host::device(1, 1), computer("Lab", 2, 0)];
    assert!(matches!(
        place(SwarmHosts::Anywhere, &added, &browser, 8, None),
        Decision::Wait(_)
    ));
    assert!(matches!(
        place(SwarmHosts::Computers, &added, &browser, 8, None),
        Decision::Refuse(reason) if reason.contains("browser tools")
    ));
    let reported = [
        Host::device(1, 1),
        Host {
            browser: Some(true),
            ..computer("Lab", 2, 0)
        },
    ];
    assert_eq!(
        placed(place(SwarmHosts::Anywhere, &reported, &browser, 8, None)).id,
        "Lab"
    );
}

#[test]
fn secrets_and_connections_are_hard_boundaries() {
    let hosts = [Host::device(4, 0), pinned(8, 0), computer("Lab", 2, 0)];
    // A secret only this device holds, or a connection that cannot reach a
    // computer, keeps the fork here; it never goes remote.
    let local = device_only("it names STRIPE_KEY, available only to this device");
    for policy in [SwarmHosts::Anywhere, SwarmHosts::Device] {
        assert!(placed(place(policy, &hosts, &local, 8, None)).is_device());
    }
    let refused = place(SwarmHosts::Computers, &hosts, &local, 8, None);
    assert!(
        matches!(&refused, Decision::Refuse(reason) if reason.contains("STRIPE_KEY") && reason.contains("only on computers")),
        "{refused:?}"
    );
    let connection = device_only("Figma (directly delivered) cannot run on a computer");
    assert!(
        placed(place(SwarmHosts::Anywhere, &hosts, &connection, 8, None))
            .reason
            .contains("Figma")
    );
    // A secret only computers hold sends it to one.
    let remote = Needs {
        computer_only: Some("it names DEPLOY_TOKEN, available only to computers".into()),
        ..Default::default()
    };
    assert_eq!(
        placed(place(SwarmHosts::Anywhere, &hosts, &remote, 8, None)).id,
        "Box"
    );
    assert!(matches!(
        place(SwarmHosts::Device, &hosts, &remote, 8, None),
        Decision::Refuse(reason) if reason.contains("only on this device")
    ));
    assert!(matches!(
        place(SwarmHosts::Anywhere, &[Host::device(4, 0)], &remote, 8, None),
        Decision::Refuse(reason) if reason.contains("no computer")
    ));
}

#[test]
fn the_project_choice_limits_hosts() {
    let hosts = [Host::device(4, 0), pinned(8, 0)];
    let none = Needs::default();
    assert!(placed(place(SwarmHosts::Device, &hosts, &none, 8, None)).is_device());
    assert_eq!(
        placed(place(SwarmHosts::Computers, &hosts, &none, 8, None)).id,
        "Box"
    );
    assert!(matches!(
        place(SwarmHosts::Computers, &[Host::device(4, 0)], &none, 8, None),
        Decision::Refuse(reason) if reason.contains("has none")
    ));
}

#[test]
fn full_hosts_spread_work_to_the_least_busy_one() {
    let none = Needs::default();
    // The project's computer is full: added computers share the work, the
    // least busy first, and this device stays out of it.
    let hosts = [
        Host::device(4, 0),
        pinned(8, 8),
        computer("Lab", 2, 1),
        computer("Attic", 2, 0),
    ];
    let host = placed(place(SwarmHosts::Anywhere, &hosts, &none, 8, None));
    assert_eq!(host.id, "Attic");
    assert_eq!(
        host.reason,
        "Box was full (8 of 8 in use), so it went to Attic, the least busy host with room (0 of 2 in use)."
    );
    // Ties go by name, so the choice is the same every time.
    let tied = [
        Host::device(4, 0),
        pinned(8, 8),
        computer("Lab", 2, 0),
        computer("Attic", 2, 0),
    ];
    for _ in 0..3 {
        assert_eq!(
            placed(place(SwarmHosts::Anywhere, &tied, &none, 8, None)).id,
            "Attic"
        );
    }
    // Without a computer of its own, this device is home and overflows to
    // added computers.
    let unpinned = [Host::device(2, 2), computer("Lab", 2, 0)];
    let host = placed(place(SwarmHosts::Anywhere, &unpinned, &none, 8, None));
    assert_eq!(host.id, "Lab");
    assert!(host
        .reason
        .starts_with("This device was full (2 of 2 in use)"));
}

#[test]
fn concurrency_limits_hold_per_host_and_for_all_computers() {
    let none = Needs::default();
    let hosts = [Host::device(1, 1), pinned(8, 2), computer("Lab", 2, 0)];
    // No slot left among computers: the fork waits even though Box has room.
    assert!(matches!(
        place(SwarmHosts::Anywhere, &hosts, &none, 0, None),
        Decision::Wait(reason) if reason.contains("Box")
    ));
    // Each computer keeps its own limit.
    let busy = [Host::device(1, 1), computer("Lab", 2, 2)];
    assert!(matches!(
        place(SwarmHosts::Anywhere, &busy, &none, 8, None),
        Decision::Wait(_)
    ));
    // Simulated dispatch: loads rise until every slot is taken.
    let mut hosts = vec![Host::device(2, 0), computer("Lab", 2, 0)];
    let mut remote_free = 8;
    let mut placed_on = Vec::new();
    while let Decision::Place(host) = place(SwarmHosts::Anywhere, &hosts, &none, remote_free, None)
    {
        let entry = hosts.iter_mut().find(|h| h.id == host.id).unwrap();
        entry.running += 1;
        if !entry.device {
            remote_free -= 1;
        }
        placed_on.push(host.id);
    }
    assert_eq!(placed_on, ["device", "device", "Lab", "Lab"]);
}

#[test]
fn lost_hosts_get_no_new_work_and_retries_move_on() {
    let none = Needs::default();
    let lost = [
        Host::device(4, 0),
        Host {
            lost: Some("connection refused".into()),
            ..pinned(8, 0)
        },
    ];
    let host = placed(place(SwarmHosts::Anywhere, &lost, &none, 8, None));
    assert!(host.is_device());
    assert_eq!(
        host.reason,
        "Box is out of contact (connection refused). Placed on this device (0 of 4 in use)."
    );
    assert!(matches!(
        place(SwarmHosts::Computers, &lost, &none, 8, None),
        Decision::Wait(reason) if reason.contains("Box")
    ));
    // A retry leaves the host it lost, for this device if nothing else.
    let hosts = [Host::device(4, 0), pinned(8, 1)];
    assert!(placed(place(SwarmHosts::Anywhere, &hosts, &none, 8, Some("Box"))).is_device());
    let spread = [Host::device(4, 0), pinned(8, 1), computer("Lab", 2, 0)];
    assert_eq!(
        placed(place(SwarmHosts::Computers, &spread, &none, 8, Some("Box"))).id,
        "Lab"
    );
    assert!(matches!(
        place(SwarmHosts::Computers, &hosts, &none, 8, Some("Box")),
        Decision::Refuse(_)
    ));
}

#[test]
fn the_pool_lists_hosts_for_each_kind_of_work() {
    let pool = Pool {
        loaded: true,
        computers: vec![
            PoolComputer {
                id: "box".into(),
                name: "Box".into(),
                pinned_by: Some("p".into()),
                health: Default::default(),
            },
            PoolComputer {
                id: "lab".into(),
                name: "Lab".into(),
                pinned_by: Some("other".into()),
                health: PoolHealth {
                    slots: Some(6),
                    ..Default::default()
                },
            },
            PoolComputer {
                id: "attic".into(),
                name: "Attic".into(),
                pinned_by: None,
                health: Default::default(),
            },
        ],
        projects: [(
            "p".to_string(),
            ProjectHosts {
                swarm_hosts: None,
                computers: vec!["lab".into(), "attic".into()],
            },
        )]
        .into(),
        needs: HashMap::new(),
    };
    let limits = Limits {
        device: 3,
        remote: 8,
    };
    let load: HashMap<String, usize> = [("box".to_string(), 2), ("lab".to_string(), 1)].into();
    let swarm = pool.hosts("p", true, false, limits, &load);
    let summary: Vec<_> = swarm
        .iter()
        .map(|host| (host.id.as_str(), host.pinned, host.limit, host.running))
        .collect();
    assert_eq!(
        summary,
        [
            ("device", false, 3, 0),
            ("box", true, 8, 2),
            ("lab", false, 6, 1),
            ("attic", false, DEFAULT_COMPUTER_SLOTS, 0)
        ]
    );
    // Other queued work keeps to its project's computer or this device.
    assert_eq!(pool.hosts("p", false, false, limits, &load).len(), 2);
    assert_eq!(pool.policy("p"), SwarmHosts::Anywhere);
    // Before the first tick, a project the coordinator knows runs on a
    // computer gets a stand-in for it.
    let empty = Pool::default();
    assert_eq!(
        empty.pinned("cloud", true).unwrap().0,
        "project:cloud".to_string()
    );
    assert!(empty.pinned("cloud", false).is_none());
}

#[test]
fn settings_round_trip_and_default_to_no_choice() {
    let root = std::env::temp_dir().join(format!("jackalope-pool-{}", uuid::Uuid::new_v4()));
    assert_eq!(settings(&root, "p"), ProjectHosts::default());
    save(
        &root,
        "p",
        ProjectHosts {
            swarm_hosts: Some(SwarmHosts::Computers),
            computers: vec!["b".into(), "a".into(), "a".into()],
        },
    )
    .unwrap();
    let saved = settings(&root, "p");
    assert_eq!(saved.swarm_hosts, Some(SwarmHosts::Computers));
    assert_eq!(saved.computers, ["a", "b"]);
    assert!(save(
        &root,
        "p",
        ProjectHosts {
            swarm_hosts: None,
            computers: vec!["../x".into()],
        },
    )
    .is_err());
    // Records written before the choice existed read as no choice.
    let old: ProjectHosts = serde_json::from_str("{}").unwrap();
    assert_eq!(old, ProjectHosts::default());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn health_follows_contact() {
    let id = format!("health-{}", uuid::Uuid::new_v4().simple());
    lost(&id, "timed out");
    assert!(health(&id).unavailable());
    let capabilities = RunnerCapabilities::from_status(Some(&serde_json::json!({
        "runs": 4, "capabilities": ["browser"], "slots": 3,
    })));
    seen(&id, Some(&capabilities));
    let now = health(&id);
    assert!(!now.unavailable() && now.lost.is_none() && now.last_seen.is_some());
    assert_eq!((now.browser, now.slots), (Some(true), Some(3)));
    assert_eq!(
        reported_slots(Some(&serde_json::json!({"slots": 99}))),
        None
    );
}

#[test]
fn finds_variable_names_in_instructions() {
    let names = named_variables("Use STRIPE_KEY (not stripe_key) and $DEPLOY_TOKEN; AC-1 ok");
    assert!(names.contains("STRIPE_KEY") && names.contains("DEPLOY_TOKEN"));
    assert!(!names.contains("stripe_key"));
}
