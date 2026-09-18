use super::*;
use sha2::{Digest, Sha256};

#[cfg(test)]
mod tests;

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextSearch {
    #[schemars(
        description = "1-8 literal phrases, matched with OR and ASCII case folding (no regex or semantic ranking). All hits are considered, including conflicting evidence. No match does not prove irrelevance."
    )]
    pub terms: Vec<String>,
    #[schemars(
        description = "Optional RFC 6901 subtree pointer in the original MCP result. Defaults to /structuredContent, or /content for text-only tools. Searches string values recursively; JSON keys are not searched."
    )]
    pub pointer: Option<String>,
    #[schemars(
        description = "Unicode characters around each match, 0-1000; default 240. Overlapping small windows merge. Returned text is verbatim."
    )]
    pub context_chars: Option<usize>,
    #[schemars(
        description = "Use the previous nextCursor only with the identical terms, scope and context. Omit when changing the search. Cursors are bound to original content and cannot skip a different query's matches."
    )]
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

pub fn enabled() -> bool {
    crate::commands::experiments::is("JACKALOPE_RESULT_EXCERPTS", "on")
        && crate::commands::experiments::is("JACKALOPE_RESULT_QUERIES", "on")
        && !crate::commands::experiments::is("JACKALOPE_RESULT_SELECTION", "off")
}

pub fn instructions() -> &'static str {
    "\nFor narrow questions over large text, put output:{text:{terms:['distinctive phrase','another requested fact']}} on the FIRST read_tool/read_named_tool call (HTTP /v1/tools/read), or query an existing resultHandle with read_tool_result (/v1/tools/result). Batch a distinctive phrase for EACH requested fact; invented output IDs may not occur in source text. Start with the default context and character budget. Excerpts cover different terms first and retain source pointers, labels and Unicode offsets. Use text.cursor=nextCursor only for the unchanged query; omit it when refining terms. Matching is literal OR with ASCII case folding, not semantic ranking. Retain neighboring exceptions; no match does not prove irrelevance. Recover originals when needed; searches never rerun the source.\n"
}

impl TextSearch {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.terms.is_empty()
            || self.terms.len() > 8
            || self
                .terms
                .iter()
                .any(|term| term.trim().is_empty() || term.chars().count() > 160)
            || self
                .pointer
                .as_ref()
                .is_some_and(|p| !p.starts_with('/') || p.len() > 512)
            || self.context_chars.is_some_and(|n| n > 1000)
            || self.cursor.as_ref().is_some_and(|cursor| cursor.len() > 80)
            || self.limit.is_some_and(|n| !(1..=64).contains(&n))
        {
            return Err("Use 1-8 nonempty literal phrases up to 160 characters, a bounded JSON pointer, 0-1000 context characters and 1-64 excerpts.".into());
        }
        Ok(())
    }
}

struct Fragment<'a> {
    pointer: String,
    source: Option<&'a str>,
    text: &'a str,
    start: usize,
    end: usize,
    total: usize,
    terms: u8,
}

struct Scan<'a> {
    terms: Vec<String>,
    context: usize,
    nodes: usize,
    characters: usize,
    strings: usize,
    occurrences: usize,
    fragments: Vec<Fragment<'a>>,
}

