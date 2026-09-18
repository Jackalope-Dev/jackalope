use super::*;

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum ReadCall {
    Handle(ExecuteInput),
    Named(NamedReadInput),
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BatchInput {
    #[schemars(
        description = "One to eight independent read-only calls with a discovered handle, or an exact name/server and already-known arguments. Results preserve input order. Each output can filter/project rows locally. Calls on different connections overlap; calls on the same connection remain ordered. No writes or dependencies between calls."
    )]
    pub calls: Vec<ReadCall>,
}

impl Broker {
    pub async fn read_batch(
        &self,
        run: &str,
        input: BatchInput,
    ) -> Result<(CallToolResult, BrokerUsage), String> {
        self.read_batch_context(run, input, None).await
    }

    pub async fn read_batch_context(
        &self,
        run: &str,
        input: BatchInput,
        context: Option<(crate::commands::tasks::TaskRuntime, TaskRun)>,
    ) -> Result<(CallToolResult, BrokerUsage), String> {
        if input.calls.is_empty() || input.calls.len() > 8 {
            return Err("Batch one to eight independent read-only calls.".into());
        }
        for call in &input.calls {
            let (valid, arguments, output) = match call {
                ReadCall::Handle(call) => (call.handle.len() <= 80, &call.arguments, &call.output),
                ReadCall::Named(call) => (
                    !call.name.is_empty()
                        && call.name.len() <= 256
                        && call
                            .server
                            .as_ref()
                            .is_none_or(|server| server.len() <= 256),
                    &call.arguments,
                    &call.output,
                ),
            };
            if !valid
                || serde_json::to_vec(arguments)
                    .map_err(|e| e.to_string())?
                    .len()
                    > 6_000
            {
                return Err("Batch arguments exceed the per-call limit of 6000 bytes.".into());
            }
            if let Some(output) = output {
                output.validate()?;
            }
        }
        let mut calls = Vec::new();
        for call in input.calls {
            calls.push(match call {
                ReadCall::Handle(call) => call,
                ReadCall::Named(call) => {
                    let (found, _) = self
                        .search_with_delivery(
                            run,
                            SearchInput {
                                query: call.name.clone(),
                                server: call.server,
                                offset: 0,
                                limit: Some(8),
                                refresh: false,
                            },
                            None,
                            false,
                        )
                        .await?;
                    ExecuteInput {
                        handle: named_read_handle(&found, &call.name)?,
                        arguments: call.arguments,
                        output: call.output,
                    }
                }
            });
        }
        let attempt = self.attempt(run)?;
        // Validate every lease before dispatch; execution revalidates each remote schema.
        {
            let catalog = attempt.catalog.lock().await;
            for call in &calls {
                let lease = catalog
                    .leases
                    .iter()
                    .find(|lease| lease.handle == call.handle)
                    .ok_or("Unknown or expired batch handle. Search for the tool first.")?;
                if !is_read_only(&lease.tool) {
                    return Err("Batches accept only declared read-only tools.".into());
                }
            }
        }
        let mut groups: BTreeMap<String, Vec<(usize, ExecuteInput)>> = BTreeMap::new();
        {
            let catalog = attempt.catalog.lock().await;
            for (index, call) in calls.into_iter().enumerate() {
                let lease = catalog
                    .leases
                    .iter()
                    .find(|lease| lease.handle == call.handle)
                    .ok_or("Batch handle expired before dispatch.")?;
                groups
                    .entry(lease.server.clone())
                    .or_default()
                    .push((index, call));
            }
        }
        let mut pending = tokio::task::JoinSet::new();
        let slots = Arc::new(tokio::sync::Semaphore::new(4));
        let count: usize = groups.values().map(Vec::len).sum();
        for calls in groups.into_values() {
            let context = context.clone();
            let broker = self.clone();
            let run = run.to_owned();
            let slots = slots.clone();
            pending.spawn(async move {
                let _slot = slots.acquire_owned().await.map_err(|e| e.to_string())?;
                let mut results = Vec::new();
                for (index, call) in calls {
                    let result = if let Some((runtime, task)) = &context {
                        delivery::read(runtime, task, ReadCall::Handle(call))
                            .await
                            .map(|result| (result, BrokerUsage::default()))
                    } else {
                        broker.read(&run, call).await
                    };
                    results.push((index, result));
                }
                Ok::<_, String>(results)
            });
        }
        let mut values = vec![Value::Null; count];
        let mut delivered = 0;
        while let Some(item) = pending.join_next().await {
            for (index, result) in item.map_err(|e| e.to_string())?? {
                values[index] = match result {
                    Ok((result, _)) => {
                        delivered += serde_json::to_vec(&result).map_or(0, |v| v.len()) as u64;
                        json!({"index":index,"result":result})
                    }
                    Err(error) => json!({"index":index,"error":error}),
                };
            }
        }
        let result = CallToolResult::structured(json!({"results":values,"complete":true}));
        let mut catalog = attempt.catalog.lock().await;
        *catalog.usage.batches.get_or_insert(0) += 1;
        let bytes = serde_json::to_vec(&result).map_or(0, |v| v.len()) as u64;
        *catalog.usage.result_bytes_returned.get_or_insert(0) += bytes.saturating_sub(delivered);
        Ok((result, catalog.usage.clone()))
    }
}
