//! A website's icon for a project's sidebar mark. The page and icon are fetched
//! straight from the site (never through a favicon service), only from public
//! addresses, and handed back as a data URL the webview stores with the project,
//! so the sidebar never touches the network.

use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    path::Path,
    time::Duration,
};

use base64::Engine as _;
use reqwest::{header, StatusCode, Url};
use serde::Serialize;

const TIMEOUT: Duration = Duration::from_secs(10);
/// Icon links sit in the page head, so only the start of a long page is read.
const PAGE_LIMIT: usize = 512 * 1024;
/// Kept small because the icon is saved inside the project list in webview storage.
const ICON_LIMIT: usize = 64 * 1024;
const MAX_REDIRECTS: usize = 5;
const MAX_CANDIDATES: usize = 4;

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::project_favicon::project_website_detect,
            commands::project_favicon::project_favicon_fetch,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFavicon {
    /// `data:<image type>;base64,…`, shown with `<img>` so an SVG cannot run scripts.
    pub data_url: String,
    /// The site address the icon came from, after redirects.
    pub site_url: String,
}

/// The project's website as its own files declare it, without any network access.
#[tauri::command]
pub async fn project_website_detect(project_path: String) -> Result<Option<String>, String> {
    let root = std::path::PathBuf::from(project_path);
    tokio::task::spawn_blocking(move || detect_website(&root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_favicon_fetch(url: String) -> Result<ProjectFavicon, String> {
    let page = site_url(&url)?;
    let (page, mut response) = get(page).await?;
    let host = page.host_str().unwrap_or_default().to_string();
    let content_type = header_value(&response, header::CONTENT_TYPE);
    let body = read_prefix(&mut response, PAGE_LIMIT)
        .await
        .map_err(|e| format!("Couldn't read {host}: {e}"))?;
    // Someone may paste the icon's own address.
    if let Some(mime) = sniff_image(&body) {
        if body.len() <= ICON_LIMIT {
            return Ok(favicon(mime, &body, &page));
        }
    }
    let mut candidates = if content_type.contains("html") || content_type.is_empty() {
        icon_links(&String::from_utf8_lossy(&body), &page)
    } else {
        Vec::new()
    };
    if let Ok(fallback) = page.join("/favicon.ico") {
        if !candidates.iter().any(|candidate| candidate.url == fallback) {
            candidates.push(Candidate {
                url: fallback,
                rank: Rank::Fallback,
            });
        }
    }
    let mut failures = Vec::new();
    for candidate in candidates.into_iter().take(MAX_CANDIDATES) {
        match fetch_icon(candidate.url.clone()).await {
            Ok((mime, bytes)) => return Ok(favicon(mime, &bytes, &page)),
            Err(reason) => failures.push(format!("{}: {reason}", candidate.url)),
        }
    }
    Err(format!("No usable icon on {host}. {}", failures.join("; ")))
}

fn favicon(mime: &str, bytes: &[u8], page: &Url) -> ProjectFavicon {
    ProjectFavicon {
        data_url: format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        site_url: page.to_string(),
    }
}

async fn fetch_icon(url: Url) -> Result<(&'static str, Vec<u8>), String> {
    let (_, mut response) = get(url).await?;
    let bytes = read_prefix(&mut response, ICON_LIMIT + 1).await?;
    if bytes.len() > ICON_LIMIT {
        return Err(format!("larger than {} KB", ICON_LIMIT / 1024));
    }
    sniff_image(&bytes)
        .map(|mime| (mime, bytes))
        .ok_or_else(|| "not a PNG, ICO, SVG, JPEG or WebP image".to_string())
}

/// Reads up to `limit` bytes and stops there rather than failing.
async fn read_prefix(response: &mut reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        let room = limit - bytes.len();
        bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
        if bytes.len() >= limit {
            break;
        }
    }
    Ok(bytes)
}

fn header_value(response: &reqwest::Response, name: header::HeaderName) -> String {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// A typed or pasted address as an http(s) URL; a bare domain means https.
fn site_url(input: &str) -> Result<Url, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Enter the project's website address.".into());
    }
    let with_scheme = if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| format!("{input} isn't a web address."))?;
    check_url(&url)?;
    Ok(url)
}

