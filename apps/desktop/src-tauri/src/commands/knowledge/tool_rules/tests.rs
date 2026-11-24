use super::*;
use serde_json::json;

fn rule(value: Value) -> ToolRule {
    serde_json::from_value(value).unwrap()
}

fn lesson(id: &str, rule: Option<ToolRule>) -> KnowledgeEntry {
    serde_json::from_value(json!({
        "id":id,"projectId":"rules","projectPath":"/work","kind":"memory","title":format!("Rule {id}"),
        "content":"Lesson text","keywords":["rule"],"enabled":true,"sourceRunId":null,"revision":1,
        "updatedAt":"2026-01-01T00:00:00Z","toolRule":rule
    }))
    .unwrap()
}

fn rules(list: Vec<Value>) -> ToolRules {
    let entries: Vec<_> = list
        .into_iter()
        .enumerate()
        .map(|(index, value)| lesson(&index.to_string(), Some(rule(value))))
        .collect();
    ToolRules::from_entries(&entries)
}

fn shell(command: &str) -> ToolCall {
    ToolCall::claude("Bash", &json!({ "command": command }), "/work").unwrap()
}

#[test]
fn rules_are_checked_before_they_are_saved() {
    let check = |value| rule(value).normalize();
    assert!(check(json!({"tools":["shell"],"pattern":"rm -rf","message":"No."})).is_ok());
    for (value, error) in [
        (
            json!({"tools":[],"pattern":"x","message":"m"}),
            "at least one",
        ),
        (json!({"tools":["shell"],"message":"m"}), "pattern, a path"),
        (
            json!({"tools":["shell"],"pattern":"x","message":"  "}),
            "message",
        ),
        (
            json!({"tools":["shell"],"pattern":"(unclosed","message":"m"}),
            "pattern is not valid",
        ),
        (
            json!({"tools":["edit"],"path":"src/[","message":"m"}),
            "path is not valid",
        ),
        (
            json!({"tools":["shell"],"path":"*.lock","message":"m"}),
            "not shell commands",
        ),
        (
            json!({"tools":["shell"],"pattern":"x".repeat(501),"message":"m"}),
            "500 bytes",
        ),
        // A pattern whose compiled form is too large is refused, not built per call.
        (
            json!({"tools":["shell"],"pattern":"\\w{1000}\\w{1000}\\w{1000}","message":"m"}),
            "pattern is not valid",
        ),
    ] {
        let found = check(value).unwrap_err();
        assert!(found.contains(error), "{found}");
    }
    let mut value =
        rule(json!({"tools":["edit","write","edit"],"path":" .\\src\\*.ts ","message":" m "}));
    value.normalize().unwrap();
    assert_eq!(value.tools, [ToolKind::Write, ToolKind::Edit]);
    assert_eq!(value.path, "./src/*.ts");
    assert_eq!(value.message, "m");
}

#[test]
fn a_rule_matches_its_tool_kind_pattern_and_path() {
    let set = rules(vec![
        json!({"tools":["shell"],"pattern":"\\bgit\\s+push\\b.*--force","action":"deny","message":"Never force-push."}),
        json!({"tools":["write","edit"],"pattern":"console\\.log","path":"src/**/*.ts","message":"Use the logger."}),
        json!({"tools":["write"],"path":"*.lock","action":"deny","message":"Lockfiles come from the package manager."}),
    ]);
    let found = set.check(&shell("git status && git push origin main --force"));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].action, RuleAction::Deny);
    assert_eq!(found[0].message, "Never force-push.");
    assert!(set.check(&shell("git push origin main")).is_empty());

    let write = |path: &str, content: &str| {
        ToolCall::claude(
            "Write",
            &json!({"file_path": path, "content": content}),
            "/work",
        )
        .unwrap()
    };
    assert_eq!(
        set.check(&write("/work/src/app/main.ts", "console.log(1)"))
            .len(),
        1
    );
    // Wrong folder, wrong content, or outside the workspace.
    assert!(set
        .check(&write("/work/test/main.ts", "console.log(1)"))
        .is_empty());
    assert!(set
        .check(&write("/work/src/main.ts", "logger.info(1)"))
        .is_empty());
    assert!(set
        .check(&write("/elsewhere/src/main.ts", "console.log(1)"))
        .is_empty());
    // A glob without a folder matches the file name anywhere.
    assert_eq!(set.check(&write("/work/apps/web/pnpm.lock", "")).len(), 1);
    // A write-only rule ignores edits.
    let edit = ToolCall::claude(
        "Edit",
        &json!({"file_path":"/work/pnpm.lock","old_string":"a","new_string":"b"}),
        "/work",
    )
    .unwrap();
    assert!(set.check(&edit).is_empty());
    // Edits match the text they write, not the text they replace.
    let edit = |old: &str, new: &str| {
        ToolCall::claude(
            "MultiEdit",
            &json!({"file_path":"/work/src/a.ts","edits":[{"old_string":old,"new_string":new}]}),
            "/work",
        )
        .unwrap()
    };
    assert_eq!(set.check(&edit("x", "console.log(x)")).len(), 1);
    assert!(set.check(&edit("console.log(x)", "log(x)")).is_empty());
}

