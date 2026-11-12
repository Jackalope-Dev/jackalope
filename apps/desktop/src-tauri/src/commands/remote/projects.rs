//! What a companion sees about each shared project besides its name: a hint that tells
//! projects with the same name apart, and the icon the person chose for it on this host.

use super::super::tasks::RunRequest;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// A data URL image is at most the 64 KB the desktop accepts for a fetched site icon, which
/// base64 grows by a third, plus its `data:image/...;base64,` prefix.
const IMAGE_LIMIT: usize = 64 * 1024 * 4 / 3 + 64;

/// The icon a project shows in the host's sidebar, synced from the desktop's project list.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIcon {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

/// Keeps only a short icon key and an image that is a bounded `data:image/` URL, so the
/// companion renders it with `<img>` alone and a saved record stays small.
pub(super) fn valid_icon(icon: ProjectIcon) -> Option<ProjectIcon> {
    let key = icon.icon.filter(|key| {
        !key.is_empty()
            && key.len() <= 32
            && key
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    });
    let image = icon.image.filter(|image| {
        image.len() <= IMAGE_LIMIT
            && image.starts_with("data:image/")
            && image.contains(";base64,")
            && !image.contains(['"', '<', '>', '\n'])
    });
    (key.is_some() || image.is_some()).then_some(ProjectIcon { icon: key, image })
}

fn segments(path: &str) -> Vec<&str> {
    path.split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .collect()
}

/// For shared projects whose names clash, the shortest run of trailing parent folders that
/// tells each apart (as the desktop sidebar does). A companion never gets a full path: when
/// parent folders cannot separate two projects, every parent folder below the home folder is
/// used, and the same folder shared twice gets no hint.
pub(super) fn hints(projects: &[RunRequest]) -> HashMap<String, String> {
    let home =
        crate::commands::platform::home_dir().map(|home| home.to_string_lossy().into_owned());
    let mut groups: HashMap<String, Vec<&RunRequest>> = HashMap::new();
    for project in projects {
        groups
            .entry(project.project_name.trim().to_lowercase())
            .or_default()
            .push(project);
    }
    let mut hints = HashMap::new();
    for group in groups.values().filter(|group| group.len() > 1) {
        let paths: Vec<Vec<&str>> = group
            .iter()
            .map(|project| {
                let path = project.project_path.as_str();
                let below_home = home
                    .as_deref()
                    .and_then(|home| path.strip_prefix(home))
                    .unwrap_or(path);
                segments(below_home)
            })
            .collect();
        for (index, project) in group.iter().enumerate() {
            let own = &paths[index];
            let others: Vec<&Vec<&str>> = paths
                .iter()
                .enumerate()
                .filter(|(at, other)| *at != index && *other != own)
                .map(|(_, other)| other)
                .collect();
            if others.is_empty() {
                continue;
            }
            let parents = &own[..own.len().saturating_sub(1)];
            let tail = |parts: &[&str], length: usize| {
                let parents = &parts[..parts.len().saturating_sub(1)];
                parents[parents.len().saturating_sub(length)..].join("/")
            };
            let hint = (1..=parents.len())
                .map(|length| (length, tail(own, length)))
                .find(|(length, hint)| others.iter().all(|other| &tail(other, *length) != hint))
                .map(|(_, hint)| hint)
                .unwrap_or_else(|| parents.join("/"));
            if !hint.is_empty() {
                hints.insert(project.project_id.clone(), hint);
            }
        }
    }
    hints
}