fn check_url(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!(
            "Only http and https addresses are fetched, not {}:.",
            url.scheme()
        ));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(format!("{url} has no host."));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Remove the user name and password from the address.".into());
    }
    Ok(())
}

/// GET that follows redirects itself, checking every hop, and connects only to the
/// public addresses it resolved (so DNS cannot swap in a private one afterwards).
async fn get(mut url: Url) -> Result<(Url, reqwest::Response), String> {
    for _ in 0..=MAX_REDIRECTS {
        check_url(&url)?;
        let host = url.host_str().unwrap_or_default().to_string();
        let addresses = public_addresses(&url).await?;
        let mut builder = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .user_agent(concat!("Jackalope/", env!("CARGO_PKG_VERSION")));
        if let Some(domain) = url.domain() {
            builder = builder.resolve_to_addrs(domain, &addresses);
        }
        let client = builder.build().map_err(|e| e.to_string())?;
        let response = client
            .get(url.clone())
            .header(header::ACCEPT, "text/html,image/*;q=0.9,*/*;q=0.5")
            .send()
            .await
            .map_err(|e| format!("Couldn't reach {host}: {}", root_cause(&e)))?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_string();
            url = url
                .join(&location)
                .map_err(|_| format!("{host} redirected to an invalid address."))?;
            continue;
        }
        if status != StatusCode::OK {
            return Err(format!("{host} answered {status}"));
        }
        return Ok((url, response));
    }
    Err(format!("Stopped after {MAX_REDIRECTS} redirects."))
}

fn root_cause(error: &(dyn std::error::Error + 'static)) -> String {
    let mut cause = error;
    while let Some(next) = cause.source() {
        cause = next;
    }
    cause.to_string()
}

async fn public_addresses(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let host = url.host_str().unwrap_or_default();
    let port = url.port_or_known_default().unwrap_or(443);
    let literal = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>();
    let addresses: Vec<SocketAddr> = if let Ok(ip) = literal {
        vec![SocketAddr::new(ip, port)]
    } else {
        let lower = host.to_ascii_lowercase();
        if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
            return Err(format!(
                "{host} is on this machine or network, so it isn't fetched."
            ));
        }
        tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| format!("Couldn't find {host}: {e}"))?
            .collect()
    };
    if addresses.is_empty() {
        return Err(format!("Couldn't find {host}."));
    }
    if let Some(private) = addresses.iter().find(|address| !is_public(address.ip())) {
        return Err(format!(
            "{host} points to a private or local address ({}), so it isn't fetched.",
            private.ip()
        ));
    }
    Ok(addresses)
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
            Some(mapped) => is_public_v4(mapped),
            None => is_public_v6(ip),
        },
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..128).contains(&b)) // shared address space
        || (a == 198 && (18..20).contains(&b)) // benchmarking
        || a >= 240)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00 // unique local
        || (first & 0xffc0) == 0xfe80 // link local
        || (first == 0x2001 && ip.segments()[1] == 0x0db8)) // documentation
}

