//! Opt-in account sync of the agent skills the person chooses, layered on
//! settings sync: the service only accepts it from a device with settings sync
//! consent. Off until the person shares a skill or turns it on, and kept per
//! account. Uploads name the revision they replace, so a skill changed on two
//! devices becomes a conflict the person resolves instead of an overwrite.
//! Synced content is written only to the same skill folder on each computer,
//! never into a file Git tracks.

use super::*;
use crate::commands::skills::{
    self,
    detect::{self, LocalSkill, ProjectRef, Scope},
    store::{self, AccountState, DeviceView, Entry, Holding, Keep, Plan, Remote, SyncedSkill},
    SkillCard,
};
use crate::commands::tasks::TaskRuntime;

/// Pulled pages per sync; the rest follows on the next sync.
const PAGES: usize = 25;
const RESPONSE_BYTES: usize = 1_000_000;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Status,
    Configure {
        enabled: bool,
        owner: String,
    },
    Sync {
        owner: String,
    },
    /// Starts (or stops) syncing one skill, by its card id.
    Share {
        owner: String,
        id: String,
        share: bool,
    },
    Resolve {
        owner: String,
        id: String,
        keep: Keep,
    },
    Delete {
        owner: String,
    },
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSyncView {
    /// Signed in to an approved account on a configured service.
    available: bool,
    /// Settings sync is on; skill sync requires it.
    settings_sync: bool,
    enabled: bool,
    owner: Option<String>,
    last_synced_at: Option<String>,
    uploaded: usize,
    downloaded: usize,
    /// Synced skills were deleted from another desktop, which turned sync off.
    reset: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsPage {
    sync: SkillSyncView,
    skills: Vec<SkillCard>,
    devices: Vec<DeviceView>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Page {
    epoch: u64,
    cursor: u64,
    more: bool,
    skills: Vec<Remote>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pushed {
    status: String,
    revision: u64,
    #[serde(default)]
    updated_at: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Held {
    devices: Vec<DeviceView>,
    holdings: Vec<Holding>,
}

/// Stable for an account on a service, unlike the device credential.
fn account_key(record: &SavedAccount) -> Option<String> {
    let email = record.email.as_ref()?.trim().to_lowercase();
    Some(sha256_hex(&format!("skills\0{}\0{email}", record.origin)))
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
            "Your account access changed. Reconnect before syncing skills.".into(),
        )),
        (403, Some("settings_sync_disabled")) => Err(Stop::Off {
            reset: false,
            settings: true,
        }),
        (409, Some("skills_reset")) => Err(Stop::Off {
            reset: true,
            settings: false,
        }),
        (413, Some("skills_full")) => Err(Stop::Failed(
            "Your account holds the most synced skills it can (200). Stop syncing a skill you no longer use, then try again."
                .into(),
        )),
        (413, _) => Err(Stop::Failed(
            "This skill is too large to sync. Skills up to 24,000 characters sync.".into(),
        )),
        (404, _) => Err(Stop::Failed(
            "Skill sync is not available on this service yet.".into(),
        )),
        _ => Err(Stop::Failed(failure(code))),
    }
}

async fn detect_all(runtime: &TaskRuntime) -> Result<(Vec<LocalSkill>, Vec<ProjectRef>), String> {
    let projects = skills::projects(runtime);
    tauri::async_runtime::spawn_blocking(move || (detect::detect(&projects), projects))
        .await
        .map_err(|error| error.to_string())
}

/// Records pulled changes as incoming copies on their entries.
fn receive(account: &mut AccountState, remotes: Vec<Remote>) {
    for remote in remotes {
        if let Some(entry) = account.skills.get_mut(&remote.id) {
            let newest = entry.incoming.as_ref().map_or(entry.revision, |incoming| {
                incoming.revision.max(entry.revision)
            });
            if remote.revision > newest {
                entry.incoming = Some(remote);
            }
            continue;
        }
        let Some(location) = remote.skill.as_ref().map(|skill| skill.location.clone()) else {
            continue;
        };
        // A skill shared from here but not uploaded yet takes the account's id,
        // so both computers end up on one synced copy.
        let unsent = account
            .entry_at(&location)
            .filter(|(_, entry)| entry.revision == 0)
            .map(|(id, _)| id.clone());
        if account.entry_at(&location).is_some() && unsent.is_none() {
            continue;
        }
        if let Some(id) = unsent {
            account.skills.remove(&id);
        }
        let id = remote.id.clone();
        let mut entry = Entry::new(location);
        entry.incoming = Some(remote);
        account.skills.insert(id, entry);
    }
}

/// Settles each synced skill against this computer's copy: writes account
/// copies, records matches and returns the uploads to make.
fn settle(
    account: &mut AccountState,
    skills: &[LocalSkill],
    projects: &[ProjectRef],
) -> (Vec<(String, u64, SyncedSkill)>, usize) {
    let mut uploads = vec![];
    let mut downloaded = 0;
    let ids: Vec<String> = account.skills.keys().cloned().collect();
    for id in ids {
        let Some(entry) = account.skills.get_mut(&id) else {
            continue;
        };
        let local = skills
            .iter()
            .find(|skill| skill.location().as_ref() == Some(&entry.location));
        let hash = local.and_then(LocalSkill::hash);
        match store::plan(entry, local.is_some(), hash.as_deref()) {
            Plan::Nothing | Plan::Conflict => {}
            Plan::Forget => {
                account.skills.remove(&id);
            }
            Plan::Adopt => {
                if let Some(remote) = entry.incoming.take() {
                    entry.revision = remote.revision;
                    entry.hash = remote.skill.map(|skill| skill.hash);
                }
                entry.resolve = None;
                entry.error = None;
            }
            Plan::Apply => {
                let Some(folder) = local
                    .map(|skill| skill.folder.clone())
                    .or_else(|| detect::folder_for(&entry.location, projects))
                else {
                    continue;
                };
                let Some(remote) = entry.incoming.clone() else {
                    continue;
                };
                let Some(skill) = remote.skill.as_ref() else {
                    continue;
                };
                match store::write_skill(&folder, skill) {
                    Ok(()) => {
                        if local.is_none() && entry.location.scope == Scope::Project {
                            let _ = store::keep_out_of_commits(&folder);
                        }
                        entry.revision = remote.revision;
                        entry.hash = Some(skill.hash.clone());
                        entry.incoming = None;
                        entry.resolve = None;
                        entry.error = None;
                        downloaded += 1;
                    }
                    Err(error) => entry.error = Some(error),
                }
            }
            Plan::Push { base } => {
                let Some(skill) = local else {
                    continue;
                };
                let Ok(files) = skill.files.clone() else {
                    continue;
                };
                uploads.push((
                    id.clone(),
                    base,
                    SyncedSkill {
                        location: entry.location.clone(),
                        description: skill.description.clone(),
                        hash: detect::content_hash(&files),
                        files,
                    },
                ));
            }
        }
    }
    (uploads, downloaded)
}

async fn pull(api: &reqwest::Url, secret: &str, account: &mut AccountState) -> Result<(), Stop> {
    for _ in 0..PAGES {
        let data = call(
            api,
            secret,
            "/v1/desktop/skills/pull",
            reqwest::Method::POST,
            Some(serde_json::json!({ "epoch": account.epoch, "cursor": account.cursor })),
        )
        .await?;
        let page: Page = serde_json::from_value(data)
            .map_err(|_| "The account service returned invalid skills.".to_string())?;
        if page.epoch == 0
            || (account.epoch != 0 && page.epoch != account.epoch)
            || !page.skills.iter().all(Remote::validate)
        {
            return Err("The account service returned invalid skills."
                .to_string()
                .into());
        }
        account.epoch = page.epoch;
        receive(account, page.skills);
        account.cursor = page.cursor.max(account.cursor);
        if !page.more {
            break;
        }
    }
    Ok(())
}

async fn run(
    api: &reqwest::Url,
    secret: &str,
    runtime: &TaskRuntime,
    owner: &str,
    view: &mut SkillSyncView,
) -> Result<(), Stop> {
    let path = store::state_path(runtime);
    let mut state = store::load(&path);
    let mut account = state.accounts.get(owner).cloned().unwrap_or_default();
    for pass in 0..2 {
        pull(api, secret, &mut account).await?;
        let (skills, projects) = detect_all(runtime).await?;
        let moved = std::mem::take(&mut account);
        let (moved, uploads, downloaded) = tauri::async_runtime::spawn_blocking(move || {
            let mut moved = moved;
            let (uploads, downloaded) = settle(&mut moved, &skills, &projects);
            (moved, uploads, downloaded)
        })
        .await
        .map_err(|error| error.to_string())?;
        account = moved;
        view.downloaded += downloaded;
        state.accounts.insert(owner.into(), account.clone());
        store::save(&path, &state)?;
        if pass == 1 {
            break;
        }
        let mut conflicted = false;
        for (id, base, skill) in uploads {
            let hash = skill.hash.clone();
            let data = call(
                api,
                secret,
                "/v1/desktop/skills/push",
                reqwest::Method::POST,
                Some(serde_json::json!({
                    "epoch": account.epoch,
                    "id": id,
                    "baseRevision": base,
                    "deleted": false,
                    "skill": skill,
                })),
            )
            .await;
            let data = match data {
                Ok(data) => data,
                Err(Stop::Failed(error)) => {
                    if let Some(entry) = account.skills.get_mut(&id) {
                        entry.error = Some(error);
                    }
                    continue;
                }
                Err(stop) => return Err(stop),
            };
            let pushed: Pushed = serde_json::from_value(data)
                .map_err(|_| "The account service returned an invalid response.".to_string())?;
            let Some(entry) = account.skills.get_mut(&id) else {
                continue;
            };
            if pushed.status == "stored" && pushed.updated_at.is_some() {
                entry.revision = pushed.revision;
                entry.hash = Some(hash);
                entry.incoming = None;
                entry.resolve = None;
                entry.error = None;
                view.uploaded += 1;
            } else {
                conflicted = true;
            }
        }
        state.accounts.insert(owner.into(), account.clone());
        store::save(&path, &state)?;
        if !conflicted {
            break;
        }
    }
    // Report what this computer holds, for every device's view of the skill.
    let (skills, _) = detect_all(runtime).await?;
    let have: Vec<serde_json::Value> = account
        .skills
        .iter()
        .filter(|(_, entry)| entry.revision > 0)
        .filter(|(_, entry)| {
            skills.iter().any(|skill| {
                skill.location().as_ref() == Some(&entry.location)
                    && skill.hash().is_some()
                    && skill.hash() == entry.hash
            })
        })
        .map(|(id, entry)| serde_json::json!({ "id": id, "revision": entry.revision }))
        .collect();
    if account.epoch > 0 {
        let data = call(
            api,
            secret,
            "/v1/desktop/skills/have",
            reqwest::Method::POST,
            Some(serde_json::json!({ "epoch": account.epoch, "have": have })),
        )
        .await?;
        let held: Held = serde_json::from_value(data)
            .map_err(|_| "The account service returned an invalid response.".to_string())?;
        account.devices = held.devices;
        account.holdings = held.holdings;
    }
    account.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
    view.last_synced_at = account.last_synced_at.clone();
    state.accounts.insert(owner.into(), account);
    store::save(&path, &state)?;
    Ok(())
}

/// Stops syncing one skill: removes it from the account (other computers keep
/// their copy) and forgets it here.
async fn unshare(
    api: &reqwest::Url,
    secret: &str,
    runtime: &TaskRuntime,
    owner: &str,
    id: &str,
) -> Result<(), Stop> {
    let path = store::state_path(runtime);
    let mut state = store::load(&path);
    let mut account = state.accounts.get(owner).cloned().unwrap_or_default();
    let synced = if account.skills.contains_key(id) {
        Some(id.to_string())
    } else {
        let (skills, _) = detect_all(runtime).await?;
        skills
            .iter()
            .find(|skill| skill.key() == id)
            .and_then(LocalSkill::location)
            .and_then(|location| account.entry_at(&location).map(|(id, _)| id.clone()))
    };
    let Some(synced) = synced else {
        return Ok(());
    };
    let Some(entry) = account.skills.get(&synced) else {
        return Ok(());
    };
    let base = entry
        .incoming
        .as_ref()
        .map_or(entry.revision, |remote| remote.revision.max(entry.revision));
    if base > 0 {
        let data = call(
            api,
            secret,
            "/v1/desktop/skills/push",
            reqwest::Method::POST,
            Some(serde_json::json!({
                "epoch": account.epoch,
                "id": synced,
                "baseRevision": base,
                "deleted": true,
            })),
        )
        .await?;
        let pushed: Pushed = serde_json::from_value(data)
            .map_err(|_| "The account service returned an invalid response.".to_string())?;
        if pushed.status != "stored" {
            return Err(Stop::Failed(
                "This skill changed on another device. Sync, then try again.".into(),
            ));
        }
    }
    account.skills.remove(&synced);
    account.holdings.retain(|holding| holding.skill != synced);
    state.accounts.insert(owner.into(), account);
    store::save(&path, &state)?;
    Ok(())
}

/// Adds a local skill to the synced set; uploading happens in the sync that follows.
async fn share(runtime: &TaskRuntime, owner: &str, id: &str) -> Result<(), String> {
    let (skills, _) = detect_all(runtime).await?;
    let skill = skills
        .iter()
        .find(|skill| skill.key() == id)
        .ok_or("That skill is no longer on this computer.")?;
    if skill.files.is_err() {
        return Err("This skill cannot sync; its card says why.".into());
    }
    let location = skill
        .location()
        .ok_or("This project has no commit to match it by on other computers.")?;
    let path = store::state_path(runtime);
    let mut state = store::load(&path);
    let account = state.accounts.entry(owner.into()).or_default();
    if account.entry_at(&location).is_none() {
        account
            .skills
            .insert(uuid::Uuid::new_v4().to_string(), Entry::new(location));
    }
    state.enabled_for = Some(owner.into());
    store::save(&path, &state)
}

async fn page(runtime: &TaskRuntime, view: SkillSyncView) -> Result<SkillsPage, String> {
    let state = store::load(&store::state_path(runtime));
    let account = view
        .owner
        .as_ref()
        .filter(|_| view.enabled)
        .and_then(|owner| state.accounts.get(owner));
    let (_, _, cards) = skills::page(runtime, account).await?;
    Ok(SkillsPage {
        devices: account
            .map(|account| account.devices.clone())
            .unwrap_or_default(),
        skills: cards,
        sync: view,
    })
}

#[tauri::command]
pub async fn app_skill_sync(
    app: AppHandle,
    state: State<'_, AccountService>,
    runtime: State<'_, TaskRuntime>,
    action: Action,
) -> Result<SkillsPage, String> {
    let _guard = state.operation.lock().await;
    let mut view = SkillSyncView::default();
    let saved = state.read()?;
    let record = match saved {
        Some(record) if record.email.is_some() && record.waitlist.is_none() => record,
        _ => {
            return match action {
                Action::Status => page(&runtime, view).await,
                _ => Err("Sign in to Jackalope to sync skills.".into()),
            }
        }
    };
    let Ok((api, _)) = endpoints(&app) else {
        return match action {
            Action::Status => page(&runtime, view).await,
            _ => Err("Skill sync is not available in this build.".into()),
        };
    };
    bound(&record, &api)?;
    let owner = account_key(&record).ok_or("Sign in to Jackalope to sync skills.")?;
    let path = store::state_path(&runtime);
    let mut sync = store::load(&path);
    view.available = true;
    view.settings_sync = record.settings_sync;
    view.owner = Some(owner.clone());
    view.enabled = record.settings_sync && sync.enabled_for.as_deref() == Some(owner.as_str());
    view.last_synced_at = sync
        .accounts
        .get(&owner)
        .and_then(|account| account.last_synced_at.clone());
    let expected = match &action {
        Action::Status => return page(&runtime, view).await,
        Action::Configure { owner, .. }
        | Action::Sync { owner }
        | Action::Share { owner, .. }
        | Action::Resolve { owner, .. }
        | Action::Delete { owner } => owner,
    };
    if expected != &owner {
        return Err("The connected account changed. Refresh skill sync.".into());
    }
    if !record.settings_sync
        && !matches!(
            action,
            Action::Delete { .. } | Action::Configure { enabled: false, .. }
        )
    {
        return Err("Turn on settings sync in Settings → Privacy before syncing skills.".into());
    }
    let outcome = match action {
        Action::Status => unreachable!(),
        Action::Configure { enabled, .. } => {
            sync.enabled_for = enabled.then(|| owner.clone());
            store::save(&path, &sync)?;
            view.enabled = enabled;
            if !enabled {
                return page(&runtime, view).await;
            }
            run(&api, &record.secret, &runtime, &owner, &mut view).await
        }
        Action::Sync { .. } => {
            if !view.enabled {
                return Err("Skill sync is turned off on this computer.".into());
            }
            run(&api, &record.secret, &runtime, &owner, &mut view).await
        }
        Action::Share {
            id, share: true, ..
        } => {
            share(&runtime, &owner, &id).await?;
            view.enabled = true;
            run(&api, &record.secret, &runtime, &owner, &mut view).await
        }
        Action::Share {
            id, share: false, ..
        } => {
            if !view.enabled {
                return Err("Skill sync is turned off on this computer.".into());
            }
            unshare(&api, &record.secret, &runtime, &owner, &id).await
        }
        Action::Resolve { id, keep, .. } => {
            if !view.enabled {
                return Err("Skill sync is turned off on this computer.".into());
            }
            let entry = sync
                .accounts
                .get_mut(&owner)
                .and_then(|account| account.skills.get_mut(&id))
                .ok_or("That skill is no longer synced.")?;
            entry.resolve = Some(keep);
            store::save(&path, &sync)?;
            run(&api, &record.secret, &runtime, &owner, &mut view).await
        }
        Action::Delete { .. } => {
            match call(
                &api,
                &record.secret,
                "/v1/desktop/skills",
                reqwest::Method::DELETE,
                None,
            )
            .await
            {
                Ok(_) | Err(Stop::Off { reset: true, .. }) => {}
                Err(Stop::Off { .. }) => {
                    return Err("Turn on settings sync to delete synced skills.".into())
                }
                Err(Stop::Failed(error)) => return Err(error),
            }
            let mut sync = store::load(&path);
            sync.accounts.remove(&owner);
            if sync.enabled_for.as_deref() == Some(owner.as_str()) {
                sync.enabled_for = None;
            }
            store::save(&path, &sync)?;
            view.enabled = false;
            view.last_synced_at = None;
            return page(&runtime, view).await;
        }
    };
    match outcome {
        Ok(()) => page(&runtime, view).await,
        Err(Stop::Failed(error)) => Err(error),
        Err(Stop::Off { reset, settings }) => {
            let mut sync = store::load(&path);
            if reset {
                sync.accounts.remove(&owner);
            }
            sync.enabled_for = None;
            store::save(&path, &sync)?;
            if settings {
                let mut record = record;
                record.settings_sync = false;
                state.save(&record)?;
                view.settings_sync = false;
            }
            view.enabled = false;
            view.reset = reset;
            page(&runtime, view).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::skills::detect::{Location, Root, SkillFile};

    fn remote(id: &str, revision: u64, name: &str) -> Remote {
        let files = vec![SkillFile {
            path: "SKILL.md".into(),
            content: format!("---\nname: {name}\n---\nv{revision}\n"),
        }];
        Remote {
            id: id.into(),
            revision,
            updated_at: 1,
            deleted: false,
            skill: Some(SyncedSkill {
                location: Location {
                    scope: Scope::Personal,
                    root: Root::Claude,
                    project: None,
                    name: name.into(),
                },
                description: String::new(),
                hash: detect::content_hash(&files),
                files,
            }),
        }
    }

    #[test]
    fn pages_with_unknown_or_local_fields_are_refused() {
        let page = serde_json::json!({
            "epoch": 1, "cursor": 3, "more": false,
            "skills": [{ "id": uuid::Uuid::new_v4().to_string(), "revision": 2, "updatedAt": 5, "deleted": true }],
        });
        assert!(serde_json::from_value::<Page>(page.clone()).is_ok());
        let mut leaked = page.clone();
        leaked["skills"][0]["folder"] = "/Users/someone/.claude/skills/x".into();
        assert!(serde_json::from_value::<Page>(leaked).is_err());
        let mut extra = page;
        extra["paths"] = serde_json::json!([]);
        assert!(serde_json::from_value::<Page>(extra).is_err());
    }

    #[test]
    fn a_new_account_skill_takes_over_an_unsent_local_entry_at_the_same_place() {
        let mut account = AccountState::default();
        let incoming = remote(&uuid::Uuid::new_v4().to_string(), 1, "notes");
        let location = incoming.skill.as_ref().unwrap().location.clone();
        account
            .skills
            .insert("unsent".into(), Entry::new(location.clone()));
        receive(&mut account, vec![incoming.clone()]);
        assert_eq!(account.skills.len(), 1);
        assert_eq!(account.entry_at(&location).unwrap().0, &incoming.id);
        // An older or repeated revision never replaces a newer incoming copy.
        receive(&mut account, vec![remote(&incoming.id, 1, "notes")]);
        let entry = account.skills.get(&incoming.id).unwrap();
        assert_eq!(entry.incoming.as_ref().unwrap().revision, 1);
        // A second id for a place already synced is ignored rather than doubled.
        let mut synced = account.clone();
        synced.skills.get_mut(&incoming.id).unwrap().revision = 1;
        receive(
            &mut synced,
            vec![remote(&uuid::Uuid::new_v4().to_string(), 1, "notes")],
        );
        assert_eq!(synced.skills.len(), 1);
    }

    #[test]
    fn the_account_key_follows_the_account_not_the_device_credential() {
        let record = |email: &str, secret: &str| -> SavedAccount {
            serde_json::from_value(serde_json::json!({
                "origin": "https://api.example.invalid/",
                "secret": secret,
                "verification": "",
                "user_code": "",
                "expires_at": 0,
                "email": email,
            }))
            .unwrap()
        };
        let first = account_key(&record("Person@Example.invalid", &"a".repeat(64))).unwrap();
        let again = account_key(&record("person@example.invalid", &"b".repeat(64))).unwrap();
        assert_eq!(first, again);
        assert!(!first.contains("example"));
    }
}
