use ignore::WalkBuilder;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::ops::ControlFlow;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tree_sitter::{Node, ParseOptions, Parser, Tree};

const MAX_FILES: usize = 6_000;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_REFERENCES: usize = 30_000;
static SCANNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseFile {
    path: String,
    language: String,
    bytes: u64,
    lines: Option<usize>,
    analyzed: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseReference {
    source: String,
    target: Option<String>,
    specifier: String,
    line: usize,
    kind: String,
    status: String,
}

#[derive(Debug, Serialize)]
pub struct CodebaseDiagnostic {
    path: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseSnapshot {
    root: String,
    scanned_at: String,
    duration_ms: u128,
    files: Vec<CodebaseFile>,
    references: Vec<CodebaseReference>,
    cycles: Vec<Vec<String>>,
    diagnostics: Vec<CodebaseDiagnostic>,
    truncated: bool,
}

#[tauri::command]
pub async fn codebase_scan(repo_path: String) -> Result<CodebaseSnapshot, String> {
    if SCANNING.swap(true, Ordering::AcqRel) {
        return Err("A codebase scan is already running. Try again when it finishes.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                SCANNING.store(false, Ordering::Release);
            }
        }
        let _reset = Reset;
        scan(Path::new(&repo_path))
    })
    .await
    .map_err(|e| format!("Codebase scan failed: {e}"))?
}

fn language(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "ts" | "tsx" | "mts" | "cts" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "rs" => "Rust",
        "py" => "Python",
        "go" => "Go",
        "java" | "kt" => "JVM",
        "cs" => "C#",
        "c" | "h" | "cpp" | "hpp" => "C/C++",
        "php" => "PHP",
        "css" | "scss" => "Styles",
        "md" | "txt" | "mdx" => "Documentation",
        "json" | "toml" | "yaml" | "yml" => "Configuration",
        _ => "Other",
    }
}