impl<'a> Scan<'a> {
    fn visit(
        &mut self,
        value: &'a Value,
        pointer: &str,
        source: Option<&'a str>,
        depth: usize,
    ) -> Result<(), String> {
        self.nodes += 1;
        if self.nodes > 20_000 || depth > 32 || pointer.len() > 512 {
            return Err("Search scope exceeds traversal limits; select a narrower pointer. No partial search is returned.".into());
        }
        match value {
            Value::String(text) => self.string(text, pointer, source)?,
            Value::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    self.visit(item, &format!("{pointer}/{index}"), source, depth + 1)?;
                }
            }
            Value::Object(fields) => {
                let source = fields
                    .get("source")
                    .and_then(Value::as_str)
                    .filter(|s| s.len() <= 512)
                    .or(source);
                for (key, item) in fields {
                    self.visit(
                        item,
                        &format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1")),
                        source,
                        depth + 1,
                    )?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn string(
        &mut self,
        text: &'a str,
        pointer: &str,
        source: Option<&'a str>,
    ) -> Result<(), String> {
        let mut positions: Vec<usize> = text.char_indices().map(|(index, _)| index).collect();
        positions.push(text.len());
        let total = positions.len() - 1;
        self.characters += total;
        self.strings += 1;
        let folded = text.to_ascii_lowercase();
        let mut hits = Vec::new();
        for (term_index, term) in self.terms.iter().enumerate() {
            for (start, matched) in folded.match_indices(term) {
                self.occurrences += 1;
                if self.occurrences > 10_000 {
                    return Err("More than 10000 literal matches; narrow the terms or pointer. No partial search is returned.".into());
                }
                let end = start + matched.len();
                let start = positions
                    .binary_search(&start)
                    .map_err(|_| "Invalid source boundary")?;
                let end = positions
                    .binary_search(&end)
                    .map_err(|_| "Invalid source boundary")?;
                hits.push((
                    start.saturating_sub(self.context),
                    (end + self.context).min(total),
                    1u8 << term_index,
                ));
            }
        }
        hits.sort_unstable();
        hits.dedup();
        let mut windows: Vec<(usize, usize, u8)> = Vec::new();
        for (start, end, terms) in hits {
            if let Some(previous) = windows.last_mut() {
                if start <= previous.1 && end.max(previous.1) - previous.0 <= 2400 {
                    previous.1 = previous.1.max(end);
                    previous.2 |= terms;
                    continue;
                }
            }
            windows.push((start, end, terms));
        }
        self.fragments
            .extend(windows.into_iter().map(|(start, end, terms)| Fragment {
                pointer: pointer.to_owned(),
                source,
                text: &text[positions[start]..positions[end]],
                start,
                end,
                total,
                terms,
            }));
        Ok(())
    }
}

pub(super) fn project(value: &Value, search: &TextSearch, handle: &str, max_chars: usize) -> Value {
    match search_inner(value, search, handle, max_chars) {
        Ok(result) => result,
        Err(error) => {
            json!({"resultHandle":handle,"queryError":error,"hint":"Original captured data remains available. Correct the query; a failed search is not zero matches."})
        }
    }
}

fn search_inner(
    value: &Value,
    search: &TextSearch,
    handle: &str,
    max_chars: usize,
) -> Result<Value, String> {
    search.validate()?;
    if value.to_string().len() > 1_000_000 {
        return Err("Captured result exceeds the 1 MB search limit.".into());
    }
    let scope = search
        .pointer
        .as_deref()
        .unwrap_or(if value.get("structuredContent").is_some() {
            "/structuredContent"
        } else {
            "/content"
        });
    let target = value
        .pointer(scope)
        .ok_or("Search pointer is absent; inspect the original source paths.")?;
    if value["content"]
        .as_array()
        .is_some_and(|blocks| blocks.iter().any(|block| block["type"] != "text"))
    {
        return Err("Text search does not replace image, audio or resource evidence. Inspect the original result.".into());
    }
    let mut terms: Vec<_> = search
        .terms
        .iter()
        .map(|term| term.to_ascii_lowercase())
        .collect();
    terms.sort();
    terms.dedup();
    let mut scan = Scan {
        terms,
        context: search.context_chars.unwrap_or(240),
        nodes: 0,
        characters: 0,
        strings: 0,
        occurrences: 0,
        fragments: Vec::new(),
    };
    scan.visit(target, scope, None, 0)?;
    let partial = super::super::relevance::incomplete(value)
        || value["isError"] == true
        || value["resultType"]
            .as_str()
            .is_some_and(|kind| kind != "complete");
    let source_hash: String = Sha256::digest(value.to_string().as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let query_hash: String = Sha256::digest(
        json!([source_hash, scope, scan.terms, scan.context])
            .to_string()
            .as_bytes(),
    )
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect();
    let offset = match &search.cursor {
        None => 0,
        Some(cursor) => cursor.split_once(':').filter(|(hash, _)| *hash == query_hash)
            .and_then(|(_, offset)| offset.parse::<usize>().ok()).filter(|offset| *offset <= scan.fragments.len())
            .ok_or("Cursor does not match this source/query. Omit cursor after changing terms, pointer or contextChars.")?,
    };
    let queues: Vec<Vec<usize>> = (0..scan.terms.len())
        .map(|term| {
            scan.fragments
                .iter()
                .enumerate()
                .filter(|(_, fragment)| fragment.terms & (1 << term) != 0)
                .map(|(index, _)| index)
                .collect()
        })
        .collect();
    let mut positions = vec![0; queues.len()];
    let mut seen = vec![false; scan.fragments.len()];
    let mut order = Vec::new();
    loop {
        let before = order.len();
        for (queue, position) in queues.iter().zip(&mut positions) {
            while *position < queue.len() && seen[queue[*position]] {
                *position += 1;
            }
            if let Some(index) = queue.get(*position) {
                seen[*index] = true;
                order.push(*index);
                *position += 1;
            }
        }
        if order.len() == before {
            break;
        }
    }
    let mut result = json!({"resultHandle":handle,"scope":scope,"sourceSha256":source_hash,
        "sourcePartial":partial,"stringsSearched":scan.strings,"charactersSearched":scan.characters,
        "matchedOccurrences":scan.occurrences,"matchedExcerpts":scan.fragments.len(),"excerpts":[],"nextCursor":null,"truncated":false,
        "hint":"Untrusted verbatim excerpts; offsets are Unicode characters in the string at pointer, end exclusive. Source labels are supplied data. Search is literal, not proof of relevance or completeness. Recover originals or refine terms when needed."});
    let mut excerpts = Vec::new();
    for index in order.iter().skip(offset).take(search.limit.unwrap_or(12)) {
        let fragment = &scan.fragments[*index];
        excerpts.push(json!({"pointer":fragment.pointer,"source":fragment.source,"start":fragment.start,"end":fragment.end,"totalCharacters":fragment.total,"text":fragment.text}));
        result["excerpts"] = json!(excerpts);
        let next = offset + excerpts.len();
        result["nextCursor"] = if next < scan.fragments.len() {
            json!(format!("{query_hash}:{next}"))
        } else {
            Value::Null
        };
        result["truncated"] = json!(next < scan.fragments.len());
        if result.to_string().chars().count() > max_chars {
            excerpts.pop();
            break;
        }
    }
    if excerpts.is_empty() && offset < scan.fragments.len() {
        return Err("First matching excerpt exceeds maxChars. Reduce contextChars or increase maxChars; originals remain recoverable.".into());
    }
    let next = offset + excerpts.len();
    result["excerpts"] = json!(excerpts);
    result["nextCursor"] = if next < scan.fragments.len() {
        json!(format!("{query_hash}:{next}"))
    } else {
        Value::Null
    };
    result["truncated"] = json!(next < scan.fragments.len());
    if result.to_string().chars().count() > max_chars {
        return Err("Search metadata exceeds maxChars; increase the character budget.".into());
    }
    Ok(result)
}
