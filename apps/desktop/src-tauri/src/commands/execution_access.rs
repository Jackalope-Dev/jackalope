use serde::Serialize;
use std::sync::Mutex;

pub const OFFLINE_GRACE_MS: i64 = 72 * 60 * 60 * 1000;

#[derive(Default)]
struct Lease {
    checked_at: i64,
    expires_at: i64,
}

pub struct ExecutionAccess {
    required: bool,
    lease: Mutex<Lease>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessStatus {
    pub required: bool,
    pub allowed: bool,
    pub valid_until: Option<i64>,
}

impl ExecutionAccess {
    pub fn new(required: bool) -> Self {
        Self {
            required,
            lease: Mutex::new(Lease::default()),
        }
    }

    pub fn update(&self, checked_at: i64, expires_at: i64) {
        if let Ok(mut lease) = self.lease.lock() {
            *lease = Lease {
                checked_at,
                expires_at,
            };
        }
    }

    pub fn revoke(&self) {
        self.update(0, 0);
    }

    fn at(&self, now: i64) -> AccessStatus {
        let until = self.lease.lock().ok().and_then(|lease| {
            let until = lease
                .checked_at
                .saturating_add(OFFLINE_GRACE_MS)
                .min(lease.expires_at);
            (lease.checked_at > 0 && now >= lease.checked_at && now < until).then_some(until)
        });
        AccessStatus {
            required: self.required,
            allowed: !self.required || until.is_some(),
            valid_until: until,
        }
    }

    pub fn status(&self) -> AccessStatus {
        self.at(chrono::Utc::now().timestamp_millis())
    }

    pub fn ensure(&self) -> Result<(), String> {
        if self.status().allowed {
            Ok(())
        } else {
            Err("Connect an approved Jackalope account before starting new work. Saved work and running tasks remain available.".into())
        }
    }
}

#[tauri::command]
pub fn app_execution_access(runtime: tauri::State<'_, super::tasks::TaskRuntime>) -> AccessStatus {
    runtime.access.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_requires_verification_and_expires_without_sliding_on_reads() {
        let access = ExecutionAccess::new(true);
        assert!(!access.at(1000).allowed);
        access.update(1000, i64::MAX);
        assert!(access.at(1001).allowed);
        assert!(access.at(1000 + OFFLINE_GRACE_MS - 1).allowed);
        assert!(!access.at(1000 + OFFLINE_GRACE_MS).allowed);
        assert!(!access.at(999).allowed);
        access.update(1000, 2000);
        assert!(!access.at(2000).allowed);
        access.revoke();
        assert!(!access.at(1001).allowed);
        assert!(ExecutionAccess::new(false).at(1001).allowed);
    }

    #[test]
    fn beta_access_denies_native_launches_without_creating_attempts_and_keeps_history_readable() {
        use crate::commands::tasks::{RunRequest, TaskRuntime};
        use std::sync::Arc;
        let folder =
            std::env::temp_dir().join(format!("jackalope-access-{}", uuid::Uuid::new_v4()));
        let mut runtime = TaskRuntime::new(folder.clone()).unwrap();
        assert_eq!(
            runtime.access.status().required,
            cfg!(feature = "beta-access")
        );
        runtime.access = Arc::new(ExecutionAccess::new(true));
        let request: RunRequest = serde_json::from_value(serde_json::json!({
            "id": "denied-attempt", "projectId": "project", "projectName": "Project",
            "projectPath": folder.join("must-not-create"), "agent": "codex",
            "prompt": "Must not launch", "isolated": true
        }))
        .unwrap();
        assert!(runtime
            .start(request.clone())
            .unwrap_err()
            .contains("approved Jackalope"));
        let mut continuation = request.clone();
        continuation.previous_run_id = Some("previous-attempt".into());
        assert!(runtime
            .start(continuation)
            .unwrap_err()
            .contains("approved Jackalope"));
        assert!(runtime.integration_runs().unwrap().is_empty());
        assert!(!folder.join("denied-attempt.json").exists());
        assert!(!folder.join("must-not-create").exists());
        let now = chrono::Utc::now().timestamp_millis();
        runtime.access.update(now, now + 60000);
        assert!(!runtime
            .start(request.clone())
            .unwrap_err()
            .contains("approved Jackalope"));
        runtime.access.revoke();
        assert!(runtime
            .start(request)
            .unwrap_err()
            .contains("approved Jackalope"));
        assert!(runtime.integration_runs().unwrap().is_empty());
        drop(runtime);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
