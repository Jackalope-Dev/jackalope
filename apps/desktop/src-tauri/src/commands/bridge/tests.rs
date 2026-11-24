use super::*;

#[test]
fn the_table_names_each_tool_and_route_once() {
    let mut names: Vec<&str> = tools().iter().map(|tool| tool.name).collect();
    let count = names.len();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), count);
    let mut routes: Vec<(bool, &str)> = tools()
        .iter()
        .filter_map(|tool| tool.route.map(|route| (route.get, route.path)))
        .collect();
    let count = routes.len();
    routes.sort_unstable();
    routes.dedup();
    assert_eq!(routes.len(), count);
}

#[test]
fn discovery_loads_groups_or_named_optional_tools() {
    let group = |group: Group| -> BTreeSet<String> {
        tools()
            .iter()
            .filter(|tool| tool.group == Some(group))
            .map(|tool| tool.name.to_owned())
            .collect()
    };
    assert_eq!(
        requested(&["browser".into()]).unwrap(),
        group(Group::Browser)
    );
    assert_eq!(
        requested(&["desktop".into()]).unwrap(),
        group(Group::Desktop)
    );
    assert_eq!(
        requested(&["message".into()]).unwrap(),
        BTreeSet::from(["message".to_owned()])
    );
    assert!(requested(&["execute_tool".into()]).is_err());
    assert!(requested(&["browser".into(), "unknown".into()]).is_err());
    assert_eq!(
        requested(&[]).unwrap().len(),
        tools().iter().filter(|tool| tool.group.is_some()).count()
    );
    for core in ["ask_user", "computer_verify", "project", "record_decision"] {
        assert!(find(core).unwrap().group.is_none(), "{core}");
    }
}

#[test]
fn codex_approves_each_browser_and_desktop_call() {
    let policy = codex_tool_policy();
    assert_eq!(policy["browser_interact"]["approval_mode"], "approve");
    assert_eq!(policy["computer_exec"]["approval_mode"], "approve");
    assert!(policy.get("execute_tool").is_none());
    assert!(policy.get("computer_verify").is_none());
    assert!(policy.get("message").is_none());
}

#[test]
fn messages_take_only_the_known_kinds_and_their_own_project() {
    let parse =
        |value: Value| Args::Json(value).parse::<crate::commands::coordination::MessageInput>();
    assert!(parse(json!({"kind":"approve","text":"Start all work"})).is_err());
    assert!(parse(json!({"kind":"progress","text":"Done","projectId":"other-project"})).is_err());
    for kind in crate::commands::coordination::MessageKind::ALL {
        assert!(parse(json!({"kind":kind.as_str(),"text":"Done","recipientTaskId":"t"})).is_ok());
    }
}

#[test]
fn errors_keep_their_meaning_on_both_transports() {
    let arguments = ToolError::arguments("missing field `id`".into());
    assert_eq!(arguments.code(), StatusCode::BAD_REQUEST);
    assert_eq!(arguments.message(), "Invalid arguments: missing field `id`");
    let error = arguments.into_mcp().unwrap_err();
    assert!(error
        .message
        .starts_with("failed to deserialize parameters:"));
    let denied = ToolError::denied("The user denied this action.")
        .into_mcp()
        .unwrap();
    assert_eq!(denied.is_error, Some(true));
    let limit = ToolError::status(StatusCode::TOO_MANY_REQUESTS, "limit");
    assert_eq!(limit.code(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        limit.into_mcp().unwrap_err().code,
        ErrorData::invalid_request("", None).code
    );
    let expired = ToolError::from(StatusCode::UNAUTHORIZED);
    assert!(expired.message().contains("no longer has access"));
}

#[test]
fn only_listed_offers_are_refused_at_call_time() {
    let run = TaskRun::default();
    assert!(find("bots").unwrap().permits(&run).is_err());
    assert_eq!(
        find("read_context").unwrap().permits(&run).is_ok(),
        context_read()
    );
    for name in ["computer_verify", "search_tools", "ask_jev", "project"] {
        assert!(find(name).unwrap().permits(&run).is_ok(), "{name}");
    }
}

#[test]
fn connection_reads_reject_retired_text_selections() {
    assert!(
        serde_json::from_value::<crate::commands::mcp_broker::results::Selection>(
            json!({"text":{"terms":["example"]}})
        )
        .is_err()
    );
}
