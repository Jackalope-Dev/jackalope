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
    pub after: Option<String>,
    pub limit: Option<usize>,
}

pub(in crate::commands) async fn bridge_inbox(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Query(query): Query<InboxQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let item = service.authorized(&headers)?;
    let inner = service
        .inner
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(page(&inner.ledger.messages, &item, &query)))
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
    serde_json::json!({"messages":page,"nextCursor":page.last().map(|m| &m.id),"hasMore":offset + page.len() < messages.len(),"cursorExpired":query.after.is_some() && cursor.is_none(),"taskId":item.id})
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
}
