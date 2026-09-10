use super::*;

#[derive(Serialize, Deserialize)]
pub(super) struct SyncChoice {
    pub enabled: bool,
    pub explicit: bool,
}
pub(super) fn read_choice(state: &AccountService) -> Result<SyncChoice, String> {
    account_storage::read(&state.path.with_file_name("settings-sync-choice.bin"))?
        .map(|bytes| {
            serde_json::from_slice(&bytes)
                .map_err(|_| "Could not read the settings sync choice.".into())
        })
        .unwrap_or(Ok(SyncChoice {
            enabled: true,
            explicit: false,
        }))
}
fn save_choice(state: &AccountService, enabled: bool) -> Result<(), String> {
    account_storage::write(
        &state.path.with_file_name("settings-sync-choice.bin"),
        &serde_json::to_vec(&SyncChoice {
            enabled,
            explicit: true,
        })
        .map_err(|_| "Could not save the settings sync choice.")?,
    )
}
pub(super) fn preserve_choice(state: &AccountService, record: &SavedAccount) -> Result<(), String> {
    account_storage::write(
        &state.path.with_file_name("settings-sync-choice.bin"),
        &serde_json::to_vec(&SyncChoice {
            enabled: record.settings_sync,
            explicit: !record.settings_sync_automatic,
        })
        .map_err(|_| "Could not save the settings sync choice.")?,
    )
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncedSettings {
    version: u8,
    accent_hex: String,
    is_dark: bool,
    appearance: String,
    atmosphere: f64,
    harmony: String,
    mascot_reactions: bool,
    notifications: String,
    os_notifications: bool,
}
impl SyncedSettings {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.accent_hex.len() != 7
            || !self.accent_hex.starts_with('#')
            || !self.accent_hex.as_bytes()[1..]
                .iter()
                .all(u8::is_ascii_hexdigit)
            || !matches!(self.appearance.as_str(), "manual" | "automatic")
            || !self.atmosphere.is_finite()
            || !(0.0..=64.0).contains(&self.atmosphere)
            || !matches!(self.harmony.as_str(), "single" | "duo" | "trio")
            || !matches!(
                self.notifications.as_str(),
                "all" | "failures-only" | "none"
            )
        {
            return Err("Invalid synchronized settings.".into());
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Status,
    Configure {
        enabled: bool,
        owner: String,
    },
    Read {
        owner: String,
    },
    Delete {
        owner: String,
    },
    Write {
        owner: String,
        revision: u64,
        settings: SyncedSettings,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncView {
    available: bool,
    enabled: bool,
    owner: Option<String>,
    revision: u64,
    settings: Option<SyncedSettings>,
    conflict: bool,
}

#[tauri::command]
pub async fn app_settings_sync(
    app: AppHandle,
    state: State<'_, AccountService>,
    action: Action,
) -> Result<SyncView, String> {
    let _guard = state.operation.lock().await;
    let mut view = SyncView {
        available: false,
        enabled: false,
        owner: None,
        revision: 0,
        settings: None,
        conflict: false,
    };
    let mut saved = state.read()?;
    if saved.as_ref().is_none_or(|r| r.email.is_none()) {
        view.available = endpoints(&app).is_ok();
        if view.available {
            view.enabled = read_choice(&state)?.enabled;
        }
        return match action {
            Action::Status => Ok(view),
            Action::Configure { enabled, owner } if owner.is_empty() && view.available => {
                save_choice(&state, enabled)?;
                if let Some(record) = saved.as_mut() {
                    record.settings_sync = enabled;
                    record.settings_sync_automatic = false;
                    state.save(record)?;
                }
                view.enabled = enabled;
                Ok(view)
            }
            _ => Err("Connect an approved Jackalope account to sync settings.".into()),
        };
    }
    let mut record = saved.take().unwrap();
    let (api, _) = endpoints(&app)?;
    bound(&record, &api)?;
    let owner = sha256_hex(&format!("{}:{}", record.origin, record.secret));
    view.available = true;
    if record.settings_sync_pending
        && matches!(
            action,
            Action::Status | Action::Read { .. } | Action::Write { .. }
        )
    {
        let (code, data) = request(&api, "/v1/desktop/settings/consent", reqwest::Method::POST,
            Some(&record.secret), Some(serde_json::json!({"enabled": record.settings_sync, "automatic": record.settings_sync_automatic}))).await?;
        if code != 200 {
            return Err(
                "Could not initialize settings sync. Retry when the account service is available."
                    .into(),
            );
        }
        record.settings_sync = data["enabled"]
            .as_bool()
            .ok_or("Invalid sync consent response.")?;
        record.settings_sync_pending = false;
        if !record.settings_sync {
            save_choice(&state, false)?;
        }
        state.save(&record)?;
    }
    view.enabled = record.settings_sync;
    view.owner = Some(owner.clone());
    match &action {
        Action::Status => return Ok(view),
        Action::Configure {
            enabled,
            owner: expected,
        } => {
            if expected != &owner {
                return Err("The connected account changed. Refresh settings sync.".into());
            }
            if *enabled {
                let (code, _) = request(
                    &api,
                    "/v1/desktop/settings/consent",
                    reqwest::Method::POST,
                    Some(&record.secret),
                    Some(serde_json::json!({"enabled": true})),
                )
                .await?;
                if code != 200 {
                    return Err(
                        "Could not enable settings sync. Check your account connection and retry."
                            .into(),
                    );
                }
            }
            record.settings_sync = *enabled;
            record.settings_sync_pending = false;
            record.settings_sync_automatic = false;
            state.save(&record)?;
            save_choice(&state, *enabled)?;
            view.enabled = *enabled;
            if !enabled {
                let _ = request(
                    &api,
                    "/v1/desktop/settings/consent",
                    reqwest::Method::POST,
                    Some(&record.secret),
                    Some(serde_json::json!({"enabled": false})),
                )
                .await;
            }
            return Ok(view);
        }
        Action::Read { owner: expected }
        | Action::Delete { owner: expected }
        | Action::Write {
            owner: expected, ..
        } if expected != &owner => {
            return Err("The connected account changed. Refresh settings sync.".into())
        }
        _ => {}
    }
    if !record.settings_sync && !matches!(action, Action::Delete { .. }) {
        return Err("Settings sync is turned off on this desktop.".into());
    }
    let (method, body) = match action {
        Action::Delete { .. } => {
            record.settings_sync = false;
            record.settings_sync_pending = false;
            state.save(&record)?;
            save_choice(&state, false)?;
            view.enabled = false;
            (reqwest::Method::DELETE, None)
        }
        Action::Write {
            revision, settings, ..
        } => {
            settings.validate()?;
            if revision >= 9_007_199_254_740_991 {
                return Err("Invalid settings revision.".into());
            }
            (
                reqwest::Method::PUT,
                Some(serde_json::json!({ "revision": revision, "settings": settings })),
            )
        }
        _ => (reqwest::Method::GET, None),
    };
    let (code, data) = request(
        &api,
        "/v1/desktop/settings",
        method,
        Some(&record.secret),
        body,
    )
    .await?;
    if code == 401 {
        state.access.revoke();
        record.settings_sync = false;
        state.save(&record)?;
        return Err("Your account access changed. Reconnect before syncing settings.".into());
    }
    if code == 403 && data["error"] == "settings_sync_disabled" {
        record.settings_sync = false;
        state.save(&record)?;
        save_choice(&state, false)?;
        view.enabled = false;
        return Ok(view);
    }
    if code == 409 {
        view.conflict = true;
        return Ok(view);
    }
    if code != 200 {
        return Err(if code == 404 {
            "Settings sync is not available on this service yet.".into()
        } else {
            failure(code)
        });
    }
    view.revision = data["revision"]
        .as_u64()
        .filter(|v| *v < 9_007_199_254_740_991)
        .ok_or("Invalid settings revision from the account service.")?;
    if !data["settings"].is_null() {
        let settings: SyncedSettings = serde_json::from_value(data["settings"].clone())
            .map_err(|_| "Invalid synchronized settings from the account service.")?;
        settings.validate()?;
        view.settings = Some(settings);
    }
    if (view.revision == 0) != view.settings.is_none() {
        return Err("Invalid settings snapshot from the account service.".into());
    }
    Ok(view)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(windows)]
    fn new_connections_default_on_and_saved_opt_out_survives_restart() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-sync-choice-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let state = AccountService::new(
            directory.join("account.bin"),
            Arc::new(ExecutionAccess::new()),
        );
        let fresh = read_choice(&state).unwrap();
        assert!(fresh.enabled);
        assert!(!fresh.explicit);
        save_choice(&state, false).unwrap();
        let restarted = AccountService::new(
            directory.join("account.bin"),
            Arc::new(ExecutionAccess::new()),
        );
        let saved = read_choice(&restarted).unwrap();
        assert!(!saved.enabled);
        assert!(saved.explicit);
        std::fs::remove_file(directory.join("settings-sync-choice.bin")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn sync_payload_rejects_secrets_unknown_fields_and_invalid_values() {
        let valid = serde_json::json!({"version":1,"accentHex":"#6366f1","isDark":true,
            "appearance":"automatic","atmosphere":12,"harmony":"single",
            "mascotReactions":true,"notifications":"all","osNotifications":true});
        assert!(serde_json::from_value::<SyncedSettings>(valid.clone())
            .unwrap()
            .validate()
            .is_ok());
        let mut secret = valid.clone();
        secret["apiKey"] = "private".into();
        assert!(serde_json::from_value::<SyncedSettings>(secret).is_err());
        for (key, value) in [
            ("accentHex", serde_json::json!("bad")),
            ("version", serde_json::json!(2)),
            ("atmosphere", serde_json::json!(65)),
            ("notifications", serde_json::json!("anything")),
        ] {
            let mut bad = valid.clone();
            bad[key] = value;
            assert!(serde_json::from_value::<SyncedSettings>(bad)
                .unwrap()
                .validate()
                .is_err());
        }
    }
}
