use crate::commands::{
    history,
    tasks::{RunRequest, TaskRun},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

pub const REVISION: u32 = 2;

pub fn fingerprint(value: &Value) -> String {
    Sha256::digest(value.to_string().as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn repository(request: &RunRequest) -> Value {
    let root = Path::new(&request.project_path);
    let instructions = ["AGENTS.md", "CLAUDE.md"]
        .into_iter()
        .filter_map(|name| {
            let file = root.join(name);
            if !file.exists() {
                return None;
            }
            let value = dunce::canonicalize(root)
                .ok()
                .zip(dunce::canonicalize(&file).ok())
                .filter(|(root, path)| path.starts_with(root))
                .and_then(|(_, path)| history::read_bounded(&path, 24_000).ok())
                .and_then(|bytes| String::from_utf8(bytes).ok());
            Some(json!({"path":name,"text":value,"available":value.is_some()}))
        })
        .collect::<Vec<_>>();
    let head = crate::commands::task_strategy::source_head(request).ok();
    let diff = crate::commands::tasks::git(
        &request.project_path,
        &["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--stat"],
    )
    .ok();
    let map = crate::commands::codebase::map::task_map(root, &request.prompt, &[], 6000);
    json!({"sourceHead":head,"instructions":instructions,"map":map,
        "changeScope":diff.as_ref().map(|text| text.chars().take(4000).collect::<String>()),
        "changeScopeTruncated":diff.as_ref().is_some_and(|text| text.chars().count()>4000),
        "evidenceBoundary":"Root guidance and a bounded advisory map. Nested instructions and current files still require worker inspection."})
}

pub fn task(request: &RunRequest, run: &TaskRun) -> Value {
    task_with_repository(request, run, repository(request))
}

pub fn task_with_repository(request: &RunRequest, run: &TaskRun, repository: Value) -> Value {
    json!({"version":REVISION,"task":request.prompt,"effort":request.effort,
        "savedContext":request.context_receipt,"acceptance":run.contract,
        "repository":repository,"verificationCommand":request.verify_command,
        "constraints":{"isolated":request.isolated,"continuation":request.previous_run_id.is_some(),
            "explicitModel":request.model,"selectedConnections":request.connection_ids,
            "permissions":"Existing native permissions and user/repository restrictions remain authoritative. A decision grants no new permissions."},
        "assignment":request.coordination.as_ref().map(|context| &context.instructions)})
}

pub fn tool_evidence(request: &RunRequest, adapter: &str) -> Value {
    match crate::commands::mcp::project_delivery(
        &request.project_id,
        request.connection_ids.as_deref(),
        adapter,
    ) {
        Ok((direct, discovery)) => json!({"deliveryValidated":true,
            "directConnections":direct.keys().collect::<Vec<_>>(),
            "discoveredConnections":discovery.iter().map(|server| &server.id).collect::<Vec<_>>(),
            "toolSchemas":"Not probed during routing; connection delivery does not prove tool availability or authorization.",
            "repositoryEditing":true,"shell":true}),
        Err(_) => json!({"deliveryValidated":false}),
    }
}
