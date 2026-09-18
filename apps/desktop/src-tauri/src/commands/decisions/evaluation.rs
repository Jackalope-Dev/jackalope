use super::{
    context, settings, DecisionAttempt, DecisionKind, DecisionMode, DecisionProvider,
    DecisionReceipt, TaskRuntime,
};
use crate::commands::{history, jev, tasks::Usage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use tauri::State;

static CACHE: LazyLock<Mutex<HashMap<String, (Instant, Record)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub project_id: String,
    pub run_id: Option<String>,
    pub created_at: String,
    pub decision: DecisionReceipt,
    pub requested_model: String,
    pub model: Option<String>,
    pub rubric_revision: u32,
    pub input_hash: String,
    pub answers: Value,
    pub accounted_elsewhere: bool,
    #[serde(default)]
    pub elapsed_ms: Option<u64>,
    #[serde(default)]
    pub evidence: Value,
}

pub struct Evaluation {
    pub record: Record,
    pub cached: bool,
}

impl Evaluation {
    pub fn usage(&self) -> Usage {
        if self.cached {
            Usage {
                reported: true,
                estimated_cost_usd: Some(0.0),
                ..Default::default()
            }
        } else {
            self.record.decision.usage.clone()
        }
    }
    pub fn evidence(&self) -> Value {
        json!({"recordId":self.record.id,"requestedModel":self.record.requested_model,"model":self.record.model,
            "rubricRevision":self.record.rubric_revision,"inputHash":self.record.input_hash,"cached":self.cached,
            "answers":self.record.answers,"context":self.record.evidence})
    }
    pub fn value(&self) -> Value {
        json!({"answers":self.record.answers,"model":self.record.model})
    }
}

pub fn validate(payload: &Value, response: &Value) -> Result<Value, String> {
    let questions = payload["questions"]
        .as_object()
        .ok_or("Missing decision questions.")?;
    let answers = response["answers"]
        .as_object()
        .ok_or("Missing decision answers.")?;
    if questions.is_empty() || questions.len() > 256 || answers.len() != questions.len() {
        return Err("Decision answers do not match the requested questions.".into());
    }
    let mut checked = serde_json::Map::new();
    for (id, question) in questions {
        let answer = answers.get(id).ok_or("Missing decision answer.")?;
        let value = match question["type"].as_str() {
            Some("noul") => json!({"type":"noul","noul":jev::validate_noul(answer)?}),
            Some("score") => {
                jev::validate_score(
                    answer,
                    question["criteria"]
                        .as_array()
                        .ok_or("Missing score levels.")?
                        .len(),
                )?;
                json!({"type":"score","score":answer["score"],"confidence":answer["confidence"],"probabilities":answer["probabilities"]})
            }
            Some("choice") => {
                let options = question["criteria"]
                    .as_object()
                    .ok_or("Missing choices.")?
                    .keys()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                jev::validate_choice(answer, &options)?;
                json!({"type":"choice","choice":answer["choice"],"confidence":answer["confidence"],"probabilities":answer["probabilities"]})
            }
            _ => return Err("Unsupported decision question.".into()),
        };
        checked.insert(id.clone(), value);
    }
    Ok(Value::Object(checked))
}

