use super::*;
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTopic {
    pub id: String,
    pub title: String,
    pub message_ids: Vec<String>,
}

fn validate_topics(topics: &[SessionTopic], messages: &[SessionMessage]) -> Result<(), String> {
    if topics.len() > 100 {
        return Err("Keep at most 100 topics in a chat.".into());
    }
    let sources: HashSet<_> = messages
        .iter()
        .filter(|m| !m.canceled)
        .map(|m| &m.id)
        .collect();
    let mut ids = HashSet::new();
    for topic in topics {
        if Uuid::parse_str(&topic.id).is_err()
            || !ids.insert(&topic.id)
            || topic.title.trim().is_empty()
            || topic.title.len() > 240
            || topic.message_ids.is_empty()
            || topic.message_ids.len() > 500
            || topic.message_ids.iter().any(|id| !sources.contains(id))
            || topic.message_ids.iter().collect::<HashSet<_>>().len() != topic.message_ids.len()
        {
            return Err("A topic needs a unique identifier, a short title and existing, uncanceled source messages.".into());
        }
    }
    Ok(())
}

impl LiveSessions {
    pub(super) fn save_topics(
        &self,
        id: &str,
        revision: u64,
        topics: Vec<SessionTopic>,
    ) -> Result<(), String> {
        self.update(|ledger| {
            let session = LiveSessions::session(ledger, id)?;
            if session.topics_revision != revision {
                return Err(
                    "Topics changed in another window. Reload topics before saving.".into(),
                );
            }
            validate_topics(&topics, &session.messages)?;
            session.topics = topics;
            session.topics_revision = session
                .topics_revision
                .checked_add(1)
                .ok_or("Topic revision exhausted")?;
            Ok(())
        })
    }
}

#[tauri::command]
pub async fn live_session_topics(
    service: State<'_, LiveSessions>,
    app: AppHandle,
    id: String,
    revision: u64,
    topics: Vec<SessionTopic>,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.save_topics(&id, revision, topics))
        .await
        .map_err(|e| e.to_string())??;
    let _ = app.emit("live-sessions-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn topics_retain_only_valid_source_messages() {
        let messages = vec![SessionMessage {
            id: "source".into(),
            text: "Original".into(),
            created_at: String::new(),
            run_id: None,
            canceled: false,
        }];
        let mut topics = vec![SessionTopic {
            id: Uuid::new_v4().to_string(),
            title: "Topic".into(),
            message_ids: vec!["source".into()],
        }];
        assert!(validate_topics(&topics, &messages).is_ok());
        topics[0].message_ids.push("missing".into());
        assert!(validate_topics(&topics, &messages).is_err());
        topics[0].message_ids = vec!["source".into(), "source".into()];
        assert!(validate_topics(&topics, &messages).is_err());
    }
}
