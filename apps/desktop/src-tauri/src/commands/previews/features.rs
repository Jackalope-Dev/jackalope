//! A project's feature map: the user-facing features worth a review screenshot.
//!
//! Each entry names a page, what "working" looks like there and the source
//! paths (globs) it depends on. When finished work changes a matching file,
//! review capture prefers that page and labels the screenshot with the entry.
//! Suggestions come from route files and router definitions in the repository,
//! with no model call; drift reports entries whose files no longer exist.
//! Nothing here edits the saved map: the person confirms every change.

use super::review::normalize;
use serde::{Deserialize, Deserializer, Serialize};
use std::{collections::HashSet, path::Path};

/// Most entries read from a saved map.
pub const FEATURE_LIMIT: usize = 40;
const SUGGESTION_LIMIT: usize = 12;
const SOURCE_LIMIT: usize = 12;
const TEXT_LIMIT: usize = 500;
const ROUTER_FILE_LIMIT: usize = 30;
const ROUTER_FILE_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Feature {
    pub name: String,
    /// The preview path screenshots open, such as `/settings?tab=billing`.
    pub page: String,
    /// How a person reaches the state worth checking. Screenshots only open
    /// `page`; this is guidance for reviewers.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub steps: String,
    /// What a working feature looks like on that page.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub working: String,
    /// Project-relative globs (`*`, `**`, `?`, `{a,b}`) of the files it depends on.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<String>,
    /// The route file a suggestion came from, checked for drift.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_file: Option<String>,
}

/// Reads a saved map, dropping entries a newer or damaged ledger wrote in a
/// shape this build cannot read instead of failing the whole project list.
pub fn lenient<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Feature>, D::Error> {
    Ok(match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Array(items) => items
            .into_iter()
            .filter_map(|item| serde_json::from_value(item).ok())
            .take(FEATURE_LIMIT)
            .collect(),
        _ => Vec::new(),
    })
}

/// What a review screenshot says about the feature on its page.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FeatureLabel {
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub working: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub steps: String,
}

fn bounded(text: &str) -> String {
    text.trim().chars().take(TEXT_LIMIT).collect()
}

fn clean_glob(glob: &str) -> Option<String> {
    let glob = glob.trim().replace('\\', "/");
    let glob = glob.trim_start_matches("./").trim_start_matches('/');
    (!glob.is_empty() && glob.len() <= 300 && !glob.split('/').any(|part| part == ".."))
        .then(|| glob.trim_end_matches('/').to_string())
}

/// Saved entries capture can use: named, with a page on the preview origin.
pub fn usable(features: &[Feature]) -> Vec<Feature> {
    features
        .iter()
        .take(FEATURE_LIMIT)
        .filter_map(|feature| {
            let name = bounded(&feature.name);
            let page = normalize(&feature.page)?;
            (!name.is_empty()).then(|| Feature {
                name,
                page,
                steps: bounded(&feature.steps),
                working: bounded(&feature.working),
                sources: feature
                    .sources
                    .iter()
                    .filter_map(|glob| clean_glob(glob))
                    .take(SOURCE_LIMIT)
                    .collect(),
                route_file: feature.route_file.as_deref().and_then(clean_glob),
            })
        })
        .collect()
}

fn segment_matches(pattern: &[u8], text: &[u8]) -> bool {
    let (mut p, mut t) = (0, 0);
    let (mut star, mut resume) = (None, 0);
    while t < text.len() {
        if p < pattern.len() && (pattern[p] == b'?' || pattern[p].eq_ignore_ascii_case(&text[t])) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            resume = t;
            p += 1;
        } else if let Some(position) = star {
            p = position + 1;
            resume += 1;
            t = resume;
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|byte| *byte == b'*')
}

fn segments_match(pattern: &[&str], path: &[&str]) -> bool {
    match pattern.split_first() {
        None => path.is_empty(),
        Some((&"**", rest)) => (0..=path.len()).any(|skip| segments_match(rest, &path[skip..])),
        Some((first, rest)) => path.split_first().is_some_and(|(head, tail)| {
            segment_matches(first.as_bytes(), head.as_bytes()) && segments_match(rest, tail)
        }),
    }
}

/// `{a,b}` alternatives, one level deep.
fn expand(pattern: &str) -> Vec<String> {
    let Some(open) = pattern.find('{') else {
        return vec![pattern.to_string()];
    };
    let Some(close) = pattern[open..].find('}').map(|offset| open + offset) else {
        return vec![pattern.to_string()];
    };
    pattern[open + 1..close]
        .split(',')
        .take(16)
        .flat_map(|choice| {
            expand(&format!(
                "{}{choice}{}",
                &pattern[..open],
                &pattern[close + 1..]
            ))
        })
        .take(64)
        .collect()
}

