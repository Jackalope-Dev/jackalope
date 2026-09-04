use std::sync::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AppState {
    pub active_project_path: Mutex<Option<String>>,
}
