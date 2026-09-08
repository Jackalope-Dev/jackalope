use super::*;
use axum::extract::Query;

pub(super) fn visible(message: &CoordinationMessage, item: &QueueItem) -> bool {
    message.project_id == item.project_id
        && (message.recipient_task_id.as_ref().is_none_or(|id| id == &item.id)
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
    let inner = service.inner.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(page(&inner.ledger.messages, &item, &query)))
}

fn page(messages: &[CoordinationMessage], item: &QueueItem, query: &InboxQuery) -> serde_json::Value {
    let messages: Vec<_> = messages.iter().filter(|m| visible(m, item)).collect();
    let cursor = query.after.as_ref().and_then(|id| messages.iter().position(|m| &m.id == id));
    let offset = cursor.map_or(0, |index| index + 1);
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let page: Vec<_> = messages.iter().skip(offset).take(limit).copied().collect();
    serde_json::json!({"messages":page,"nextCursor":page.last().map(|m| &m.id),"hasMore":offset + page.len() < messages.len(),"cursorExpired":query.after.is_some() && cursor.is_none(),"taskId":item.id})
}

#[derive(Deserialize, rmcp::schemars::JsonSchema)]
pub(in crate::commands) struct AckInput { pub id: String }

pub(in crate::commands) async fn bridge_ack(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Json(input): Json<AckInput>,
) -> Result<Json<CoordinationMessage>, StatusCode> {
    let item = service.authorized(&headers)?;
    let mut inner = service.inner.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut ledger = inner.ledger.clone();
    let message = ledger.messages.iter_mut().find(|m| m.id == input.id && visible(m, &item))
        .ok_or(StatusCode::NOT_FOUND)?;
    if !message.acknowledged_by.contains(&item.id) {
        if message.acknowledged_by.len() >= 256 { return Err(StatusCode::CONFLICT); }
        message.acknowledged_by.push(item.id);
    }
    let response = message.clone();
    service.save(&ledger).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    inner.ledger = ledger;
    Ok(Json(response))
}
