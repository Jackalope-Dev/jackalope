use super::*;

impl Coordinator {
    pub(in crate::commands) fn bridge_ready(&self) -> bool {
        self.inner.lock().is_ok_and(|inner| inner.url.is_some())
    }

    pub(super) fn view(&self) -> Result<QueueView, String> {
        self.ensure_storage_loaded()?;
        let merged_run_ids = crate::commands::integration::applied_run_ids(&self.runtime)?;
        let inner = self.inner.lock().unwrap();
        Ok(QueueView {
            items: inner.ledger.items.clone(),
            messages: inner.ledger.messages.clone(),
            enabled_projects: inner.enabled.iter().cloned().collect(),
            concurrency: inner.concurrency,
            bridge_url: inner.url.clone(),
            bridge_error: inner.error.clone(),
            merged_run_ids,
        })
    }

    pub(super) fn append(ledger: &mut Ledger, req: QueueRequest) -> Result<String, String> {
        super::super::outcomes::ProcessTemplate {
            outcomes: req.context_selection.outcomes.clone(),
            ..Default::default()
        }
        .validate()?;
        if req.context_selection.advance_workflow {
            return Err("A queued task must begin at the first workflow step.".into());
        }
        if req.title.trim().is_empty()
            || req.title.len() > 160
            || req.prompt.trim().is_empty()
            || req.prompt.len() > 100_000
        {
            return Err("Give the task a short title and a concrete instruction.".into());
        }
        if req.agent.is_empty()
            || req.agent.len() > 80
            || !req
                .agent
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Choose a configured agent.".into());
        }
        let scopes = scopes(req.scopes)?;
        let target_branch = crate::commands::tasks::resolve_target_branch(
            &req.project_path,
            req.target_branch.as_deref(),
        )?;
        let root = std::fs::canonicalize(&req.project_path).map_err(|e| e.to_string())?;
        if ledger.items.iter().any(|i| {
            i.project_id == req.project_id
                && std::fs::canonicalize(&i.project_path).ok().as_ref() != Some(&root)
        }) {
            return Err("This project ID belongs to another folder.".into());
        }
        for dependency in &req.dependencies {
            if !ledger.items.iter().any(|i| {
                &i.id == dependency
                    && i.project_id == req.project_id
                    && !i.canceled
                    && i.target_branch.as_deref().unwrap_or("master") == target_branch
            }) {
                return Err("Dependencies must refer to existing tasks in this project with the same target branch.".into());
            }
        }
        if ledger.items.len() >= 2000 {
            return Err("This MVP queue is limited to 2,000 tasks.".into());
        }
        let id = Uuid::new_v4().to_string();
        ledger.items.push(QueueItem {
            staged_dependencies: req.staged_dependencies,
            feature: req.feature,
            feature_id: req.feature_id,
            context_selection: req.context_selection,
            id: id.clone(),
            project_id: req.project_id,
            project_name: req.project_name,
            project_path: req.project_path,
            target_branch: Some(target_branch),
            agent_profile_id: req.agent_profile_id,
            verify_command: req.verify_command,
            prepare_command: req.prepare_command,
            auto_verify: req.auto_verify,
            title: req.title.trim().into(),
            prompt: req.prompt.trim().into(),
            agent: req.agent,
            scopes,
            dependencies: req.dependencies,
            created_at: Utc::now().to_rfc3339(),
            run_id: None,
            error: None,
            canceled: false,
        });
        Ok(id)
    }
    pub(super) fn add(&self, req: QueueRequest) -> Result<String, String> {
        let mut inner = self.inner.lock().unwrap();
        let mut ledger = inner.ledger.clone();
        let id = Self::append(&mut ledger, req)?;
        self.save(&ledger)?;
        inner.ledger = ledger;
        Ok(id)
    }

    pub(super) fn import(&self, request: PlanRequest) -> Result<Vec<String>, String> {
        if request
            .feature
            .as_ref()
            .is_some_and(|f| f.trim().is_empty() || f.len() > 160)
        {
            return Err("Use a feature title up to 160 bytes.".into());
        }
        if request.staged_dependencies
            && (!request.auto_verify
                || request
                    .verify_command
                    .as_ref()
                    .is_none_or(|s| s.trim().is_empty()))
        {
            return Err("Enable automatic project verification and save its command before using staged dependencies.".into());
        }
        let items = ordered_plan(request.items)?;
        let mut inner = self.inner.lock().unwrap();
        if let Some(feature_id) = &request.feature_id {
            if uuid::Uuid::parse_str(feature_id).is_err() {
                return Err("Invalid feature identifier.".into());
            }
            let existing: Vec<_> = inner
                .ledger
                .items
                .iter()
                .filter(|i| i.feature_id.as_ref() == Some(feature_id))
                .collect();
            if !existing.is_empty() {
                let existing_ids: HashMap<_, _> = items
                    .iter()
                    .zip(&existing)
                    .map(|(item, old)| (item.key.as_str(), old.id.as_str()))
                    .collect();
                if existing.len() != items.len()
                    || existing.iter().zip(&items).any(|(old, item)| {
                        old.project_id != request.project_id
                            || old.project_path != request.project_path
                            || old.title != item.title.trim()
                            || old.prompt != item.prompt.trim()
                            || old.agent != item.agent
                            || old.agent_profile_id
                                != request.agent_accounts.get(&item.agent).cloned()
                            || request
                                .target_branch
                                .as_ref()
                                .is_some_and(|branch| old.target_branch.as_ref() != Some(branch))
                            || scopes(item.scopes.clone()).ok().as_ref() != Some(&old.scopes)
                            || item
                                .depends_on
                                .iter()
                                .filter_map(|key| existing_ids.get(key.as_str()).copied())
                                .collect::<Vec<_>>()
                                != old
                                    .dependencies
                                    .iter()
                                    .map(String::as_str)
                                    .collect::<Vec<_>>()
                            || old.staged_dependencies != request.staged_dependencies
                            || old.feature != request.feature
                            || old.verify_command != request.verify_command
                            || old.prepare_command != request.prepare_command
                            || old.auto_verify != request.auto_verify
                            || serde_json::to_value(&old.context_selection).ok()
                                != serde_json::to_value(&item.context_selection).ok()
                    })
                {
                    return Err("This feature plan was already saved with different tasks. Open the saved plan before adding more work.".into());
                }
                return Ok(existing.iter().map(|item| item.id.clone()).collect());
            }
        }
        let mut ledger = inner.ledger.clone();
        let mut ids = HashMap::new();
        let mut created = Vec::new();
        for item in items {
            let id = Self::append(
                &mut ledger,
                QueueRequest {
                    staged_dependencies: request.staged_dependencies,
                    feature: request.feature.clone(),
                    feature_id: request.feature_id.clone(),
                    context_selection: item.context_selection,
                    project_id: request.project_id.clone(),
                    project_name: request.project_name.clone(),
                    project_path: request.project_path.clone(),
                    target_branch: request.target_branch.clone(),
                    agent_profile_id: request.agent_accounts.get(&item.agent).cloned(),
                    verify_command: request.verify_command.clone(),
                    prepare_command: request.prepare_command.clone(),
                    auto_verify: request.auto_verify,
                    title: item.title,
                    prompt: item.prompt,
                    agent: item.agent,
                    scopes: item.scopes,
                    dependencies: item
                        .depends_on
                        .iter()
                        .map(|key| ids.get(key).cloned().ok_or("Dependency order is invalid"))
                        .collect::<Result<_, _>>()?,
                },
            )?;
            ids.insert(item.key, id.clone());
            created.push(id);
        }
        self.save(&ledger)?;
        inner.ledger = ledger;
        inner.enabled.remove(&request.project_id);
        Ok(created)
    }

    pub(super) fn tick(&self) -> Result<(), String> {
        self.reconcile()?;
        self.runtime.access.ensure()?;
        self.ensure_storage_loaded()?;
        let mut inner = self.inner.lock().unwrap();
        let _guard = crate::commands::integration::execution_guard()?;
        self.runtime.ensure_history_saved()?;
        let merged = crate::commands::integration::applied_run_ids(&self.runtime)?;
        let runs = self.runtime.integration_runs()?;
        let Some(url) = inner.url.clone() else {
            return Ok(());
        };
        inner.error = None;
        let reserved = ready_items(&inner, &runs, &merged);
        for item in reserved {
            let run_id = Uuid::new_v4().to_string();
            let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
            let mut ledger = inner.ledger.clone();
            ledger
                .items
                .iter_mut()
                .find(|i| i.id == item.id)
                .unwrap()
                .run_id = Some(run_id.clone());
            self.save(&ledger)?;
            inner.ledger = ledger;
            inner
                .grants
                .insert(token.clone(), (item.id.clone(), run_id.clone()));
            let instructions = instructions(&item);
            let assigned = item.clone();
            let mut request = RunRequest {
                dependency_snapshot: Default::default(),
                monitor_change: None,
                context_selection: item.context_selection.clone(),
                context_receipt: Default::default(),
                model: None,
                id: run_id,
                project_id: item.project_id.clone(),
                project_name: item.project_name,
                project_path: item.project_path,
                agent: item.agent,
                agent_profile_id: item.agent_profile_id,
                verify_command: item.verify_command,
                prepare_command: item.prepare_command,
                auto_verify: item.auto_verify,
                target_branch: item.target_branch,
                account_binding: None,
                prompt: item.prompt,
                isolated: true,
                previous_run_id: None,
                connection_ids: None,
                coordination: Some(CoordinationContext {
                    endpoint: url.clone(),
                    token: token.clone(),
                    instructions,
                }),
            };
            let result = (|| {
                if assigned.staged_dependencies && !assigned.dependencies.is_empty() {
                    let ids = assigned
                        .dependencies
                        .iter()
                        .filter_map(|id| {
                            inner
                                .ledger
                                .items
                                .iter()
                                .find(|i| &i.id == id)
                                .and_then(|i| i.run_id.clone())
                        })
                        .collect::<Vec<_>>();
                    request.dependency_snapshot =
                        crate::commands::integration::prepare_dependencies(
                            &self.runtime.integration_directory(),
                            &runs,
                            &ids,
                            &request.id,
                        )?;
                }
                if !request.dependency_snapshot.sources.is_empty() {
                    request.coordination.as_mut().unwrap().instructions.push_str(&format!("\nThis workspace includes verified predecessor snapshots, not just the target branch. Inspect these immutable input receipts and perform only your assigned work: {}\n", serde_json::to_string(&request.dependency_snapshot).map_err(|e| e.to_string())?));
                }
                let snapshot = self.startup(&mut inner, &request, Some(&assigned))?;
                request
                    .coordination
                    .as_mut()
                    .unwrap()
                    .instructions
                    .push_str(&snapshot);
                self.register_launch(&mut inner, &request.id)?;
                self.runtime.start_locked(request)
            })();
            if let Err(error) = result {
                inner.grants.remove(&token);
                inner
                    .ledger
                    .items
                    .iter_mut()
                    .find(|i| i.id == item.id)
                    .unwrap()
                    .error = Some(error);
                inner.enabled.remove(&item.project_id);
                self.save(&inner.ledger)?;
            }
        }
        self.reconcile_locked(&mut inner)?;
        Ok(())
    }

    pub fn launch(&self) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            match tokio::net::TcpListener::bind("127.0.0.1:0").await {
                Ok(listener) => {
                    service.inner.lock().unwrap().url =
                        Some(format!("http://{}", listener.local_addr().unwrap()));
                    let router = Router::new()
                        .route("/v1/project", get(bridge_project))
                        .route("/v1/tools/search", post(bridge_tool_search))
                        .route("/v1/tools/execute", post(bridge_tool_execute))
                        .route("/v1/tools/read", post(bridge_tool_read))
                        .route("/v1/messages", post(bridge_message))
                        .route("/v1/messages", get(inbox::bridge_inbox))
                        .route("/v1/messages/ack", post(inbox::bridge_ack))
                        .route("/v1/browser/navigate", post(bridge_browser_navigate))
                        .route("/v1/browser/screenshot", post(bridge_browser_screenshot))
                        .route("/v1/browser/snapshot", post(bridge_browser_snapshot))
                        .route("/v1/browser/interact", post(bridge_browser_interact))
                        .route("/v1/browser/configure", post(bridge_browser_configure))
                        .route("/v1/browser/inspect", post(bridge_browser_inspect))
                        .route("/v1/browser/tabs", post(bridge_browser_tabs))
                        .route(
                            "/v1/desktop/control",
                            post(crate::commands::desktop_control::bridge),
                        )
                        .route("/v1/user-prompt", post(bridge_user_prompt))
                        .route("/v1/user-prompt/poll", get(bridge_get_user_prompt))
                        .route("/v1/validation-step", post(bridge_validation_step))
                        .route("/v1/computer/verify", post(bridge_computer_verify))
                        .layer(DefaultBodyLimit::max(65_536))
                        .with_state(service.clone());
                    let router = router
                        .merge(crate::commands::coordination_mcp::router(service.clone()))
                        .layer(axum::middleware::from_fn_with_state(
                            service.clone(),
                            automatic::deliver,
                        ));
                    let alive = service.alive.clone();
                    if let Err(error) = axum::serve(listener, router)
                        .with_graceful_shutdown(async move {
                            while alive.load(Ordering::Relaxed) {
                                tokio::time::sleep(Duration::from_millis(250)).await;
                            }
                        })
                        .await
                    {
                        service.inner.lock().unwrap().error = Some(error.to_string());
                    }
                }
                Err(error) => service.inner.lock().unwrap().error = Some(error.to_string()),
            }
        });
        let service = self.clone();
        std::thread::spawn(move || {
            while service.alive.load(Ordering::Relaxed) {
                if let Err(error) = service.tick() {
                    let mut inner = service.inner.lock().unwrap();
                    inner.error = Some(error);
                    inner.enabled.clear();
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        });
    }

    pub fn start_manual(&self, mut request: RunRequest) -> Result<String, String> {
        self.runtime.access.ensure()?;
        self.ensure_storage_loaded()?;
        let mut inner = self.inner.lock().unwrap();
        let mut assigned = None;
        if let Some(previous_id) = &request.previous_run_id {
            let runs = self.runtime.integration_runs()?;
            if let Some(previous) = runs.iter().find(|r| &r.id == previous_id) {
                if let Some(item) = inner
                    .ledger
                    .items
                    .iter()
                    .find(|i| {
                        runs.iter().any(|r| {
                            Some(&r.id) == i.run_id.as_ref() && r.task_id == previous.task_id
                        })
                    })
                    .cloned()
                {
                    if item.canceled {
                        return Err(
                            "This task was abandoned. Add a new task to claim its scope again."
                                .into(),
                        );
                    }
                    let endpoint = inner
                        .url
                        .clone()
                        .ok_or("The coordination bridge is unavailable")?;
                    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
                    inner
                        .grants
                        .insert(token.clone(), (item.id.clone(), request.id.clone()));
                    request.coordination = Some(CoordinationContext {
                        endpoint,
                        token,
                        instructions: instructions(&item),
                    });
                    assigned = Some(item);
                }
            }
        }
        if request.coordination.is_none() {
            if let Some(endpoint) = inner.url.clone() {
                let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
                inner
                    .grants
                    .insert(token.clone(), (request.id.clone(), request.id.clone()));
                request.coordination = Some(CoordinationContext {
                    endpoint,
                    token,
                    instructions: harness_instructions(),
                });
            }
        }
        if request.coordination.is_none() {
            return Err(
                "The coordination bridge is starting or unavailable. Retry when it is ready."
                    .into(),
            );
        }
        let token = request.coordination.as_ref().unwrap().token.clone();
        let result = (|| {
            let snapshot = self.startup(&mut inner, &request, assigned.as_ref())?;
            request
                .coordination
                .as_mut()
                .unwrap()
                .instructions
                .push_str(&snapshot);
            self.register_launch(&mut inner, &request.id)?;
            self.runtime.start(request)
        })();
        if result.is_err() {
            inner.grants.remove(&token);
        }
        if let Err(error) = self.reconcile_locked(&mut inner) {
            inner.error = Some(error);
        }
        result
    }

    pub(in crate::commands) fn prepare_reset(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        if !inner.enabled.is_empty() {
            return Err("Pause task queues before resetting Jackalope.".into());
        }
        let _integration_guard = crate::commands::integration::execution_guard()?;
        crate::commands::verification::ensure_all_idle()?;
        self.runtime.request_reset()?;
        self.alive.store(false, Ordering::Relaxed);
        inner.enabled.clear();
        Ok(())
    }

    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::Relaxed);
        self.inner.lock().unwrap().enabled.clear();
    }

    pub(in crate::commands) fn authorized(
        &self,
        headers: &HeaderMap,
    ) -> Result<QueueItem, StatusCode> {
        if headers.contains_key("origin") {
            return Err(StatusCode::FORBIDDEN);
        }
        let token = headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let inner = self.inner.lock().unwrap();
        let (id, run_id) = inner
            .grants
            .get(token)
            .cloned()
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let item = inner
            .ledger
            .items
            .iter()
            .find(|i| i.id == id && !i.canceled)
            .cloned();
        drop(inner);
        if !self
            .runtime
            .integration_runs()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .iter()
            .any(|r| r.id == run_id && active(&r.status))
        {
            return Err(StatusCode::UNAUTHORIZED);
        }
        let item = match item {
            Some(item) => item,
            None => {
                let runs = self
                    .runtime
                    .integration_runs()
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let run = runs
                    .into_iter()
                    .find(|r| r.id == run_id)
                    .ok_or(StatusCode::UNAUTHORIZED)?;
                QueueItem {
                    staged_dependencies: false,
                    feature: None,
                    feature_id: None,
                    context_selection: Default::default(),
                    id: run.task_id.clone(),
                    project_id: run.project_id.clone(),
                    project_name: run.project_name.clone(),
                    project_path: run.project_path.clone(),
                    target_branch: run.target_branch.clone(),
                    agent_profile_id: run
                        .account_binding
                        .as_ref()
                        .and_then(|b| b.profile_id.clone()),
                    verify_command: run.verify_command.clone(),
                    prepare_command: run.prepare_command.clone(),
                    auto_verify: run.auto_verify,
                    title: run.prompt.chars().take(50).collect(),
                    prompt: run.prompt.clone(),
                    agent: run.agent.clone(),
                    scopes: vec![".".into()],
                    dependencies: vec![],
                    created_at: run.started_at.clone(),
                    run_id: Some(run.id.clone()),
                    canceled: false,
                    error: None,
                }
            }
        };
        Ok(item)
    }

    pub(in crate::commands) fn authorized_run(
        &self,
        headers: &HeaderMap,
    ) -> Result<crate::commands::tasks::TaskRun, StatusCode> {
        if headers.contains_key("origin") {
            return Err(StatusCode::FORBIDDEN);
        }
        let token = headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let inner = self.inner.lock().unwrap();
        let (_id, run_id) = inner
            .grants
            .get(token)
            .cloned()
            .ok_or(StatusCode::UNAUTHORIZED)?;
        drop(inner);
        let runs = self
            .runtime
            .integration_runs()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let run = runs
            .into_iter()
            .find(|r| r.id == run_id && active(&r.status))
            .ok_or(StatusCode::UNAUTHORIZED)?;
        Ok(run)
    }
}
