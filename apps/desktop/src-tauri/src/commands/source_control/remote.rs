//! Reading a Git remote or a change request address into its host and repository path.

use super::HostKind;

/// A repository on a code host, as a Git remote names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Repository {
    /// Lowercase host name, with the port for HTTPS remotes. An SSH port is dropped
    /// because the host's API is not served there.
    pub host: String,
    /// `owner/name`, or `group/subgroup/name` on GitLab, without `.git`.
    pub path: String,
}

/// A change request address: its host's kind, the repository and the number.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ChangeRequestUrl {
    pub kind: HostKind,
    pub repository: Repository,
    pub number: u64,
}

fn segment(part: &str) -> bool {
    !part.is_empty()
        && !part.starts_with('-')
        && !part.starts_with('.')
        && part
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
}

fn host_name(host: &str) -> bool {
    !host.is_empty()
        && !host.starts_with('-')
        && host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-.:".contains(&c))
}

fn repository(host: &str, path: &str) -> Option<Repository> {
    let host = host.to_ascii_lowercase();
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let parts: Vec<_> = path.split('/').collect();
    (host_name(&host) && parts.len() >= 2 && parts.iter().all(|part| segment(part))).then(|| {
        Repository {
            host,
            path: path.into(),
        }
    })
}

/// The host and repository a Git remote URL points at: HTTPS, SSH or the SCP-like
/// `git@host:owner/name.git` form. Credentials in the URL are dropped.
pub(crate) fn parse_remote(url: &str) -> Option<Repository> {
    let url = url.trim();
    if let Some((scheme, rest)) = url.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        let (authority, path) = rest.split_once('/')?;
        let authority = authority.rsplit('@').next()?;
        let host = match scheme.as_str() {
            "https" | "http" => authority,
            "ssh" | "git+ssh" => authority.split(':').next()?,
            _ => return None,
        };
        return repository(host, path);
    }
    // SCP-like syntax: [user@]host:path, where the colon comes before any slash.
    let (authority, path) = url.split_once(':')?;
    // A Windows drive letter (`C:/repos/app`) is a local path, as Git reads it.
    if authority.contains('/') || authority.len() == 1 || path.starts_with("//") {
        return None;
    }
    repository(authority.rsplit('@').next()?, path)
}

/// Reads a GitLab merge request or Bitbucket pull request address. GitHub addresses
/// are read by the GitHub CLI path and return `None` here.
pub(crate) fn parse_change_request(url: &str) -> Option<ChangeRequestUrl> {
    let rest = url.strip_prefix("https://")?.trim_end_matches('/');
    let (host, path) = rest.split_once('/')?;
    let (kind, repo, number) = if let Some((repo, number)) = path.split_once("/-/merge_requests/") {
        (HostKind::Gitlab, repo, number)
    } else if host.eq_ignore_ascii_case("bitbucket.org") {
        let (repo, number) = path.split_once("/pull-requests/")?;
        (HostKind::Bitbucket, repo, number)
    } else {
        return None;
    };
    if number.is_empty() || !number.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let number = number.parse::<u64>().ok().filter(|number| *number > 0)?;
    let repository = repository(host, repo)?;
    if kind == HostKind::Bitbucket && repository.path.split('/').count() != 2 {
        return None;
    }
    Some(ChangeRequestUrl {
        kind,
        repository,
        number,
    })
}

/// The kind of host a repository lives on: a project's own choice, a host configured
/// in settings, then the public hosts by name. `None` for a host Jackalope does not know.
pub(crate) fn kind_of(
    host: &str,
    configured: &[(String, HostKind)],
    project: Option<HostKind>,
) -> Option<HostKind> {
    if project.is_some() {
        return project;
    }
    let host = host.to_ascii_lowercase();
    if let Some((_, kind)) = configured
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(&host))
    {
        return Some(*kind);
    }
    match host.as_str() {
        "github.com" => Some(HostKind::Github),
        "gitlab.com" => Some(HostKind::Gitlab),
        "bitbucket.org" => Some(HostKind::Bitbucket),
        _ => None,
    }
}

