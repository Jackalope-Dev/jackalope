use super::*;
use crate::commands::tasks::TaskRun;
use agreements::{Action, AgreementInput};

fn change(
    ledger: &mut Ledger,
    runs: &[TaskRun],
    actor: &QueueItem,
    input: AgreementInput,
) -> Result<agreements::Agreement, String> {
    agreements::change(ledger, runs, actor, input, &[])
}

fn item(id: &str, paths: &[&str]) -> QueueItem {
    serde_json::from_value(serde_json::json!({"id":id,"projectId":"p","projectName":"Fixture","projectPath":"fixture","title":id,"prompt":id,"agent":"grok","scopes":paths,"dependencies":[],"createdAt":"now","runId":null,"error":null,"canceled":false})).unwrap()
}

fn request(action: Action, id: &str) -> AgreementInput {
    AgreementInput {
        action,
        id: id.into(),
        revision: 1,
        resource: "shared parser".into(),
        text: "Own parser behavior and avoid implementing a second parser.".into(),
        paths: vec![],
        participants: vec![],
    }
}

#[test]
fn durable_claims_reject_duplicates_and_require_both_owners_for_transfer() {
    let a = item("grok", &["a"]);
    let b = item("claude", &["b"]);
    let mut ledger = Ledger {
        items: vec![a.clone(), b.clone()],
        ..Default::default()
    };
    let id = Uuid::new_v4().to_string();
    let claim = request(Action::Claim, &id);
    change(&mut ledger, &[], &a, claim.clone()).unwrap();
    assert!(change(
        &mut ledger,
        &[],
        &b,
        request(Action::Claim, &Uuid::new_v4().to_string())
    )
    .unwrap_err()
    .contains("Already claimed"));
    assert_eq!(change(&mut ledger, &[], &a, claim).unwrap().revision, 1);
    let mut transfer = request(Action::Transfer, &id);
    transfer.participants = vec![b.id.clone()];
    assert!(change(&mut ledger, &[], &b, transfer.clone()).is_err());
    let pending = change(&mut ledger, &[], &a, transfer).unwrap();
    assert_eq!(pending.task_id, a.id);
    assert_eq!(pending.status, "pending");
    let mut restarted: Ledger =
        serde_json::from_slice(&serde_json::to_vec(&ledger).unwrap()).unwrap();
    let mut accept = request(Action::Accept, &id);
    assert!(change(&mut restarted, &[], &b, accept.clone())
        .unwrap_err()
        .contains("changed"));
    accept.revision = pending.revision;
    assert!(change(&mut restarted, &[], &a, accept.clone()).is_err());
    assert_eq!(
        change(&mut restarted, &[], &b, accept).unwrap().task_id,
        b.id
    );
    assert!(change(
        &mut restarted,
        &[],
        &a,
        request(Action::Claim, &Uuid::new_v4().to_string())
    )
    .is_err());
}

