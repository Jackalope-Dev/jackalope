use super::{valid_token, SavedAccount};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitlistView {
    position: Option<u64>,
    referrals: u64,
    pending: u64,
    priority_days: u64,
    share_url: String,
    #[serde(default)]
    checked_at: i64,
}

pub(super) fn accept(
    record: &mut SavedAccount,
    data: &serde_json::Value,
    web: &reqwest::Url,
    now: i64,
) -> Result<&'static str, String> {
    let email = data["email"]
        .as_str()
        .filter(|s| s.len() <= 254 && s.contains('@'))
        .ok_or("Invalid account response.")?;
    let expiry = data["expiresAt"]
        .as_i64()
        .filter(|expiry| *expiry > now)
        .ok_or("Invalid account expiry.")?;
    let waiting = match data["status"].as_str() {
        Some("approved") => None,
        Some("waiting") => Some(parse(data["waitlist"].clone(), web, now)?),
        _ => return Err("Invalid account approval.".into()),
    };
    let approved = waiting.is_none();
    if record.email.is_none() || record.waitlist.is_some() {
        record.settings_sync_pending = approved && record.settings_sync;
    }
    record.email = Some(email.to_string());
    record.expires_at = expiry;
    record.verified_at = if approved { now } else { 0 };
    record.waitlist = waiting;
    record.verification.clear();
    record.user_code.clear();
    Ok(if approved { "connected" } else { "waiting" })
}

fn parse(data: serde_json::Value, web: &reqwest::Url, now: i64) -> Result<WaitlistView, String> {
    let mut view: WaitlistView = serde_json::from_value(data)
        .map_err(|_| "The account service returned invalid waitlist progress.")?;
    let share = reqwest::Url::parse(&view.share_url)
        .map_err(|_| "The account service returned an invalid referral link.")?;
    let query: Vec<_> = share.query_pairs().collect();
    if share.origin() != web.origin()
        || !share.username().is_empty()
        || share.password().is_some()
        || share.path() != "/"
        || share.fragment().is_some()
        || query.len() != 1
        || query[0].0 != "ref"
        || !valid_token(&query[0].1)
        || view.position == Some(0)
        || view
            .position
            .is_some_and(|value| value > 9_007_199_254_740_991)
        || view.referrals > 9_007_199_254_740_991
        || view.pending > 9_007_199_254_740_991
        || view.priority_days != view.referrals
    {
        return Err("The account service returned invalid waitlist progress.".into());
    }
    view.checked_at = now;
    Ok(view)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::execution_access::ExecutionAccess;

    fn record() -> SavedAccount {
        serde_json::from_value(serde_json::json!({
            "origin": "https://api.jackalope.dev/", "secret": "a".repeat(64),
            "verification": "b".repeat(64), "user_code": "ABCD1234", "expires_at": i64::MAX,
            "email": null, "settings_sync": true
        }))
        .unwrap()
    }
    fn response(now: i64) -> serde_json::Value {
        serde_json::json!({
            "status": "waiting", "email": "waiting@example.invalid", "expiresAt": now + 86400000,
            "waitlist": { "position": 42, "referrals": 3, "pending": 1, "priorityDays": 3,
                "shareUrl": format!("https://jackalope.dev/?ref={}", "c".repeat(64)) }
        })
    }

    #[test]
    fn waiting_survives_restart_without_execution_and_promotes_only_on_approval() {
        let now = chrono::Utc::now().timestamp_millis();
        let web = reqwest::Url::parse("https://jackalope.dev/").unwrap();
        let mut saved = record();
        let mut data = response(now);
        assert_eq!(accept(&mut saved, &data, &web, now).unwrap(), "waiting");
        assert!(!saved.settings_sync_pending);
        let mut restored: SavedAccount =
            serde_json::from_slice(&serde_json::to_vec(&saved).unwrap()).unwrap();
        assert_eq!(restored.waitlist.as_ref().unwrap().position, Some(42));
        assert!(restored.verification.is_empty());
        let access = ExecutionAccess::new();
        access.update(restored.verified_at, restored.expires_at);
        assert!(!access.status().allowed);
        assert!(access.ensure().is_err());
        let visible =
            serde_json::to_value(super::super::status("waiting-offline", Some(&restored))).unwrap();
        assert_eq!(visible["waitlist"]["checkedAt"], now);
        assert!(visible["userCode"].is_null());
        assert!(!visible.to_string().contains(&restored.secret));
        data["status"] = "approved".into();
        assert_eq!(
            accept(&mut restored, &data, &web, now).unwrap(),
            "connected"
        );
        assert!(restored.waitlist.is_none());
        assert!(restored.settings_sync_pending);
        access.update(restored.verified_at, restored.expires_at);
        assert!(access.status().allowed);
    }

    #[test]
    fn invalid_waitlist_data_and_links_never_become_an_approval() {
        let now = chrono::Utc::now().timestamp_millis();
        let web = reqwest::Url::parse("https://jackalope.dev/").unwrap();
        let original = response(now);
        for (key, value) in [
            (
                "shareUrl",
                serde_json::json!(format!("https://other.invalid/?ref={}", "c".repeat(64))),
            ),
            (
                "shareUrl",
                serde_json::json!("https://jackalope.dev/?ref=bad"),
            ),
            (
                "shareUrl",
                serde_json::json!(format!(
                    "https://jackalope.dev/access/?invite={}",
                    "c".repeat(64)
                )),
            ),
            ("position", serde_json::json!(0)),
            ("referrals", serde_json::json!(-1)),
            ("priorityDays", serde_json::json!(4)),
        ] {
            let mut data = original.clone();
            data["waitlist"][key] = value;
            let mut saved = record();
            assert!(accept(&mut saved, &data, &web, now).is_err());
            assert_eq!(saved.verified_at, 0);
            assert!(saved.email.is_none());
        }
        let mut missing = original.clone();
        missing["waitlist"]["position"] = serde_json::Value::Null;
        assert!(accept(&mut record(), &missing, &web, now).is_ok());
        missing["expiresAt"] = (now - 1).into();
        assert!(accept(&mut record(), &missing, &web, now).is_err());
        let mut saved = record();
        saved.settings_sync = false;
        accept(&mut saved, &original, &web, now).unwrap();
        missing = original;
        missing["status"] = "approved".into();
        accept(&mut saved, &missing, &web, now).unwrap();
        assert!(!saved.settings_sync_pending);
    }
}
