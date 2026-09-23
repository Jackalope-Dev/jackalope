use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Deserialize)]
struct Registry {
    #[cfg(test)]
    version: u32,
    fields: BTreeMap<String, Field>,
}
#[derive(Deserialize)]
struct Field {
    values: Vec<String>,
    default: String,
    environment: Option<String>,
}
fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        serde_json::from_str(include_str!("experiments.json")).expect("checked experiment registry")
    })
}
fn resolved(field: &Field) -> String {
    field
        .environment
        .as_ref()
        .and_then(|name| std::env::var(name).ok())
        .filter(|value| field.values.contains(value))
        .unwrap_or_else(|| field.default.clone())
}
pub(super) fn is(environment: &str, value: &str) -> bool {
    registry()
        .fields
        .values()
        .find(|field| field.environment.as_deref() == Some(environment))
        .is_some_and(|field| resolved(field) == value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_experiments_have_valid_defaults_and_unique_environment_names() {
        let mut names = std::collections::HashSet::new();
        assert_eq!(registry().version, 1);
        for field in registry().fields.values() {
            assert!(field.values.contains(&field.default));
            if let Some(name) = &field.environment {
                assert!(names.insert(name));
            }
        }
    }
}