/// A short fingerprint of an icon image, so a companion fetches it once and again only when
/// it changes.
fn version(image: &str) -> String {
    Sha256::digest(image.as_bytes())
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The snapshot's project entries. Hosts before these fields sent only `id` and `name`.
pub(super) fn entries(projects: &[RunRequest], icons: &HashMap<String, ProjectIcon>) -> Vec<Value> {
    let hints = hints(projects);
    projects
        .iter()
        .map(|project| {
            let mut entry = json!({"id":project.project_id,"name":project.project_name});
            if let Some(hint) = hints.get(&project.project_id) {
                entry["hint"] = json!(hint);
            }
            if let Some(icon) = icons.get(&project.project_id) {
                if let Some(key) = &icon.icon {
                    entry["icon"] = json!(key);
                }
                if let Some(image) = &icon.image {
                    entry["iconVersion"] = json!(version(image));
                }
            }
            entry
        })
        .collect()
}

/// Icon images for the shared projects that have one, keyed by project id.
pub(super) fn images(projects: &[RunRequest], icons: &HashMap<String, ProjectIcon>) -> Value {
    let images: serde_json::Map<String, Value> = projects
        .iter()
        .filter_map(|project| {
            let image = icons.get(&project.project_id)?.image.as_ref()?;
            Some((project.project_id.clone(), json!(image)))
        })
        .collect();
    json!({ "icons": images })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: &str, name: &str, path: &str) -> RunRequest {
        serde_json::from_value(json!({"id":id,"projectId":id,"projectName":name,"projectPath":path,"agent":"codex","prompt":"","isolated":true})).unwrap()
    }

    #[test]
    fn clashing_names_get_the_shortest_parent_hint_and_never_a_home_path() {
        let home = crate::commands::platform::home_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let projects = [
            project("a", "pocket-shop", &format!("{home}/trials/a/pocket-shop")),
            project("b", "Pocket-Shop", &format!("{home}/trials/b/pocket-shop")),
            project("c", "site", "/srv/site"),
            project("d", "same", &format!("{home}/x/same")),
            project("e", "same", &format!("{home}/x/same")),
        ];
        let hints = hints(&projects);
        assert_eq!(hints.get("a").map(String::as_str), Some("a"));
        assert_eq!(hints.get("b").map(String::as_str), Some("b"));
        assert!(!hints.contains_key("c"), "unique names get no hint");
        assert!(!hints.contains_key("d") && !hints.contains_key("e"));
        assert!(hints.values().all(|hint| !hint.contains(&home)));
    }

    #[test]
    fn deeper_clashes_take_more_folders() {
        let projects = [
            project("a", "app", "/w/one/x/app"),
            project("b", "app", "/w/two/x/app"),
        ];
        let hints = hints(&projects);
        assert_eq!(hints.get("a").map(String::as_str), Some("one/x"));
        assert_eq!(hints.get("b").map(String::as_str), Some("two/x"));
    }

    #[test]
    fn icons_keep_only_short_keys_and_bounded_data_images() {
        let ok = valid_icon(ProjectIcon {
            icon: Some("rocket".into()),
            image: Some("data:image/png;base64,AAAA".into()),
        })
        .unwrap();
        assert_eq!(ok.icon.as_deref(), Some("rocket"));
        assert!(ok.image.is_some());
        let script = valid_icon(ProjectIcon {
            icon: Some("Rocket!".into()),
            image: Some("javascript:alert(1)".into()),
        });
        assert!(script.is_none());
        let huge = valid_icon(ProjectIcon {
            icon: None,
            image: Some(format!("data:image/png;base64,{}", "A".repeat(IMAGE_LIMIT))),
        });
        assert!(huge.is_none());
    }

    #[test]
    fn entries_carry_hints_keys_and_image_versions_and_images_stay_separate() {
        let projects = [
            project("a", "shop", "/w/one/shop"),
            project("b", "shop", "/w/two/shop"),
        ];
        let icons = HashMap::from([(
            "a".to_string(),
            ProjectIcon {
                icon: Some("website".into()),
                image: Some("data:image/png;base64,AAAA".into()),
            },
        )]);
        let entries = entries(&projects, &icons);
        assert_eq!(entries[0]["hint"], "one");
        assert_eq!(entries[0]["icon"], "website");
        assert_eq!(entries[0]["iconVersion"].as_str().unwrap().len(), 12);
        assert!(
            entries[0].get("image").is_none(),
            "images stay out of the polled snapshot"
        );
        assert!(entries[1].get("icon").is_none());
        assert_eq!(
            images(&projects, &icons)["icons"]["a"],
            "data:image/png;base64,AAAA"
        );
    }
}
