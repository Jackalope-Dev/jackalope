use super::*;

impl TaskRuntime {
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
        let runtime = Self {
            knowledge: super::super::knowledge::KnowledgeStore::new(
                directory.join("knowledge/entries.json"),
            ),
            mcp_broker: super::super::mcp_broker::Broker::default(),
            inner: Arc::new(Mutex::new(Inner::default())),
            directory,
            _owner: Arc::new(owner),
        };
        let paths: Vec<_> = std::fs::read_dir(&runtime.directory)
            .map_err(|e| e.to_string())?
            .map(|entry| entry.map(|entry| entry.path()).map_err(|e| e.to_string()))
            .collect::<Result<_, _>>()?;
        for path in paths {
            if path
                .file_name()
                .is_some_and(|name| name == "schedules.json")
            {
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
                let bytes = match crate::commands::history::read_bounded(&path, 8_000_000) {
                    Ok(bytes) => bytes,
                    Err(reason) => {
                        runtime.record_recovery(HistoryRecoveryEntry {
                            path: path.to_string_lossy().into_owned(),
                            reason,
                            quarantined: false,
                        });
                        continue;
                    }
                };
                let parsed = serde_json::from_slice::<TaskRun>(&bytes).map_err(|e| e.to_string())
                    .and_then(|run| {
                        if !valid_id(&run.id) {
                            Err("invalid task identifier".to_string())
                        } else if path.file_stem().and_then(|stem| stem.to_str()) != Some(run.id.as_str()) {
                            Err("Task identifier does not match its history filename; the other task was not overwritten.".into())
                        } else if run.details_omitted {
                            Err("This file contains a task summary rather than a complete history record.".into())
                        } else { Ok(run) }
                    });
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
                        run.persistence_error = None;
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
        runtime
            .inner
            .lock()
            .unwrap()
            .recovery
            .sort_by(|a, b| a.path.cmp(&b.path));
        Ok(runtime)
    }

    pub(super) fn save(&self, run: &TaskRun) -> Result<(), String> {
        if !valid_id(&run.id) || run.details_omitted {
            return Err("Only a complete task record with a valid identifier can be saved.".into());
        }
        let mut saved = run.clone();
        saved.persistence_error = None;
        let bytes = serde_json::to_vec(&saved).map_err(|e| e.to_string())?;
        if bytes.len() > 8_000_000 {
            return Err("This task exceeds the history size limit. Save a recovery copy before closing Jackalope.".into());
        }
        crate::commands::history::write_atomic(
            &self.directory.join(format!("{}.json", run.id)),
            &bytes,
        )
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
            if run.result.len() > 128_000 {
                let mut end = 128_000;
                while !run.result.is_char_boundary(end) {
                    end -= 1;
                }
                run.result.truncate(end);
                run.result.push_str(
                    "\n[Result truncated; inspect the agent session for complete output.]",
                );
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
        if self
            .inner
            .lock()
            .map_err(|e| e.to_string())?
            .runs
            .values()
            .any(|run| run.persistence_error.is_some())
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
