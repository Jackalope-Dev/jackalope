use super::wakes::{digest, evaluate};
use super::*;
use crate::commands::{coordination::Coordinator, tasks::TaskRun};
use std::process::Command;

struct Fixture {
    _root: PathBuf,
    hub: BotHub,
    sessions: LiveSessions,
    repo: PathBuf,
}

fn fixture() -> Fixture {
    let root = std::env::temp_dir().join(format!("jackalope-bots-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    for args in [
        vec!["init", "-b", "main"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    ] {
        assert!(Command::new("git")
            .current_dir(&repo)
            .args(args)
            .output()
            .unwrap()
            .status
            .success());
    }
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let coordinator = Coordinator::new(root.join("coordination"), runtime.clone()).unwrap();
    let sessions = LiveSessions::new(
        root.join("sessions/sessions.json"),
        runtime.clone(),
        coordinator,
    );
    let hub = BotHub::new(root.join("bots/hub.json"), runtime, sessions.clone());
    Fixture {
        _root: root,
        hub,
        sessions,
        repo,
    }
}

fn bot(fixture: &Fixture, name: &str) -> HubBot {
    HubBot {
        id: Uuid::new_v4().to_string(),
        name: name.into(),
        role: format!("{name} role"),
        instructions: format!("Act as {name}."),
        collaborate: true,
        wakes: vec![],
        request: serde_json::from_value(serde_json::json!({
            "id": Uuid::new_v4().to_string(),
            "projectId": "fixture",
            "projectName": "Fixture",
            "projectPath": fixture.repo.to_string_lossy(),
            "agent": "codex",
            "model": null,
            "prompt": "Bot",
            "isolated": true,
            "previousRunId": null,
        }))
        .unwrap(),
    }
}

fn schedule(expression: &str) -> WakeDefinition {
    WakeDefinition {
        id: Uuid::new_v4().to_string(),
        name: "Morning check".into(),
        prompt: "Look for new failures.".into(),
        enabled: true,
        trigger: WakeTrigger::Schedule {
            expression: expression.into(),
            timezone: "UTC".into(),
        },
    }
}

/// A bot's conversation with one dispatched-looking task, as the coordination tools see it.
fn conversation(fixture: &Fixture, bot: &HubBot) -> TaskRun {
    let (session, _) = fixture
        .hub
        .deliver(
            bot,
            "Start",
            MessageOrigin {
                kind: "wake".into(),
                label: "Test".into(),
                bot_id: None,
                bot_name: None,
                session_id: None,
            },
            None,
        )
        .unwrap();
    TaskRun {
        id: Uuid::new_v4().to_string(),
        live_session_id: Some(session),
        ..Default::default()
    }
}

#[test]
fn sync_validates_wakes_and_keeps_progress_for_unchanged_triggers() {
    let fixture = fixture();
    let mut scout = bot(&fixture, "Scout");
    scout.wakes.push(schedule("0 9 * * 1-5"));
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    fixture.hub.check_wakes(Utc::now()).unwrap();
    let first = fixture.hub.snapshot().unwrap().wakes;
    assert_eq!(first.len(), 1);
    assert!(first[0].next_check_at.is_some());

    scout.role = "Edited".into();
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    assert_eq!(fixture.hub.snapshot().unwrap().wakes.len(), 1);

    scout.wakes[0].trigger = WakeTrigger::Schedule {
        expression: "0 10 * * *".into(),
        timezone: "UTC".into(),
    };
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    assert!(fixture.hub.snapshot().unwrap().wakes.is_empty());

    let mut invalid = scout.clone();
    invalid.wakes[0].trigger = WakeTrigger::Schedule {
        expression: "every morning".into(),
        timezone: "UTC".into(),
    };
    assert!(fixture.hub.sync(vec![invalid]).is_err());
    let mut scoped = scout.clone();
    scoped.request.connection_ids = Some(vec!["github".into()]);
    scoped.wakes[0].trigger = WakeTrigger::Connection {
        connection_id: "linear".into(),
        tool: "list_issues".into(),
        arguments: Default::default(),
        interval_minutes: 15,
    };
    assert!(fixture.hub.sync(vec![scoped]).is_err());
}

#[test]
fn schedules_take_a_due_time_fire_once_and_skip_late_runs() {
    let wake = schedule("*/5 * * * *");
    let now = Utc::now();
    let first = evaluate(&wake, None, now, None).unwrap();
    assert!(first.wake.is_none());
    let due = first.next_check_at.unwrap();
    let state = WakeState {
        next_check_at: Some(due),
        ..Default::default()
    };
    let on_time = evaluate(&wake, Some(&state), due + Span::seconds(3), None).unwrap();
    assert!(on_time.wake.unwrap().contains("Look for new failures."));
    assert!(on_time.next_check_at.unwrap() > due);
    let late = evaluate(&wake, Some(&state), due + Span::minutes(30), None).unwrap();
    assert!(late.wake.is_none());
    assert!(late.note.unwrap().contains("Missed"));
}

#[test]
fn observers_record_a_baseline_then_wake_only_on_change() {
    let wake = WakeDefinition {
        trigger: WakeTrigger::Connection {
            connection_id: "linear".into(),
            tool: "list_issues".into(),
            arguments: Default::default(),
            interval_minutes: 10,
        },
        ..schedule("* * * * *")
    };
    let now = Utc::now();
    let result = |text: &str| {
        digest(&rmcp::model::CallToolResult::success(vec![
            rmcp::model::ContentBlock::text(text),
        ]))
    };
    let baseline = evaluate(&wake, None, now, Some(result("one issue"))).unwrap();
    assert!(baseline.wake.is_none());
    assert_eq!(baseline.next_check_at, Some(now + Span::minutes(10)));
    let state = WakeState {
        baseline: baseline.baseline.clone(),
        next_check_at: baseline.next_check_at,
        ..Default::default()
    };
    let same = evaluate(&wake, Some(&state), now, Some(result("one issue"))).unwrap();
    assert!(same.wake.is_none() && same.baseline.is_none());
    let changed = evaluate(&wake, Some(&state), now, Some(result("two issues"))).unwrap();
    assert!(changed.wake.unwrap().contains("two issues"));
    let failed = evaluate(&wake, Some(&state), now, Some(Err("offline".into()))).unwrap();
    assert!(failed.wake.is_none() && failed.note.unwrap().contains("offline"));
}

#[test]
fn bots_message_each_other_within_limits_and_replies_return() {
    let fixture = fixture();
    let reviewer = bot(&fixture, "Reviewer");
    let mut tester = bot(&fixture, "Tester");
    fixture
        .hub
        .sync(vec![reviewer.clone(), tester.clone()])
        .unwrap();
    let run = conversation(&fixture, &reviewer);
    let listed = fixture
        .hub
        .directory(
            &run,
            DirectoryInput {
                query: "tester".into(),
            },
        )
        .unwrap();
    assert_eq!(listed["bots"][0]["name"], "Tester");
    assert!(fixture
        .hub
        .message(
            &run,
            BotMessageInput {
                bot_id: reviewer.id.clone(),
                text: "Hi".into(),
                expect_reply: true
            }
        )
        .is_err());
    let sent = fixture
        .hub
        .message(
            &run,
            BotMessageInput {
                bot_id: tester.id.clone(),
                text: "Add a test for the parser".into(),
                expect_reply: true,
            },
        )
        .unwrap();
    let target = sent["conversationId"].as_str().unwrap().to_owned();
    let snapshot = fixture.sessions.snapshot(None).unwrap();
    let delivered = snapshot.sessions.iter().find(|s| s.id == target).unwrap();
    assert_eq!(delivered.persona.as_ref().unwrap().bot_id, tester.id);
    assert_eq!(delivered.limits.max_batches, Some(AUTONOMOUS_BATCHES));
    let origin = delivered.messages[0].origin.as_ref().unwrap();
    assert_eq!(origin.bot_name.as_deref(), Some("Reviewer"));

    // The recipient's conversation is deeper, so hand-offs stop after a few hops.
    let relay = fixture.hub.snapshot().unwrap().relays.remove(0);
    assert_eq!(relay.depth, 1);
    fixture
        .hub
        .update(|ledger| {
            ledger.depths.insert(target.clone(), MAX_DEPTH);
            Ok(())
        })
        .unwrap();
    let deep = TaskRun {
        live_session_id: Some(target.clone()),
        ..Default::default()
    };
    assert!(fixture
        .hub
        .message(
            &deep,
            BotMessageInput {
                bot_id: reviewer.id.clone(),
                text: "Back to you".into(),
                expect_reply: true
            }
        )
        .unwrap_err()
        .contains("hand-offs"));

    tester.collaborate = false;
    fixture
        .hub
        .sync(vec![reviewer.clone(), tester.clone()])
        .unwrap();
    assert!(fixture
        .hub
        .message(
            &run,
            BotMessageInput {
                bot_id: tester.id.clone(),
                text: "Again".into(),
                expect_reply: false
            }
        )
        .is_err());

    // Canceling the delivered message settles the hand-off with a visible note.
    fixture
        .sessions
        .action(&target, "cancel-message", Some(&relay.message_id))
        .unwrap();
    fixture.hub.route_replies().unwrap();
    let snapshot = fixture.sessions.snapshot(None).unwrap();
    let origin_session = snapshot
        .sessions
        .iter()
        .find(|s| Some(&s.id) == run.live_session_id.as_ref())
        .unwrap();
    let reply = origin_session.messages.last().unwrap();
    assert_eq!(reply.origin.as_ref().unwrap().kind, "reply");
    assert!(reply.text.contains("canceled"));
    assert!(fixture.hub.snapshot().unwrap().relays.is_empty());
}

#[test]
fn cards_and_suggestions_wait_for_the_person() {
    let fixture = fixture();
    let scout = bot(&fixture, "Scout");
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    let run = conversation(&fixture, &scout);
    let session = run.live_session_id.clone().unwrap();
    let decision = |options: Vec<OptionInput>| PresentInput {
        kind: CardKind::Decision,
        title: "Upgrade React?".into(),
        body: "A major version is available.".into(),
        options,
        sources: vec![SourceInput {
            title: "Release notes".into(),
            url: Some("https://example.com/notes".into()),
            path: None,
        }],
        allow_text: None,
    };
    assert!(fixture.hub.present(&run, decision(vec![])).is_err());
    let card = fixture
        .hub
        .present(
            &run,
            decision(vec![
                OptionInput {
                    label: "Upgrade".into(),
                    reply: Some("Go ahead on a branch".into()),
                },
                OptionInput {
                    label: "Wait".into(),
                    reply: None,
                },
            ]),
        )
        .unwrap();
    let id = card["cardId"].as_str().unwrap().to_owned();
    assert!(fixture
        .hub
        .resolve_card(&id, "answer", Some(9), None)
        .is_err());
    assert!(fixture
        .hub
        .resolve_card(&id, "answer", None, Some("free text".into()))
        .is_err());
    fixture
        .hub
        .resolve_card(&id, "answer", Some(0), None)
        .unwrap();
    assert!(fixture
        .hub
        .resolve_card(&id, "dismiss", None, None)
        .is_err());
    let snapshot = fixture.sessions.snapshot(None).unwrap();
    let answered = snapshot.sessions.iter().find(|s| s.id == session).unwrap();
    let answer = answered.messages.last().unwrap();
    assert_eq!(answer.origin.as_ref().unwrap().kind, "card");
    assert!(answer.text.contains("Upgrade — Go ahead on a branch"));

    let suggestion = |name: &str| SuggestBotInput {
        name: name.into(),
        role: "Watches releases".into(),
        instructions: "Summarize releases.".into(),
        reason: "Nobody tracks upstream releases.".into(),
        wake_up: Some(WakeInput {
            name: "Weekly".into(),
            prompt: "Check releases.".into(),
            schedule: "0 9 * * 1".into(),
        }),
    };
    assert!(fixture.hub.suggest(&run, suggestion("scout")).is_err());
    let proposal = fixture.hub.suggest(&run, suggestion("Herald")).unwrap();
    assert!(fixture.hub.suggest(&run, suggestion("Herald")).is_err());
    let id = proposal["proposalId"].as_str().unwrap();
    fixture.hub.resolve_proposal(id, "dismiss", None).unwrap();
    assert!(fixture.hub.resolve_proposal(id, "accept", None).is_err());

    let outsider = TaskRun {
        live_session_id: None,
        ..Default::default()
    };
    assert!(!fixture.hub.is_bot_run(&outsider));
}

#[test]
fn bot_prompts_label_who_sent_each_message() {
    let fixture = fixture();
    let scout = bot(&fixture, "Scout");
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    conversation(&fixture, &scout);
    let session = fixture.sessions.snapshot(None).unwrap().sessions.remove(0);
    let prompt = crate::commands::live_sessions::batch_prompt_for_test(&session);
    assert!(prompt.contains("Wake-up (Test)"));
    assert!(prompt.contains("Bot teamwork"));
}

#[test]
fn renderer_bots_and_wakes_deserialize_with_their_saved_shape() {
    let bot: HubBot = serde_json::from_value(serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "name": "Scout",
        "role": "Watches issues",
        "instructions": "",
        "collaborate": false,
        "wakes": [
            {"id": Uuid::new_v4().to_string(), "name": "Issues", "prompt": "Triage", "enabled": true,
             "trigger": {"kind": "connection", "connectionId": "linear", "tool": "list_issues",
                         "arguments": {"state": "open"}, "intervalMinutes": 15}},
            {"id": Uuid::new_v4().to_string(), "name": "Code", "prompt": "Review", "enabled": false,
             "trigger": {"kind": "repoChange", "path": "src"}},
            {"id": Uuid::new_v4().to_string(), "name": "Daily", "prompt": "Summarize", "enabled": true,
             "trigger": {"kind": "schedule", "expression": "0 9 * * 1-5", "timezone": "America/Denver"}}
        ],
        "request": {"id": "x", "projectId": "p", "projectName": "P", "projectPath": "/repo",
                    "agent": "auto", "prompt": "Bot", "isolated": true, "connectionIds": ["linear"]}
    }))
    .unwrap();
    assert!(!bot.collaborate);
    assert!(matches!(
        &bot.wakes[0].trigger,
        WakeTrigger::Connection { interval_minutes: 15, arguments, .. } if arguments["state"] == "open"
    ));
    assert_eq!(
        bot.wakes[1].trigger,
        WakeTrigger::RepoChange { path: "src".into() }
    );
    validate_bots(&[bot]).unwrap();
    let state = serde_json::to_value(WakeState {
        wake_id: "w".into(),
        ..Default::default()
    })
    .unwrap();
    assert!(state.get("wakeId").is_some() && state.get("lastSessionId").is_some());
}

