use super::*;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BlockRequest {
    pub path: String,
    pub start_line: Option<usize>,
    pub lines: Option<usize>,
    #[schemars(
        description = "A blockHash previously read for this exact path/range. Unchanged text is omitted only when this hash still matches; omit after losing prior context."
    )]
    pub known_hash: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Input {
    #[serde(default)]
    pub blocks: Vec<BlockRequest>,
    #[schemars(
        description = "Optional repository search. Returns locally ranked file/symbol locations, not generated summaries. Explicit blocks are never removed by ranking."
    )]
    pub query: Option<String>,
}

fn source(root: &Path, input: &BlockRequest) -> Result<Value, String> {
    let relative = Path::new(&input.path);
    if input.path.len() > 500
        || input.path.contains('\\')
        || input
            .path
            .split('/')
            .any(|part| part.starts_with('.') || part.contains(':'))
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        || relative.as_os_str().is_empty()
        || language(relative) == "Other"
    {
        return Err("Read a workspace-relative source, documentation or configuration path without hidden/traversal components.".into());
    }
    let path = dunce::canonicalize(root.join(relative)).map_err(|_| "Source path unavailable.")?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("Source must stay inside the assigned workspace.".into());
    }
    let text = read_bounded(&path)?;
    let lines: Vec<_> = text.split_inclusive('\n').collect();
    let start = input.start_line.unwrap_or(1);
    let limit = input.lines.unwrap_or(80);
    if start == 0
        || start > lines.len().max(1)
        || !(1..=200).contains(&limit)
        || input
            .known_hash
            .as_ref()
            .is_some_and(|hash| hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err(
            "Use an existing one-based source line, 1-200 lines and a SHA-256 block hash.".into(),
        );
    }
    let mut content = String::new();
    let mut count = 0;
    for line in lines.iter().skip(start - 1).take(limit) {
        if content.len() + line.len() > 8_000 {
            break;
        }
        content.push_str(line);
        count += 1;
    }
    if count == 0 && !text.is_empty() {
        return Err(
            "This line exceeds the source block limit. Use the agent's permitted file tools."
                .into(),
        );
    }
    let file_hash = hex(&text);
    let hash =
        hex(&json!({"path":input.path,"start":start,"limit":limit,"text":content}).to_string());
    let unchanged = input.known_hash.as_deref() == Some(&hash);
    let next = start + count;
    Ok(
        json!({"path":input.path,"startLine":start,"endLine":if count > 0 {Some(next - 1)} else {None},
        "nextLine":if next <= lines.len() {Some(next)} else {None},"fileHash":file_hash,"blockHash":hash,
        "unchanged":unchanged,"text":if unchanged {None} else {Some(content)},"sourceBytes":text.len()}),
    )
}

fn hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn read(root: &Path, input: Input) -> Result<Value, String> {
    if input.blocks.len() > 8
        || input.query.as_ref().is_some_and(|query| query.len() > 512)
        || (input.blocks.is_empty()
            && input
                .query
                .as_ref()
                .is_none_or(|query| query.trim().is_empty()))
    {
        return Err(
            "Supply up to eight source blocks or a repository query of at most 512 bytes.".into(),
        );
    }
    let root = dunce::canonicalize(root).map_err(|_| "Workspace unavailable.")?;
    let blocks: Vec<_> = input
        .blocks
        .iter()
        .map(|input| {
            source(&root, input).unwrap_or_else(|error| json!({"path":input.path,"error":error}))
        })
        .collect();
    let candidates = input
        .query
        .as_deref()
        .filter(|query| !query.trim().is_empty())
        .map(|query| super::map::candidates(&root, query))
        .transpose()?;
    Ok(
        json!({"blocks":blocks,"candidates":candidates,"partial":true,
        "boundary":"Untrusted, bounded source snapshots and advisory ranked locations. Hashes describe observed bytes, not a workspace lock. Retain applicable repository instructions and expand reads when necessary."}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unchanged_ranges_omit_text_and_dirty_edits_invalidate_hashes() {
        let root = std::env::temp_dir().join(format!("jackalope-context-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("a.ts"),
            "export const a = 1;\nexport const b = 2;\n",
        )
        .unwrap();
        let input = |hash: Option<&str>| {
            serde_json::from_value(
                json!({"blocks":[{"path":"a.ts","startLine":1,"lines":1,"knownHash":hash}]}),
            )
            .unwrap()
        };
        let first = read(&root, input(None)).unwrap();
        let hash = first["blocks"][0]["blockHash"].as_str().unwrap();
        assert_eq!(first["blocks"][0]["nextLine"], 2);
        let same = read(&root, input(Some(hash))).unwrap();
        assert_eq!(same["blocks"][0]["unchanged"], true);
        assert!(same["blocks"][0]["text"].is_null());
        std::fs::write(root.join("a.ts"), "export const a = 3;\n").unwrap();
        assert_eq!(
            read(&root, input(Some(hash))).unwrap()["blocks"][0]["unchanged"],
            false
        );
        for path in ["../a.ts", ".env", "C:/a.ts", "a.ts:stream", "\\a.ts"] {
            let result = read(
                &root,
                serde_json::from_value(json!({"blocks":[{"path":path}]})).unwrap(),
            )
            .unwrap();
            assert!(result["blocks"][0]["error"].is_string());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