pub async fn evaluate(
    runtime: &TaskRuntime,
    project: &str,
    run: Option<&str>,
    kind: DecisionKind,
    revision: u32,
    payload: &Value,
    accounted_elsewhere: bool,
    canceled: impl Fn() -> bool,
) -> Result<Option<Evaluation>, String> {
    if canceled() {
        return Ok(None);
    }
    let policy = super::policy(runtime, project)?;
    if policy.mode != DecisionMode::Jev {
        return Ok(None);
    }
    runtime.access.ensure()?;
    jev::check_request_size(payload)?;
    let decision_options = super::options::options(runtime, project)?;
    if matches!(
        kind,
        DecisionKind::AgentQuestions | DecisionKind::TaskPreparation
    ) && !decision_options.agent_questions
    {
        return Ok(None);
    }
    let key = jev::key_for_routing(runtime, project)?.ok_or("Jev is disconnected.")?;
    let hash = context::fingerprint(
        &json!({"payload":payload,"policy":policy,"revision":revision,"kind":kind,
        "options":decision_options,"project":project,"accountedElsewhere":accounted_elsewhere}),
    );
    let cache_key = format!("{}:{hash}", settings::directory(runtime).display());
    if let Some(record) = CACHE
        .lock()
        .map_err(|_| "Decision cache unavailable.")?
        .get(&cache_key)
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(600))
        .map(|(_, record)| record.clone())
    {
        return Ok((!canceled()).then_some(Evaluation {
            record,
            cached: true,
        }));
    }
    let _slot = SLOTS
        .try_acquire()
        .map_err(|_| "Jev decision capacity is busy; local behavior applies.")?;
    let mut record = Record {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project.into(),
        run_id: run.map(str::to_owned),
        created_at: chrono::Utc::now().to_rfc3339(),
        requested_model: jev::MODEL.into(),
        model: None,
        rubric_revision: revision,
        input_hash: hash,
        answers: json!({}),
        accounted_elsewhere,
        elapsed_ms: None,
        evidence: json!({"candidates":payload["state"]["workers"].as_array().map(|workers|workers.iter().map(|w|json!({"id":w["id"],"agent":w["agent"],"adapter":w["adapter"],"model":w["model"]})).collect::<Vec<_>>()),
            "sourceHead":payload["state"]["taskContext"]["repository"]["sourceHead"],"objective":decision_options.objective,"assistance":payload["state"]["assistance"]}),
        decision: DecisionReceipt {
            evidence: None,
            version: 1,
            kind,
            requested_mode: policy.mode,
            provider: DecisionProvider::LocalRules,
            policy_revision: policy.revision,
            model_call_attempted: true,
            attempts: vec![],
            concentration: None,
            fallback_reason: Some("Decision interrupted before a usable report was saved.".into()),
            usage: Usage::default(),
        },
    };
    let directory = settings::directory(runtime).join("decisions");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let file = directory.join(format!("{}.json", record.id));
    history::write_atomic(
        &file,
        &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
    )?;
    let started = Instant::now();
    if canceled() {
        record.decision.model_call_attempted = false;
        record.decision.usage = Usage {
            reported: true,
            estimated_cost_usd: Some(0.0),
            ..Default::default()
        };
    } else {
        match jev::evaluate(&key, payload, &canceled).await {
            Ok(value) => {
                record.decision.usage = jev::usage(&value);
                let model = value["model"].as_str().filter(|s| {
                    s.starts_with("jev") && s.len() <= 120 && !s.chars().any(char::is_control)
                });
                record.model = model.map(str::to_owned);
                match model
                    .ok_or("Jev returned an invalid model identifier.".to_string())
                    .and_then(|_| validate(payload, &value))
                {
                    Ok(answers) if !canceled() => {
                        record.answers = answers;
                        record.decision.provider = DecisionProvider::Jev;
                        record.decision.fallback_reason = None;
                    }
                    Ok(_) => {
                        record.decision.fallback_reason =
                            Some("Decision canceled; no advice applied.".into())
                    }
                    Err(error) => record.decision.fallback_reason = Some(error),
                }
            }
            Err(error) => record.decision.fallback_reason = Some(error),
        }
        record.decision.attempts.push(DecisionAttempt {
            provider: DecisionProvider::Jev,
            usage: record.decision.usage.clone(),
        });
    }
    record.elapsed_ms = Some(started.elapsed().as_millis().try_into().unwrap_or(u64::MAX));
    let still_authorized = super::policy(runtime, project).is_ok_and(|current| {
        current.mode == DecisionMode::Jev && current.revision == policy.revision
    }) && super::options::options(runtime, project).is_ok_and(|current| {
        serde_json::to_value(current).ok() == serde_json::to_value(&decision_options).ok()
    });
    if !still_authorized || canceled() {
        record.decision.provider = DecisionProvider::LocalRules;
        record.decision.fallback_reason =
            Some("Decision canceled or settings changed; no advice applied.".into());
    }
    if let Err(error) = history::write_atomic(
        &file,
        &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
    ) {
        record.decision.fallback_reason = Some(format!(
            "Decision receipt could not be finalized: {error}. Advice was not applied."
        ));
    }
    if record.decision.fallback_reason.is_none() && !canceled() {
        let mut cache = CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(600));
        if cache.len() >= 128 {
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest);
            }
        }
        cache.insert(cache_key, (Instant::now(), record.clone()));
    }
    Ok(Some(Evaluation {
        record,
        cached: false,
    }))
}

#[tauri::command]
pub async fn decision_history(runtime: State<'_, TaskRuntime>) -> Result<Vec<Record>, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || records(&runtime))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn records(runtime: &TaskRuntime) -> Result<Vec<Record>, String> {
    let directory = settings::directory(runtime).join("decisions");
    if !directory.exists() {
        return Ok(vec![]);
    }
    let mut records = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_none_or(|s| s != "json")
            || path
                .file_stem()
                .and_then(|s| s.to_str())
                .is_none_or(|s| uuid::Uuid::parse_str(s).is_err())
        {
            continue;
        }
        let record =
            serde_json::from_slice(&history::read_bounded(&path, 512_000)?).map_err(|_| {
                "Decision history is unreadable; original records are preserved.".to_string()
            })?;
        records.push(record);
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_every_answer_and_drops_unrequested_text() {
        let payload = json!({"questions":{"a":{"type":"noul"}}});
        assert_eq!(
            validate(
                &payload,
                &json!({"answers":{"a":{"type":"noul","noul":0.8,"explanation":"untrusted"}}})
            )
            .unwrap(),
            json!({"a":{"type":"noul","noul":0.8}})
        );
        assert!(validate(&payload, &json!({"answers":{}})).is_err());
        assert!(validate(&payload, &json!({"answers":{"a":{"type":"noul","noul":2}}})).is_err());
    }
}