#[test]
fn interface_requires_every_invited_owner_and_blocks_descendants() {
    let a = item("api", &["api"]);
    let b = item("web", &["web"]);
    let c = item("tests", &["tests"]);
    let mut child = item("child", &["child"]);
    child.dependencies = vec![a.id.clone()];
    let mut ledger = Ledger {
        items: vec![a.clone(), b.clone(), c.clone(), child],
        ..Default::default()
    };
    let id = Uuid::new_v4().to_string();
    let mut proposal = request(Action::Propose, &id);
    proposal.participants = vec![b.id.clone(), c.id.clone()];
    change(&mut ledger, &[], &a, proposal).unwrap();
    assert!(agreements::interface_block(&ledger, "p", &a.id).is_some());
    assert!(agreements::interface_block(&ledger, "other", &a.id).is_none());
    let mut accept = request(Action::Accept, &id);
    let first = change(&mut ledger, &[], &b, accept.clone()).unwrap();
    assert_eq!(first.status, "pending");
    accept.revision = first.revision;
    let agreed = change(&mut ledger, &[], &c, accept).unwrap();
    assert_eq!(agreed.status, "agreed");
    assert!(agreements::interface_block(&ledger, "p", &a.id).is_none());
    let mut foreign = b.clone();
    foreign.project_id = "other".into();
    assert!(change(&mut ledger, &[], &foreign, request(Action::Reject, &id)).is_err());
    let legacy: Ledger = serde_json::from_str(r#"{"items":[],"messages":[]}"#).unwrap();
    assert!(legacy.agreements.is_empty() && legacy.scope_audits.is_empty());
}

#[test]
fn persisted_interface_gate_blocks_dispatch_and_integration_until_agreed() {
    let repo = Repo::new();
    let mut run = repo.run("api");
    run.status = "review".into();
    let history = repo.root.join("history");
    std::fs::create_dir(&history).unwrap();
    std::fs::write(
        history.join(format!("{}.json", run.id)),
        serde_json::to_vec(&run).unwrap(),
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(history).unwrap();
    let mut a = item("api", &["api"]);
    a.run_id = Some(run.id.clone());
    let b = item("web", &["web"]);
    let mut child = item("child", &["child"]);
    child.dependencies = vec![a.id.clone()];
    let service = Coordinator::new(repo.root.join("queue"), runtime.clone()).unwrap();
    let id = Uuid::new_v4().to_string();
    {
        let mut inner = service.inner.lock().unwrap();
        inner.ledger.items = vec![a.clone(), b.clone(), child];
        let mut proposal = request(Action::Propose, &id);
        proposal.participants = vec![b.id.clone()];
        change(&mut inner.ledger, &[run.clone()], &a, proposal).unwrap();
        service.save(&inner.ledger).unwrap();
        inner.enabled.insert("p".into());
        assert!(!ready_items(&inner, &[run.clone()], &[run.id.clone()])
            .iter()
            .any(|i| i.id == "child"));
    }
    assert!(service
        .guarded_integration(&[run.id.clone()], |_| Ok(()))
        .unwrap_err()
        .contains("Interface"));
    drop(service);
    let restored = Coordinator::new(repo.root.join("queue"), runtime.clone()).unwrap();
    assert!(restored.inner.lock().unwrap().enabled.is_empty());
    assert_eq!(restored.view().unwrap().agreements[0].status, "pending");
    {
        let mut inner = restored.inner.lock().unwrap();
        change(
            &mut inner.ledger,
            &[run.clone()],
            &b,
            request(Action::Accept, &id),
        )
        .unwrap();
        restored.save(&inner.ledger).unwrap();
        inner.enabled.insert("p".into());
        assert!(ready_items(&inner, &[run.clone()], &[run.id.clone()])
            .iter()
            .any(|i| i.id == "child"));
    }
    assert!(restored.guarded_integration(&[run.id], |_| Ok(())).is_ok());
}

pub(super) struct Repo {
    pub(super) root: PathBuf,
}
impl Repo {
    pub(super) fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jackalope-agreements-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let repo = Self { root };
        repo.git(&["init", "-b", "main"]);
        repo.git(&[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture baseline",
        ]);
        repo
    }
    pub(super) fn git(&self, args: &[&str]) -> String {
        let o = crate::commands::git_command::command(
            &self.root,
            args,
            crate::commands::git_command::Policy::Isolated,
        )
        .output()
        .unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
        String::from_utf8(o.stdout).unwrap().trim().into()
    }
    pub(super) fn run(&self, id: &str) -> TaskRun {
        let workspace = self.root.join(id);
        self.git(&[
            "worktree",
            "add",
            "--detach",
            workspace.to_str().unwrap(),
            "HEAD",
        ]);
        TaskRun {
            id: format!("{id}-run-000"),
            task_id: id.into(),
            project_id: "p".into(),
            project_path: self.root.to_string_lossy().into(),
            workspace: workspace.to_string_lossy().into(),
            base_head: self.git(&["rev-parse", "HEAD"]),
            status: "review".into(),
            started_at: "now".into(),
            ..Default::default()
        }
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn real_worktree_drift_and_overlap_block_until_current_snapshot_is_reconciled() {
    let repo = Repo::new();
    let a = repo.run("a");
    let b = repo.run("b");
    let mut ia = item("a", &["allowed"]);
    ia.run_id = Some(a.id.clone());
    let mut ib = item("b", &["other"]);
    ib.run_id = Some(b.id.clone());
    let mut ledger = Ledger {
        items: vec![ia, ib],
        ..Default::default()
    };
    std::fs::write(PathBuf::from(&a.workspace).join("extra"), "first").unwrap();
    let runs = vec![a.clone(), b.clone()];
    let checks = scope_audit::audit(&ledger, &runs, &[]);
    assert_eq!(checks[0].outside, ["extra"]);
    assert!(checks[0].blocked());
    ledger.scope_audits = checks;
    ledger.scope_audits[0].accepted_tree = ledger.scope_audits[0].tree.clone();
    assert!(!scope_audit::audit(&ledger, &runs, &[])[0].blocked());
    std::fs::write(
        PathBuf::from(&a.workspace).join("extra"),
        "changed after acceptance",
    )
    .unwrap();
    assert!(scope_audit::audit(&ledger, &runs, &[])[0].blocked());
    std::fs::write(PathBuf::from(&b.workspace).join("extra"), "duplicate work").unwrap();
    let checks = scope_audit::audit(&ledger, &runs, &[]);
    assert_eq!(checks[0].overlaps, ["extra"]);
    assert_eq!(checks[1].overlaps, ["extra"]);
    assert!(checks.iter().all(|c| c.blocked()));
    assert!(scope_audit::audit(&ledger, &runs, &[a.id, b.id]).is_empty());
}

#[test]
fn path_claims_cannot_steal_declared_scope_or_transfer_existing_changes() {
    let repo = Repo::new();
    let run = repo.run("a");
    let a = item("a", &["a"]);
    let b = item("b", &["b"]);
    let mut ledger = Ledger {
        items: vec![a.clone(), b.clone()],
        ..Default::default()
    };
    let id = Uuid::new_v4().to_string();
    let mut claim = request(Action::Claim, &id);
    claim.paths = vec!["b/file".into()];
    assert!(change(&mut ledger, &[], &a, claim.clone()).is_err());
    claim.paths = vec!["shared".into()];
    change(&mut ledger, &[], &a, claim).unwrap();
    std::fs::write(
        PathBuf::from(&run.workspace).join("shared"),
        "keep this work",
    )
    .unwrap();
    let mut transfer = request(Action::Transfer, &id);
    transfer.participants = vec![b.id];
    assert!(change(&mut ledger, &[run], &a, transfer)
        .unwrap_err()
        .contains("still has changes"));
}

#[tokio::test]
async fn concurrent_authenticated_claims_have_one_durable_winner_and_fail_closed_on_save_error() {
    let repo = Repo::new();
    let history = repo.root.join("history");
    std::fs::create_dir(&history).unwrap();
    for id in ["grok-run", "claude-run"] {
        let run = TaskRun {
            id: id.into(),
            task_id: id.into(),
            project_id: "p".into(),
            status: "review".into(),
            started_at: "now".into(),
            ..Default::default()
        };
        std::fs::write(
            history.join(format!("{id}.json")),
            serde_json::to_vec(&run).unwrap(),
        )
        .unwrap();
    }
    let runtime = TaskRuntime::with_test_access(history).unwrap();
    let service = Coordinator::new(repo.root.join("queue"), runtime.clone()).unwrap();
    for id in ["grok-run", "claude-run"] {
        runtime.update(id, |r| r.status = "running".into());
        service
            .inner
            .lock()
            .unwrap()
            .grants
            .insert(id.into(), (id.into(), id.into()));
    }
    let headers = |id: &str| {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {id}").parse().unwrap());
        h
    };
    let (a, b) = tokio::join!(
        agreements::bridge_agreement(
            WebState(service.clone()),
            headers("grok-run"),
            Json(request(Action::Claim, &Uuid::new_v4().to_string()))
        ),
        agreements::bridge_agreement(
            WebState(service.clone()),
            headers("claude-run"),
            Json(request(Action::Claim, &Uuid::new_v4().to_string()))
        )
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let ledger: Ledger =
        serde_json::from_slice(&std::fs::read(repo.root.join("queue/queue.json")).unwrap())
            .unwrap();
    assert_eq!(ledger.agreements.len(), 1);
    std::fs::remove_file(repo.root.join("queue/queue.json")).unwrap();
    std::fs::create_dir(repo.root.join("queue/queue.json")).unwrap();
    let mut input = request(Action::Claim, &Uuid::new_v4().to_string());
    input.resource = "other responsibility".into();
    assert!(agreements::bridge_agreement(
        WebState(service.clone()),
        headers("grok-run"),
        Json(input)
    )
    .await
    .is_err());
    assert_eq!(service.inner.lock().unwrap().ledger.agreements.len(), 1);
    runtime.update("grok-run", |r| r.status = "review".into());
    assert!(agreements::bridge_agreement(
        WebState(service.clone()),
        headers("grok-run"),
        Json(request(Action::Claim, &Uuid::new_v4().to_string()))
    )
    .await
    .is_err());
}
