//! Local voice to text. The webview records and resamples to 16 kHz mono WAV, as
//! dictation through a loopback server already does; this module downloads a
//! whisper.cpp model on first use and transcribes on this computer.

mod download;
mod engine;

use super::tasks::TaskRuntime;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::voice::voice_models,
            commands::voice::voice_download,
            commands::voice::voice_cancel_download,
            commands::voice::voice_delete,
            commands::voice::voice_transcribe,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// One downloadable model. Files come from a pinned commit, so the size and
/// SHA-256 below are what that URL serves; a mismatch is never installed.
pub(super) struct Model {
    pub id: &'static str,
    pub label: &'static str,
    pub detail: &'static str,
    pub file: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

const REVISION: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";

pub(super) const MODELS: [Model; 3] = [
    Model {
        id: "fast",
        label: "Fast",
        detail: "Whisper base. Quick on any computer.",
        file: "ggml-base-q5_1.bin",
        bytes: 59_707_625,
        sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    },
    Model {
        id: "balanced",
        label: "Balanced",
        detail: "Whisper small. More accurate, still quick.",
        file: "ggml-small-q5_1.bin",
        bytes: 190_085_487,
        sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    },
    Model {
        id: "accurate",
        label: "Most accurate",
        detail: "Whisper large v3 turbo. Best with accents and jargon.",
        file: "ggml-large-v3-turbo-q5_0.bin",
        bytes: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    },
];

impl Model {
    fn url(&self) -> String {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/{REVISION}/{}",
            self.file
        )
    }
}

pub(super) fn model(id: &str) -> Result<&'static Model, String> {
    MODELS
        .iter()
        .find(|model| model.id == id)
        .ok_or_else(|| format!("There is no voice model named {id}."))
}

/// Where models live: the profile's data folder, so test profiles stay separate.
fn directory(runtime: &TaskRuntime) -> PathBuf {
    runtime.data_directory().join("voice-models")
}

pub(super) fn installed_path(directory: &Path, model: &Model) -> PathBuf {
    directory.join(model.file)
}

pub(super) fn partial_path(directory: &Path, model: &Model) -> PathBuf {
    directory.join(format!("{}.part", model.file))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceModel {
    id: &'static str,
    label: &'static str,
    detail: &'static str,
    bytes: u64,
    installed: bool,
    /// Bytes of an interrupted download that the next download resumes from.
    partial: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceModels {
    models: Vec<VoiceModel>,
    /// The model this computer runs comfortably: the largest on Apple Silicon,
    /// whose GPU whisper.cpp uses, and the smallest elsewhere.
    recommended: &'static str,
}

fn recommended() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "accurate"
    } else {
        "fast"
    }
}

fn models_in(directory: &Path) -> VoiceModels {
    VoiceModels {
        models: MODELS
            .iter()
            .map(|model| VoiceModel {
                id: model.id,
                label: model.label,
                detail: model.detail,
                bytes: model.bytes,
                // Only a verified download is renamed into place.
                installed: installed_path(directory, model).is_file(),
                partial: std::fs::metadata(partial_path(directory, model))
                    .map_or(0, |meta| meta.len().min(model.bytes)),
            })
            .collect(),
        recommended: recommended(),
    }
}

#[tauri::command]
pub fn voice_models(state: State<'_, TaskRuntime>) -> VoiceModels {
    models_in(&directory(state.inner()))
}

/// Downloads, resuming an interrupted download, then verifies the SHA-256 before
/// installing. Progress arrives as `voice-download` events.
#[tauri::command]
pub async fn voice_download(
    id: String,
    app: AppHandle,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let model = model(&id)?;
    let directory = directory(state.inner());
    download::run(model, &directory, |progress| {
        use tauri::Emitter;
        let _ = app.emit("voice-download", progress);
    })
    .await
}

#[tauri::command]
pub fn voice_cancel_download(id: String) -> Result<(), String> {
    download::cancel(model(&id)?);
    Ok(())
}

#[tauri::command]
pub fn voice_delete(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    let model = model(&id)?;
    let directory = directory(state.inner());
    download::cancel(model);
    for path in [
        installed_path(&directory, model),
        partial_path(&directory, model),
    ] {
        match std::fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("Could not delete {}: {error}", path.display()));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Transcribes a recording (16 kHz mono 16-bit WAV, up to a minute) with an
/// installed model. The audio is never written to disk.
#[tauri::command]
pub async fn voice_transcribe(
    id: String,
    audio: Vec<u8>,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let model = model(&id)?;
    let path = installed_path(&directory(state.inner()), model);
    if !path.is_file() {
        return Err(format!("The {} voice model is not installed.", model.label));
    }
    let samples = engine::samples(&audio)?;
    tauri::async_runtime::spawn_blocking(move || engine::transcribe(model, &path, &samples))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_pinned_and_unique() {
        for (index, model) in MODELS.iter().enumerate() {
            assert!(model.url().contains(REVISION), "{}", model.id);
            assert!(model.url().starts_with("https://huggingface.co/"));
            assert_eq!(model.sha256.len(), 64);
            assert!(model.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
            assert!(model.bytes > 1_000_000);
            assert!(MODELS[..index].iter().all(|other| other.id != model.id));
        }
        assert!(model(recommended()).is_ok());
        assert!(model("../etc").is_err());
    }

    #[test]
    fn status_counts_only_verified_files_as_installed() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-voice-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(partial_path(&directory, &MODELS[0]), [0u8; 10]).unwrap();
        std::fs::write(installed_path(&directory, &MODELS[1]), b"x").unwrap();
        let status = models_in(&directory);
        assert!(!status.models[0].installed);
        assert_eq!(status.models[0].partial, 10);
        assert!(status.models[1].installed);
        assert!(!status.models[2].installed && status.models[2].partial == 0);
        let _ = std::fs::remove_dir_all(&directory);
    }
}
