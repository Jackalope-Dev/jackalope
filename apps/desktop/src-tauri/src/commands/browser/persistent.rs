//! Browser windows on a persistent profile that no agent controls: the visible
//! window a person signs in with, and short headless sessions that read or
//! clear a profile's site data. Only cookie domain names leave Chromium.

use super::{
    cdp,
    engine::{chromium::BrowserProcess, create_session_directory, remove_session_directory},
    validate_url, Slot,
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

const CDP_TIMEOUT: Duration = Duration::from_secs(10);
/// Most site names kept for one profile.
const SITE_LIMIT: usize = 200;

/// Site names from a CDP cookie list: lowercase domains without a leading dot
/// or `www.`, sorted and deduplicated. Names, values and paths are dropped.
pub(in crate::commands) fn cookie_sites(cookies: &Value) -> Vec<String> {
    let mut sites: Vec<String> = cookies
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|cookie| cookie["domain"].as_str())
        .filter_map(|domain| {
            let domain = domain.trim().trim_start_matches('.').to_ascii_lowercase();
            let domain = domain.strip_prefix("www.").unwrap_or(&domain).to_owned();
            (!domain.is_empty()
                && domain.len() <= 253
                && domain
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-')))
            .then_some(domain)
        })
        .collect();
    sites.sort();
    sites.dedup();
    sites.truncate(SITE_LIMIT);
    sites
}

/// Whether a cookie domain belongs to `site` or one of its subdomains.
pub(super) fn belongs(domain: &str, site: &str) -> bool {
    let domain = domain.trim_start_matches('.').to_ascii_lowercase();
    domain == site || domain.ends_with(&format!(".{site}"))
}

/// A Chromium process on a persistent profile, outside any agent's control.
/// Dropping it closes Chromium gracefully and removes its working folder.
pub(in crate::commands) struct ProfileWindow {
    process: Option<BrowserProcess>,
    directory: PathBuf,
}

impl ProfileWindow {
    /// Opens the profile visibly (for a person to sign in) or headless (for
    /// reading and clearing site data), optionally at `url`.
    pub fn open(profile: &Path, url: Option<&str>, visible: bool) -> Result<Self, String> {
        if let Some(url) = url {
            validate_url(url)?;
        }
        let browser = crate::commands::harness::find_browser_executable()
            .ok_or("Install Chrome, Edge or Chromium, or set JACKALOPE_BROWSER_EXECUTABLE to its executable, then restart Jackalope.")?;
        let directory = create_session_directory()?;
        let slot = Slot {
            headed: visible,
            ..Slot::default()
        };
        match BrowserProcess::start_persistent(&browser, &directory, profile, &slot, url) {
            Ok(process) => Ok(Self {
                process: Some(process),
                directory,
            }),
            Err(error) => {
                remove_session_directory(&directory);
                Err(error)
            }
        }
    }

    /// Whether the person still has the window open.
    pub fn running(&mut self) -> bool {
        self.process.as_mut().is_some_and(BrowserProcess::running)
    }

    fn endpoint(&self) -> Result<&str, String> {
        self.process
            .as_ref()
            .map(|process| process.endpoint.as_str())
            .ok_or_else(|| "The profile browser is closed.".into())
    }

    /// Sites holding cookies in the profile.
    pub fn sites(&self) -> Result<Vec<String>, String> {
        let result = cdp::call(
            self.endpoint()?,
            "Storage.getCookies",
            json!({}),
            CDP_TIMEOUT,
        )?;
        Ok(cookie_sites(&result["cookies"]))
    }

    /// Removes a site's cookies and its origins' stored data. Returns how many
    /// cookies were removed.
    pub fn clear_site(&self, site: &str) -> Result<usize, String> {
        let endpoint = self.endpoint()?;
        let result = cdp::call(endpoint, "Storage.getCookies", json!({}), CDP_TIMEOUT)?;
        let expired: Vec<Value> = result["cookies"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|cookie| cookie["domain"].as_str().is_some_and(|d| belongs(d, site)))
            .map(|cookie| {
                json!({"name":cookie["name"], "value":"", "domain":cookie["domain"],
                    "path":cookie["path"], "secure":cookie["secure"], "httpOnly":cookie["httpOnly"],
                    "expires":1})
            })
            .collect();
        if !expired.is_empty() {
            cdp::call(
                endpoint,
                "Storage.setCookies",
                json!({"cookies":expired}),
                CDP_TIMEOUT,
            )?;
        }
        for origin in [
            format!("https://{site}"),
            format!("https://www.{site}"),
            format!("http://{site}"),
        ] {
            cdp::call(
                endpoint,
                "Storage.clearDataForOrigin",
                json!({"origin":origin, "storageTypes":"all"}),
                CDP_TIMEOUT,
            )?;
        }
        Ok(expired.len())
    }

    /// Stores long-lived fixture cookies for example.com and example.org.
    #[cfg(test)]
    pub fn set_test_cookies(&self) {
        let expires = chrono::Utc::now().timestamp() + 86_400;
        let cookies: Vec<Value> = ["example.com", "example.org"]
            .iter()
            .map(|domain| json!({"name":"fixture", "value":"1", "domain":domain, "path":"/", "expires":expires}))
            .collect();
        cdp::call(
            self.endpoint().unwrap(),
            "Storage.setCookies",
            json!({"cookies":cookies}),
            CDP_TIMEOUT,
        )
        .unwrap();
    }
}

impl Drop for ProfileWindow {
    fn drop(&mut self) {
        drop(self.process.take());
        remove_session_directory(&self.directory);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_sites_keep_only_normalized_domain_names() {
        let cookies = json!([
            {"name":"sid","value":"private","domain":".Example.com","path":"/"},
            {"name":"a","value":"x","domain":"www.example.com"},
            {"name":"b","value":"y","domain":"app.example.org"},
            {"name":"c","value":"z","domain":"bad domain"},
            {"name":"d","value":"w"},
        ]);
        let sites = cookie_sites(&cookies);
        assert_eq!(sites, ["app.example.org", "example.com"]);
        assert!(!serde_json::to_string(&sites).unwrap().contains("private"));
        assert!(cookie_sites(&json!(null)).is_empty());
    }

    #[test]
    fn site_membership_covers_subdomains_but_not_lookalikes() {
        assert!(belongs(".example.com", "example.com"));
        assert!(belongs("mail.example.com", "example.com"));
        assert!(!belongs("notexample.com", "example.com"));
        assert!(!belongs("example.com.evil.net", "example.com"));
    }
}
