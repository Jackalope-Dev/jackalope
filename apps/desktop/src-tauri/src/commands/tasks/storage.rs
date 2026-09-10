use super::*;

/// Most recent reviewed runs kept in the loaded history. Older reviewed runs are
/// moved to `archive/` on startup: still on disk and restorable, but out of the
/// in-memory set that every poll serialises. Active, review-ready, failed,
/// interrupted and unsaved runs are never archived.
const RETAINED_REVIEWED: usize = 200;

impl TaskRuntime {
    #[cfg(test)]
    pub(crate) fn with_test_access(directory: PathBuf) -> Result<Self, String> {
        let runtime = Self::new(directory)?;
        let now = Utc::now().timestamp_millis();
        runtime.access.update(now, now + 60 * 60 * 1000);
        Ok(runtime)
    }

    pub fn new(directory: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let owner = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("runtime.lock"))
            .map_err(|e| e.to_string())?;
        owner.try_lock().map_err(|_| "Another Jackalope instance owns this task history. Close it before starting another instance.".to_string())?;
        let owner = Arc::new(owner);
        let writer = journal::Writer::new(directory.clone())?;
        let runtime = Self {
            access: Arc::new(super::super::execution_access::ExecutionAccess::new()),
            knowledge: super::super::knowledge::KnowledgeStore::new(
                directory.join("knowledge/entries.json"),
            ),
            mcp_broker: super::super::mcp_broker::Broker::default(),
            inner: Arc::new(Mutex::new(Inner::default())),
            directory,
            writer,
            _owner: owner,
        };
        let paths: Vec<_> = std::fs::read_dir(&runtime.directory)
            .map_err(|e| e.to_string())?
            .map(|entry| entry.map(|entry| entry.path()).map_err(|e| e.to_string()))
            .collect::<Result<_, _>>()?;
        let history: Vec<_> = paths
            .iter()
            .filter(|path| {
                path.extension().is_some_and(|ext| ext == "json")
                    && path.file_name().is_none_or(|name| name != "schedules.json")
            })
            .collect();
        let mut loaded: HashMap<_, _> = std::thread::scope(|scope| {
            let workers: Vec<_> = history
                .chunks(history.len().div_ceil(4).max(1))
                .map(|chunk| {
                    scope.spawn(move || {
                        chunk
                            .iter()
                            .map(|path| ((*path).clone(), load_record(path)))
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            workers
                .into_iter()
                .flat_map(|worker| worker.join().expect("history reader panicked"))
                .collect()
        });
        for path in paths {
            if path
                .file_name()
                .is_some_and(|name| name == "schedules.json")
            {
                continue;
            }
            if path.extension().is_some_and(|ext| ext == "journal")
                && !path.with_extension("json").exists()
            {
                runtime.record_recovery(HistoryRecoveryEntry { path: path.to_string_lossy().into_owned(), reason: "A task journal has no snapshot. The original remains available for recovery.".into(), quarantined: false });
                continue;
            }
            if path.extension().is_some_and(|ext| ext == "tmp") {
                runtime.inner.lock().unwrap().recovery.push(HistoryRecoveryEntry {
                    path: path.to_string_lossy().into_owned(),
                    reason: "An unfinished save was preserved. It has not replaced the last saved task. Keep a copy before inspecting or repairing it.".into(),
                    quarantined: false,
                });
                continue;
            }
            if path.extension().is_some_and(|ext| ext == "corrupt") {
                runtime.inner.lock().unwrap().recovery.push(HistoryRecoveryEntry {
                    path: path.to_string_lossy().into_owned(),
                    reason: "This history file was set aside during an earlier startup. It has not been loaded or repaired.".into(),
                    quarantined: true,
                });
                continue;
            }
            if path.extension().is_some_and(|ext| ext == "json") {
                let parsed = match loaded
                    .remove(&path)
                    .expect("history loader omitted a record")
                {
                    Ok((parsed, warning)) => {
                        if let Some(warning) = warning {
                            runtime.record_recovery(HistoryRecoveryEntry {
                                path: path
                                    .with_extension("journal")
                                    .to_string_lossy()
                                    .into_owned(),
                                reason: warning.clone(),
                                quarantined: false,
                            });
                            parsed.map(|mut run| {
                                run.persistence_error = Some(warning);
                                run
                            })
                        } else {
                            parsed
                        }
                    }
                    Err(reason) => {
                        runtime.record_recovery(HistoryRecoveryEntry {
                            path: path.to_string_lossy().into_owned(),
                            reason,
                            quarantined: false,
                        });
                        continue;
                    }
                };
                match parsed {
                    Err(reason) => {
                        runtime
                            .inner
                            .lock()
                            .unwrap()
                            .recovery
                            .push(quarantine(&path, reason));
                    }
                    Ok(mut run) => {
                        if ["starting", "running", "stopping"].contains(&run.status.as_str()) {
                            run.status = if cfg!(windows) && run.process_contained {
                                "stopped"
                            } else {
                                "interrupted"
                            }
                            .into();
                            run.error = Some("Jackalope closed before this attempt finished. Review its workspace before continuing; work was not automatically rerun.".into());
                            run.ended_at = Some(Utc::now().to_rfc3339());
                            if let Err(error) = runtime.save(&run) {
                                run.persistence_error = Some(format!(
                                    "The recovered state could not be saved: {error}"
                                ));
                            } else {
                                run.persistence_error = None;
                            }
                        }
                        runtime
                            .inner
                            .lock()
                            .unwrap()
                            .runs
                            .insert(run.id.clone(), run);
                    }
                }
            }
        }
        runtime.archive_old_reviewed();
        runtime
            .inner
            .lock()
            .unwrap()
            .recovery
            .sort_by(|a, b| a.path.cmp(&b.path));
        Ok(runtime)
    }

    fn archive_directory(&self) -> PathBuf {
        self.directory.join("archive")
    }

    fn recency_key(run: &TaskRun) -> &str {
        run.ended_at.as_deref().unwrap_or(run.started_at.as_str())
    }

    /// Move reviewed runs beyond [`RETAINED_REVIEWED`] into `archive/`, newest
    /// kept. A move that fails leaves the run loaded rather than losing it.
    fn archive_old_reviewed(&self) {
        let stale: Vec<String> = {
            let inner = self.inner.lock().unwrap();
            let mut reviewed: Vec<&TaskRun> = inner
                .runs
                .values()
                .filter(|run| run.status == "reviewed" && run.persistence_error.is_none())
                .collect();
            reviewed.sort_by(|a, b| Self::recency_key(b).cmp(Self::recency_key(a)));
            reviewed
                .into_iter()
                .skip(RETAINED_REVIEWED)
                .map(|run| run.id.clone())
                .collect()
        };
        if stale.is_empty() {
            return;
        }
        let archive = self.archive_directory();
        if std::fs::create_dir_all(&archive).is_err() {
            return;
        }
        for id in stale {
            let from = self.directory.join(format!("{id}.json"));
            if std::fs::rename(&from, archive.join(format!("{id}.json"))).is_ok() {
                self.inner.lock().unwrap().runs.remove(&id);
            }
        }
    }

    /// Parse the newest `limit` archived records by modification time.
    pub(in crate::commands) fn archived_full(&self, limit: usize) -> Vec<TaskRun> {
        let Ok(entries) = std::fs::read_dir(self.archive_directory()) else {
            return vec![];
        };
        let mut files: Vec<(PathBuf, std::time::SystemTime)> = entries
            .flatten()
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|entry| Some((entry.path(), entry.metadata().ok()?.modified().ok()?)))
            .collect();
        files.sort_by(|a, b| b.1.cmp(&a.1));
        files.truncate(limit);
        files
            .into_iter()
            .filter_map(|(path, _)| {
                let bytes = journal::read(&path).ok()?;
                let run = serde_json::from_slice::<TaskRun>(&bytes).ok()?;
                (path.file_stem().and_then(|stem| stem.to_str()) == Some(run.id.as_str()))
                    .then_some(run)
            })
            .collect()
    }

    pub(in crate::commands) fn archived_runs(&self) -> Vec<ArchivedRun> {
        let mut runs: Vec<ArchivedRun> = self
            .archived_full(500)
            .into_iter()
            .map(|run| ArchivedRun {
                id: run.id,
                task_id: run.task_id,
                project_name: run.project_name,
                agent: run.agent,
                prompt: run.prompt.chars().take(200).collect(),
                status: run.status,
                started_at: run.started_at,
                ended_at: run.ended_at,
            })
            .collect();
        runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        runs
    }

    pub(in crate::commands) fn restore_archived(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("Invalid task identifier".into());
        }
        if self.inner.lock().unwrap().runs.contains_key(id) {
            return Err("This task is already in your loaded history.".into());
        }
        let live = self.directory.join(format!("{id}.json"));
        if live.exists() {
            return Err("A loaded history file with this identifier already exists.".into());
        }
        let archived = self.archive_directory().join(format!("{id}.json"));
        let bytes = crate::commands::history::read_bounded(&archived, 8_000_000)?;
        let mut run = serde_json::from_slice::<TaskRun>(&bytes).map_err(|e| e.to_string())?;
        if run.id != id {
            return Err("Archived record identifier does not match its filename.".into());
        }
        run.persistence_error = None;
        std::fs::rename(&archived, &live).map_err(|e| e.to_string())?;
        let mut inner = self.inner.lock().unwrap();
        self.writer.changed(&run.id);
        inner.runs.insert(run.id.clone(), run);
        Ok(())
    }

    /// Load a `jackalope-task-recovery` export back into history. Refuses to
    /// shadow a task that is still present or running.
    pub(in crate::commands) fn import_recovery(&self, bytes: &[u8]) -> Result<String, String> {
        let envelope: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        if envelope.get("format").and_then(Value::as_str) != Some("jackalope-task-recovery") {
            return Err("This file is not a Jackalope task recovery export.".into());
        }
        let task = envelope
            .get("task")
            .cloned()
            .ok_or("The export contains no task record.")?;
        let mut run = serde_json::from_value::<TaskRun>(task)
            .map_err(|e| format!("The task record could not be read: {e}"))?;
        if !valid_id(&run.id) {
            return Err("The task record has an invalid identifier.".into());
        }
        if let Some(existing) = self.inner.lock().unwrap().runs.get(&run.id) {
            return Err(
                if ["starting", "running", "stopping"].contains(&existing.status.as_str()) {
                    "A running task already uses this identifier."
                } else {
                    "This task is already in your history."
                }
                .into(),
            );
        }
        if self.directory.join(format!("{}.json", run.id)).exists() {
            return Err("A history file with this identifier already exists.".into());
        }
        run.persistence_error = None;
        if ["starting", "running", "stopping"].contains(&run.status.as_str()) {
            run.status = "interrupted".into();
            run.error.get_or_insert_with(|| {
                "Restored from a recovery copy of an unfinished attempt; it was not rerun.".into()
            });
            run.ended_at.get_or_insert_with(|| Utc::now().to_rfc3339());
        }
        self.save(&run)?;
        let id = run.id.clone();
        let _ = std::fs::remove_file(self.archive_directory().join(format!("{id}.json")));
        let mut inner = self.inner.lock().unwrap();
        self.writer.changed(&id);
        inner.runs.insert(id.clone(), run);
        Ok(id)
    }

    pub(super) fn save(&self, run: &TaskRun) -> Result<(), String> {
        journal::Writer::wait(self.writer.submit(run.clone(), true)?)
    }

    pub(super) fn update_output(
        &self,
        id: &str,
        update: impl FnOnce(&mut TaskRun),
    ) -> Result<(), String> {
        let receive = {
            let mut inner = self.inner.lock().unwrap();
            let run = inner.runs.get_mut(id).ok_or("Attempt not found")?;
            update(run);
            Self::bound_output(run);
            self.writer.submit(run.clone(), false)?
        };
        let result = journal::Writer::wait(receive);
        let mut inner = self.inner.lock().unwrap();
        if let Some(run) = inner.runs.get_mut(id) {
            run.persistence_error = self.writer.error(id);
            self.writer.changed(id);
        }
        result
    }

    fn bound_output(run: &mut TaskRun) {
        if run.result.len() > 128_000 {
            let mut end = 128_000;
            while !run.result.is_char_boundary(end) {
                end -= 1;
            }
            run.result.truncate(end);
            run.result
                .push_str("\n[Result truncated; inspect the agent session for complete output.]");
        }
        if run.validation_steps.len() > 200 {
            run.validation_steps
                .drain(..run.validation_steps.len() - 200);
        }
        if run.screenshots.len() > 100 {
            run.screenshots.drain(..run.screenshots.len() - 100);
        }
        if run.activity.len() > 150 {
            run.activity.drain(..run.activity.len() - 150);
        }
        if run.diagnostics.len() > 150 {
            run.diagnostics.drain(..run.diagnostics.len() - 150);
        }
    }

    pub(in crate::commands) fn update(&self, id: &str, update: impl FnOnce(&mut TaskRun)) {
        let _ = self.update_checked(id, update);
    }

    pub(in crate::commands) fn update_checked(
        &self,
        id: &str,
        update: impl FnOnce(&mut TaskRun),
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if let Some(run) = inner.runs.get_mut(id) {
            update(run);
            Self::bound_output(run);
            if let Err(error) = self.save(run) {
                let error = format!("History could not be saved: {error}");
                run.persistence_error = Some(error.clone());
                return Err(error);
            }
            run.persistence_error = None;
            Ok(())
        } else {
            Err("Attempt not found".into())
        }
    }

    pub(in crate::commands) fn ensure_history_saved(&self) -> Result<(), String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        self.writer.flush()?;
        if inner
            .runs
            .values()
            .any(|run| run.persistence_error.is_some() || self.writer.error(&run.id).is_some())
        {
            return Err("Task history has unsaved changes. Open the affected task and retry saving before starting more work or installing an update.".into());
        }
        Ok(())
    }

