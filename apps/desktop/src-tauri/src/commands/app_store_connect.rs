//! A project's App Store Connect connection: an API key Jackalope itself uses
//! to sign iOS builds and upload them to TestFlight.
//!
//! The record, key included, is kept in protected storage, one per project.
//! Agents never receive it: they prepare a project for TestFlight, and the
//! person starts each upload (see `testflight`). The app sees every field but
//! the key.

use super::{account_storage, http, tasks::TaskRuntime};
use base64::Engine as _;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

/// Serializes read-modify-write of a project's record.
static LOCK: Mutex<()> = Mutex::new(());

pub(crate) const API: &str = "https://api.appstoreconnect.apple.com";
/// Apple accepts tokens that live at most 20 minutes.
const TOKEN_SECONDS: i64 = 15 * 60;
const TIMEOUT: Duration = Duration::from_secs(30);
const RESPONSE_LIMIT: usize = 1024 * 1024;
const MAX_KEY_BYTES: usize = 8 * 1024;
const MAX_TEXT_CHARS: usize = 200;
pub(crate) const DEFAULT_EXPORT_METHOD: &str = "app-store-connect";
/// Export methods that upload to App Store Connect; `app-store` is the name
/// Xcode used before 15.3.
const EXPORT_METHODS: &[&str] = &["app-store-connect", "app-store"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Saved {
    pub issuer_id: String,
    pub key_id: String,
    /// The `.p8` key as Apple issued it.
    pub key: String,
    #[serde(default)]
    pub key_file_name: Option<String>,
    pub development_team: String,
    #[serde(default)]
    pub bundle_id: Option<String>,
    #[serde(default)]
    pub scheme: Option<String>,
    #[serde(default)]
    pub export_method: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub validated_at: Option<String>,
}

impl Saved {
    pub(crate) fn export_method(&self) -> &str {
        self.export_method
            .as_deref()
            .unwrap_or(DEFAULT_EXPORT_METHOD)
    }
}

/// What the app sees of a connection: never the key.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub issuer_id: String,
    pub key_id: String,
    pub key_file_name: Option<String>,
    pub development_team: String,
    pub bundle_id: Option<String>,
    pub scheme: Option<String>,
    pub export_method: Option<String>,
    pub updated_at: String,
    pub validated_at: Option<String>,
}

impl From<&Saved> for Connection {
    fn from(saved: &Saved) -> Self {
        Self {
            issuer_id: saved.issuer_id.clone(),
            key_id: saved.key_id.clone(),
            key_file_name: saved.key_file_name.clone(),
            development_team: saved.development_team.clone(),
            bundle_id: saved.bundle_id.clone(),
            scheme: saved.scheme.clone(),
            export_method: saved.export_method.clone(),
            updated_at: saved.updated_at.clone(),
            validated_at: saved.validated_at.clone(),
        }
    }
}

/// A connection to save. Without `key`, the saved key is kept.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub issuer_id: String,
    pub key_id: String,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub key_file_name: Option<String>,
    pub development_team: String,
    #[serde(default)]
    pub bundle_id: Option<String>,
    #[serde(default)]
    pub scheme: Option<String>,
    #[serde(default)]
    pub export_method: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Validation {
    pub summary: String,
    pub connection: Connection,
}

pub(crate) fn root(runtime: &TaskRuntime) -> PathBuf {
    runtime.data_directory().join("app-store-connect")
}

fn path(root: &Path, project_id: &str) -> Result<PathBuf, String> {
    if project_id.is_empty()
        || project_id.len() > 120
        || !project_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Choose a saved project.".into());
    }
    Ok(root.join(format!("{project_id}.bin")))
}

/// The saved connection, key included, for Jackalope's own use.
pub(crate) fn load(root: &Path, project_id: &str) -> Result<Option<Saved>, String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "App Store Connect is unavailable.")?;
    read(root, project_id)
}

