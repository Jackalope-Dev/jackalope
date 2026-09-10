use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn terms(text: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "how", "i",
        "in", "is", "it", "my", "of", "on", "or", "the", "this", "to", "was", "what", "when",
        "where", "with", "you", "your",
    ];
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.len() > 1 && !STOP.contains(s))
        .map(str::to_owned)
        .collect()
}

pub(super) fn rank(query: &str, documents: &[String]) -> Vec<(usize, f64)> {
    let query: BTreeSet<_> = terms(query).into_iter().take(64).collect();
    if query.is_empty() || documents.is_empty() {
        return vec![];
    }
    let counts: Vec<_> = documents
        .iter()
        .map(|doc| {
            let mut counts = BTreeMap::<String, usize>::new();
            for term in terms(doc) {
                *counts.entry(term).or_default() += 1;
            }
            counts
        })
        .collect();
    let lengths: Vec<usize> = counts.iter().map(|d| d.values().sum()).collect();
    let average = (lengths.iter().sum::<usize>() as f64 / documents.len() as f64).max(1.0);
    let mut scores = vec![0.0; documents.len()];
    for term in query {
        let frequency = counts.iter().filter(|doc| doc.contains_key(&term)).count() as f64;
        let idf = (1.0 + (documents.len() as f64 - frequency + 0.5) / (frequency + 0.5)).ln();
        for (index, counts) in counts.iter().enumerate() {
            let tf = *counts.get(&term).unwrap_or(&0) as f64;
            scores[index] +=
                idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * lengths[index] as f64 / average));
        }
    }
    let mut ranked: Vec<_> = scores
        .into_iter()
        .enumerate()
        .filter(|(_, s)| *s > 0.0)
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    ranked
}

pub(super) fn docs() -> Vec<Value> {
    serde_json::from_str(include_str!(
        "../../../../../packages/knowledge/catalog.json"
    ))
    .unwrap_or_default()
}

fn chunks() -> Vec<(String, Value)> {
    let mut chunks = Vec::new();
    for doc in docs() {
        let title = doc["title"].as_str().unwrap_or("");
        let mut heading = title.to_string();
        for paragraph in doc["markdown"].as_str().unwrap_or("").split("\n\n") {
            if paragraph.starts_with('#') {
                heading = paragraph.trim_start_matches('#').trim().into();
            }
            if paragraph.trim().is_empty() || paragraph.starts_with("https://") {
                continue;
            }
            // Only whole bounded passages are prefetched; the full document remains available.
            if paragraph.len() > 2400 {
                continue;
            }
            chunks.push((format!("{title} {heading} {paragraph}"), json!({"slug":doc["slug"],"title":doc["title"],"url":doc["url"],"heading":heading,"excerpt":paragraph})));
        }
    }
    chunks
}

pub(super) fn search(query: &str) -> Vec<Value> {
    let chunks = chunks();
    let documents = docs();
    let mut seen = BTreeSet::new();
    rank(
        query,
        &chunks
            .iter()
            .map(|(text, _)| text.clone())
            .collect::<Vec<_>>(),
    )
    .into_iter()
    .filter_map(|(index, _)| {
        let slug = chunks[index].1["slug"].as_str()?;
        if !seen.insert(slug.to_owned()) {
            return None;
        }
        documents.iter().find(|doc| doc["slug"] == slug).cloned()
    })
    .collect()
}

pub(super) fn passages(query: &str) -> Value {
    let chunks = chunks();
    let ranked = rank(
        query,
        &chunks
            .iter()
            .map(|(text, _)| text.clone())
            .collect::<Vec<_>>(),
    );
    let mut selected = Vec::new();
    let mut per_doc = BTreeMap::<String, usize>::new();
    let mut bytes = 0;
    for (index, _) in ranked {
        let value = &chunks[index].1;
        let count = per_doc
            .entry(value["slug"].as_str().unwrap_or("").to_string())
            .or_default();
        let size = value.to_string().len();
        if *count >= 2 || bytes + size > 6000 {
            continue;
        }
        *count += 1;
        bytes += size;
        selected.push(value.clone());
        if selected.len() == 4 {
            break;
        }
    }
    json!({"source":"Bundled official documentation for this app build","partial":true,"passages":selected})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retrieval_does_not_treat_substrings_or_empty_queries_as_evidence() {
        assert!(rank("the", &["the task".into()]).is_empty());
        assert!(rank("cat", &["concatenate".into()]).is_empty());
        assert_eq!(
            rank(
                "quota reset",
                &[
                    "Tasks and preferences".into(),
                    "Check the quota reset time".into()
                ]
            )[0]
            .0,
            1
        );
    }
    #[test]
    fn passages_are_bounded_verbatim_sources_with_no_model_call() {
        let found = passages("Ollama subscriptions worktrees themes model quota agents");
        assert!(found.to_string().len() < 6300);
        let docs = docs();
        for passage in found["passages"].as_array().unwrap() {
            let doc = docs.iter().find(|d| d["slug"] == passage["slug"]).unwrap();
            assert_eq!(doc["url"], passage["url"]);
            assert!(doc["markdown"]
                .as_str()
                .unwrap()
                .contains(passage["excerpt"].as_str().unwrap()));
        }
    }
}