#[test]
fn wake_ups_continue_their_open_conversation_and_paused_ones_do_not_block() {
    let fixture = fixture();
    let mut scout = bot(&fixture, "Scout");
    let wake = schedule("0 9 * * *");
    scout.wakes.push(wake.clone());
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    let first = fixture.hub.wake_now(&scout.id, &wake.id).unwrap();
    // Its message is still queued, so another wake-up waits.
    assert!(fixture
        .hub
        .wake_now(&scout.id, &wake.id)
        .unwrap_err()
        .contains("still working"));
    let queued = fixture.sessions.snapshot(None).unwrap().sessions[0].messages[0]
        .id
        .clone();
    fixture
        .sessions
        .action(&first, "cancel-message", Some(&queued))
        .unwrap();
    assert_eq!(fixture.hub.wake_now(&scout.id, &wake.id).unwrap(), first);
    fixture.sessions.action(&first, "pause", None).unwrap();
    let next = fixture.hub.wake_now(&scout.id, &wake.id).unwrap();
    assert_ne!(next, first);
    let snapshot = fixture.sessions.snapshot(None).unwrap();
    let title = &snapshot
        .sessions
        .iter()
        .find(|s| s.id == next)
        .unwrap()
        .title;
    assert!(title.starts_with("Morning check"));
}

