use super::*;

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BetaRequestKind {
    Join,
    Leave,
}

/// The account's latest beta flight request. The operator adds or removes the
/// Store account in Partner Center by hand, so `done` records that action and
/// does not prove the Store has delivered a different build yet.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BetaRequest {
    kind: BetaRequestKind,
    store_email: String,
    status: String,
    created_at: i64,
    resolved_at: Option<i64>,
}
#[derive(Serialize, Deserialize)]
pub struct BetaView {
    request: Option<BetaRequest>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum BetaAction {
    Status,
    Request {
        kind: BetaRequestKind,
        #[serde(rename = "storeEmail")]
        store_email: String,
    },
    Withdraw,
}

fn plausible_email(value: &str) -> bool {
    let value = value.trim();
    value.len() <= 254
        && value
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'))
        && !value.chars().any(char::is_whitespace)
}

#[tauri::command]
pub async fn app_account_beta(
    app: AppHandle,
    state: State<'_, AccountService>,
    action: BetaAction,
) -> Result<BetaView, String> {
    let _guard = state.operation.lock().await;
    let (api, _) = endpoints(&app)?;
    let record = state
        .read()?
        .ok_or("Connect your Jackalope account to manage beta access.")?;
    bound(&record, &api)?;
    if record.email.is_none() || record.waitlist.is_some() {
        return Err("Beta access is available once your Jackalope account is approved.".into());
    }
    let (method, body) = match action {
        BetaAction::Status => (reqwest::Method::GET, None),
        BetaAction::Request { kind, store_email } => {
            if !plausible_email(&store_email) {
                return Err("Enter the email of your Microsoft account.".into());
            }
            (
                reqwest::Method::POST,
                Some(serde_json::json!({
                    "kind": kind,
                    "storeEmail": store_email.trim(),
                    "appVersion": env!("CARGO_PKG_VERSION"),
                })),
            )
        }
        BetaAction::Withdraw => (reqwest::Method::DELETE, None),
    };
    let (code, data) =
        request(&api, "/v1/desktop/beta", method, Some(&record.secret), body).await?;
    if code == 401 {
        state.access.revoke();
        account_storage::remove(&state.path)?;
        return Err("Your account connection expired. Connect again to manage beta access.".into());
    }
    if code == 400 {
        return Err("Enter the email of your Microsoft account.".into());
    }
    if code == 409 {
        return Err("That request was already handled. Refresh to see its status.".into());
    }
    if code != 200 {
        return Err(failure(code));
    }
    serde_json::from_value(data)
        .map_err(|_| "The account service returned an invalid response.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beta_actions_accept_only_known_shapes() {
        assert!(
            serde_json::from_value::<BetaAction>(serde_json::json!({"action":"status"})).is_ok()
        );
        assert!(serde_json::from_value::<BetaAction>(
            serde_json::json!({"action":"request","kind":"join","storeEmail":"a@example.com"})
        )
        .is_ok());
        assert!(serde_json::from_value::<BetaAction>(
            serde_json::json!({"action":"request","kind":"admin","storeEmail":"a@example.com"})
        )
        .is_err());
        assert!(
            serde_json::from_value::<BetaAction>(serde_json::json!({"action":"approve"})).is_err()
        );
    }

    #[test]
    fn store_emails_need_a_local_part_and_a_domain() {
        assert!(plausible_email(" person@outlook.com "));
        assert!(!plausible_email("person"));
        assert!(!plausible_email("@outlook.com"));
        assert!(!plausible_email("person@localhost"));
        assert!(!plausible_email("per son@outlook.com"));
    }
}