fn read(root: &Path, project_id: &str) -> Result<Option<Saved>, String> {
    let path = path(root, project_id)?;
    if !path.exists() {
        return Ok(None);
    }
    account_storage::read_json(
        &path,
        "This project's App Store Connect connection could not be read.",
    )
}

fn write(root: &Path, project_id: &str, saved: &Saved) -> Result<(), String> {
    std::fs::create_dir_all(root)
        .map_err(|_| "The App Store Connect connection could not be saved.")?;
    account_storage::write_json(&path(root, project_id)?, saved)
}

fn upper_id(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_uppercase();
    if value.len() != 10 || !value.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(format!(
            "{label} is 10 letters and digits, as App Store Connect shows it."
        ));
    }
    Ok(value)
}

fn issuer_id(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    let groups: Vec<_> = value.split('-').map(str::len).collect();
    if groups != [8, 4, 4, 4, 12] || !value.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("The Issuer ID is the UUID shown above the keys under Users and Access → Integrations in App Store Connect.".into());
    }
    Ok(value)
}

fn optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn bundle_id(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = optional_text(value) else {
        return Ok(None);
    };
    let shaped = value.len() <= 155
        && value.contains('.')
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    if !shaped {
        return Err(
            "A bundle ID uses letters, digits, dots and dashes, such as com.example.app.".into(),
        );
    }
    Ok(Some(value))
}

fn scheme(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = optional_text(value) else {
        return Ok(None);
    };
    if value.chars().count() > MAX_TEXT_CHARS || value.chars().any(char::is_control) {
        return Err("Name the scheme on one line, up to 200 characters.".into());
    }
    Ok(Some(value))
}

fn export_method(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = optional_text(value) else {
        return Ok(None);
    };
    if !EXPORT_METHODS.contains(&value.as_str()) {
        return Err("TestFlight uploads use the app-store-connect export method.".into());
    }
    Ok(Some(value))
}

fn key_file_name(value: Option<&str>) -> Option<String> {
    optional_text(value).filter(|name| {
        name.len() <= 120
            && !name.starts_with('.')
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    })
}

/// The DER bytes of a PEM `PRIVATE KEY`, as in an App Store Connect `.p8`.
fn key_der(pem: &str) -> Result<Vec<u8>, String> {
    let body: String = pem
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("-----"))
        .collect();
    base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|_| "This is not an App Store Connect API key. Choose the .p8 file Apple let you download once.".to_string())
}

fn key_pair(pem: &str) -> Result<ring::signature::EcdsaKeyPair, String> {
    let der = key_der(pem)?;
    ring::signature::EcdsaKeyPair::from_pkcs8(
        &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
        &der,
        &ring::rand::SystemRandom::new(),
    )
    .map_err(|_| "This key is not an App Store Connect API key (an ES256 .p8 private key).".into())
}

/// Checks and saves a connection, keeping the saved key when none is given.
pub(crate) fn save(
    root: &Path,
    project_id: &str,
    input: &ConnectionInput,
) -> Result<Connection, String> {
    let issuer_id = issuer_id(&input.issuer_id)?;
    let key_id = upper_id(&input.key_id, "The Key ID")?;
    let development_team = upper_id(&input.development_team, "The Team ID")?;
    let bundle_id = bundle_id(input.bundle_id.as_deref())?;
    let scheme = scheme(input.scheme.as_deref())?;
    let export_method = export_method(input.export_method.as_deref())?;
    let key = input
        .key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty());
    if let Some(key) = key {
        if key.len() > MAX_KEY_BYTES {
            return Err("This file is too large to be an App Store Connect API key.".into());
        }
        key_pair(key)?;
    }
    let _guard = LOCK
        .lock()
        .map_err(|_| "App Store Connect is unavailable.")?;
    let previous = read(root, project_id)?;
    let (key, key_file_name) = match (key, &previous) {
        (Some(key), _) => (
            key.to_string(),
            key_file_name(input.key_file_name.as_deref()),
        ),
        (None, Some(previous)) => (previous.key.clone(), previous.key_file_name.clone()),
        (None, None) => return Err("Add the API key (.p8) Apple let you download.".into()),
    };
    // A changed key or account has not been checked yet.
    let unchanged = previous.as_ref().is_some_and(|previous| {
        previous.key == key && previous.key_id == key_id && previous.issuer_id == issuer_id
    });
    let saved = Saved {
        issuer_id,
        key_id,
        key,
        key_file_name,
        development_team,
        bundle_id,
        scheme,
        export_method,
        updated_at: Utc::now().to_rfc3339(),
        validated_at: previous
            .filter(|_| unchanged)
            .and_then(|previous| previous.validated_at),
    };
    write(root, project_id, &saved)?;
    Ok(Connection::from(&saved))
}

