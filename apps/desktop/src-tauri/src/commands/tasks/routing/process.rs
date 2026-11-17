use super::super::helper_process::{reported, Interrupted, Turn};
use super::*;

/// How long the routing agent has to answer before local rules choose instead,
/// matching Jev's timeout. Sonnet answered a real routing request in about six
/// seconds, including the CLI's start-up.
pub(in crate::commands::tasks) const ROUTING_BUDGET: Duration = Duration::from_secs(8);

/// The model a routing agent answers with. Choosing a worker is a short
/// structured judgement, so Claude routes on Sonnet rather than its default
/// or Opus; other agents keep the router's configured model.
pub(in crate::commands::tasks) fn routing_model(
    adapter: &str,
    model: Option<&str>,
) -> Option<String> {
    match (adapter, model) {
        ("claude", None) => Some("sonnet".into()),
        ("claude", Some(model)) if model.to_ascii_lowercase().contains("opus") => {
            Some("sonnet".into())
        }
        (_, model) => model.map(str::to_string),
    }
}

/// A routing answer asks for the lowest effort the router's model accepts.
pub(in crate::commands::tasks) fn routing_effort(
    cmd: &mut Command,
    adapter: &str,
    model: Option<&str>,
) {
    super::super::effort::configure(
        cmd,
        adapter,
        model,
        Some(super::super::effort::TaskEffort::Quick),
    );
}

impl TaskRuntime {
    pub(super) fn routing_process(
        &self,
        req: &RunRequest,
        router: &Candidate,
        prompt: &str,
    ) -> Result<TaskRun, String> {
        let directory = if router.adapter == "opencode" {
            self.directory.join("helper-workspace")
        } else {
            self.directory
                .join("routing")
                .join(format!("{}-{}", req.id, uuid::Uuid::new_v4()))
        };
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let (_, executable) = self.policy()?.resolve(&router.agent)?;
        agent_profiles::validate_binding(&self.profiles_root(), &router.binding)?;
        let model = routing_model(&router.adapter, router.model.as_deref());
        let mut output = self.run_snapshot(&req.id).ok_or("Attempt not found")?;
        let answer = Turn {
            agent: &router.agent,
            adapter: &router.adapter,
            executable,
            binding: &router.binding,
            model: model.as_deref(),
            prompt,
            prompt_path: directory.join("request.txt"),
            directory,
            attempt: Some(&req.id),
            limit: ROUTING_BUDGET,
        }
        .run(
            self,
            |cmd| routing_effort(cmd, &router.adapter, model.as_deref()),
            &|| !self.is_running(&req.id),
            |answer| {
                self.update_checked(&req.id, |run| {
                    run.efficiency.timing("helperStartup", answer.warm_elapsed);
                    run.efficiency.warm_provider_hits += u64::from(answer.warm.as_ref().is_some_and(|lease| lease.reused));
                    run.process_contained = cfg!(windows);
                    activity(run, &format!("{} is choosing an agent, model and account using task context and available quota.", router.agent));
                })
            },
        )?;
        if !answer.ran {
            return Err("Routing was stopped.".into());
        }
        let mut failure = None;
        let exit = match answer.exit {
            Ok(status) => Some(status),
            Err(Interrupted::Stopped) => {
                failure = Some("Routing was stopped.".to_string());
                None
            }
            Err(Interrupted::TimedOut) => {
                failure = Some(format!(
                    "The routing agent did not answer within {} seconds.",
                    ROUTING_BUDGET.as_secs()
                ));
                None
            }
            Err(Interrupted::Failed(error)) => {
                failure = Some(error);
                None
            }
        };
        let mut read = answer.output;
        let mut warm = answer.warm;
        if let Some(lease) = &warm {
            match lease.output(|| !self.is_running(&req.id)) {
                Ok(text) => read.0 = text,
                Err(error) => {
                    failure.get_or_insert(error);
                }
            }
        }
        output.model = model;
        output.result.clear();
        output.error = None;
        output.session_id = None;
        output.usage = Usage::default();
        output.usage_observations.clear();
        output.activity.clear();
        output.quota_failure = None;
        for line in read.0.lines() {
            consume_adapter_event(&mut output, line, &router.adapter);
        }
        if let Some(error) = &failure {
            output.error = Some(error.clone());
        }
        if answer.written.is_err() {
            output.error = Some("The default agent did not accept the routing context.".into());
        }
        if read.1 {
            output.error = Some("The routing response exceeded its size limit.".into());
        }
        if !exit.is_some_and(|status| status.success()) && output.error.is_none() {
            output.error = Some(reported(
                "The default agent could not complete routing.",
                &answer.diagnostics,
            ));
        }
        self.update_checked(&req.id, |run| {
            run.routing
                .get_or_insert_with(Default::default)
                .attempts
                .push(RoutingAttempt {
                    agent: router.agent.clone(),
                    model: output.model.clone().or_else(|| router.model.clone()),
                    binding: router.binding.clone(),
                    usage: output.usage.clone(),
                    error: output.error.clone(),
                    recorded_at: Utc::now().to_rfc3339(),
                });
        })?;
        if output.quota_failure.is_none()
            && (!exit.is_some_and(|status| status.success()) || output.error.is_some())
        {
            return Err(output
                .error
                .clone()
                .unwrap_or_else(|| "The routing agent could not complete routing.".into()));
        }
        if output.error.is_none() && output.quota_failure.is_none() {
            if let Some(lease) = &mut warm {
                lease.complete();
            }
        }
        Ok(output)
    }
}