    pub(super) fn export_recovery(&self, id: &str, destination: &Path) -> Result<(), String> {
        let parent = std::fs::canonicalize(destination.parent().ok_or("Choose a file location")?)
            .map_err(|e| e.to_string())?;
        let history = std::fs::canonicalize(&self.directory).map_err(|e| e.to_string())?;
        if parent.starts_with(history) {
            return Err("Choose a recovery location outside Jackalope's history folder.".into());
        }
        let run = self
            .inner
            .lock()
            .map_err(|e| e.to_string())?
            .runs
            .get(id)
            .cloned()
            .ok_or("Attempt not found")?;
        let bytes = serde_json::to_vec_pretty(&serde_json::json!({
            "format": "jackalope-task-recovery", "version": 1,
            "exportedAt": Utc::now().to_rfc3339(), "task": run,
        }))
        .map_err(|e| e.to_string())?;
        crate::commands::history::write_atomic(destination, &bytes)
    }

    pub(in crate::commands) fn record_recovery(&self, entry: HistoryRecoveryEntry) {
        self.inner.lock().unwrap().recovery.push(entry);
    }
}

fn load_record(path: &Path) -> Result<(Result<TaskRun, String>, Option<String>), String> {
    let (bytes, warning) = journal::recover(path)?;
    Ok((serde_json::from_slice::<TaskRun>(&bytes).map_err(|e| e.to_string())
                    .and_then(|run| {
                        if !valid_id(&run.id) {
                            Err("invalid task identifier".to_string())
                        } else if path.file_stem().and_then(|stem| stem.to_str()) != Some(run.id.as_str()) {
                            Err("Task identifier does not match its history filename; the other task was not overwritten.".into())
                        } else if run.details_omitted {
                            Err("This file contains a task summary rather than a complete history record.".into())
                        } else { Ok(run) }
                    }), warning))
}