#[test]
fn changes_found_while_busy_are_retried_and_pausing_stops_checks() {
    let fixture = fixture();
    let mut scout = bot(&fixture, "Scout");
    let wake = WakeDefinition {
        trigger: WakeTrigger::RepoChange {
            path: String::new(),
        },
        ..schedule("* * * * *")
    };
    scout.wakes.push(wake.clone());
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    let start = Utc::now();
    fixture.hub.check_wakes(start).unwrap();
    let baseline = fixture.hub.snapshot().unwrap().wakes[0].baseline.clone();
    assert!(baseline.is_some());
    // A queued wake-up message keeps the conversation busy.
    let session = fixture.hub.wake_now(&scout.id, &wake.id).unwrap();
    std::fs::write(fixture.repo.join("notes.txt"), "changed").unwrap();
    assert!(Command::new("git")
        .current_dir(&fixture.repo)
        .args(["add", "notes.txt"])
        .output()
        .unwrap()
        .status
        .success());
    assert!(Command::new("git")
        .current_dir(&fixture.repo)
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-m",
            "Change",
        ])
        .output()
        .unwrap()
        .status
        .success());
    let skipped = |hub: &BotHub| {
        hub.snapshot()
            .unwrap()
            .events
            .iter()
            .filter(|event| event.kind == "skipped")
            .count()
    };
    fixture.hub.check_wakes(start + Span::seconds(61)).unwrap();
    fixture.hub.check_wakes(start + Span::seconds(122)).unwrap();
    let snapshot = fixture.hub.snapshot().unwrap();
    assert_eq!(snapshot.wakes[0].baseline, baseline);
    assert_eq!(skipped(&fixture.hub), 1);

    fixture.hub.set_paused(true).unwrap();
    let queued = fixture.sessions.snapshot(None).unwrap().sessions[0].messages[0]
        .id
        .clone();
    fixture
        .sessions
        .action(&session, "cancel-message", Some(&queued))
        .unwrap();
    fixture.hub.check_wakes(start + Span::seconds(183)).unwrap();
    assert_eq!(fixture.hub.snapshot().unwrap().wakes[0].baseline, baseline);

    fixture.hub.set_paused(false).unwrap();
    fixture.hub.check_wakes(start + Span::seconds(244)).unwrap();
    let state = fixture.hub.snapshot().unwrap().wakes.remove(0);
    assert_ne!(state.baseline, baseline);
    assert_eq!(state.last_session_id.as_deref(), Some(session.as_str()));

    // Edited instructions reach the open conversation, so the next wake-up continues it.
    scout.instructions = "Be brief.".into();
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    let queued = fixture
        .sessions
        .snapshot(None)
        .unwrap()
        .sessions
        .into_iter()
        .find(|item| item.id == session)
        .unwrap()
        .messages
        .last()
        .unwrap()
        .id
        .clone();
    fixture
        .sessions
        .action(&session, "cancel-message", Some(&queued))
        .unwrap();
    assert_eq!(fixture.hub.wake_now(&scout.id, &wake.id).unwrap(), session);
    assert_eq!(
        fixture.sessions.persona(&session).unwrap().instructions,
        "Be brief."
    );
}

