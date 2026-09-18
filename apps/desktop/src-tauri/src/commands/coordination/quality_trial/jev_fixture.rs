use crate::commands::{
    account_storage,
    decisions::{settings, DecisionMode},
    tasks::TaskRuntime,
};

pub(super) struct Fixture(std::path::PathBuf);

impl Fixture {
    pub(super) fn configure(runtime: &TaskRuntime) -> Result<Option<Self>, String> {
        if ![
            "JACKALOPE_JEV_QUESTIONS",
            "JACKALOPE_JEV_PREPARATION",
            "JACKALOPE_CONTEXT_PRUNING",
        ]
        .iter()
        .any(|name| std::env::var(name).is_ok_and(|value| value == "on"))
        {
            return Ok(None);
        }
        let key = std::env::var("JACKALOPE_JEV_TEST_KEY")
            .map_err(|_| "Jev experiments require JACKALOPE_JEV_TEST_KEY.")?;
        let directory = settings::directory(runtime);
        let mut preferences = settings::Preferences {
            mode: DecisionMode::Jev,
            ..Default::default()
        };
        settings::save(&directory, &mut preferences)?;
        std::fs::write(
            directory.join("options.json"),
            br#"{"default":{"agentQuestions":true}}"#,
        )
        .map_err(|e| e.to_string())?;
        let fixture = Self(directory.join("api-key.bin"));
        account_storage::write(
            &fixture.0,
            &serde_json::to_vec(
                &serde_json::json!({"key":key,"checked_at":chrono::Utc::now().to_rfc3339()}),
            )
            .map_err(|e| e.to_string())?,
        )?;
        Ok(Some(fixture))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = account_storage::remove(&self.0);
    }
}