fn normalized(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for part in path.components() {
        match part {
            Component::Normal(p) => parts.push(p.to_str()?),
            Component::ParentDir => {
                parts.pop()?;
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

fn read_bounded(path: &Path) -> Result<String, String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("File exceeds the 512 KiB analysis limit.".into());
    }
    String::from_utf8(bytes).map_err(|_| "File is not UTF-8 text.".into())
}

fn literal(node: Node<'_>, text: &str) -> Option<String> {
    if node.kind() != "string" {
        return None;
    }
    let raw = node.utf8_text(text.as_bytes()).ok()?;
    let inner = raw.get(1..raw.len().checked_sub(1)?)?;
    if inner.contains('\\') {
        return None;
    }
    Some(inner.to_string())
}

fn parse_bounded(parser: &mut Parser, text: &str, timeout: Duration) -> Option<Tree> {
    parser.reset();
    let started = Instant::now();
    let mut progress = |_: &tree_sitter::ParseState| {
        if started.elapsed() >= timeout {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    };
    parser.parse_with_options(
        &mut |offset, _| &text.as_bytes()[offset..],
        None,
        Some(ParseOptions::new().progress_callback(&mut progress)),
    )
}

fn extract(
    parser: &mut Parser,
    path: &str,
    text: &str,
    rust: bool,
) -> (Vec<CodebaseReference>, bool) {
    let Some(tree) = parse_bounded(parser, text, Duration::from_millis(100)) else {
        return (vec![], true);
    };
    let mut refs = Vec::new();
    let mut cursor = tree.walk();
    loop {
        let node = cursor.node();
        let mut found = None;
        if !rust && matches!(node.kind(), "import_statement" | "export_statement") {
            if let Some(source) = node.child_by_field_name("source") {
                found = Some((literal(source, text), "import"));
            }
        } else if !rust && node.kind() == "call_expression" {
            if let Some(function) = node.child_by_field_name("function") {
                let name = function.utf8_text(text.as_bytes()).unwrap_or("");
                if name == "import" || name == "require" {
                    let argument = node
                        .child_by_field_name("arguments")
                        .and_then(|args| args.named_child(0));
                    found = Some((
                        argument.and_then(|arg| literal(arg, text)),
                        if name == "import" {
                            "dynamic import"
                        } else {
                            "require"
                        },
                    ));
                }
            }
        } else if !rust && node.kind() == "import_require_clause" {
            let mut children = node.walk();
            found = Some((
                node.named_children(&mut children)
                    .find_map(|n| literal(n, text)),
                "require",
            ));
        } else if rust && node.kind() == "use_declaration" {
            if let Some(argument) = node.child_by_field_name("argument") {
                let mut parent = node.parent();
                let mut inline = false;
                while let Some(p) = parent {
                    inline |= p.kind() == "mod_item";
                    parent = p.parent();
                }
                let mut uses = Vec::new();
                rust_uses(argument, text, "", &mut uses);
                for specifier in uses {
                    refs.push(CodebaseReference {
                        source: path.into(),
                        target: None,
                        specifier,
                        line: node.start_position().row + 1,
                        kind: "use module".into(),
                        status: if inline { "unsupported" } else { "pending" }.into(),
                    });
                }
            }
        } else if rust && node.kind() == "mod_item" && node.child_by_field_name("body").is_none() {
            let name = node
                .child_by_field_name("name")
                .and_then(|n| n.utf8_text(text.as_bytes()).ok())
                .map(str::to_string);
            let mut parent = node.parent();
            let mut nested = false;
            while let Some(p) = parent {
                if p.kind() == "mod_item" {
                    nested = true;
                    break;
                }
                parent = p.parent();
            }
            let mut sibling = node.prev_named_sibling();
            let mut custom_path = false;
            while let Some(attribute) = sibling {
                if !matches!(
                    attribute.kind(),
                    "attribute_item" | "line_comment" | "block_comment"
                ) {
                    break;
                }
                custom_path |= attribute.kind() == "attribute_item"
                    && attribute
                        .utf8_text(text.as_bytes())
                        .unwrap_or("")
                        .contains("path");
                sibling = attribute.prev_named_sibling();
            }
            found = Some((if nested || custom_path { None } else { name }, "module"));
        }
        if let Some((specifier, kind)) = found {
            refs.push(CodebaseReference {
                source: path.into(),
                target: None,
                specifier: specifier.clone().unwrap_or_else(|| {
                    node.utf8_text(text.as_bytes())
                        .unwrap_or("Computed or custom reference")
                        .chars()
                        .take(160)
                        .collect()
                }),
                line: node.start_position().row + 1,
                kind: kind.into(),
                status: if specifier.is_some() {
                    "pending"
                } else {
                    "unsupported"
                }
                .into(),
            });
            if refs.len() >= MAX_REFERENCES {
                break;
            }
        }
        if cursor.goto_first_child() {
            continue;
        }
        loop {
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                return (refs, tree.root_node().has_error());
            }
        }
    }
    (refs, tree.root_node().has_error())
}

fn rust_uses(node: Node<'_>, text: &str, prefix: &str, output: &mut Vec<String>) {
    if output.len() >= 500 {
        return;
    }
    match node.kind() {
        "scoped_use_list" => {
            let path = node
                .child_by_field_name("path")
                .and_then(|n| n.utf8_text(text.as_bytes()).ok())
                .unwrap_or("");
            if let Some(list) = node.child_by_field_name("list") {
                rust_uses(list, text, &format!("{prefix}{path}::"), output);
            }
        }
        "use_list" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                rust_uses(child, text, prefix, output);
            }
        }
        "use_as_clause" => {
            if let Some(path) = node.child_by_field_name("path") {
                rust_uses(path, text, prefix, output);
            }
        }
        "identifier" | "scoped_identifier" | "crate" | "self" | "super" | "use_wildcard" => {
            if let Ok(path) = node.utf8_text(text.as_bytes()) {
                output.push(format!("{prefix}{path}"));
            }
        }
        _ => {}
    }
}