#[test]
fn deleting_a_bot_closes_its_open_cards_and_suggestions() {
    let fixture = fixture();
    let scout = bot(&fixture, "Scout");
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    let run = conversation(&fixture, &scout);
    fixture
        .hub
        .present(
            &run,
            PresentInput {
                kind: CardKind::Input,
                title: "Which branch?".into(),
                body: String::new(),
                options: vec![],
                sources: vec![],
                allow_text: None,
            },
        )
        .unwrap();
    fixture
        .hub
        .suggest(
            &run,
            SuggestBotInput {
                name: "Herald".into(),
                role: "Release notes".into(),
                instructions: "Summarize.".into(),
                reason: "Nobody writes them.".into(),
                wake_up: None,
            },
        )
        .unwrap();
    assert_eq!(fixture.hub.waiting().len(), 2);
    fixture.hub.sync(vec![]).unwrap();
    assert!(fixture.hub.waiting().is_empty());
    assert_eq!(fixture.hub.snapshot().unwrap().cards[0].status, "dismissed");
}

fn note(text: &str, replaces: Option<&str>) -> RememberInput {
    RememberInput {
        note: text.into(),
        replaces: replaces.map(Into::into),
    }
}

#[test]
fn bots_keep_bounded_notes_for_later_conversations() {
    let fixture = fixture();
    let scout = bot(&fixture, "Scout");
    let other = bot(&fixture, "Other");
    fixture
        .hub
        .sync(vec![scout.clone(), other.clone()])
        .unwrap();
    let run = conversation(&fixture, &scout);
    let saved = fixture
        .hub
        .remember(&run, note("The user prefers short replies.", None))
        .unwrap();
    let id = saved["noteId"].as_str().unwrap().to_owned();
    assert!(fixture
        .hub
        .notes_prompt(&scout.id)
        .contains("prefers short replies"));
    assert!(fixture.hub.notes_prompt(&other.id).is_empty());
    assert!(fixture.hub.remember(&run, note("", None)).is_err());
    assert!(fixture
        .hub
        .remember(&run, note(&"x".repeat(NOTE_CHARS + 1), None))
        .is_err());

    fixture
        .hub
        .remember(&run, note("The user prefers detailed replies.", Some(&id)))
        .unwrap();
    let prompt = fixture.hub.notes_prompt(&scout.id);
    assert!(prompt.contains("detailed") && !prompt.contains("short"));
    let theirs = conversation(&fixture, &other);
    assert!(fixture
        .hub
        .remember(&theirs, note("Not mine.", Some(&id)))
        .is_err());

    for index in 1..MAX_NOTES {
        fixture
            .hub
            .remember(&run, note(&format!("Note {index}"), None))
            .unwrap();
    }
    assert!(fixture
        .hub
        .remember(&run, note("One too many", None))
        .is_err());
    fixture.hub.remember(&run, note("", Some(&id))).unwrap();
    assert!(!fixture.hub.notes_prompt(&scout.id).contains("detailed"));

    let kept = fixture.hub.snapshot().unwrap().notes[0].id.clone();
    fixture.hub.forget_note(&kept).unwrap();
    assert!(fixture.hub.forget_note(&kept).is_err());
    fixture.hub.sync(vec![other]).unwrap();
    assert!(fixture.hub.snapshot().unwrap().notes.is_empty());
}

