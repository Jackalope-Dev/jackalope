use super::*;
use crate::commands::tasks::TaskRuntime;

pub fn automatic(runtime: &TaskRuntime, project: &str) -> bool {
    crate::commands::experiments::is("JACKALOPE_AUTO_RELEVANCE", "on")
        && relevance::available(runtime, project)
}

pub async fn read(
    runtime: &TaskRuntime,
    run: &TaskRun,
    call: batch::ReadCall,
) -> Result<CallToolResult, String> {
    let broker = &runtime.mcp_broker;
    let mut input = match call {
        batch::ReadCall::Handle(input) => input,
        batch::ReadCall::Named(input) => broker.resolve_named(&run.id, input).await?,
    };
    if let Some(output) = &input.output {
        output.validate()?;
    }
    let output = input.output.take();
    let (original, usage) = broker
        .execute_with_policy(&run.id, input, true, false)
        .await?;
    record_usage(runtime, run, usage);
    deliver(runtime, run, original, output.as_ref()).await
}

pub(super) async fn deliver(
    runtime: &TaskRuntime,
    run: &TaskRun,
    original: CallToolResult,
    output: Option<&results::Selection>,
) -> Result<CallToolResult, String> {
    let broker = &runtime.mcp_broker;
    // Exact requests retain their stated semantics, including counts and completeness.
    let exact = output.is_some_and(|selection| {
        selection.rows.is_some() || selection.text.is_some() || !selection.json_pointers.is_empty()
    });
    let candidate = (!exact && automatic(runtime, &run.project_id))
        .then(|| relevance::automatic_input(&original))
        .flatten();
    let (result, receipt) = if let Some(input) = candidate {
        let (result, receipt) = relevance::filter(runtime, run, original, &input).await?;
        if let Some(output) = output {
            let attempt = broker.attempt(&run.id)?;
            let mut catalog = attempt.catalog.lock().await;
            let (result, stats) =
                results::select_measured(result, Some(output), &mut catalog.results);
            catalog.usage.selection(stats);
            (result, receipt)
        } else {
            (result, receipt)
        }
    } else {
        let attempt = broker.attempt(&run.id)?;
        let mut catalog = attempt.catalog.lock().await;
        if *attempt.closed.borrow() {
            return Err("This attempt has ended.".into());
        }
        let output = if crate::commands::experiments::is("JACKALOPE_RESULT_SELECTION", "off") {
            None
        } else {
            output
        };
        let (result, stats) = results::select_measured(original, output, &mut catalog.results);
        catalog.usage.selection(stats);
        (result, None)
    };
    let usage = broker.record_delivery(&run.id, &result, receipt).await?;
    record_usage(runtime, run, usage);
    Ok(result)
}