#[test]
fn only_available_lessons_supply_rules() {
    let value = rule(json!({"tools":["shell"],"pattern":"curl","message":"No downloads."}));
    let mut paused = lesson("paused", Some(value.clone()));
    paused.enabled = false;
    let mut removed = lesson("removed", Some(value.clone()));
    removed.dismissed = true;
    let mut workflow = lesson("workflow", Some(value.clone()));
    workflow.kind = KnowledgeKind::Workflow;
    let broken = lesson(
        "broken",
        Some(rule(json!({"tools":["shell"],"pattern":"(","message":"m"}))),
    );
    let set = ToolRules::from_entries(&[
        paused,
        removed,
        workflow,
        broken,
        lesson("plain", None),
        lesson("live", Some(value)),
    ]);
    let found = set.check(&shell("curl example.com"));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].entry_id, "live");
}

#[test]
fn matching_reads_a_bounded_prefix_of_large_text() {
    let set = rules(vec![
        json!({"tools":["write"],"pattern":"NEEDLE","message":"m"}),
    ]);
    let mut content = "é".repeat(TEXT_BYTES);
    content.push_str("NEEDLE");
    let call = ToolCall::claude(
        "Write",
        &json!({"file_path":"/work/a.txt","content":content}),
        "/work",
    )
    .unwrap();
    assert!(set.check(&call).is_empty());
}

#[test]
fn acp_and_opencode_requests_become_tool_calls() {
    assert_eq!(
        ToolCall::acp(
            &json!({"kind":"execute","rawInput":{"command":["git","push","--force"]}}),
            "/work"
        ),
        Some(ToolCall {
            kind: ToolKind::Shell,
            text: "git push --force".into(),
            paths: vec![],
        })
    );
    let write = ToolCall::acp(
        &json!({"kind":"edit","rawInput":{"path":"/work/src/a.ts","content":"x"}}),
        "/work",
    )
    .unwrap();
    assert_eq!(
        (write.kind, write.paths),
        (ToolKind::Write, vec!["src/a.ts".to_string()])
    );
    let edit = ToolCall::acp(
        &json!({"kind":"edit","rawInput":{"path":"src/a.ts","oldText":"a","newText":"b"}}),
        "/work",
    )
    .unwrap();
    assert_eq!((edit.kind, edit.text.as_str()), (ToolKind::Edit, "b"));
    assert_eq!(ToolCall::acp(&json!({"kind":"read"}), "/work"), None);

    let edit = ToolCall::opencode(
        "edit",
        &["/work/src/a.ts".into()],
        &json!({"diff":"--- a\n+++ b\n-old line\n+new line\n context"}),
        "/work",
    )
    .unwrap();
    assert_eq!(edit.kind, ToolKind::Edit);
    assert_eq!(edit.text, "new line");
    assert_eq!(edit.paths, ["src/a.ts"]);
    let bash = ToolCall::opencode("bash", &["npm i".into()], &json!({}), "/work").unwrap();
    assert_eq!((bash.kind, bash.text.as_str()), (ToolKind::Shell, "npm i"));
    assert_eq!(
        ToolCall::opencode("webfetch", &[], &json!({}), "/work"),
        None
    );
}

#[test]
fn feedback_separates_denials_from_warnings() {
    let found = |action, message: &str| RuleMatch {
        entry_id: "1".into(),
        title: "Title".into(),
        action,
        message: message.into(),
    };
    assert_eq!(feedback(ToolKind::Shell, &[]), (None, None));
    let (denied, warned) = feedback(
        ToolKind::Shell,
        &[
            found(RuleAction::Deny, "Use pnpm."),
            found(RuleAction::Warn, "Prefer scripts."),
        ],
    );
    let denied = denied.unwrap();
    assert!(denied.contains("blocked this shell command"), "{denied}");
    assert!(denied.contains("Project rule \"Title\": Use pnpm."));
    assert!(!denied.contains("Prefer scripts."));
    assert!(warned
        .unwrap()
        .contains("Project rule \"Title\": Prefer scripts."));
    assert_eq!(
        activity_line(&found(RuleAction::Warn, "m"), "Bash: ls"),
        "Tool rule \"Title\" warned on Bash: ls"
    );
}
