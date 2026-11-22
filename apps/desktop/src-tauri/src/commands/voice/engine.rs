use super::Model;
use std::{path::Path, sync::Once};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const RATE: u32 = 16_000;

/// The samples of a 16 kHz mono 16-bit PCM WAV of up to a minute, as the
/// webview's recorder writes it.
pub(super) fn samples(wave: &[u8]) -> Result<Vec<f32>, String> {
    let invalid = || "The recording is not a 16 kHz mono WAV.".to_string();
    if wave.len() < 44 || &wave[..4] != b"RIFF" || &wave[8..12] != b"WAVE" {
        return Err(invalid());
    }
    let word = |at: usize| u16::from_le_bytes([wave[at], wave[at + 1]]);
    let long = |at: usize| u32::from_le_bytes([wave[at], wave[at + 1], wave[at + 2], wave[at + 3]]);
    // Walk the chunks: format first, then the data the recorder writes.
    let mut at = 12;
    let mut format = None;
    while at + 8 <= wave.len() {
        let size = long(at + 4) as usize;
        let body = at + 8;
        let end = body.checked_add(size).ok_or_else(invalid)?.min(wave.len());
        match &wave[at..at + 4] {
            b"fmt " if size >= 16 && body + 16 <= wave.len() => {
                format = Some((word(body), word(body + 2), long(body + 4), word(body + 14)));
            }
            b"data" => {
                if format != Some((1, 1, RATE, 16)) {
                    return Err(invalid());
                }
                let data = &wave[body..end];
                if data.len() > RATE as usize * 2 * 61 {
                    return Err("Record up to one minute at a time.".into());
                }
                return Ok(data
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|pair| f32::from(i16::from_le_bytes(*pair)) / 32768.0)
                    .collect());
            }
            _ => {}
        }
        at = end + (size & 1);
    }
    Err(invalid())
}

pub(super) fn transcribe(
    model: &'static Model,
    path: &Path,
    samples: &[f32],
) -> Result<String, String> {
    // Under a second of audio is a stray click; whisper would invent words for it.
    if samples.len() < RATE as usize {
        return Ok(String::new());
    }
    static QUIET: Once = Once::new();
    QUIET.call_once(whisper_rs::install_logging_hooks);
    // Loaded per recording, not kept in a static: the model is memory-mapped, so loading
    // is quick, and whisper.cpp's Metal backend aborts at exit if a context outlives it.
    let context = WhisperContext::new_with_params(path, WhisperContextParameters::default())
        .map_err(|error| format!("Could not load the {} voice model: {error}", model.label))?;
    let mut state = context
        .create_state()
        .map_err(|error| format!("Could not start transcription: {error}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("auto"));
    params.set_n_threads(threads());
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    state
        .full(params, samples)
        .map_err(|error| format!("Transcription failed: {error}"))?;
    let mut text = String::new();
    for segment in state.as_iter() {
        let piece = segment
            .to_str_lossy()
            .map_err(|error| format!("Could not read the transcription: {error}"))?;
        text.push_str(&piece);
    }
    Ok(text.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Leaves a core free so the window stays responsive while transcribing.
fn threads() -> i32 {
    std::thread::available_parallelism()
        .map_or(4, |count| count.get().saturating_sub(1))
        .clamp(1, 8) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wave(rate: u32, channels: u16, samples: &[i16], extra_chunk: bool) -> Vec<u8> {
        let mut bytes = b"RIFF\0\0\0\0WAVE".to_vec();
        bytes.extend(b"fmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(channels.to_le_bytes());
        bytes.extend(rate.to_le_bytes());
        bytes.extend((rate * 2 * u32::from(channels)).to_le_bytes());
        bytes.extend((2 * channels).to_le_bytes());
        bytes.extend(16u16.to_le_bytes());
        if extra_chunk {
            bytes.extend(b"LIST");
            bytes.extend(3u32.to_le_bytes());
            bytes.extend([1, 2, 3, 0]);
        }
        bytes.extend(b"data");
        bytes.extend((samples.len() as u32 * 2).to_le_bytes());
        for sample in samples {
            bytes.extend(sample.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn recordings_decode_to_normalised_samples_and_other_formats_are_refused() {
        let decoded = samples(&wave(16_000, 1, &[0, 16_384, -32_768, 32_767], true)).unwrap();
        assert_eq!(decoded, vec![0.0, 0.5, -1.0, 32_767.0 / 32_768.0]);
        assert!(samples(&wave(44_100, 1, &[0; 4], false)).is_err());
        assert!(samples(&wave(16_000, 2, &[0; 4], false)).is_err());
        assert!(samples(b"RIFF\0\0\0\0WAVEdata").is_err());
        assert!(samples(&[0; 10]).is_err());
        let long = vec![0i16; 16_000 * 62];
        assert!(samples(&wave(16_000, 1, &long, false))
            .unwrap_err()
            .contains("one minute"));
    }

    /// Real speech through a real model: `JACKALOPE_VOICE_MODEL=<ggml base file>
    /// JACKALOPE_VOICE_WAV=<16 kHz mono WAV> cargo test --lib voice -- --ignored`.
    #[test]
    #[ignore = "needs a downloaded model and a recording"]
    fn transcribes_a_real_recording() {
        let model = std::env::var("JACKALOPE_VOICE_MODEL").unwrap();
        let wave = std::fs::read(std::env::var("JACKALOPE_VOICE_WAV").unwrap()).unwrap();
        let text = transcribe(
            &super::super::MODELS[0],
            Path::new(&model),
            &samples(&wave).unwrap(),
        )
        .unwrap();
        eprintln!("transcript: {text}");
        assert!(!text.is_empty());
    }

    #[test]
    fn a_stray_click_transcribes_to_nothing_without_loading_a_model() {
        let text =
            transcribe(&super::super::MODELS[0], Path::new("/missing"), &[0.0; 800]).unwrap();
        assert!(text.is_empty());
    }
}