fn resolve_rust_use(reference: &mut CodebaseReference, paths: &BTreeSet<String>) {
    let source = Path::new(&reference.source);
    let parent = source.parent().unwrap_or(Path::new(""));
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let mut tokens: Vec<_> = reference.specifier.split("::").collect();
    let mut base = if tokens.first() == Some(&"crate") {
        tokens.remove(0);
        let root = parent.ancestors().find(|p| {
            ["lib.rs", "main.rs"]
                .iter()
                .any(|name| normalized(&p.join(name)).is_some_and(|path| paths.contains(&path)))
        });
        let Some(root) = root else {
            reference.status = "unresolved".into();
            return;
        };
        root.to_path_buf()
    } else {
        if !matches!(tokens.first(), Some(&"self" | &"super")) {
            reference.status = "package or alias".into();
            return;
        }
        let mut base = if ["lib", "main", "mod"].contains(&stem) {
            parent.to_path_buf()
        } else {
            parent.join(stem)
        };
        if tokens.first() == Some(&"self") {
            tokens.remove(0);
        }
        while tokens.first() == Some(&"super") {
            tokens.remove(0);
            if !base.pop() {
                reference.status = "outside root".into();
                return;
            }
        }
        base
    };
    let mut target = None;
    for token in tokens {
        if token == "self" || token == "*" {
            break;
        }
        if !token.chars().all(|c| c.is_alphanumeric() || c == '_') {
            break;
        }
        base.push(token);
        for candidate in [base.with_extension("rs"), base.join("mod.rs")] {
            if let Some(path) = normalized(&candidate).filter(|p| paths.contains(p)) {
                target = Some(path);
            }
        }
    }
    reference.target = target;
    reference.status = if reference.target.is_some() {
        "resolved"
    } else {
        "unresolved"
    }
    .into();
}

fn resolve(reference: &mut CodebaseReference, paths: &BTreeSet<String>) {
    if reference.status != "pending" {
        return;
    }
    let parent = Path::new(&reference.source)
        .parent()
        .unwrap_or(Path::new(""));
    let mut candidates = Vec::new();
    if reference.kind == "use module" {
        resolve_rust_use(reference, paths);
        return;
    }
    if reference.kind == "module" {
        let file = Path::new(&reference.source);
        let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let base = if matches!(stem, "lib" | "main" | "mod") {
            parent.to_path_buf()
        } else {
            parent.join(stem)
        };
        candidates.push(base.join(format!("{}.rs", reference.specifier)));
        candidates.push(base.join(&reference.specifier).join("mod.rs"));
    } else if reference.specifier.starts_with('.') {
        let specifier = reference.specifier.split(['?', '#']).next().unwrap_or("");
        let Some(base) = normalized(&parent.join(specifier)) else {
            reference.status = "outside root".into();
            return;
        };
        let extension = Path::new(&base)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if matches!(extension, "js" | "jsx" | "mjs" | "cjs") {
            let equivalents: &[&str] = match extension {
                "mjs" => &["mts"],
                "cjs" => &["cts"],
                _ => &["ts", "tsx"],
            };
            for ext in equivalents {
                candidates.push(Path::new(&base).with_extension(ext));
            }
        }
        candidates.push(PathBuf::from(&base));
        if extension.is_empty() {
            for ext in ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json"] {
                candidates.push(PathBuf::from(format!("{base}.{ext}")));
            }
            for ext in ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json"] {
                candidates.push(PathBuf::from(format!("{base}/index.{ext}")));
            }
        }
    } else {
        reference.status = "package or alias".into();
        return;
    }
    reference.target = candidates
        .iter()
        .filter_map(|p| normalized(p))
        .find(|p| paths.contains(p));
    reference.status = if reference.target.is_some() {
        "resolved"
    } else {
        "unresolved"
    }
    .into();
}