/// Whether a project-relative path matches a source glob. A glob without
/// wildcards also matches everything inside that folder. Case is ignored so
/// a map written on one platform works on another.
pub fn glob_matches(glob: &str, path: &str) -> bool {
    let Some(glob) = clean_glob(glob) else {
        return false;
    };
    let path = path.replace('\\', "/");
    if !glob.contains(['*', '?', '{']) {
        let (glob, path) = (glob.to_ascii_lowercase(), path.to_ascii_lowercase());
        return path == glob || path.starts_with(&format!("{glob}/"));
    }
    let parts: Vec<&str> = path.split('/').collect();
    expand(&glob).iter().any(|pattern| {
        let pattern: Vec<&str> = pattern.split('/').collect();
        segments_match(&pattern, &parts)
    })
}

fn depends_on(feature: &Feature, path: &str) -> bool {
    feature
        .sources
        .iter()
        .chain(feature.route_file.iter())
        .any(|glob| glob_matches(glob, path))
}

/// Pages of the entries whose sources include a changed file, in map order.
pub fn changed_pages(features: &[Feature], changed: &[String]) -> Vec<String> {
    let mut pages: Vec<String> = Vec::new();
    for feature in features {
        if !pages.contains(&feature.page) && changed.iter().any(|path| depends_on(feature, path)) {
            pages.push(feature.page.clone());
        }
    }
    pages
}

/// Every entry for a captured page, so its screenshot says what to check.
pub fn labels(features: &[Feature], page: &str) -> Vec<FeatureLabel> {
    features
        .iter()
        .filter(|feature| feature.page == page)
        .map(|feature| FeatureLabel {
            name: feature.name.clone(),
            working: feature.working.clone(),
            steps: feature.steps.clone(),
        })
        .collect()
}

/// An entry whose files are gone. `index` is its position in the list checked.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Drift {
    pub index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_route_file: Option<String>,
    pub unmatched_sources: Vec<String>,
}

/// Entries whose route file or source globs no longer match any file.
pub fn drift(features: &[Feature], files: &[String]) -> Vec<Drift> {
    let present = |glob: &str| files.iter().any(|file| glob_matches(glob, file));
    features
        .iter()
        .enumerate()
        .filter_map(|(index, feature)| {
            let missing_route_file = feature
                .route_file
                .as_deref()
                .filter(|file| !file.trim().is_empty() && !present(file))
                .map(str::to_string);
            let unmatched_sources: Vec<String> = feature
                .sources
                .iter()
                .filter(|glob| !glob.trim().is_empty() && !present(glob))
                .cloned()
                .collect();
            (missing_route_file.is_some() || !unmatched_sources.is_empty()).then_some(Drift {
                index,
                missing_route_file,
                unmatched_sources,
            })
        })
        .collect()
}

const FILE_ROUTERS: &[&str] = &[
    "next",
    "nuxt",
    "astro",
    "@sveltejs/kit",
    "@remix-run/react",
    "@remix-run/dev",
    "@react-router/dev",
    "@tanstack/react-router",
];
const ROUTER_LIBRARIES: &[&str] = &[
    "react-router",
    "react-router-dom",
    "vue-router",
    "@angular/router",
    "wouter",
    "@solidjs/router",
    "preact-router",
];

fn dependencies(manifest: &str) -> HashSet<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(manifest) else {
        return HashSet::new();
    };
    ["dependencies", "devDependencies", "peerDependencies"]
        .iter()
        .filter_map(|key| value.get(key)?.as_object())
        .flat_map(|map| map.keys().cloned())
        .collect()
}

fn split_extension<'a>(name: &'a str, extensions: &[&str]) -> Option<&'a str> {
    let (stem, extension) = name.rsplit_once('.')?;
    extensions.contains(&extension).then_some(stem)
}