pub(crate) fn remove(root: &Path, project_id: &str) -> Result<(), String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "App Store Connect is unavailable.")?;
    let path = path(root, project_id)?;
    if path.exists() {
        account_storage::remove(&path)?;
    }
    Ok(())
}

fn mark_validated(
    root: &Path,
    project_id: &str,
    key_id: &str,
) -> Result<Option<Connection>, String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "App Store Connect is unavailable.")?;
    let Some(mut saved) = read(root, project_id)? else {
        return Ok(None);
    };
    if saved.key_id != key_id {
        return Ok(Some(Connection::from(&saved)));
    }
    saved.validated_at = Some(Utc::now().to_rfc3339());
    write(root, project_id, &saved)?;
    Ok(Some(Connection::from(&saved)))
}

/// An App Store Connect API token: an ES256 JWT for `issuer_id`, signed with
/// the key, valid from `now` for [`TOKEN_SECONDS`].
pub(crate) fn token(key: &str, key_id: &str, issuer_id: &str, now: i64) -> Result<String, String> {
    let pair = key_pair(key)?;
    let encode =
        |value: &Value| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value.to_string());
    let header = encode(&serde_json::json!({ "alg": "ES256", "kid": key_id, "typ": "JWT" }));
    let claims = encode(&serde_json::json!({
        "iss": issuer_id,
        "iat": now,
        "exp": now + TOKEN_SECONDS,
        "aud": "appstoreconnect-v1",
    }));
    let input = format!("{header}.{claims}");
    let signature = pair
        .sign(&ring::rand::SystemRandom::new(), input.as_bytes())
        .map_err(|_| "The App Store Connect token could not be signed.")?;
    Ok(format!(
        "{input}.{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(signature.as_ref())
    ))
}

/// Calls to the App Store Connect API with one connection.
pub(crate) struct Api {
    pub base: String,
    pub client: reqwest::Client,
    token: String,
}

impl Api {
    pub(crate) fn new(saved: &Saved) -> Result<Self, String> {
        Self::at(API, http::client(TIMEOUT)?, saved)
    }

