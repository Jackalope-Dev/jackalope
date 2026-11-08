use super::*;
use crate::commands::integration::{execution_guard, ExecutionGuard};

/// The queue could not be written; the ledger keeps its previous contents.
pub(super) struct SaveFailed(String);

impl From<SaveFailed> for String {
    fn from(failed: SaveFailed) -> Self {
        failed.0
    }
}

impl From<SaveFailed> for ToolError {
    fn from(failed: SaveFailed) -> Self {
        ToolError::failed(failed.0)
    }
}

/// The execution guard is unavailable, for example while an update installs.
pub(super) struct Busy(String);

impl From<Busy> for String {
    fn from(busy: Busy) -> Self {
        busy.0
    }
}

impl From<Busy> for ToolError {
    fn from(busy: Busy) -> Self {
        ToolError::status(StatusCode::CONFLICT, busy.0)
    }
}

impl Coordinator {
    pub fn new(directory: PathBuf, runtime: TaskRuntime) -> Result<Self, String> {
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("owner.lock"))
            .map_err(|e| e.to_string())?;
        let lock = super::super::file_lock::FileLock::try_new(lock).map_err(|_| "Another Jackalope instance owns this task queue. Close it before opening this workspace.".to_string())?;
        let path = directory.join("queue.json");
        let loaded = match path.try_exists() {
            Ok(false) => Ok(Ledger::default()),
            Ok(true) => crate::commands::history::read_bounded(&path, 32_000_000)
                .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string())),
            Err(error) => Err(error.to_string()),
        };
        let (mut ledger, storage_error) = match loaded {
            Ok(ledger) => (ledger, None),
            Err(error) => {
                let reason = format!("Task queue could not be loaded: {error}. Starting work is disabled to protect existing assignments. The original remains at {}. Close Jackalope, back it up and repair it, then restart.", path.display());
                runtime.record_recovery(crate::commands::history::HistoryRecoveryEntry {
                    path: path.to_string_lossy().into_owned(),
                    reason: reason.clone(),
                    quarantined: false,
                });
                (Ledger::default(), Some(reason))
            }
        };
        for followup in &mut ledger.followups {
            if !followup.dispatched {
                followup.paused = true;
            }
        }
        let service = Self {
            inner: Arc::new(Mutex::new(Inner {
                ledger,
                enabled: HashSet::new(),
                concurrency: 3,
                remote_concurrency: DEFAULT_REMOTE_CONCURRENCY,
                remote_projects: HashSet::new(),
                pool: Default::default(),
                grants: HashMap::new(),
                url: None,
                error: None,
                delivered: HashMap::new(),
            })),
            directory,
            runtime,
            alive: Arc::new(AtomicBool::new(true)),
            _lock: Arc::new(lock),
            storage_error,
            scope_checked: Arc::new(Mutex::new(None)),
        };
        if service.storage_error.is_none() {
            if let Err(error) = service.reconcile() {
                service.state().error = Some(error);
            }
        }
        Ok(service)
    }

    pub(super) fn ensure_storage_loaded(&self) -> Result<(), String> {
        self.storage_error.clone().map_or(Ok(()), Err)
    }

    /// The coordinator's state. Coordinator code that also needs the execution
    /// guard goes through [`Coordinator::transact`] instead, which keeps the
    /// lock order: coordinator state, execution guard, runtime state.
    pub(super) fn state(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap()
    }

    /// Locks the coordinator state, then takes the execution guard, and runs
    /// `work` with both.
    pub(super) fn transact<T, E: From<Busy>>(
        &self,
        work: impl FnOnce(&mut Inner, &ExecutionGuard) -> Result<T, E>,
    ) -> Result<T, E> {
        let mut inner = self.state();
        let guard = self.execution(&inner)?;
        work(&mut inner, &guard)
    }

    /// Takes the execution guard for a caller that already holds the
    /// coordinator state, which the `state` argument proves.
    pub(super) fn execution(&self, state: &Inner) -> Result<ExecutionGuard, Busy> {
        let _ = state;
        execution_guard().map_err(Busy)
    }

    /// Changes a copy of the ledger and keeps it once it is saved, so a change
    /// or save that fails leaves the ledger as it was.
    pub(super) fn commit<T, E: From<SaveFailed>>(
        &self,
        inner: &mut Inner,
        change: impl FnOnce(&mut Ledger) -> Result<T, E>,
    ) -> Result<T, E> {
        let mut ledger = inner.ledger.clone();
        let value = change(&mut ledger)?;
        self.save(&ledger).map_err(SaveFailed)?;
        inner.ledger = ledger;
        Ok(value)
    }

    fn save(&self, ledger: &Ledger) -> Result<(), String> {
        self.ensure_storage_loaded()?;
        let bytes = serde_json::to_vec(ledger).map_err(|e| e.to_string())?;
        if bytes.len() > 32_000_000 {
            return Err("The task queue exceeds its storage limit. No changes were saved.".into());
        }
        crate::commands::history::write_atomic(&self.directory.join("queue.json"), &bytes)
    }
}
