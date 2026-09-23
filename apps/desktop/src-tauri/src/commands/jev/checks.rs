use super::*;
use crate::commands::{history, tasks::Usage};

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionUsage {
    pub calls: u64,
    pub unreported_calls: u64,
    pub usage: Usage,
}

pub(super) fn read(path: &Path) -> Result<ConnectionUsage, String> {
    let file = path.join("connection-usage.json");
    if !file.exists() {
        return Ok(ConnectionUsage::default());
    }
    serde_json::from_slice(&history::read_bounded(&file, 4096)?)
        .map_err(|_| "Jev connection-check usage could not be read.".into())
}

pub(super) fn record(path: &Path, response: Option<&Value>) -> Result<(), String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Decision settings are unavailable.")?;
    let mut total = read(path)?;
    let reported = response.map(usage).unwrap_or_default();
    total.calls = total.calls.saturating_add(1);
    if !reported.reported {
        total.unreported_calls = total.unreported_calls.saturating_add(1);
    }
    total.usage.input = total.usage.input.saturating_add(reported.input);
    total.usage.output = total.usage.output.saturating_add(reported.output);
    total.usage.reported |= reported.reported;
    if let Some(cost) = reported.estimated_cost_usd {
        total.usage.estimated_cost_usd =
            Some(total.usage.estimated_cost_usd.unwrap_or_default() + cost);
    }
    std::fs::create_dir_all(path).map_err(|_| "Could not save Jev connection-check usage.")?;
    history::write_atomic(
        &path.join("connection-usage.json"),
        &serde_json::to_vec(&total).map_err(|_| "Could not save Jev connection-check usage.")?,
    )
}

#[tauri::command]
pub fn routing_connection_usage(
    runtime: State<'_, TaskRuntime>,
) -> Result<ConnectionUsage, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Decision settings are unavailable.")?;
    read(&directory(&runtime))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_checks_preserve_reported_totals_and_unknown_coverage() {
        let path = std::env::temp_dir().join(format!("jev-checks-{}", uuid::Uuid::new_v4()));
        record(
            &path,
            Some(&json!({"usage":{"input_tokens":100,"output_tokens":2}})),
        )
        .unwrap();
        record(&path, None).unwrap();
        let total = read(&path).unwrap();
        assert_eq!(total.calls, 2);
        assert_eq!(total.unreported_calls, 1);
        assert_eq!(total.usage.input, 100);
        assert_eq!(total.usage.output, 2);
        std::fs::remove_file(path.join("connection-usage.json")).unwrap();
        std::fs::remove_dir(path).unwrap();
    }
}