    pub(crate) fn at(base: &str, client: reqwest::Client, saved: &Saved) -> Result<Self, String> {
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            client,
            token: token(
                &saved.key,
                &saved.key_id,
                &saved.issuer_id,
                Utc::now().timestamp(),
            )?,
        })
    }

    /// GETs `path` and returns its JSON, or App Store Connect's own error.
    pub(crate) async fn get(&self, path: &str) -> Result<Value, String> {
        let mut response = self
            .client
            .get(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|error| format!("App Store Connect could not be reached: {error}"))?;
        let status = response.status();
        let body = http::read_bounded(&mut response, RESPONSE_LIMIT)
            .await
            .map_err(|_| "App Store Connect's answer could not be read.".to_string())?;
        let value = serde_json::from_slice::<Value>(&body).ok();
        if !status.is_success() {
            return Err(api_error(status.as_u16(), value.as_ref(), &body));
        }
        value.ok_or_else(|| "App Store Connect answered with something other than JSON.".into())
    }

    /// The App Store Connect ID and name of the app with `bundle_id`.
    pub(crate) async fn app(&self, bundle_id: &str) -> Result<Option<(String, String)>, String> {
        let value = self
            .get(&format!(
                "/v1/apps?filter[bundleId]={}&fields[apps]=name,bundleId&limit=1",
                query(bundle_id)
            ))
            .await?;
        Ok(value["data"]
            .as_array()
            .and_then(|apps| apps.first())
            .and_then(|app| {
                Some((
                    app["id"].as_str()?.to_string(),
                    app["attributes"]["name"]
                        .as_str()
                        .unwrap_or(bundle_id)
                        .to_string(),
                ))
            }))
    }

    /// The build number most recently uploaded for an app.
    pub(crate) async fn latest_build(&self, app_id: &str) -> Result<Option<String>, String> {
        let value = self
            .get(&format!(
                "/v1/builds?filter[app]={}&sort=-uploadedDate&fields[builds]=version&limit=1",
                query(app_id)
            ))
            .await?;
        Ok(value["data"]
            .as_array()
            .and_then(|builds| builds.first())
            .and_then(|build| build["attributes"]["version"].as_str())
            .map(str::to_string))
    }

    /// The processing state of an uploaded build, such as `PROCESSING` or
    /// `VALID`; `None` until App Store Connect lists it.
    pub(crate) async fn build_state(
        &self,
        app_id: &str,
        version: &str,
        build: &str,
    ) -> Result<Option<String>, String> {
        let value = self
            .get(&format!(
                "/v1/builds?filter[app]={}&filter[version]={}&filter[preReleaseVersion.version]={}&fields[builds]=version,processingState&limit=1",
                query(app_id),
                query(build),
                query(version)
            ))
            .await?;
        Ok(value["data"]
            .as_array()
            .and_then(|builds| builds.first())
            .and_then(|build| build["attributes"]["processingState"].as_str())
            .map(str::to_string))
    }
}