pub fn scan(root: &Path) -> Result<CodebaseSnapshot, String> {
    let started = Instant::now();
    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot open repository: {e}"))?;
    if !root.is_dir() {
        return Err("Choose a repository directory.".into());
    }
    let mut result = CodebaseSnapshot {
        root: root.to_string_lossy().into_owned(),
        scanned_at: chrono::Utc::now().to_rfc3339(),
        duration_ms: 0,
        files: vec![],
        references: vec![],
        cycles: vec![],
        diagnostics: vec![],
        truncated: false,
    };
    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_global(false)
        .parents(false)
        .sort_by_file_path(|a, b| a.cmp(b))
        .filter_entry(|e| {
            e.depth() == 0
                || !matches!(
                    e.file_name().to_str().unwrap_or(""),
                    ".git"
                        | ".worktrees"
                        | "node_modules"
                        | "target"
                        | "vendor"
                        | "dist"
                        | "build"
                        | "coverage"
                        | "output"
                        | ".next"
                        | ".venv"
                        | "__pycache__"
                )
        })
        .build();
    for entry in walker {
        if started.elapsed() > Duration::from_secs(20) || result.files.len() >= MAX_FILES {
            result.truncated = true;
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                if result.diagnostics.len() < 200 {
                    result.diagnostics.push(CodebaseDiagnostic {
                        path: ".".into(),
                        message: format!("Could not inspect entry: {e}"),
                    });
                }
                continue;
            }
        };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(&root)
            .ok()
            .and_then(normalized)
            .ok_or("Unsupported repository path")?;
        match entry.metadata() {
            Ok(meta) => result.files.push(CodebaseFile {
                language: language(entry.path()).into(),
                path,
                bytes: meta.len(),
                lines: None,
                analyzed: false,
            }),
            Err(e) => result.diagnostics.push(CodebaseDiagnostic {
                path,
                message: format!("Cannot read metadata: {e}"),
            }),
        }
    }
    result.files.sort_by(|a, b| a.path.cmp(&b.path));
    let paths = result
        .files
        .iter()
        .map(|f| f.path.clone())
        .collect::<BTreeSet<_>>();
    let mut parsers = BTreeMap::new();
    for (key, lang) in [
        ("ts", tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        ("tsx", tree_sitter_typescript::LANGUAGE_TSX.into()),
        ("js", tree_sitter_javascript::LANGUAGE.into()),
        ("rs", tree_sitter_rust::LANGUAGE.into()),
    ] {
        let mut parser = Parser::new();
        parser.set_language(&lang).map_err(|e| e.to_string())?;
        parsers.insert(key, parser);
    }
    let resolver_limited = std::sync::Arc::new(AtomicBool::new(false));
    let resolver_options = oxc_resolver::ResolveOptions {
        cwd: Some(root.clone()),
        tsconfig: Some(oxc_resolver::TsconfigDiscovery::Auto),
        extensions: [
            ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json",
        ]
        .map(str::to_string)
        .to_vec(),
        condition_names: vec!["import".into(), "default".into()],
        main_fields: vec!["module".into(), "main".into()],
        ..Default::default()
    };
    let js_resolver = oxc_resolver::ResolverGeneric::new_with_file_system(
        super::resolver_fs::ResolverFs::for_root(root.clone(), resolver_limited.clone()),
        resolver_options.clone(),
    );
    let require_resolver = js_resolver.clone_with_options(oxc_resolver::ResolveOptions {
        condition_names: vec!["require".into(), "default".into()],
        main_fields: vec!["main".into()],
        ..resolver_options
    });
    let mut total_bytes = 0;
    for file in &mut result.files {
        let key = match file.language.as_str() {
            "TypeScript" if file.path.ends_with(".tsx") => "tsx",
            "TypeScript" => "ts",
            "JavaScript" => "js",
            "Rust" => "rs",
            _ => continue,
        };
        if started.elapsed() > Duration::from_secs(20)
            || total_bytes + file.bytes > MAX_TOTAL_BYTES
            || result.references.len() >= MAX_REFERENCES
        {
            result.truncated = true;
            break;
        }
        let full = root.join(&file.path);
        let text = (|| {
            let canonical = full.canonicalize().map_err(|e| e.to_string())?;
            if !canonical.starts_with(&root) {
                return Err("File points outside the repository.".into());
            }
            read_bounded(&canonical)
        })();
        match text {
            Ok(text) => {
                total_bytes += text.len() as u64;
                file.lines = Some(text.lines().count());
                let parser = parsers.get_mut(key).unwrap();
                let (mut refs, errors) = extract(parser, &file.path, &text, key == "rs");
                file.analyzed = true;
                if errors {
                    result.diagnostics.push(CodebaseDiagnostic {
                        path: file.path.clone(),
                        message:
                            "Syntax could not be fully parsed; relationships may be incomplete."
                                .into(),
                    });
                }
                if refs.len() + result.references.len() >= MAX_REFERENCES {
                    result.truncated = true;
                    refs.truncate(MAX_REFERENCES - result.references.len());
                }
                for reference in &mut refs {
                    resolve(reference, &paths);
                    if key != "rs" && reference.status == "package or alias" {
                        let resolver = if reference.kind == "require" {
                            &require_resolver
                        } else {
                            &js_resolver
                        };
                        let resolution_result =
                            resolver.resolve_file(dunce::simplified(&full), &reference.specifier);
                        if let Ok(resolution) = resolution_result {
                            if let Ok(canonical) = resolution.path().canonicalize() {
                                if let Ok(relative) = canonical.strip_prefix(&root) {
                                    if let Some(path) =
                                        normalized(relative).filter(|p| paths.contains(p))
                                    {
                                        reference.target = Some(path);
                                        reference.status = "resolved".into();
                                    }
                                }
                            }
                        }
                    }
                }
                result.references.extend(refs);
            }
            Err(message) => result.diagnostics.push(CodebaseDiagnostic {
                path: file.path.clone(),
                message,
            }),
        }
    }
    result.truncated |= resolver_limited.load(Ordering::Relaxed);
    let declared: BTreeSet<_> = result
        .references
        .iter()
        .filter(|r| r.kind == "module")
        .filter_map(|r| r.target.clone())
        .collect();
    for reference in &mut result.references {
        if reference.kind == "use module"
            && reference
                .target
                .as_ref()
                .is_some_and(|target| !declared.contains(target))
        {
            reference.target = None;
            reference.status = "unresolved".into();
        }
    }
    result.references.sort();
    result.references.dedup();
    result.cycles = dependency_cycles(&result.references);
    result.duration_ms = started.elapsed().as_millis();
    Ok(result)
}

