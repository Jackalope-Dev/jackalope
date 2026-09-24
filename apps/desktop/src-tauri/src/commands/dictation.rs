use serde::Deserialize;

fn endpoint(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Enter a local transcription endpoint.")?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use a local HTTP transcription endpoint at 127.0.0.1 or [::1], without credentials or query parameters.".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn desktop_transcribe(
    endpoint: String,
    model: String,
    audio: Vec<u8>,
) -> Result<String, String> {
    let url = self::endpoint(&endpoint)?;
    if audio.len() < 44
        || audio.len() > 1_920_044
        || &audio[..4] != b"RIFF"
        || &audio[8..12] != b"WAVE"
    {
        return Err("Record up to one minute of audio.".into());
    }
    if model.is_empty() || model.len() > 200 || model.chars().any(char::is_control) {
        return Err("Set the model name expected by your transcription server.".into());
    }
    let boundary = format!("jackalope-{}", uuid::Uuid::new_v4());
    let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dictation.wav\"\r\nContent-Type: audio/wav\r\n\r\n").into_bytes();
    body.extend_from_slice(&audio);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.post(url).header("Content-Type", format!("multipart/form-data; boundary={boundary}")).body(body).send().await.map_err(|_| "Could not reach the local transcription server. Check Desktop settings and start your server.")?;
    if !response.status().is_success() {
        return Err(format!(
            "The local transcription server returned {}.",
            response.status()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 32_000 {
            return Err("The transcription is too long.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    #[derive(Deserialize)]
    struct Transcript {
        text: String,
    }
    let result: Transcript = serde_json::from_slice(&bytes)
        .map_err(|_| "The local server must return a JSON response with a text field.")?;
    if result.text.len() > 12_000 {
        return Err("The transcription is too long for a new message.".into());
    }
    Ok(result.text.trim().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audio_stays_on_loopback() {
        for value in [
            "https://example.com/transcribe",
            "http://127.0.0.1.example.com",
            "http://user:pass@127.0.0.1",
            "http://192.168.1.2:8000",
            "file:///tmp/audio",
        ] {
            assert!(endpoint(value).is_err());
        }
        assert!(endpoint("http://127.0.0.1:8000/v1/audio/transcriptions").is_ok());
        assert!(endpoint("http://[::1]:8000/v1/audio/transcriptions").is_ok());
    }
}