fn title(page: &str) -> String {
    let words: Vec<String> = page
        .split('?')
        .next()
        .unwrap_or_default()
        .split('/')
        .filter(|part| !part.is_empty())
        .map(|part| part.replace(['-', '_'], " "))
        .collect();
    let text = if words.is_empty() {
        "Home".to_string()
    } else {
        words.join(" ")
    };
    let mut chars = text.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// A route from file-system segments, or `None` for dynamic, private or API routes.
fn route(segments: &[&str]) -> Option<String> {
    let mut parts = Vec::new();
    for segment in segments {
        if segment.is_empty() || (segment.starts_with('(') && segment.ends_with(')')) {
            continue;
        }
        if segment.starts_with(['[', '@', '_', '$', '+', '-', ':', '*']) {
            return None;
        }
        parts.push(*segment);
    }
    if parts.first() == Some(&"api") {
        return None;
    }
    normalize(&format!("/{}", parts.join("/")))
}

struct Candidate {
    page: String,
    route_file: String,
    sources: Vec<String>,
}

fn file_route(rel: &str, frameworks: &HashSet<&str>) -> Option<(String, bool)> {
    let segments: Vec<&str> = rel.split('/').collect();
    let (name, dirs) = segments.split_last()?;
    let has = |name: &str| frameworks.contains(name);
    // App-directory routers own a folder per page.
    if has("next") {
        let base = match dirs {
            ["app", rest @ ..] | ["src", "app", rest @ ..] => Some(rest),
            _ => None,
        };
        if let Some(rest) = base {
            if split_extension(name, &["tsx", "jsx", "ts", "js", "mdx"]) == Some("page") {
                return route(rest).map(|page| (page, !rest.is_empty()));
            }
            return None;
        }
    }
    if has("@sveltejs/kit") {
        if let ["src", "routes", rest @ ..] = dirs {
            return (*name == "+page.svelte")
                .then(|| route(rest).map(|page| (page, !rest.is_empty())))
                .flatten();
        }
    }
    if has("@remix-run/react") || has("@remix-run/dev") || has("@react-router/dev") {
        let extensions = ["tsx", "jsx", "ts", "js", "mdx"];
        let flat = match dirs {
            ["app", "routes"] => split_extension(name, &extensions).map(|stem| (stem, false)),
            ["app", "routes", folder] if split_extension(name, &extensions) == Some("route") => {
                Some((*folder, true))
            }
            _ => None,
        };
        if let Some((stem, folder)) = flat {
            let mut parts = Vec::new();
            for part in stem.split('.') {
                if part == "_index" || (part.starts_with('_') && part.len() > 1) {
                    continue;
                }
                parts.push(part.trim_end_matches('_'));
            }
            return route(&parts).map(|page| (page, folder));
        }
    }
    if has("@tanstack/react-router") {
        if let ["src", "routes", rest @ ..] = dirs {
            let stem = split_extension(name, &["tsx", "jsx", "ts", "js"])?;
            let stem = stem.strip_suffix(".lazy").unwrap_or(stem);
            if stem.starts_with("__") || stem.starts_with('-') {
                return None;
            }
            let mut parts: Vec<&str> = Vec::new();
            for part in rest.iter().copied().chain(stem.split('.')) {
                if part == "index" || part == "route" || (part.starts_with('_') && part.len() > 1) {
                    continue;
                }
                parts.push(part.trim_end_matches('_'));
            }
            return route(&parts).map(|page| (page, false));
        }
    }
    // Page-file routers map one file to one page.
    let pages = match dirs {
        ["pages", rest @ ..] | ["src", "pages", rest @ ..] => {
            if has("astro") && dirs.first() == Some(&"src") {
                Some((rest, &["astro", "md", "mdx", "html"][..]))
            } else if has("nuxt") {
                Some((rest, &["vue"][..]))
            } else if has("next") {
                Some((rest, &["tsx", "jsx", "ts", "js", "mdx", "md"][..]))
            } else {
                None
            }
        }
        ["app", "pages", rest @ ..] if has("nuxt") => Some((rest, &["vue"][..])),
        _ => None,
    };
    let (rest, extensions) = pages?;
    let stem = split_extension(name, extensions)?;
    let mut parts: Vec<&str> = rest.to_vec();
    if stem != "index" {
        parts.push(stem);
    }
    route(&parts).map(|page| (page, false))
}

/// Quoted `/route` values after `path`, plus `href`/`to` in navigation files.
fn declared_routes(text: &str, navigation: bool, angular: bool) -> Vec<String> {
    let mut keys = vec!["path"];
    if navigation {
        keys.extend(["href", "to"]);
    }
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    for key in keys {
        let mut from = 0;
        while let Some(offset) = text[from..].find(key) {
            let start = from + offset;
            from = start + key.len();
            if start > 0 && (bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'_') {
                continue;
            }
            let rest = text[from..].trim_start();
            let Some(rest) = rest.strip_prefix([':', '=']) else {
                continue;
            };
            let rest = rest.trim_start();
            let rest = rest.strip_prefix('{').unwrap_or(rest).trim_start();
            let Some(quote) = rest
                .chars()
                .next()
                .filter(|c| matches!(c, '"' | '\'' | '`'))
            else {
                continue;
            };
            let Some(value) = rest[1..].split(quote).next() else {
                continue;
            };
            if value.contains([':', '*', '$', '{']) || value.len() > 200 {
                continue;
            }
            let value = if !value.starts_with('/') && angular && !value.is_empty() {
                format!("/{value}")
            } else {
                value.to_string()
            };
            if value.starts_with('/') {
                if let Some(page) = normalize(&value) {
                    if !found.contains(&page) {
                        found.push(page);
                    }
                }
            }
        }
    }
    found
}

fn router_file(name: &str) -> Option<bool> {
    let lower = name.to_ascii_lowercase();
    split_extension(&lower, &["ts", "tsx", "js", "jsx", "mjs", "vue", "svelte"])?;
    let navigation = ["nav", "menu", "sidebar"]
        .iter()
        .any(|word| lower.contains(word));
    (navigation
        || lower.contains("route")
        || lower.starts_with("app.")
        || lower.starts_with("main."))
    .then_some(navigation)
}

/// Suggested entries from route files and router definitions. `files` are
/// project-relative paths and `read` returns a small file's text. Projects
/// without a recognized router get no suggestions.
pub fn suggest(files: &[String], read: impl Fn(&str) -> Option<String>) -> Vec<Feature> {
    let mut packages: Vec<(String, HashSet<String>)> = files
        .iter()
        .filter(|file| file.rsplit('/').next() == Some("package.json"))
        .filter(|file| !file.contains("node_modules/"))
        .filter_map(|file| {
            let directory = file.strip_suffix("package.json")?.to_string();
            Some((directory, dependencies(&read(file).unwrap_or_default())))
        })
        .collect();
    // The innermost package owns a file.
    packages.sort_by_key(|(directory, _)| std::cmp::Reverse(directory.len()));
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut router_files = 0;
    for file in files {
        let Some((directory, deps)) = packages
            .iter()
            .find(|(directory, _)| file.starts_with(directory.as_str()))
        else {
            continue;
        };
        if deps.is_empty() {
            continue;
        }
        let rel = &file[directory.len()..];
        let frameworks: HashSet<&str> = FILE_ROUTERS
            .iter()
            .copied()
            .filter(|name| deps.contains(*name))
            .collect();
        if let Some((page, folder)) = file_route(rel, &frameworks) {
            let source = match (folder, file.rsplit_once('/')) {
                (true, Some((parent, _))) => format!("{parent}/**"),
                _ => file.clone(),
            };
            candidates.push(Candidate {
                page,
                route_file: file.clone(),
                sources: vec![source],
            });
            continue;
        }
        if router_files >= ROUTER_FILE_LIMIT
            || !ROUTER_LIBRARIES.iter().any(|name| deps.contains(*name))
        {
            continue;
        }
        let Some(navigation) = router_file(rel.rsplit('/').next().unwrap_or(rel)) else {
            continue;
        };
        let Some(text) = read(file) else { continue };
        router_files += 1;
        for page in declared_routes(&text, navigation, deps.contains("@angular/router")) {
            candidates.push(Candidate {
                page,
                route_file: file.clone(),
                sources: vec![file.clone()],
            });
        }
    }
    let mut seen = HashSet::new();
    let mut features: Vec<Feature> = candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.page.clone()))
        .map(|candidate| Feature {
            name: title(&candidate.page),
            page: candidate.page,
            sources: candidate.sources,
            route_file: Some(candidate.route_file),
            ..Default::default()
        })
        .collect();
    features.sort_by(|a, b| {
        let depth = |page: &str| page.matches('/').count() - usize::from(page == "/");
        depth(&a.page)
            .cmp(&depth(&b.page))
            .then_with(|| a.page.cmp(&b.page))
    });
    features.truncate(SUGGESTION_LIMIT);
    features
}

