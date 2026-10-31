//! Opt-in account sync of learned lessons, layered on settings sync: the
//! service only accepts it from a device with settings sync consent. It is off
//! by default and turned on per account, so connecting another account never
//! uploads lessons exchanged with the first.

use super::*;
use crate::commands::knowledge::learning::sync::{
    batches, sync_projects, SyncProject, SyncedLesson, SyncedRecord,
};
use crate::commands::tasks::TaskRuntime;

/// Pulled pages per sync; the rest follows on the next sync.
const PAGES: usize = 40;
const RESPONSE_BYTES: usize = 1_000_000;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Status,
    Configure { enabled: bool, owner: String },
    Sync { owner: String },
    Delete { owner: String },
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LessonSyncView {
    /// Signed in to an approved account on a configured service.
    available: bool,
    /// Settings sync is on; lesson sync requires it.
    settings_sync: bool,
    enabled: bool,
    owner: Option<String>,
    last_synced_at: Option<String>,
    uploaded: usize,
    downloaded: usize,
    /// Learned lessons that stay on this desktop because they look sensitive.
    kept_local: usize,
    projects: usize,
    /// Included projects without a folder or a commit to match them by.
    unavailable_projects: usize,
    /// Synced lessons were deleted from another desktop, which turned sync off.
    reset: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Page {
    epoch: u64,
    cursor: u64,
    more: bool,
    lessons: Vec<SyncedLesson>,
    records: Vec<SyncedRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stored {
    id: String,
    revision: u64,
    updated_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pushed {
    lessons: Vec<Stored>,
}

/// Stable for an account on a service, unlike the device credential.
fn account_key(record: &SavedAccount) -> Option<String> {
    let email = record.email.as_ref()?.trim().to_lowercase();
    Some(sha256_hex(&format!("lessons\0{}\0{email}", record.origin)))
}

enum Stop {
    Failed(String),
    /// The service turned sync off for this device or account.
    Off {
        reset: bool,
        settings: bool,
    },
}

impl From<String> for Stop {
    fn from(error: String) -> Self {
        Stop::Failed(error)
    }
}

async fn call(
    api: &reqwest::Url,
    secret: &str,
    path: &str,
    method: reqwest::Method,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, Stop> {
    let (code, data) = request_with_limit(api, path, method, Some(secret), body, RESPONSE_BYTES)
        .await
        .map_err(Stop::Failed)?;
    match (code, data["error"].as_str()) {
        (200, _) => Ok(data),
        (401, _) => Err(Stop::Failed(
            "Your account access changed. Reconnect before syncing lessons.".into(),
        )),
        (403, Some("settings_sync_disabled")) => Err(Stop::Off {
            reset: false,
            settings: true,
        }),
        (409, Some("lessons_reset")) => Err(Stop::Off {
            reset: true,
            settings: false,
        }),
        (413, Some("lessons_full")) => Err(Stop::Failed(
            "Your account holds the most synced lessons it can. Remove unused lessons, then sync again."
                .into(),
        )),
        (404, _) => Err(Stop::Failed(
            "Lesson sync is not available on this service yet.".into(),
        )),
        _ => Err(Stop::Failed(failure(code))),
    }
}

async fn included_projects(runtime: &TaskRuntime) -> Result<(Vec<SyncProject>, usize), String> {
    let projects: Vec<(String, String)> = crate::commands::project_registry::list(runtime)
        .into_iter()
        .filter(|project| project.settings().sync_lessons)
        .map(|project| (project.id, project.path))
        .collect();
    tauri::async_runtime::spawn_blocking(move || sync_projects(&projects))
        .await
        .map_err(|error| error.to_string())
}

async fn run(
    api: &reqwest::Url,
    secret: &str,
    runtime: &TaskRuntime,
    owner: &str,
    view: &mut LessonSyncView,
) -> Result<(), Stop> {
    let store = &runtime.knowledge;
    let (projects, unavailable) = included_projects(runtime).await?;
    view.projects = projects.len();
    view.unavailable_projects = unavailable;
    let mut state = store.sync_state();
    let mut account = state.accounts.get(owner).cloned().unwrap_or_default();
    if projects
        .iter()
        .any(|project| !account.projects.contains(&project.key))
    {
        account.cursor = 0;
    }
    for _ in 0..PAGES {
        let data = call(
            api,
            secret,
            "/v1/desktop/lessons/pull",
            reqwest::Method::POST,
            Some(serde_json::json!({ "epoch": account.epoch, "cursor": account.cursor })),
        )
        .await?;
        let page: Page = serde_json::from_value(data)
            .map_err(|_| "The account service returned invalid lessons.".to_string())?;
        if page.epoch == 0 || (account.epoch != 0 && page.epoch != account.epoch) {
            return Err("The account service returned invalid lessons."
                .to_string()
                .into());
        }
        account.epoch = page.epoch;
        let (shared, changed) = store.sync_apply(&projects, &page.lessons, &page.records)?;
        view.downloaded += changed;
        for (id, marker) in shared {
            state.owners.insert(id.clone(), owner.into());
            account.synced.insert(id, marker);
        }
        account.cursor = page.cursor.max(account.cursor);
        state.accounts.insert(owner.into(), account.clone());
        store.save_sync_state(&state)?;
        if !page.more {
            break;
        }
    }
    account.projects = projects.iter().map(|project| project.key.clone()).collect();
    state.accounts.insert(owner.into(), account.clone());
    let outgoing = store.sync_outgoing(&projects, owner, &state)?;
    view.kept_local = outgoing.kept_local;
    for (lessons, records) in batches(outgoing) {
        let data = call(
            api,
            secret,
            "/v1/desktop/lessons/push",
            reqwest::Method::POST,
            Some(serde_json::json!({
                "epoch": account.epoch,
                "lessons": lessons,
                "records": records,
            })),
        )
        .await?;
        let pushed: Pushed = serde_json::from_value(data)
            .map_err(|_| "The account service returned an invalid response.".to_string())?;
        for lesson in &lessons {
            let marker = (lesson.revision, lesson.updated_at);
            if pushed.lessons.iter().any(|stored| {
                stored.id == lesson.id && (stored.revision, stored.updated_at) == marker
            }) {
                view.uploaded += 1;
                state.owners.insert(lesson.id.clone(), owner.into());
                account.synced.insert(lesson.id.clone(), marker);
            }
        }
        for record in &records {
            let after = account
                .records_after
                .entry(record.project.clone())
                .or_default();
            if record.at > *after {
                after.clone_from(&record.at);
            }
        }
        state.accounts.insert(owner.into(), account.clone());
        store.save_sync_state(&state)?;
    }
    account.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
    view.last_synced_at = account.last_synced_at.clone();
    state.accounts.insert(owner.into(), account);
    store.save_sync_state(&state)?;
    Ok(())
}

#[tauri::command]
pub async fn app_lesson_sync(
    app: AppHandle,
    state: State<'_, AccountService>,
    runtime: State<'_, TaskRuntime>,
    action: Action,
) -> Result<LessonSyncView, String> {
    let _guard = state.operation.lock().await;
    let mut view = LessonSyncView::default();
    let saved = state.read()?;
    let record = match saved {
        Some(record) if record.email.is_some() && record.waitlist.is_none() => record,
        _ => {
            return match action {
                Action::Status => Ok(view),
                _ => Err("Sign in to Jackalope to sync learned lessons.".into()),
            }
        }
    };
    let Ok((api, _)) = endpoints(&app) else {
        return match action {
            Action::Status => Ok(view),
            _ => Err("Lesson sync is not available in this build.".into()),
        };
    };
    bound(&record, &api)?;
    let owner = account_key(&record).ok_or("Sign in to Jackalope to sync learned lessons.")?;
    let store = &runtime.knowledge;
    let mut sync = store.sync_state();
    view.available = true;
    view.settings_sync = record.settings_sync;
    view.owner = Some(owner.clone());
    view.enabled = record.settings_sync && sync.enabled_for.as_deref() == Some(owner.as_str());
    view.last_synced_at = sync
        .accounts
        .get(&owner)
        .and_then(|account| account.last_synced_at.clone());
    let expected = match &action {
        Action::Status => return Ok(view),
        Action::Configure { owner, .. } | Action::Sync { owner } | Action::Delete { owner } => {
            owner
        }
    };
    if expected != &owner {
        return Err("The connected account changed. Refresh lesson sync.".into());
    }
    let outcome = match action {
        Action::Status => unreachable!(),
        Action::Configure { enabled, .. } => {
            if enabled && !record.settings_sync {
                return Err("Turn on settings sync before including learned lessons.".into());
            }
            sync.enabled_for = enabled.then(|| owner.clone());
            store.save_sync_state(&sync)?;
            view.enabled = enabled;
            if !enabled {
                return Ok(view);
            }
            run(&api, &record.secret, &runtime, &owner, &mut view).await
        }
        Action::Sync { .. } => {
            if !view.enabled {
                return Err("Lesson sync is turned off on this desktop.".into());
            }
            run(&api, &record.secret, &runtime, &owner, &mut view).await
        }
        Action::Delete { .. } => {
            match call(
                &api,
                &record.secret,
                "/v1/desktop/lessons",
                reqwest::Method::DELETE,
                None,
            )
            .await
            {
                Ok(_) | Err(Stop::Off { reset: true, .. }) => {}
                Err(Stop::Off { .. }) => {
                    return Err("Turn on settings sync to delete synced lessons.".into())
                }
                Err(Stop::Failed(error)) => return Err(error),
            }
            let mut sync = store.sync_state();
            sync.reset(&owner);
            store.save_sync_state(&sync)?;
            view.enabled = false;
            view.last_synced_at = None;
            return Ok(view);
        }
    };
    match outcome {
        Ok(()) => Ok(view),
        Err(Stop::Failed(error)) => Err(error),
        Err(Stop::Off { reset, settings }) => {
            let mut sync = store.sync_state();
            if reset {
                sync.reset(&owner);
            } else {
                sync.enabled_for = None;
            }
            store.save_sync_state(&sync)?;
            if settings {
                let mut record = record;
                record.settings_sync = false;
                state.save(&record)?;
                view.settings_sync = false;
            }
            view.enabled = false;
            view.reset = reset;
            Ok(view)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(email: &str, secret: &str) -> SavedAccount {
        serde_json::from_value(serde_json::json!({
            "origin": "https://api.example.invalid/",
            "secret": secret,
            "verification": "",
            "user_code": "",
            "expires_at": 0,
            "email": email,
        }))
        .unwrap()
    }

    #[test]
    fn the_account_key_follows_the_account_not_the_device_credential() {
        let first = account_key(&account("Person@Example.invalid", &"a".repeat(64))).unwrap();
        let reconnected = account_key(&account("person@example.invalid", &"b".repeat(64))).unwrap();
        let other = account_key(&account("other@example.invalid", &"a".repeat(64))).unwrap();
        assert_eq!(first, reconnected);
        assert_ne!(first, other);
        assert!(!first.contains("example"));
    }

    #[test]
    fn pages_with_unknown_or_local_fields_are_refused() {
        let page = serde_json::json!({
            "epoch": 1, "cursor": 3, "more": false, "records": [],
            "lessons": [{
                "id": uuid::Uuid::new_v4().to_string(), "project": "a".repeat(64),
                "revision": 2, "updatedAt": 5, "deleted": true,
            }],
        });
        assert!(serde_json::from_value::<Page>(page.clone()).is_ok());
        let mut leaked = page.clone();
        leaked["lessons"][0]["projectPath"] = "/private/repo".into();
        assert!(serde_json::from_value::<Page>(leaked).is_err());
        let mut extra = page;
        extra["evidence"] = serde_json::json!([]);
        assert!(serde_json::from_value::<Page>(extra).is_err());
    }
}