#[test]
fn edits_reach_open_conversations_and_new_ones_recall_recent_work() {
    let fixture = fixture();
    let mut scout = bot(&fixture, "Scout");
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    let first = conversation(&fixture, &scout);
    let first = first.live_session_id.unwrap();
    scout.name = "Scout Prime".into();
    scout.instructions = "Review only the lockfile.".into();
    fixture.hub.sync(vec![scout.clone()]).unwrap();
    let persona = fixture.sessions.persona(&first).unwrap();
    assert_eq!(persona.name, "Scout Prime");
    assert_eq!(persona.instructions, "Review only the lockfile.");

    let second = conversation(&fixture, &scout).live_session_id.unwrap();
    let sessions = fixture.sessions.snapshot(None).unwrap().sessions;
    let session = sessions.iter().find(|item| item.id == second).unwrap();
    let memory = fixture.sessions.bot_memory(session, &[]);
    assert!(memory.contains("Your latest other conversations"));
    assert!(memory.contains("(no reply yet)"));
    let plain = sessions.iter().find(|item| item.id == first).unwrap();
    let mut unrelated = plain.clone();
    unrelated.persona = None;
    assert!(fixture.sessions.bot_memory(&unrelated, &[]).is_empty());
}

#[test]
fn bridge_agents_reach_the_same_bot_tools_by_name() {
    let fixture = fixture();
    let scout = bot(&fixture, "Scout");
    let helper = bot(&fixture, "Helper");
    fixture
        .hub
        .sync(vec![scout.clone(), helper.clone()])
        .unwrap();
    let run = conversation(&fixture, &scout);
    let listed = fixture
        .hub
        .call(&run, "bots", serde_json::json!({}))
        .unwrap();
    assert_eq!(listed["bots"][0]["name"], "Helper");
    fixture
        .hub
        .call(
            &run,
            "remember",
            serde_json::json!({"note": "Ship on Fridays."}),
        )
        .unwrap();
    assert!(fixture
        .hub
        .notes_prompt(&scout.id)
        .contains("Ship on Fridays."));
    let error = fixture
        .hub
        .call(&run, "remember", serde_json::json!({"text": "wrong field"}))
        .unwrap_err();
    assert!(error.starts_with("Invalid arguments"));
    assert!(fixture
        .hub
        .call(&run, "delete_everything", serde_json::json!({}))
        .unwrap_err()
        .contains("remember"));
    let outsider = TaskRun {
        id: Uuid::new_v4().to_string(),
        ..Default::default()
    };
    assert!(fixture
        .hub
        .call(&outsider, "bots", serde_json::json!({}))
        .is_err());
}