fn dependency_cycles(references: &[CodebaseReference]) -> Vec<Vec<String>> {
    let mut graph = petgraph::graphmap::DiGraphMap::<&str, ()>::new();
    for reference in references {
        if reference.kind != "module" {
            if let Some(target) = &reference.target {
                graph.add_edge(&reference.source, target, ());
            }
        }
    }
    let mut cycles = petgraph::algo::kosaraju_scc(&graph)
        .into_iter()
        .filter(|group| group.len() > 1 || graph.contains_edge(group[0], group[0]))
        .map(|group| {
            let mut paths = group.into_iter().map(str::to_string).collect::<Vec<_>>();
            paths.sort();
            paths
        })
        .collect::<Vec<_>>();
    cycles.sort();
    cycles
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_timeout_does_not_contaminate_the_next_file() {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
            .unwrap();
        let text = "export const value = 1;\n".repeat(10_000);
        assert!(parse_bounded(&mut parser, &text, Duration::ZERO).is_none());
        let (references, errors) = extract(&mut parser, "next.ts", "import './valid';", false);
        assert!(!errors);
        assert_eq!(references.len(), 1);
        assert_eq!(references[0].specifier, "./valid");
    }

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("jackalope-map-{}", uuid::Uuid::new_v4())))
        }
        fn write(&self, name: &str, text: &str) {
            let path = self.0.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn parses_real_imports_and_preserves_unsupported_references() {
        let f = Fixture::new();
        f.write("src/a.tsx", "// import x from './fake'\nconst label = \"require('./fake')\";\nimport type { B } from './b.js';\nexport { B } from './b';\nconst c = import('./c');\nconst d = require('./data.json');\nimport React from 'react';\nimport x from '@/alias';\nimport('./' + name);\nimport './missing';\nimport '../../outside';\nconst view = <div/>;");
        f.write("src/b.ts", "export type B = string;");
        f.write("src/c/index.ts", "export {};");
        f.write("src/data.json", "{}");
        let snapshot = scan(&f.0).unwrap();
        assert!(
            snapshot.diagnostics.is_empty(),
            "{:?}",
            snapshot.diagnostics
        );
        assert_eq!(snapshot.references.len(), 9);
        assert_eq!(
            snapshot
                .references
                .iter()
                .filter(|r| r.status == "resolved")
                .count(),
            4
        );
        assert!(snapshot
            .references
            .iter()
            .any(|r| r.target.as_deref() == Some("src/b.ts") && r.line == 3));
        assert!(snapshot
            .references
            .iter()
            .any(|r| r.status == "unsupported"));
        assert!(snapshot
            .references
            .iter()
            .any(|r| r.status == "outside root"));
        assert!(snapshot.references.iter().any(|r| r.status == "unresolved"));
        assert_eq!(
            snapshot
                .references
                .iter()
                .filter(|r| r.status == "package or alias")
                .count(),
            2
        );
    }

    #[test]
    fn source_files_win_over_directory_indexes_and_js_extensions_map_to_typescript() {
        let f = Fixture::new();
        f.write("a.ts", "import './component'; import './module.mjs';");
        f.write("component.tsx", "export {};");
        f.write("component/index.ts", "export {};");
        f.write("module.mts", "export {};");
        let result = scan(&f.0).unwrap();
        assert_eq!(
            result
                .references
                .iter()
                .map(|r| r.target.as_deref().unwrap())
                .collect::<Vec<_>>(),
            vec!["component.tsx", "module.mts"]
        );
    }

    #[test]
    fn respects_ignores_limits_and_reports_partial_parsing() {
        let f = Fixture::new();
        f.write(".gitignore", "ignored/\n");
        f.write("ignored/secret.ts", "export {}");
        f.write("node_modules/pkg/a.ts", "export {}");
        f.write(".worktrees/task/a.ts", "export {}");
        f.write("target/a.rs", "");
        f.write("visible.ts", "import x from './missing'; const = ;");
        f.write("large.ts", &" ".repeat(MAX_FILE_BYTES as usize + 1));
        f.write("notes.md", "# Context");
        let snapshot = scan(&f.0).unwrap();
        assert_eq!(snapshot.files.len(), 4);
        assert_eq!(snapshot.diagnostics.len(), 2);
        assert!(
            !snapshot
                .files
                .iter()
                .find(|x| x.path == "large.ts")
                .unwrap()
                .analyzed
        );
        assert!(snapshot.references.iter().any(|r| r.status == "unresolved"));
    }

    #[test]
    fn rust_modules_resolve_without_inventing_use_edges() {
        let f = Fixture::new();
        f.write("src/lib.rs", "mod commands; use commands::run; #[path = \"alternate.rs\"] mod custom; mod nested { mod child; }");
        f.write("src/commands.rs", "mod child; pub fn run() {}");
        f.write("src/commands/child.rs", "");
        let snapshot = scan(&f.0).unwrap();
        assert_eq!(
            snapshot
                .references
                .iter()
                .filter(|r| r.status == "resolved")
                .count(),
            2,
            "{:?}",
            snapshot.references
        );
        assert_eq!(
            snapshot
                .references
                .iter()
                .filter(|r| r.status == "unsupported")
                .count(),
            2
        );
    }

    #[test]
    fn aliases_and_rust_grouped_uses_resolve_to_local_declared_modules() {
        let f = Fixture::new();
        f.write(
            "tsconfig.json",
            r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
        );
        f.write("src/app.ts", "import {x} from '@/shared';");
        f.write("src/shared.ts", "export const x=1;");
        f.write(
            "rust/src/lib.rs",
            "mod one; mod two; use crate::{one::A, two::B};",
        );
        f.write("rust/src/one.rs", "pub struct A; use super::two::B;");
        f.write("rust/src/two.rs", "pub struct B;");
        let snapshot = scan(&f.0).unwrap();
        assert!(
            snapshot
                .references
                .iter()
                .any(|r| r.specifier == "@/shared" && r.target.as_deref() == Some("src/shared.ts")),
            "{:?}",
            snapshot.references
        );
        assert_eq!(
            snapshot
                .references
                .iter()
                .filter(|r| r.kind == "use module" && r.status == "resolved")
                .count(),
            3,
            "{:?}",
            snapshot.references
        );
    }

    #[test]
    fn package_exports_follow_import_and_require_conditions() {
        let f = Fixture::new();
        f.write(
            "package.json",
            r#"{"name":"fixture","exports":{".":{"import":"./esm.ts","require":"./cjs.ts"}}}"#,
        );
        f.write(
            "entry.ts",
            "import x from 'fixture'; const y = require('fixture');",
        );
        f.write("esm.ts", "export default 1;");
        f.write("cjs.ts", "module.exports = 1;");
        let snapshot = scan(&f.0).unwrap();
        assert!(
            snapshot
                .references
                .iter()
                .any(|r| r.kind == "import" && r.target.as_deref() == Some("esm.ts")),
            "{:?}",
            snapshot.references
        );
        assert!(
            snapshot
                .references
                .iter()
                .any(|r| r.kind == "require" && r.target.as_deref() == Some("cjs.ts")),
            "{:?}",
            snapshot.references
        );
    }

    #[test]
    fn scan_is_stable_and_does_not_execute_project_code() {
        let f = Fixture::new();
        f.write("package.json", r#"{"scripts":{"prepare":"exit 1"}}"#);
        f.write("a.js", "import './b';");
        f.write("b.js", "import './a';");
        let a = scan(&f.0).unwrap();
        let b = scan(&f.0).unwrap();
        assert_eq!(
            serde_json::to_value(a.files).unwrap(),
            serde_json::to_value(b.files).unwrap()
        );
        assert_eq!(a.references, b.references);
        assert_eq!(a.cycles, vec![vec!["a.js".to_string(), "b.js".to_string()]]);
        assert!(scan(&f.0.join("missing")).is_err());
        assert!(normalized(Path::new("../outside")).is_none());
    }

    #[test]
    fn long_dependency_chains_and_self_imports_are_checked_without_recursion() {
        let mut refs = (0..MAX_FILES)
            .map(|i| CodebaseReference {
                source: format!("{i}.ts"),
                target: Some(format!("{}.ts", i + 1)),
                specifier: String::new(),
                line: 1,
                kind: "import".into(),
                status: "resolved".into(),
            })
            .collect::<Vec<_>>();
        assert!(dependency_cycles(&refs).is_empty());
        refs.last_mut().unwrap().target = Some("0.ts".into());
        assert_eq!(dependency_cycles(&refs)[0].len(), MAX_FILES);
        refs.truncate(1);
        refs[0].target = Some("0.ts".into());
        assert_eq!(dependency_cycles(&refs), vec![vec!["0.ts".to_string()]]);
    }

    #[test]
    #[ignore = "Manual real-repository scan; set JACKALOPE_SCAN_ROOT and JACKALOPE_SCAN_OUTPUT"]
    fn export_repository_scan() {
        let root = std::env::var("JACKALOPE_SCAN_ROOT").unwrap();
        let output = std::env::var("JACKALOPE_SCAN_OUTPUT").unwrap();
        let snapshot = scan(Path::new(&root)).unwrap();
        println!(
            "{} files, {} references, {} diagnostics in {}ms",
            snapshot.files.len(),
            snapshot.references.len(),
            snapshot.diagnostics.len(),
            snapshot.duration_ms
        );
        std::fs::write(output, serde_json::to_vec_pretty(&snapshot).unwrap()).unwrap();
    }
}
