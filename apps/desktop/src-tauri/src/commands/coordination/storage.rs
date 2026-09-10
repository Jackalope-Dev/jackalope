use super::*;

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
        let (ledger, storage_error) = match loaded {
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
        let service = Self {
            inner: Arc::new(Mutex::new(Inner {
                ledger,
                enabled: HashSet::new(),
                concurrency: 3,
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
                service.inner.lock().unwrap().error = Some(error);
            }
        }
        Ok(service)
    }

    pub(super) fn ensure_storage_loaded(&self) -> Result<(), String> {
        self.storage_error.clone().map_or(Ok(()), Err)
    }

    pub(super) fn save(&self, ledger: &Ledger) -> Result<(), String> {
        self.ensure_storage_loaded()?;
        let bytes = serde_json::to_vec(ledger).map_err(|e| e.to_string())?;
        if bytes.len() > 32_000_000 {
            return Err("The task queue exceeds its storage limit. No changes were saved.".into());
        }
        crate::commands::history::write_atomic(&self.directory.join("queue.json"), &bytes)
    }
}