/// The image type from the bytes themselves; servers often mislabel icons.
fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(&[0, 0, 1, 0]) {
        return Some("image/x-icon");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_ascii_lowercase();
    let head = head.trim_start_matches('\u{feff}').trim_start();
    let markup = head.starts_with("<?xml") || head.starts_with("<svg") || head.starts_with("<!--");
    (markup && head.contains("<svg") && !head.contains("<html")).then_some("image/svg+xml")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Rank {
    /// Scales to any size.
    Vector,
    /// Declared at least 32px, smallest first.
    Sized(u32),
    Unsized,
    /// Apple touch icons: large, sometimes on an opaque square.
    Touch(u32),
    /// Declared under 32px, largest first.
    Small(u32),
    Fallback,
}

#[derive(Debug)]
struct Candidate {
    url: Url,
    rank: Rank,
}

/// Icon links in the page, best first for a 20–24px mark on a high-density display.
fn icon_links(html: &str, page: &Url) -> Vec<Candidate> {
    let lower = html.to_ascii_lowercase();
    let mut candidates = Vec::new();
    let mut from = 0;
    while let Some(offset) = lower[from..].find("<link") {
        let start = from + offset + "<link".len();
        let (attributes, end) = parse_attributes(html, start);
        from = end;
        let get = |name: &str| {
            attributes
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        };
        let rel = get("rel").unwrap_or_default().to_ascii_lowercase();
        let rels: Vec<&str> = rel.split_ascii_whitespace().collect();
        let touch = rels
            .iter()
            .any(|rel| matches!(*rel, "apple-touch-icon" | "apple-touch-icon-precomposed"));
        if !touch && !rels.contains(&"icon") {
            continue;
        }
        let Some(href) = get("href").map(|href| href.trim().replace("&amp;", "&")) else {
            continue;
        };
        let Ok(url) = page.join(&href) else { continue };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let kind = get("type").unwrap_or_default().to_ascii_lowercase();
        let sizes = get("sizes").unwrap_or_default().to_ascii_lowercase();
        let largest = sizes
            .split_ascii_whitespace()
            .filter_map(|size| size.split_once('x')?.0.parse::<u32>().ok())
            .max();
        let vector = kind == "image/svg+xml"
            || url.path().to_ascii_lowercase().ends_with(".svg")
            || sizes.split_ascii_whitespace().any(|size| size == "any");
        let rank = match (touch, vector, largest) {
            (true, _, size) => Rank::Touch(size.unwrap_or(180)),
            (false, true, _) => Rank::Vector,
            (false, false, Some(size)) if size >= 32 => Rank::Sized(size),
            (false, false, Some(size)) => Rank::Small(u32::MAX - size),
            (false, false, None) => Rank::Unsized,
        };
        candidates.push(Candidate { url, rank });
    }
    candidates.sort_by_key(|candidate| candidate.rank);
    candidates.dedup_by(|a, b| a.url == b.url);
    candidates
}

/// Attributes of the tag whose name ends at `start`, and the index just past it.
fn parse_attributes(html: &str, start: usize) -> (Vec<(String, String)>, usize) {
    let bytes = html.as_bytes();
    let mut index = start;
    let mut attributes = Vec::new();
    loop {
        while index < bytes.len() && (bytes[index].is_ascii_whitespace() || bytes[index] == b'/') {
            index += 1;
        }
        if index >= bytes.len() {
            return (attributes, index);
        }
        if bytes[index] == b'>' {
            return (attributes, index + 1);
        }
        let name_start = index;
        while index < bytes.len()
            && !bytes[index].is_ascii_whitespace()
            && !matches!(bytes[index], b'=' | b'>' | b'/')
        {
            index += 1;
        }
        let name = html[name_start..index].to_ascii_lowercase();
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let mut value = String::new();
        if index < bytes.len() && bytes[index] == b'=' {
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_whitespace() {
                index += 1;
            }
            if index < bytes.len() && matches!(bytes[index], b'"' | b'\'') {
                let quote = bytes[index];
                let value_start = index + 1;
                let value_end = bytes[value_start..]
                    .iter()
                    .position(|byte| *byte == quote)
                    .map_or(bytes.len(), |offset| value_start + offset);
                value = html[value_start..value_end].to_string();
                index = (value_end + 1).min(bytes.len());
            } else {
                let value_start = index;
                while index < bytes.len()
                    && !bytes[index].is_ascii_whitespace()
                    && bytes[index] != b'>'
                {
                    index += 1;
                }
                value = html[value_start..index].to_string();
            }
        }
        if name.is_empty() {
            index += 1;
        } else {
            attributes.push((name, value));
        }
    }
}

const NOT_A_WEBSITE: [&str; 6] = [
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "npmjs.com",
    "crates.io",
    "pypi.org",
];

/// An http(s) address on a public-looking host that isn't a code host or registry.
fn website(candidate: &str) -> Option<String> {
    let url = Url::parse(candidate.trim()).ok()?;
    check_url(&url).ok()?;
    let host = url
        .host_str()?
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    if !host.contains('.')
        || NOT_A_WEBSITE
            .iter()
            .any(|blocked| host == *blocked || host.ends_with(&format!(".{blocked}")))
    {
        return None;
    }
    Some(url.to_string())
}

fn read_small(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 256 * 1024 {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn detect_website(root: &Path) -> Option<String> {
    let package = read_small(&root.join("package.json"))
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|json| json["homepage"].as_str().and_then(website));
    if package.is_some() {
        return package;
    }
    for name in ["CNAME", "public/CNAME", "docs/CNAME", "static/CNAME"] {
        let domain = read_small(&root.join(name))
            .and_then(|text| text.lines().next().map(|line| line.trim().to_string()))
            .filter(|domain| !domain.is_empty() && !domain.contains('/'));
        if let Some(found) = domain.and_then(|domain| website(&format!("https://{domain}"))) {
            return Some(found);
        }
    }
    let cargo = read_small(&root.join("Cargo.toml"))
        .and_then(|text| text.parse::<toml::Table>().ok())
        .and_then(|table| {
            let package = table.get("package").and_then(|value| value.get("homepage"));
            let workspace = table
                .get("workspace")
                .and_then(|value| value.get("package"))
                .and_then(|value| value.get("homepage"));
            package.or(workspace)?.as_str().and_then(website)
        });
    if cargo.is_some() {
        return cargo;
    }
    read_small(&root.join("pyproject.toml"))
        .and_then(|text| text.parse::<toml::Table>().ok())
        .and_then(|table| {
            let urls = table.get("project").and_then(|value| value.get("urls"));
            let from_urls = urls.and_then(|urls| {
                ["Homepage", "homepage", "Website", "website", "Home", "home"]
                    .iter()
                    .find_map(|key| urls.get(*key)?.as_str().and_then(website))
            });
            from_urls.or_else(|| {
                table
                    .get("tool")?
                    .get("poetry")?
                    .get("homepage")?
                    .as_str()
                    .and_then(website)
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page() -> Url {
        Url::parse("https://example.com/docs/index.html").unwrap()
    }

    fn urls(html: &str) -> Vec<String> {
        icon_links(html, &page())
            .into_iter()
            .map(|candidate| candidate.url.to_string())
            .collect()
    }

    #[test]
    fn icon_links_are_resolved_and_ranked() {
        let html = r#"<html><head>
            <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
            <LINK REL='icon' type="image/png" sizes="16x16" href="favicon-16.png" />
            <link rel=icon type=image/png sizes=32x32 href=/favicon-32.png>
            <link rel="stylesheet" href="/site.css">
            <link rel="mask-icon" href="/mask.svg">
            <link rel="shortcut icon" href="/favicon.ico?v=2&amp;x=1">
            <link href="/icon.svg" rel="icon" type="image/svg+xml">
        </head></html>"#;
        assert_eq!(
            urls(html),
            [
                "https://example.com/icon.svg",
                "https://example.com/favicon-32.png",
                "https://example.com/favicon.ico?v=2&x=1",
                "https://example.com/apple-touch-icon.png",
                "https://example.com/docs/favicon-16.png",
            ]
        );
    }

    #[test]
    fn non_web_icon_links_are_ignored() {
        let html = r#"<link rel="icon" href="data:image/png;base64,AAAA">
            <link rel="icon" href="javascript:alert(1)">
            <link rel="icon" href="file:///etc/passwd">
            <link rel="icon" href="//cdn.example.net/i.png">"#;
        assert_eq!(urls(html), ["https://cdn.example.net/i.png"]);
    }

    #[test]
    fn unterminated_tags_do_not_panic() {
        assert_eq!(
            urls("<link rel=\"icon\" href=\"/a.png"),
            ["https://example.com/a.png"]
        );
        assert!(urls("<link").is_empty());
        assert!(urls("<link =x rel=").is_empty());
        assert_eq!(
            urls("<link rel=icon href=/a.png"),
            ["https://example.com/a.png"]
        );
    }

    #[test]
    fn typed_addresses_become_web_urls() {
        assert_eq!(
            site_url("example.com").unwrap().as_str(),
            "https://example.com/"
        );
        assert_eq!(
            site_url(" http://example.com/a ").unwrap().as_str(),
            "http://example.com/a"
        );
        assert!(site_url("").is_err());
        assert!(site_url("ftp://example.com").is_err());
        assert!(site_url("file:///etc/hosts").is_err());
        assert!(site_url("https://user:pass@example.com").is_err());
    }

    #[test]
    fn only_public_addresses_are_fetched() {
        for private in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "255.255.255.255",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
        ] {
            assert!(!is_public(private.parse().unwrap()), "{private}");
        }
        for public in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public(public.parse().unwrap()), "{public}");
        }
    }

    #[tokio::test]
    async fn local_hosts_are_refused_before_connecting() {
        for url in [
            "http://127.0.0.1:8080/",
            "http://[::1]/",
            "http://localhost:3000/",
            "http://printer.local/",
            "http://169.254.169.254/latest/meta-data",
        ] {
            let error = get(Url::parse(url).unwrap()).await.unwrap_err();
            assert!(error.contains("isn't fetched"), "{url}: {error}");
        }
    }

    #[test]
    fn images_are_recognised_by_their_bytes() {
        assert_eq!(sniff_image(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(sniff_image(&[0, 0, 1, 0, 1, 0]), Some("image/x-icon"));
        assert_eq!(sniff_image(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(
            sniff_image(b"<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            Some("image/svg+xml")
        );
        assert_eq!(
            sniff_image(b"\xef\xbb\xbf <svg viewBox=\"0 0 1 1\"/>"),
            Some("image/svg+xml")
        );
        assert_eq!(sniff_image(b"<!doctype html><html><svg/></html>"), None);
        assert_eq!(sniff_image(b"GIF89a"), None);
    }

    #[test]
    fn websites_are_detected_from_project_files() {
        let root = std::env::temp_dir().join(format!("favicon-detect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("public")).unwrap();
        assert_eq!(detect_website(&root), None);

        std::fs::write(
            root.join("package.json"),
            r#"{"homepage": "https://github.com/acme/app#readme"}"#,
        )
        .unwrap();
        std::fs::write(root.join("public/CNAME"), "app.acme.dev\n").unwrap();
        assert_eq!(
            detect_website(&root).as_deref(),
            Some("https://app.acme.dev/")
        );

        std::fs::write(
            root.join("package.json"),
            r#"{"homepage": "https://acme.dev"}"#,
        )
        .unwrap();
        assert_eq!(detect_website(&root).as_deref(), Some("https://acme.dev/"));

        std::fs::remove_file(root.join("package.json")).unwrap();
        std::fs::remove_file(root.join("public/CNAME")).unwrap();
        std::fs::write(
            root.join("Cargo.toml"),
            "[workspace.package]\nhomepage = \"https://tool.example.org\"\n",
        )
        .unwrap();
        assert_eq!(
            detect_website(&root).as_deref(),
            Some("https://tool.example.org/")
        );

        std::fs::remove_file(root.join("Cargo.toml")).unwrap();
        std::fs::write(
            root.join("pyproject.toml"),
            "[project.urls]\nRepository = \"https://github.com/a/b\"\nHomepage = \"https://lib.example.io\"\n",
        )
        .unwrap();
        assert_eq!(
            detect_website(&root).as_deref(),
            Some("https://lib.example.io/")
        );

        std::fs::remove_dir_all(&root).unwrap();
    }
}
