use super::*;
use crate::commands::tasks::TaskRuntime;

const DAY: i64 = 86_400_000;
fn yes() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
#[serde(default)]
pub struct LocalFeedback {
    enabled: bool,
    prompts_enabled: bool,
    linked: bool,
    first_day: Option<i64>,
    active_days: u8,
    last_day: Option<i64>,
    results: Vec<String>,
    prompt_count: u8,
    prompt_id: Option<String>,
    next_prompt_at: i64,
    completed: bool,
    pending: Option<Action>,
}
impl Default for LocalFeedback {
    fn default() -> Self {
        Self {
            enabled: false,
            prompts_enabled: true,
            linked: false,
            first_day: None,
            active_days: 0,
            last_day: None,
            results: Vec::new(),
            prompt_count: 0,
            prompt_id: None,
            next_prompt_at: 0,
            completed: false,
            pending: None,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Status,
    Activity {
        #[serde(rename = "runId")]
        run_id: Option<String>,
    },
    Preferences {
        enabled: bool,
        #[serde(rename = "promptsEnabled")]
        prompts_enabled: bool,
    },
    Claim {
        id: String,
    },
    Later {
        id: String,
    },
    Stop,
    Completed,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackView {
    #[serde(default)]
    linked: bool,
    enabled: bool,
    #[serde(default = "yes")]
    prompts_enabled: bool,
    completed: bool,
    next_prompt_at: i64,
    prompt_count: u8,
    eligible: bool,
    claimed: bool,
}
impl LocalFeedback {
    fn eligible(&self, now: i64) -> bool {
        self.prompts_enabled
            && !self.completed
            && self.active_days >= 2
            && self.results.len() >= 2
            && self.prompt_count < 2
            && self.next_prompt_at <= now
    }
    fn view(&self, now: i64, claimed: bool) -> FeedbackView {
        FeedbackView {
            linked: self.linked,
            enabled: self.enabled,
            prompts_enabled: self.prompts_enabled,
            completed: self.completed,
            next_prompt_at: self.next_prompt_at,
            prompt_count: self.prompt_count,
            eligible: self.eligible(now),
            claimed,
        }
    }
    fn activity(&mut self, now: i64, task: Option<String>) {
        if self.completed || (!self.enabled && !self.prompts_enabled) {
            return;
        }
        let day = now.div_euclid(DAY);
        self.first_day.get_or_insert(day);
        if self.last_day.is_none_or(|last| day > last) {
            self.active_days = (self.active_days + 1).min(2);
            self.last_day = Some(day);
        }
        if let Some(task) = task {
            if self.results.len() < 2 && !self.results.contains(&task) {
                self.results.push(task);
            }
        }
    }
}
async fn remote(
    api: &reqwest::Url,
    record: &SavedAccount,
    body: serde_json::Value,
) -> Result<FeedbackView, String> {
    let (code, data) = request(
        api,
        "/v1/desktop/feedback",
        reqwest::Method::POST,
        Some(&record.secret),
        Some(body),
    )
    .await?;
    if code != 200 {
        return Err("Feedback preferences could not sync. Retry when connected; local feedback invitations are paused until then.".into());
    }
    let view: FeedbackView =
        serde_json::from_value(data).map_err(|_| "Invalid feedback response.")?;
    if view.prompt_count > 2 || view.next_prompt_at < 0 {
        return Err("Invalid feedback response.".into());
    }
    Ok(view)
}
fn remote_action(
    action: &Action,
    local: &LocalFeedback,
    now: i64,
) -> Result<serde_json::Value, String> {
    let mut body =
        serde_json::to_value(action).map_err(|_| "Could not prepare feedback request.")?;
    if matches!(action, Action::Preferences { .. }) {
        body["promptCount"] = local.prompt_count.into();
        body["nextPromptAt"] = local.next_prompt_at.min(now + 14 * DAY).max(0).into();
    }
    Ok(body)
}
fn merge(local: &mut LocalFeedback, remote: &FeedbackView) {
    local.enabled = remote.enabled;
    local.prompts_enabled = remote.prompts_enabled;
    local.completed |= remote.completed;
    local.next_prompt_at = local.next_prompt_at.max(remote.next_prompt_at);
    local.prompt_count = local.prompt_count.max(remote.prompt_count);
}

#[tauri::command]
pub async fn app_account_feedback(
    app: AppHandle,
    state: State<'_, AccountService>,
    runtime: State<'_, TaskRuntime>,
    action: Action,
) -> Result<FeedbackView, String> {
    // Snapshot before account I/O: never hold a runtime lock across a network request.
    let task = if let Action::Activity { run_id: Some(id) } = &action {
        Some(
            runtime
                .notification_snapshot()
                .into_iter()
                .find(|run| {
                    run.id == *id
                        && matches!(
                            run.status.as_str(),
                            "review" | "reviewed" | "failed" | "stopped"
                        )
                })
                .ok_or("Open a finished task result first.")?
                .task_id,
        )
    } else {
        None
    };
    if let Action::Claim { id } | Action::Later { id } = &action {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err("Invalid feedback invitation.".into());
        }
    }
    let _guard = state.operation.lock().await;
    let (api, _) = endpoints(&app)?;
    let mut record = state
        .read()?
        .ok_or("Connect your Jackalope account first.")?;
    bound(&record, &api)?;
    let now = chrono::Utc::now().timestamp_millis();
    if record.email.is_none() || record.expires_at <= now {
        return Err("Connect your Jackalope account first.".into());
    }
    let mut claimed = false;
    if matches!(action, Action::Activity { .. }) {
        record.feedback.activity(now, task.clone());
    }
    match &action {
        Action::Preferences {
            enabled,
            prompts_enabled,
        } => {
            record.feedback.enabled = *enabled;
            record.feedback.prompts_enabled = *prompts_enabled;
            record.feedback.linked = true;
            record.feedback.pending = Some(action.clone());
        }
        Action::Stop => {
            record.feedback.linked = true;
            record.feedback.enabled = false;
            record.feedback.prompts_enabled = false;
            record.feedback.pending = Some(action.clone());
        }
        Action::Completed => {
            record.feedback.linked = true;
            record.feedback.completed = true;
            record.feedback.enabled = false;
            record.feedback.pending = Some(action.clone());
        }
        Action::Later { id } if record.feedback.prompt_id.as_ref() == Some(id) => {
            record.feedback.next_prompt_at = record.feedback.next_prompt_at.max(now + 14 * DAY);
            if record.feedback.linked {
                record.feedback.pending = Some(action.clone());
            }
        }
        _ => {}
    }
    state.save(&record)?;
    if let Some(pending) = &record.feedback.pending {
        let view = remote(
            &api,
            &record,
            remote_action(pending, &record.feedback, now)?,
        )
        .await?;
        merge(&mut record.feedback, &view);
        record.feedback.pending = None;
        state.save(&record)?;
    }
    if record.feedback.linked && record.feedback.completed {
        let view = remote(&api, &record, serde_json::json!({"action":"completed"})).await?;
        merge(&mut record.feedback, &view);
        state.save(&record)?;
        return Ok(record.feedback.view(now, false));
    }
    let mut remote_view = None;
    if !record.feedback.linked {
        let view = remote(&api, &record, serde_json::json!({"action":"status"})).await?;
        if view.linked {
            record.feedback.linked = true;
            merge(&mut record.feedback, &view);
        }
        remote_view = Some(view);
    }
    if matches!(action, Action::Claim { .. }) && !record.feedback.eligible(now) {
        state.save(&record)?;
        return Ok(record.feedback.view(now, false));
    }
    if matches!(action, Action::Claim { .. }) && !record.feedback.linked {
        let preferences = Action::Preferences {
            enabled: false,
            prompts_enabled: record.feedback.prompts_enabled,
        };
        let view = remote(
            &api,
            &record,
            remote_action(&preferences, &record.feedback, now)?,
        )
        .await?;
        record.feedback.linked = true;
        merge(&mut record.feedback, &view);
        state.save(&record)?;
    }
    if record.feedback.linked {
        let body = if matches!(action, Action::Activity { .. }) && record.feedback.enabled {
            let receipt = task.as_ref().map(|id| {
                format!(
                    "{:x}",
                    Sha256::digest(format!("feedback:{}:{}", record.secret, id).as_bytes())
                )
            });
            let mut body = serde_json::json!({"action":"activity"});
            if let Some(receipt) = receipt {
                body["result"] = receipt.into();
            }
            body
        } else if matches!(action, Action::Claim { .. }) {
            remote_action(&action, &record.feedback, now)?
        } else {
            serde_json::json!({"action":"status"})
        };
        let view = remote(&api, &record, body).await?;
        claimed = view.claimed;
        merge(&mut record.feedback, &view);
        remote_view = Some(view);
    }
    match action {
        Action::Activity { .. } => {}
        Action::Claim { id } => {
            if claimed {
                record.feedback.prompt_id = Some(id);
            }
        }
        _ => {}
    }
    state.save(&record)?;
    let mut view = record.feedback.view(now, claimed);
    if let Some(remote) = remote_view {
        view.eligible &= remote.eligible;
    }
    Ok(view)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_invitation_needs_distinct_days_and_tasks_and_honors_suppression() {
        let mut local = LocalFeedback::default();
        local.activity(DAY, Some("one".into()));
        local.activity(DAY, Some("one".into()));
        assert!(!local.eligible(DAY));
        local.activity(DAY, Some("two".into()));
        assert!(!local.eligible(DAY));
        local.activity(2 * DAY, None);
        assert!(local.eligible(2 * DAY));
        assert!(!local.enabled);
        local.next_prompt_at = 16 * DAY;
        assert!(!local.eligible(15 * DAY));
        assert!(local.eligible(16 * DAY));
        local.completed = true;
        assert!(!local.eligible(20 * DAY));
    }
    #[test]
    fn old_accounts_default_to_local_only_feedback_and_bounded_progress() {
        let mut local: LocalFeedback = serde_json::from_str("{}").unwrap();
        for i in 0..20 {
            local.activity(i * DAY, Some(i.to_string()));
        }
        assert_eq!(local.results.len(), 2);
        assert_eq!(local.active_days, 2);
        assert!(!local.enabled);
        assert!(!local.linked);
    }
}