/// Tracked and untracked, non-ignored files that still exist in the checkout.
fn project_files(project: &Path) -> Result<Vec<String>, String> {
    let mut files = super::super::project_files::list(project)?;
    let deleted = super::super::git_command::command(
        project,
        &["ls-files", "--deleted", "-z"],
        super::super::git_command::Policy::Inspection,
    )
    .output()
    .ok()
    .filter(|output| output.status.success())
    .map(|output| {
        output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
            .map(|entry| String::from_utf8_lossy(entry).into_owned())
            .collect::<HashSet<_>>()
    })
    .unwrap_or_default();
    files.retain(|file| !deleted.contains(file));
    Ok(files)
}

fn read_small(project: &Path, relative: &str) -> Option<String> {
    let path = project.join(relative);
    let metadata = std::fs::metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > ROUTER_FILE_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Suggested feature-map entries for a project, read locally without any model call.
#[tauri::command]
pub async fn project_feature_suggestions(project_path: String) -> Result<Vec<Feature>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project = Path::new(&project_path);
        let files = project_files(project)?;
        Ok(suggest(&files, |file| read_small(project, file)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Which of the given entries point at files that no longer exist.
#[tauri::command]
pub async fn project_feature_drift(
    project_path: String,
    features: Vec<Feature>,
) -> Result<Vec<Drift>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = project_files(Path::new(&project_path))?;
        Ok(drift(&features, &files))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
