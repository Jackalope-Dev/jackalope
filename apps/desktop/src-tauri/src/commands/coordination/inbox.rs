use super::*;
use axum::extract::Query;
use rmcp::schemars;

pub(super) fn visible(message: &CoordinationMessage, item: &QueueItem) -> bool {
    message.project_id == item.project_id
        && (message
            .recipient_task_id
            .as_ref()
            .is_none_or(|id| id == &item.id)
            || message.task_id == item.id)
}

#[derive(Default, Deserialize, rmcp::schemars::JsonSchema)]
pub(in crate::commands) struct InboxQuery {
    pub wait_ms: Option<u64>,
    pub after: Option<String>,
    pub limit: Option<usize>,
}

pub(in crate::commands) async fn bridge_inbox(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Query(query): Query<InboxQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let deadline =
        tokio::time::Instant::now() + Duration::from_millis(query.wait_ms.unwrap_or(0).min(30_000));
    loop {
        let item = service.authorized(&headers)?;
        let result = {
            let inner = service
                .inner
                .lock()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            page(&inner.ledger.messages, &item, &query)
        };
        if result["messages"].as_array().is_some_and(|m| !m.is_empty())
            || result["cursorExpired"] == true
            || tokio::time::Instant::now() >= deadline
        {
            return Ok(Json(result));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn page(
    messages: &[CoordinationMessage],
    item: &QueueItem,
    query: &InboxQuery,
) -> serde_json::Value {
    let messages: Vec<_> = messages.iter().filter(|m| visible(m, item)).collect();
    let cursor = query
        .after
        .as_ref()
        .and_then(|id| messages.iter().position(|m| &m.id == id));
    let offset = cursor.map_or(0, |index| index + 1);
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let page: Vec<_> = messages.iter().skip(offset).take(limit).copied().collect();
    serde_json::json!({"messages":page,"nextCursor":page.last().map(|m| &m.id).or(query.after.as_ref()),"hasMore":offset + page.len() < messages.len(),"cursorExpired":query.after.is_some() && cursor.is_none(),"taskId":item.id})
}

#[derive(Deserialize, rmcp::schemars::JsonSchema)]
pub(in crate::commands) struct AckInput {
    pub id: String,
}

pub(in crate::commands) async fn bridge_ack(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Json(input): Json<AckInput>,
) -> Result<Json<CoordinationMessage>, StatusCode> {
    let item = service.authorized(&headers)?;
    let mut inner = service
        .inner
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut ledger = inner.ledger.clone();
    let message = ledger
        .messages
        .iter_mut()
        .find(|m| m.id == input.id && visible(m, &item))
        .ok_or(StatusCode::NOT_FOUND)?;
    if !message.acknowledged_by.contains(&item.id) {
        if message.acknowledged_by.len() >= 256 {
            return Err(StatusCode::CONFLICT);
        }
        message.acknowledged_by.push(item.id);
    }
    let response = message.clone();
    service
        .save(&ledger)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    inner.ledger = ledger;
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item() -> QueueItem {
        serde_json::from_value(serde_json::json!({"id":"reader","projectId":"p","projectName":"P","projectPath":"/fixture","title":"Reader","prompt":"Read","agent":"codex","scopes":[],"dependencies":[],"createdAt":"now","runId":null,"error":null,"canceled":false})).unwrap()
    }
    fn message(id: &str, project: &str, recipient: Option<&str>) -> CoordinationMessage {
        CoordinationMessage {
            report: None,
            run_id: None,
            source_tree: None,
            resolved_by: None,
            id: id.into(),
            task_id: "writer".into(),
            project_id: project.into(),
            kind: "progress".into(),
            text: "Untrusted observation".into(),
            created_at: "now".into(),
            recipient_task_id: recipient.map(str::to_string),
            acknowledged_by: vec![],
        }
    }
    #[test]
    fn inbox_scopes_recipients_and_pages_without_losing_cursor_expiry() {
        let messages = vec![
            message("a", "p", None),
            message("b", "other", None),
            message("c", "p", Some("someone-else")),
            message("d", "p", Some("reader")),
        ];
        let first = page(
            &messages,
            &item(),
            &InboxQuery {
                wait_ms: None,
                after: None,
                limit: Some(1),
            },
        );
        assert_eq!(first["messages"][0]["id"], "a");
        assert_eq!(first["hasMore"], true);
        let second = page(
            &messages,
            &item(),
            &InboxQuery {
                wait_ms: None,
                after: Some("a".into()),
                limit: Some(1000),
            },
        );
        assert_eq!(second["messages"].as_array().unwrap().len(), 1);
        assert_eq!(second["messages"][0]["id"], "d");
        assert_eq!(second["hasMore"], false);
        assert_eq!(
            page(
                &messages,
                &item(),
                &InboxQuery {
                    wait_ms: None,
                    after: Some("pruned".into()),
                    limit: None
                }
            )["cursorExpired"],
            true
        );
    }
    #[test]
    fn legacy_messages_keep_broadcast_semantics_and_receipts_round_trip() {
        let mut message: CoordinationMessage = serde_json::from_value(serde_json::json!({"id":"old","taskId":"writer","projectId":"p","kind":"blocker","text":"Need a decision","createdAt":"now"})).unwrap();
        assert!(visible(&message, &item()));
        assert!(message.acknowledged_by.is_empty());
        message.acknowledged_by.push("reader".into());
        let saved: CoordinationMessage =
            serde_json::from_slice(&serde_json::to_vec(&message).unwrap()).unwrap();
        assert_eq!(saved.acknowledged_by, ["reader"]);
    }

    #[tokio::test]
    async fn authenticated_manual_tasks_share_inventory_and_durable_addressed_receipts() {
        let directory = std::env::temp_dir().join(format!("jackalope-inbox-{}", Uuid::new_v4()));
        let history = directory.join("history");
        std::fs::create_dir_all(&history).unwrap();
        for (id, project) in [
            ("sender-run", "p"),
            ("reader-run", "p"),
            ("foreign-run", "other"),
        ] {
            let record = serde_json::json!({"id":id,"taskId":format!("{id}-task"),"projectId":project,"projectName":"Fixture","projectPath":"","workspace":"","branch":"","baseHead":"","agent":"codex","account":"fixture","model":null,"prompt":"Fixture manual task","status":"review","startedAt":"2026-09-08T00:00:00Z","endedAt":null,"sessionId":null,"result":"","activity":[],"error":null,"persistenceError":null,"exitCode":null,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false,"estimatedCostUsd":null}});
            std::fs::write(history.join(format!("{id}.json")), record.to_string()).unwrap();
        }
        let runtime = TaskRuntime::with_test_access(history).unwrap();
        let service = Coordinator::new(directory.join("coordination"), runtime.clone()).unwrap();
        for id in ["sender-run", "reader-run", "foreign-run"] {
            runtime.update(id, |run| run.status = "running".into());
            service
                .inner
                .lock()
                .unwrap()
                .grants
                .insert(id.into(), (id.into(), id.into()));
        }
        let headers = |id: &str| {
            let mut headers = HeaderMap::new();
            headers.insert("authorization", format!("Bearer {id}").parse().unwrap());
            headers
        };
        let Json(project) = bridge_project(WebState(service.clone()), headers("sender-run"))
            .await
            .unwrap();
        assert_eq!(project["assignedTaskId"], "sender-run-task");
        assert_eq!(project["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(project["tasks"][0]["scopeKnown"], false);
        let request = |recipient: &str| MessageRequest {
            report: None,
            resolves: None,
            kind: "handoff".into(),
            text: "Please inspect the result".into(),
            recipient_task_id: Some(recipient.into()),
        };
        assert_eq!(
            bridge_message(
                WebState(service.clone()),
                headers("sender-run"),
                Json(request("foreign-run-task"))
            )
            .await
            .err(),
            Some(StatusCode::BAD_REQUEST)
        );
        let Json(message) = bridge_message(
            WebState(service.clone()),
            headers("sender-run"),
            Json(request("reader-run-task")),
        )
        .await
        .unwrap();
        assert_eq!(
            bridge_ack(
                WebState(service.clone()),
                headers("foreign-run"),
                Json(AckInput {
                    id: message.id.clone()
                })
            )
            .await
            .err(),
            Some(StatusCode::NOT_FOUND)
        );
        for _ in 0..2 {
            let Json(ack) = bridge_ack(
                WebState(service.clone()),
                headers("reader-run"),
                Json(AckInput {
                    id: message.id.clone(),
                }),
            )
            .await
            .unwrap();
            assert_eq!(ack.acknowledged_by, ["reader-run-task"]);
        }
        let mut resolution = request("sender-run-task");
        resolution.kind = "progress".into();
        resolution.resolves = Some(message.id.clone());
        let Json(reply) = bridge_message(
            WebState(service.clone()),
            headers("reader-run"),
            Json(resolution),
        )
        .await
        .unwrap();
        assert_eq!(
            service
                .view()
                .unwrap()
                .messages
                .iter()
                .find(|m| m.id == message.id)
                .unwrap()
                .resolved_by
                .as_ref(),
            Some(&reply.id)
        );
        let Json(empty) = bridge_inbox(
            WebState(service.clone()),
            headers("reader-run"),
            Query(InboxQuery {
                after: Some(reply.id.clone()),
                limit: None,
                wait_ms: Some(1),
            }),
        )
        .await
        .unwrap();
        assert_eq!(empty["nextCursor"], reply.id);
        assert!(empty["messages"].as_array().unwrap().is_empty());
        let waiting = bridge_inbox(
            WebState(service.clone()),
            headers("reader-run"),
            Query(InboxQuery {
                after: Some(reply.id),
                limit: None,
                wait_ms: Some(1000),
            }),
        );
        let sending = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            bridge_message(
                WebState(service.clone()),
                headers("sender-run"),
                Json(request("reader-run-task")),
            )
            .await
            .unwrap()
        };
        let (received, sent) = tokio::join!(waiting, sending);
        assert_eq!(received.unwrap().0["messages"][0]["id"], sent.0.id);
        let mut origin = headers("reader-run");
        origin.insert("origin", "https://example.invalid".parse().unwrap());
        assert_eq!(
            bridge_inbox(
                WebState(service.clone()),
                origin,
                Query(InboxQuery::default())
            )
            .await
            .err(),
            Some(StatusCode::FORBIDDEN)
        );
        runtime.update("reader-run", |run| run.status = "review".into());
        assert_eq!(
            bridge_inbox(
                WebState(service.clone()),
                headers("reader-run"),
                Query(InboxQuery::default())
            )
            .await
            .err(),
            Some(StatusCode::UNAUTHORIZED)
        );
        drop(service);
        let restored = Coordinator::new(directory.join("coordination"), runtime.clone()).unwrap();
        assert_eq!(
            restored.view().unwrap().messages[0].acknowledged_by,
            ["reader-run-task"]
        );
        drop(restored);
        drop(runtime);
        assert!(directory.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