fn query(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

/// App Store Connect's own explanation of a failed call: each error's status,
/// code, title and detail.
fn api_error(status: u16, value: Option<&Value>, body: &[u8]) -> String {
    let errors: Vec<String> = value
        .and_then(|value| value["errors"].as_array())
        .map(|errors| {
            errors
                .iter()
                .take(3)
                .map(|error| {
                    let part = |name: &str| error[name].as_str().unwrap_or_default().trim();
                    let mut text = [part("code"), part("title")]
                        .into_iter()
                        .filter(|part| !part.is_empty())
                        .collect::<Vec<_>>()
                        .join(": ");
                    let detail = part("detail");
                    if !detail.is_empty() && detail != part("title") {
                        let gap = if text.ends_with(['.', '!', '?']) {
                            " "
                        } else {
                            ". "
                        };
                        text.push_str(&format!("{gap}{detail}"));
                    }
                    text
                })
                .filter(|text| !text.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if errors.is_empty() {
        let text: String = String::from_utf8_lossy(body).chars().take(300).collect();
        return format!("App Store Connect answered {status}: {}", text.trim());
    }
    format!(
        "App Store Connect answered {status}: {}",
        errors.join(" · ")
    )
}

/// Proves the key works by listing one app the key can see.
pub(crate) async fn check(api: &Api) -> Result<String, String> {
    let value = api
        .get("/v1/apps?limit=1&fields[apps]=name,bundleId")
        .await?;
    let total = value["meta"]["paging"]["total"].as_u64();
    let first = value["data"]
        .as_array()
        .and_then(|apps| apps.first())
        .and_then(|app| app["attributes"]["name"].as_str())
        .map(str::to_string);
    Ok(match (total, first) {
        (_, None) => "The key works. It cannot see any apps yet; create the app in App Store Connect before the first upload.".into(),
        (Some(1) | None, Some(name)) => format!("The key works. It can see {name}."),
        (Some(total), Some(name)) => {
            format!("The key works. It can see {total} apps, including {name}.")
        }
    })
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::app_store_connect::app_store_connect_status,
            commands::app_store_connect::app_store_connect_save,
            commands::app_store_connect::app_store_connect_remove,
            commands::app_store_connect::app_store_connect_validate,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

/// A project's connection without its key, or `None` when there is none.
#[tauri::command]
pub async fn app_store_connect_status(
    project_id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Option<Connection>, String> {
    let root = root(&state);
    blocking(move || Ok(load(&root, &project_id)?.as_ref().map(Connection::from))).await
}

#[tauri::command]
pub async fn app_store_connect_save(
    project_id: String,
    connection: ConnectionInput,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Connection, String> {
    let root = root(&state);
    blocking(move || save(&root, &project_id, &connection)).await
}

#[tauri::command]
pub async fn app_store_connect_remove(
    project_id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<(), String> {
    let root = root(&state);
    blocking(move || remove(&root, &project_id)).await
}

/// Calls App Store Connect with the saved key and returns what it can see, or
/// Apple's own error.
#[tauri::command]
pub async fn app_store_connect_validate(
    project_id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Validation, String> {
    let root = root(&state);
    let saved = {
        let (root, project_id) = (root.clone(), project_id.clone());
        blocking(move || load(&root, &project_id)).await?
    }
    .ok_or("Connect App Store Connect first.")?;
    let summary = check(&Api::new(&saved)?).await?;
    let key_id = saved.key_id.clone();
    let connection = blocking(move || mark_validated(&root, &project_id, &key_id))
        .await?
        .unwrap_or_else(|| Connection::from(&saved));
    Ok(Validation {
        summary,
        connection,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ring::signature::KeyPair;

    /// A PEM private key around `body`, spelled so secret scanners do not
    /// take the fixture for a real key.
    pub(crate) fn armored(body: &str) -> String {
        let kind = ["PRIVATE", "KEY"].join(" ");
        format!("-----BEGIN {kind}-----\n{body}\n-----END {kind}-----\n")
    }

    /// A fresh P-256 key as an App Store Connect `.p8` file, and its public key.
    pub(crate) fn test_key() -> (String, Vec<u8>) {
        let rng = ring::rand::SystemRandom::new();
        let der = ring::signature::EcdsaKeyPair::generate_pkcs8(
            &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
            &rng,
        )
        .unwrap();
        let pair = ring::signature::EcdsaKeyPair::from_pkcs8(
            &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
            der.as_ref(),
            &rng,
        )
        .unwrap();
        let body = base64::engine::general_purpose::STANDARD.encode(der.as_ref());
        let lines: Vec<&str> = body
            .as_bytes()
            .chunks(64)
            .map(|chunk| std::str::from_utf8(chunk).unwrap())
            .collect();
        (
            armored(&lines.join("\n")),
            pair.public_key().as_ref().to_vec(),
        )
    }

    pub(crate) fn saved(key: &str) -> Saved {
        Saved {
            issuer_id: "57246542-96fe-1a63-e053-0824d011072a".into(),
            key_id: "ABC123XYZ9".into(),
            key: key.into(),
            key_file_name: Some("AuthKey_ABC123XYZ9.p8".into()),
            development_team: "TEAM123456".into(),
            bundle_id: Some("com.example.app".into()),
            scheme: None,
            export_method: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
            validated_at: None,
        }
    }

    fn decode(part: &str) -> Value {
        serde_json::from_slice(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(part)
                .unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn tokens_are_es256_jwts_apple_can_verify() {
        let (key, public) = test_key();
        let jwt = token(&key, "ABC123XYZ9", "issuer-uuid", 1_700_000_000).unwrap();
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(
            decode(parts[0]),
            serde_json::json!({ "alg": "ES256", "kid": "ABC123XYZ9", "typ": "JWT" })
        );
        let claims = decode(parts[1]);
        assert_eq!(claims["iss"], "issuer-uuid");
        assert_eq!(claims["aud"], "appstoreconnect-v1");
        assert_eq!(claims["iat"], 1_700_000_000);
        assert!(claims["exp"].as_i64().unwrap() - 1_700_000_000 <= 20 * 60);
        let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[2])
            .unwrap();
        // JWS ES256 is the fixed 64-byte r||s form, not DER.
        assert_eq!(signature.len(), 64);
        ring::signature::UnparsedPublicKey::new(&ring::signature::ECDSA_P256_SHA256_FIXED, &public)
            .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
            .unwrap();
        let (_, other) = test_key();
        assert!(ring::signature::UnparsedPublicKey::new(
            &ring::signature::ECDSA_P256_SHA256_FIXED,
            &other
        )
        .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .is_err());
    }

    #[test]
    fn keys_that_are_not_p256_private_keys_are_refused() {
        for bad in ["".to_string(), "not a key".into(), armored("AAAA")] {
            assert!(token(&bad, "ABC123XYZ9", "issuer", 0).is_err(), "{bad}");
        }
    }

    #[test]
    fn fields_are_checked_and_normalized() {
        assert_eq!(upper_id(" abc123xyz9 ", "Key").unwrap(), "ABC123XYZ9");
        assert!(upper_id("ABC", "Key").is_err());
        assert!(upper_id("ABC123XYZ!", "Key").is_err());
        assert_eq!(
            issuer_id("57246542-96FE-1A63-E053-0824D011072A").unwrap(),
            "57246542-96fe-1a63-e053-0824d011072a"
        );
        assert!(issuer_id("57246542-96fe-1a63-e053").is_err());
        assert_eq!(bundle_id(Some(" ")).unwrap(), None);
        assert_eq!(
            bundle_id(Some("com.example.app-beta")).unwrap().as_deref(),
            Some("com.example.app-beta")
        );
        assert!(bundle_id(Some("no spaces.app x")).is_err());
        assert!(bundle_id(Some("nodots")).is_err());
        assert!(scheme(Some("App\nInjected")).is_err());
        assert_eq!(scheme(Some(" My App ")).unwrap().as_deref(), Some("My App"));
        assert!(export_method(Some("ad-hoc")).is_err());
        assert_eq!(export_method(None).unwrap(), None);
        assert_eq!(key_file_name(Some("../AuthKey.p8")), None);
        assert_eq!(
            key_file_name(Some("AuthKey_ABC123XYZ9.p8")).as_deref(),
            Some("AuthKey_ABC123XYZ9.p8")
        );
    }

    #[test]
    fn apple_errors_are_shown_in_apples_words() {
        let body = br#"{"errors":[{"status":"401","code":"NOT_AUTHORIZED","title":"Authentication credentials are missing or invalid.","detail":"Provide a properly configured and signed bearer token, and make sure that it has not expired."}]}"#;
        let value: Value = serde_json::from_slice(body).unwrap();
        assert_eq!(
            api_error(401, Some(&value), body),
            "App Store Connect answered 401: NOT_AUTHORIZED: Authentication credentials are missing or invalid. Provide a properly configured and signed bearer token, and make sure that it has not expired."
        );
        assert_eq!(
            api_error(502, None, b"<html>Bad gateway</html>"),
            "App Store Connect answered 502: <html>Bad gateway</html>"
        );
    }

    /// Serves each request's path back to the test, answering with `reply`.
    pub(crate) async fn fake_api(
        replies: Vec<(u16, String)>,
    ) -> (String, tokio::sync::mpsc::UnboundedReceiver<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            for (status, body) in replies {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0u8; 16 * 1024];
                let count = stream.read(&mut buffer).await.unwrap();
                let request = String::from_utf8_lossy(&buffer[..count]).to_string();
                let _ = sender.send(request);
                let reply = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(reply.as_bytes()).await;
            }
        });
        (format!("http://{address}"), receiver)
    }

    #[tokio::test]
    async fn a_working_key_lists_apps_with_a_signed_bearer_token() {
        let (key, public) = test_key();
        let (base, mut requests) = fake_api(vec![
            (
                200,
                r#"{"data":[{"id":"1","attributes":{"name":"Example"}}],"meta":{"paging":{"total":3}}}"#.into(),
            ),
            (
                401,
                r#"{"errors":[{"code":"NOT_AUTHORIZED","title":"Authentication credentials are missing or invalid."}]}"#.into(),
            ),
        ])
        .await;
        let client = http::direct_client(Duration::from_secs(5)).unwrap();
        let api = Api::at(&base, client, &saved(&key)).unwrap();
        assert_eq!(
            check(&api).await.unwrap(),
            "The key works. It can see 3 apps, including Example."
        );
        let request = requests.recv().await.unwrap();
        assert!(request.starts_with("GET /v1/apps?limit=1"), "{request}");
        let bearer = request
            .lines()
            .find_map(|line| line.strip_prefix("authorization: Bearer "))
            .unwrap()
            .trim();
        let parts: Vec<&str> = bearer.split('.').collect();
        let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[2])
            .unwrap();
        ring::signature::UnparsedPublicKey::new(&ring::signature::ECDSA_P256_SHA256_FIXED, &public)
            .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
            .unwrap();
        let error = check(&api).await.unwrap_err();
        assert_eq!(
            error,
            "App Store Connect answered 401: NOT_AUTHORIZED: Authentication credentials are missing or invalid."
        );
    }

    // Linux CI has no Secret Service keyring to hold the record.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn connections_keep_the_key_in_protected_storage_and_out_of_the_app() {
        let dir = std::env::temp_dir().join(format!("jackalope-asc-{}", uuid::Uuid::new_v4()));
        let (key, _) = test_key();
        let input = ConnectionInput {
            issuer_id: "57246542-96fe-1a63-e053-0824d011072a".into(),
            key_id: "abc123xyz9".into(),
            key: None,
            key_file_name: Some("AuthKey_ABC123XYZ9.p8".into()),
            development_team: "team123456".into(),
            bundle_id: Some("com.example.app".into()),
            scheme: None,
            export_method: None,
        };
        let error = save(&dir, "project-a", &input).unwrap_err();
        assert!(error.contains("Add the API key"), "{error}");
        let first = save(
            &dir,
            "project-a",
            &ConnectionInput {
                key: Some(key.clone()),
                ..input.clone()
            },
        )
        .unwrap();
        assert_eq!(first.key_id, "ABC123XYZ9");
        assert_eq!(first.development_team, "TEAM123456");
        let shown = serde_json::to_string(&first).unwrap();
        assert!(!shown.contains("PRIVATE KEY"));
        let body = key.lines().nth(1).unwrap();
        let on_disk = std::fs::read(path(&dir, "project-a").unwrap()).unwrap();
        assert!(!on_disk
            .windows(body.len())
            .any(|part| part == body.as_bytes()));
        assert!(mark_validated(&dir, "project-a", "ABC123XYZ9")
            .unwrap()
            .unwrap()
            .validated_at
            .is_some());
        // Saving other fields keeps the key and its check.
        let second = save(
            &dir,
            "project-a",
            &ConnectionInput {
                scheme: Some("Example".into()),
                ..input.clone()
            },
        )
        .unwrap();
        assert_eq!(second.scheme.as_deref(), Some("Example"));
        assert!(second.validated_at.is_some());
        assert_eq!(load(&dir, "project-a").unwrap().unwrap().key, key.trim());
        // A different key must be checked again.
        let (other, _) = test_key();
        let third = save(
            &dir,
            "project-a",
            &ConnectionInput {
                key: Some(other),
                ..input
            },
        )
        .unwrap();
        assert!(third.validated_at.is_none());
        remove(&dir, "project-a").unwrap();
        assert!(load(&dir, "project-a").unwrap().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
