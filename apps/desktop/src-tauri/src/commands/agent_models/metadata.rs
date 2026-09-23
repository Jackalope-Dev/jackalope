use super::*;
use crate::commands::decisions::options::ModelEvidence;
use std::{
    path::PathBuf,
    sync::{Mutex as SyncMutex, OnceLock},
};

type Cache = HashMap<(PathBuf, String), ModelEvidence>;
static CACHE: OnceLock<SyncMutex<Cache>> = OnceLock::new();

pub(super) fn remember(binding: &agent_profiles::AccountBinding, models: &[AgentModel]) {
    let mut cache = CACHE.get_or_init(Default::default).lock().unwrap();
    if cache.len() + models.len() > 4096 {
        cache.clear();
    }
    cache.retain(|(directory, _), _| directory != &binding.directory);
    for model in models {
        if let Some(metadata) = &model.metadata {
            cache.insert(
                (binding.directory.clone(), model.id.clone()),
                metadata.clone(),
            );
        }
    }
}

pub(in crate::commands) fn evidence(
    binding: &agent_profiles::AccountBinding,
    model: Option<&str>,
) -> Option<ModelEvidence> {
    CACHE
        .get()?
        .lock()
        .ok()?
        .get(&(binding.directory.clone(), model?.to_owned()))
        .cloned()
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .filter(|value| value.is_finite() && (0.0..=10000.0).contains(value))
}
fn tokens(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .filter(|value| (1..=10_000_000).contains(value))
}

pub(super) fn parse(text: &str) -> Vec<AgentModel> {
    let mut models = Vec::new();
    let mut remaining = text.trim();
    while !remaining.is_empty() && models.len() < 512 {
        let (id, rest) = remaining.split_once('\n').unwrap_or((remaining, ""));
        let id = id.trim();
        remaining = rest.trim_start();
        let mut value = Value::Null;
        if remaining.starts_with('{') {
            let mut reader = serde_json::Deserializer::from_str(remaining).into_iter::<Value>();
            if let Some(Ok(parsed)) = reader.next() {
                value = parsed;
                remaining = remaining[reader.byte_offset()..].trim_start();
            } else {
                break;
            }
        }
        if !valid_id(id)
            || !id.contains('/')
            || models.iter().any(|model: &AgentModel| model.id == id)
        {
            continue;
        }
        let mut model =
            parse_models(&json!([{"id":id,"name":value["name"].as_str().unwrap_or(id)}])).remove(0);
        if value.is_object() {
            let caps = &value["capabilities"];
            let facts = json!({"tools":caps["toolcall"].as_bool(),"reasoning":caps["reasoning"].as_bool(),
                "imageInput":caps["input"]["image"].as_bool(),"textInput":caps["input"]["text"].as_bool(),
                "upstreamFreshness":"unknown","accessAndQuality":"not established by discovery"});
            model.metadata = Some(ModelEvidence {
                adapter: "opencode".into(), model: id.into(),
                source: "OpenCode models --verbose (Models.dev and account configuration; upstream freshness unknown)".into(),
                checked_at: chrono::Utc::now().to_rfc3339(), capabilities: facts.to_string(),
                context_tokens: tokens(&value["limit"]["context"]), output_tokens: tokens(&value["limit"]["output"]),
                efforts: value["variants"].as_object().into_iter().flat_map(|variants| variants.keys())
                    .filter(|name| ["low","medium","high","xhigh","max"].contains(&name.as_str())).cloned().collect(),
                input_usd_per_million: number(&value["cost"]["input"]), output_usd_per_million: number(&value["cost"]["output"]),
                cache_read_usd_per_million: number(&value["cost"]["cache"]["read"]),
                cache_write_usd_per_million: number(&value["cost"]["cache"]["write"]),
            });
        }
        models.push(model);
    }
    models
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_only_bounded_facts_and_keeps_missing_capabilities_unknown() {
        let models = parse("deepseek/test\n{\"name\":\"Test\",\"headers\":{\"Authorization\":\"secret\"},\"limit\":{\"context\":1000,\"output\":0},\"cost\":{\"input\":-1,\"cache\":{\"read\":0}},\"capabilities\":{\"toolcall\":true}}\nother/plain\n");
        assert_eq!(models.len(), 2);
        let facts = models[0].metadata.as_ref().unwrap();
        assert_eq!(facts.context_tokens, Some(1000));
        assert_eq!(facts.output_tokens, None);
        assert_eq!(facts.input_usd_per_million, None);
        assert_eq!(facts.cache_read_usd_per_million, Some(0.0));
        assert!(facts.capabilities.contains("\"imageInput\":null"));
        assert!(!serde_json::to_string(facts).unwrap().contains("secret"));
        assert!(models[1].metadata.is_none());
        assert!(parse("bad\n{}").is_empty());
    }
}
