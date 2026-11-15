use super::*;

impl crate::services::Service for Coordinator {
    fn shutdown(&self) {
        Coordinator::shutdown(self)
    }
}

impl Coordinator {
    pub(in crate::commands) fn bridge_ready(&self) -> bool {
        self.inner.lock().is_ok_and(|inner| inner.url.is_some())
    }

    pub(super) fn view(&self) -> Result<QueueView, String> {
        self.ensure_storage_loaded()?;
        // The view lists what is reachable and names paused merges instead of failing,
        // so one stale integration does not hide every plan; dispatch still waits.
        let (merged_run_ids, paused_integrations) =
            crate::commands::integration::applied_view(&self.runtime)?;
        let inner = self.state();
        Ok(QueueView {
            managed_tasks: inner.ledger.managed_tasks.clone(),
            assist_policies: inner.ledger.assist_policies.clone(),
            reconciliations: inner.ledger.reconciliations.clone(),
            agreements: inner.ledger.agreements.clone(),
            scope_audits: inner.ledger.scope_audits.clone(),
            adoptions: inner.ledger.adoptions.clone(),
            items: inner.ledger.items.clone(),
            messages: inner.ledger.messages.clone(),
            enabled_projects: inner.enabled.iter().cloned().collect(),
            concurrency: inner.concurrency,
            remote_concurrency: inner.remote_concurrency,
            bridge_url: inner.url.clone(),
            bridge_error: inner.error.clone(),
            merged_run_ids,
            paused_integrations,
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
            excluded_scopes: vec![],
            parent_task_id: None,
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
            setup_files: req.setup_files,
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
        let mut inner = self.state();
        self.commit(&mut inner, |ledger| Self::append(ledger, req))
    }

    pub(super) fn import(&self, request: PlanRequest) -> Result<Vec<String>, String> {
        if request
            .feature
            .as_ref()
            .is_some_and(|f| f.trim().is_empty() || f.len() > 160)
        {
            return Err("Use a feature title up to 160 bytes.".into());
        }
        if request.review_only
            && request
                .verify_command
                .as_ref()
                .is_some_and(|s| !s.trim().is_empty())
        {
            return Err("A review-only plan cannot carry a check command.".into());
        }
        if request.staged_dependencies
            && !request.review_only
            && (!request.auto_verify
                || request
                    .verify_command
                    .as_ref()
                    .is_none_or(|s| s.trim().is_empty()))
        {
            return Err("Enable automatic project verification and save its command before using staged dependencies.".into());
        }
        let items = ordered_plan(request.items)?;
        let mut inner = self.state();
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
        let created = self.commit(&mut inner, |ledger| {
            let mut ids = HashMap::new();
            let mut created = Vec::new();
            for item in items {
                let id = Self::append(
                    ledger,
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
                        setup_files: request.setup_files.clone(),
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
            Ok::<_, String>(created)
        })?;
        if !inner
            .ledger
            .managed_tasks
            .iter()
            .any(|task| Some(&task.id) == request.feature_id.as_ref())
        {
            inner.enabled.remove(&request.project_id);
        }
        Ok(created)
    }

    pub(super) fn tick(&self) -> Result<(), String> {
        self.reconcile()?;
        self.ensure_storage_loaded()?;
        self.auto_start_managed()?;
        // Swarm rounds take the plan store and coordinator locks one at a time.
        crate::commands::planning::rounds::tick(self);
        self.runtime.access.ensure()?;
        self.transact(|inner, guard| {
            self.refresh_pool_locked(inner);
            self.runtime.ensure_history_saved()?;
            let merged = crate::commands::integration::applied_run_ids(&self.runtime)?;
            let runs = self.runtime.integration_runs()?;
            let Some(url) = inner.url.clone() else {
                return Ok(());
            };
            inner.error = None;
            let due = self
                .scope_checked
                .lock()
                .unwrap()
                .is_none_or(|last| last.elapsed() >= SNAPSHOT_INTERVAL);
            if due || !ready_items(inner, &runs, &merged).is_empty() {
                self.refresh_scopes_locked(inner)?;
                *self.scope_checked.lock().unwrap() = Some(std::time::Instant::now());
            }
            if self.retry_lost_hosts_locked(inner, guard, &runs, &merged, &url)? {
                return Ok(());
            }
            if self.deliver_managed_locked(inner, guard, &runs, &merged, &url)? {
                return Ok(());
            }
            if self.apply_managed_locked(inner, &runs, &merged)? {
                return Ok(());
            }
            if self.assist_locked(inner, guard, &runs, &merged, &url)? {
                return Ok(());
            }
            for (item, host) in placed_items(inner, &runs, &merged) {
                // No host the work may use can take it: it waits for the
                // person, like any other dispatch error.
                let result = host
                    .and_then(|host| self.dispatch_item(inner, guard, &runs, &url, &item, host));
                if let Err(error) = result {
                    self.hold_dispatch(inner, &item, error)?;
                }
            }
            self.reconcile_locked(inner)
        })
    }

    /// Claims a queued item for a new attempt and launches it on `host`.
    fn dispatch_item(
        &self,
        inner: &mut Inner,
        guard: &ExecutionGuard,
        runs: &[crate::commands::tasks::TaskRun],
        url: &str,
        item: &QueueItem,
        host: crate::commands::computers::pool::RunHost,
    ) -> Result<String, String> {
        let run_id = Uuid::new_v4().to_string();
        self.commit(inner, |ledger| {
            managed_delivery::capture_interfaces(ledger, item, &run_id);
            ledger
                .items
                .iter_mut()
                .find(|i| i.id == item.id)
                .unwrap()
                .run_id = Some(run_id.clone());
            if let Some(task) = ledger
                .managed_tasks
                .iter_mut()
                .find(|task| Some(&task.id) == item.feature_id.as_ref())
            {
                task.run_ids.push(run_id.clone());
            }
            Ok::<_, String>(())
        })?;
        let mut request = RunRequest {
            id: run_id,
            context_selection: item.context_selection.clone(),
            agent_profile_id: item.agent_profile_id.clone(),
            verify_command: item.verify_command.clone(),
            prepare_command: item.prepare_command.clone(),
            setup_files: item.setup_files.clone(),
            auto_verify: item.auto_verify,
            target_branch: item.target_branch.clone(),
            ..RunRequest::new(
                &item.project_id,
                &item.project_name,
                &item.project_path,
                &item.agent,
                item.prompt.clone(),
            )
        };
        let feature = inner
            .ledger
            .managed_tasks
            .iter()
            .find(|task| Some(&task.id) == item.feature_id.as_ref());
        if let Some(task) = feature {
            request.model = task.request.model.clone();
            request.effort = task.request.effort;
            request.codex_speed = task.request.codex_speed;
            request.connection_ids = task.request.connection_ids.clone();
            request.agent_profile_id = task.request.agent_profile_id.clone();
            crate::commands::task_strategy::validate_source(
                &task.request,
                &task.assessment.source_head,
            )?;
        }
        let mut instructions = instructions(item);
        if item.staged_dependencies && !item.dependencies.is_empty() {
            let integration = managed_delivery::is_integration(&inner.ledger, item);
            let ids = if integration {
                managed_delivery::source_ids(&inner.ledger, item)
            } else {
                item.dependencies
                    .iter()
                    .filter_map(|id| {
                        inner
                            .ledger
                            .items
                            .iter()
                            .find(|i| &i.id == id)
                            .and_then(|i| i.run_id.clone())
                    })
                    .collect::<Vec<_>>()
            };
            let directory = self.runtime.integration_directory();
            request.dependency_snapshot = if integration {
                crate::commands::integration::dependencies::reconciliation_input(
                    &directory,
                    runs,
                    &ids,
                    &request.id,
                )?
            } else {
                crate::commands::integration::prepare_dependencies(
                    &directory,
                    runs,
                    &ids,
                    &request.id,
                )?
            };
        }
        if !request.dependency_snapshot.sources.is_empty() {
            instructions.push_str(&format!("\nThis workspace includes verified predecessor snapshots, not just the target branch. Inspect these immutable input receipts and perform only your assigned work: {}\n", serde_json::to_string(&request.dependency_snapshot).map_err(|e| e.to_string())?));
        }
        self.launch_assignment(
            inner,
            guard,
            LaunchSpec {
                request,
                endpoint: url,
                managed: true,
                instructions,
                assigned: Some(item),
                host: Some(host),
            },
        )
    }

    /// Records why `item` could not start and stops dispatching its project and
    /// feature until the person looks at it.
    fn hold_dispatch(
        &self,
        inner: &mut Inner,
        item: &QueueItem,
        error: String,
    ) -> Result<(), String> {
        inner.enabled.remove(&item.project_id);
        if let Some(id) = &item.feature_id {
            inner.enabled.remove(&managed::dispatch_key(id));
        }
        self.commit(inner, |ledger| {
            if let Some(saved) = ledger.items.iter_mut().find(|i| i.id == item.id) {
                saved.error = Some(error);
            }
            Ok(())
        })
    }

    /// Launches a coordinated attempt: grants it a bridge token, briefs it on
    /// the project, records the launch and starts it, on `spec.host` when
    /// given. When the start fails, the grant and host placement are released;
    /// the caller records the error where the attempt belongs.
    pub(super) fn launch_assignment(
        &self,
        inner: &mut Inner,
        guard: &ExecutionGuard,
        spec: LaunchSpec,
    ) -> Result<String, String> {
        let LaunchSpec {
            mut request,
            endpoint,
            managed,
            instructions,
            assigned,
            host,
        } = spec;
        let token = bridge_token();
        let id = request.id.clone();
        let grant = assigned.map_or_else(|| id.clone(), |item| item.id.clone());
        inner.grants.insert(token.clone(), (grant, id.clone()));
        let placed = host.is_some();
        if let Some(host) = host {
            crate::commands::computers::pool::assign(&id, host);
        }
        let result = (|| {
            let briefing = self.startup(inner, &request, assigned)?;
            request.coordination = Some(CoordinationContext {
                managed,
                endpoint: endpoint.into(),
                token: token.clone(),
                instructions: instructions + &briefing,
            });
            self.register_launch(inner, &id)?;
            self.runtime.start_locked(guard, request)
        })();
        if result.is_err() {
            inner.grants.remove(&token);
            if placed {
                crate::commands::computers::pool::take(&id);
            }
        }
        result
    }

    pub fn launch(&self) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            match tokio::net::TcpListener::bind("127.0.0.1:0").await {
                Ok(listener) => {
                    service.state().url =
                        Some(format!("http://{}", listener.local_addr().unwrap()));
                    let router = crate::commands::bridge::router(service.clone());
                    let alive = service.alive.clone();
                    if let Err(error) = axum::serve(listener, router)
                        .with_graceful_shutdown(async move {
                            while alive.load(Ordering::Relaxed) {
                                tokio::time::sleep(Duration::from_millis(250)).await;
                            }
                        })
                        .await
                    {
                        service.state().error = Some(error.to_string());
                    }
                }
                Err(error) => service.state().error = Some(error.to_string()),
            }
        });
        let service = self.clone();
        std::thread::spawn(move || {
            while service.alive.load(Ordering::Relaxed) {
                if let Err(error) = service.dispatch_followups() {
                    service.state().error = Some(error);
                }
                if let Err(error) = service.tick() {
                    let mut inner = service.state();
                    inner.error = Some(error);
                    inner.enabled.clear();
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        });
    }

    pub fn start_manual(&self, request: RunRequest) -> Result<String, String> {
        self.runtime.access.ensure()?;
        self.ensure_storage_loaded()?;
        self.transact(|inner, guard| self.start_manual_locked(inner, guard, request))
    }

    /// Starts a live session's next attempt, or reports that it waits for a
    /// free execution slot.
    pub(crate) fn start_session(&self, request: RunRequest) -> Result<SessionStart, String> {
        self.runtime.access.ensure()?;
        self.ensure_storage_loaded()?;
        self.transact(|inner, guard| {
            if self.awaits_capacity(inner, &request)? {
                return Ok(SessionStart::Waiting);
            }
            self.start_manual_locked(inner, guard, request)
                .map(|_| SessionStart::Started)
        })
    }

    /// Whether a session or planner attempt that has not started would exceed
    /// the execution limit.
    fn awaits_capacity(&self, inner: &Inner, request: &RunRequest) -> Result<bool, String> {
        if request.live_session_id.is_none()
            && !inner
                .ledger
                .managed_tasks
                .iter()
                .any(|task| task.planner_run_id == request.id)
        {
            return Ok(false);
        }
        let runs = self.runtime.integration_runs()?;
        Ok(!runs.iter().any(|run| run.id == request.id)
            && runs.iter().filter(|run| run.status.is_active()).count() >= inner.concurrency)
    }

    pub(super) fn start_manual_locked(
        &self,
        inner: &mut Inner,
        guard: &ExecutionGuard,
        mut request: RunRequest,
    ) -> Result<String, String> {
        self.validate_followup_launch(&inner.ledger, &request)?;
        if request.previous_run_id.is_some() || request.retry_of.is_some() {
            super::managed::prepare_followup(
                &inner.ledger,
                &self.runtime.integration_runs()?,
                &mut request,
            )?;
        }
        if self.awaits_capacity(inner, &request)? {
            return Err("Session is waiting for execution capacity.".into());
        }
        let endpoint = inner
            .url
            .clone()
            .ok_or("The coordination bridge is starting or unavailable. Retry when it is ready.")?;
        let assigned = self.followed_assignment(inner, &request)?;
        let (managed, instructions) = match &assigned {
            Some(item) => (true, instructions(item)),
            None => {
                let managed = inner
                    .ledger
                    .managed_tasks
                    .iter()
                    .any(|task| task.planner_run_id == request.id);
                let instructions = if managed {
                    harness_instructions()
                } else {
                    focused_instructions()
                };
                (managed, instructions)
            }
        };
        if let Some(item) = &assigned {
            self.commit(inner, |ledger| {
                managed_delivery::capture_interfaces(ledger, item, &request.id);
                Ok::<_, String>(())
            })?;
        }
        let result = self.launch_assignment(
            inner,
            guard,
            LaunchSpec {
                request,
                endpoint: &endpoint,
                managed,
                instructions,
                assigned: assigned.as_ref(),
                host: None,
            },
        );
        if let (Ok(_), Some(task_id)) = (
            &result,
            assigned.as_ref().and_then(|item| item.feature_id.as_ref()),
        ) {
            self.commit(inner, |ledger| {
                if let Some(task) = ledger
                    .managed_tasks
                    .iter_mut()
                    .find(|task| &task.id == task_id)
                {
                    task.error = None;
                    if let Some(delivery) = &mut task.delivery {
                        delivery.interventions += 1;
                        delivery.repair_limit = delivery.repairs.len() + 2;
                        delivery.ready_at = None;
                    }
                }
                Ok::<_, String>(())
            })?;
        }
        if let Err(error) = self.reconcile_locked(inner) {
            inner.error = Some(error);
        }
        result
    }

    /// The queued assignment a follow-up or retry continues, when the attempt
    /// it follows belonged to one.
    fn followed_assignment(
        &self,
        inner: &Inner,
        request: &RunRequest,
    ) -> Result<Option<QueueItem>, String> {
        let Some(previous_id) = request
            .previous_run_id
            .as_ref()
            .or(request.retry_of.as_ref())
        else {
            return Ok(None);
        };
        let runs = self.runtime.integration_runs()?;
        let Some(previous) = runs.iter().find(|r| &r.id == previous_id) else {
            return Ok(None);
        };
        let Some(item) = inner
            .ledger
            .items
            .iter()
            .find(|i| {
                runs.iter()
                    .any(|r| Some(&r.id) == i.run_id.as_ref() && r.task_id == previous.task_id)
            })
            .cloned()
        else {
            return Ok(None);
        };
        if inner
            .ledger
            .managed_tasks
            .iter()
            .any(|task| Some(&task.id) == item.feature_id.as_ref())
            && inner
                .ledger
                .items
                .iter()
                .any(|child| child.dependencies.contains(&item.id) && child.run_id.is_some())
        {
            return Err("Dependent work already uses this assignment. Follow up on the final combined result instead.".into());
        }
        if item.canceled {
            return Err("This task was abandoned. Add a new task to claim its scope again.".into());
        }
        Ok(Some(item))
    }

    pub(in crate::commands) fn prepare_reset(&self) -> Result<(), String> {
        let mut inner = self.state();
        if !inner.enabled.is_empty() {
            return Err("Pause task queues before resetting Jackalope.".into());
        }
        let _guard = self.execution(&inner)?;
        crate::commands::verification::ensure_all_idle()?;
        self.runtime.request_reset()?;
        self.alive.store(false, Ordering::Relaxed);
        inner.enabled.clear();
        Ok(())
    }

    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::Relaxed);
        self.state().enabled.clear();
    }

    /// The grant a bridge token was issued for: its task and attempt.
    fn grant(&self, token: &str) -> Result<(String, String), StatusCode> {
        let token = crate::commands::tasks::bridge_token(token);
        self.state()
            .grants
            .get(&token)
            .cloned()
            .ok_or(StatusCode::UNAUTHORIZED)
    }

    /// The attempt a bridge request speaks for, while it is still active.
    pub(in crate::commands) fn caller(&self, headers: &HeaderMap) -> Result<Caller, StatusCode> {
        let token = bearer(headers)?.to_owned();
        let (_, run_id) = self.grant(&token)?;
        let run = self.active_run(&run_id)?;
        Ok(Caller { token, run })
    }

    fn active_run(&self, run_id: &str) -> Result<crate::commands::tasks::TaskRun, StatusCode> {
        self.runtime
            .run_snapshot(run_id)
            .filter(|run| run.status.is_active())
            .ok_or(StatusCode::UNAUTHORIZED)
    }

    /// The assignment `caller` works on, checked again against its grant and
    /// attempt. A manual attempt has no queued item, so it stands in with the
    /// whole repository as its scope.
    pub(in crate::commands) fn assignment(&self, caller: &Caller) -> Result<QueueItem, StatusCode> {
        let (id, run_id) = self.grant(&caller.token)?;
        let item = self
            .state()
            .ledger
            .items
            .iter()
            .find(|i| i.id == id && !i.canceled)
            .cloned();
        let run = self.active_run(&run_id)?;
        Ok(item.unwrap_or_else(|| QueueItem {
            excluded_scopes: vec![],
            parent_task_id: None,
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
            setup_files: run.setup_files.clone(),
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
        }))
    }
}

/// How [`Coordinator::start_session`] ended.
pub(crate) enum SessionStart {
    Started,
    /// Every execution slot is in use; the session tries again later.
    Waiting,
}

/// An authenticated bridge request: the attempt its token speaks for.
#[derive(Clone)]
pub(crate) struct Caller {
    /// The bearer token as sent; a warm process's alias resolves at each check.
    token: String,
    pub run: crate::commands::tasks::TaskRun,
}

impl Caller {
    pub(super) fn token(&self) -> &str {
        &self.token
    }
}

/// The bearer token of a bridge request. Browser pages never reach the bridge.
pub(super) fn bearer(headers: &HeaderMap) -> Result<&str, StatusCode> {
    if headers.contains_key("origin") {
        return Err(StatusCode::FORBIDDEN);
    }
    headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)
}