/// A host name someone typed in settings: a bare host with an optional port, or the
/// host of a URL they pasted.
pub(crate) fn configured_host(value: &str) -> Option<String> {
    let value = value.trim();
    let value = value
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(value);
    let host = value
        .split('/')
        .next()?
        .rsplit('@')
        .next()?
        .to_ascii_lowercase();
    (host_name(&host) && host.contains('.') && host.len() <= 253).then_some(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(host: &str, path: &str) -> Option<Repository> {
        Some(Repository {
            host: host.into(),
            path: path.into(),
        })
    }

    #[test]
    fn remotes_name_their_host_and_repository() {
        for (url, host, path) in [
            (
                "https://github.com/acme/shop.git",
                "github.com",
                "acme/shop",
            ),
            ("https://github.com/acme/shop", "github.com", "acme/shop"),
            ("git@github.com:acme/shop.git", "github.com", "acme/shop"),
            (
                "https://oauth2:secret@gitlab.com/group/sub/app.git",
                "gitlab.com",
                "group/sub/app",
            ),
            (
                "git@gitlab.com:group/sub/app.git",
                "gitlab.com",
                "group/sub/app",
            ),
            (
                "ssh://git@gitlab.example.com:2222/team/app.git",
                "gitlab.example.com",
                "team/app",
            ),
            (
                "https://GitLab.Example.com:8443/team/app/",
                "gitlab.example.com:8443",
                "team/app",
            ),
            (
                "https://ana@bitbucket.org/acme/web.git",
                "bitbucket.org",
                "acme/web",
            ),
            (
                "git@bitbucket.org:acme/web.git",
                "bitbucket.org",
                "acme/web",
            ),
            (
                "ssh://git@bitbucket.org/acme/web.git",
                "bitbucket.org",
                "acme/web",
            ),
        ] {
            assert_eq!(parse_remote(url), repo(host, path), "{url}");
        }
        for url in [
            "",
            "/srv/git/app.git",
            "file:///srv/git/app.git",
            "https://github.com/acme",
            "https://github.com/--upload-pack/x",
            "git@github.com:acme/../x.git",
            "C:/repos/app",
        ] {
            assert_eq!(parse_remote(url), None, "{url}");
        }
    }

    #[test]
    fn hosts_resolve_by_project_choice_then_settings_then_name() {
        let configured = vec![
            ("git.corp.example".to_string(), HostKind::Gitlab),
            ("github.corp.example".to_string(), HostKind::Github),
        ];
        assert_eq!(kind_of("github.com", &[], None), Some(HostKind::Github));
        assert_eq!(kind_of("GitLab.com", &[], None), Some(HostKind::Gitlab));
        assert_eq!(
            kind_of("bitbucket.org", &[], None),
            Some(HostKind::Bitbucket)
        );
        assert_eq!(
            kind_of("git.corp.example", &configured, None),
            Some(HostKind::Gitlab)
        );
        assert_eq!(
            kind_of("github.corp.example", &configured, None),
            Some(HostKind::Github)
        );
        assert_eq!(kind_of("git.unknown.example", &configured, None), None);
        assert_eq!(
            kind_of("git.unknown.example", &configured, Some(HostKind::Gitlab)),
            Some(HostKind::Gitlab)
        );
        assert_eq!(
            kind_of("github.com", &[], Some(HostKind::Gitlab)),
            Some(HostKind::Gitlab)
        );
    }

    #[test]
    fn change_request_addresses_are_read_strictly() {
        assert_eq!(
            parse_change_request("https://gitlab.com/group/sub/app/-/merge_requests/42"),
            Some(ChangeRequestUrl {
                kind: HostKind::Gitlab,
                repository: repo("gitlab.com", "group/sub/app").unwrap(),
                number: 42
            })
        );
        assert_eq!(
            parse_change_request("https://git.corp.example/team/app/-/merge_requests/7/")
                .map(|url| (url.kind, url.repository.host, url.number)),
            Some((HostKind::Gitlab, "git.corp.example".into(), 7))
        );
        assert_eq!(
            parse_change_request("https://bitbucket.org/acme/web/pull-requests/3"),
            Some(ChangeRequestUrl {
                kind: HostKind::Bitbucket,
                repository: repo("bitbucket.org", "acme/web").unwrap(),
                number: 3
            })
        );
        for url in [
            "https://github.com/acme/shop/pull/12",
            "http://gitlab.com/group/app/-/merge_requests/1",
            "https://gitlab.com/group/app/-/merge_requests/0",
            "https://gitlab.com/group/app/-/merge_requests/1/diffs",
            "https://gitlab.com/group/app/-/merge_requests/1 --yes",
            "https://gitlab.com/group/app/-/merge_requests/+1",
            "https://gitlab.com/-x/app/-/merge_requests/1",
            "https://example.com/acme/web/pull-requests/3",
            "https://bitbucket.org/acme/sub/web/pull-requests/3",
            "https://bitbucket.org/acme/web/pull-requests/3/diff",
        ] {
            assert_eq!(parse_change_request(url), None, "{url}");
        }
    }

    #[test]
    fn configured_hosts_accept_a_pasted_address() {
        assert_eq!(
            configured_host(" git.corp.example "),
            Some("git.corp.example".into())
        );
        assert_eq!(
            configured_host("https://Git.Corp.Example:8443/team/app"),
            Some("git.corp.example:8443".into())
        );
        for value in ["", "localhost", "-x.example", "git corp.example"] {
            assert_eq!(configured_host(value), None, "{value}");
        }
    }
}
