//! The prebuilt computer image that `.github/workflows/computer-image.yml`
//! publishes to GitHub Container Registry for linux/amd64.
//!
//! Each published image is tagged `<version>-<definition>`: the app version
//! and the digest of `resources/computer` that also names local images and
//! Agent37 templates ([`super::docker::image_tag`]). The app uses only the tag
//! matching both, so a build with a changed definition, or a version that was
//! never published, falls back to building the image itself.

use std::path::Path;

/// The registry repository, owned by the project's GitHub organization
/// (`Jackalope-Dev/jackalope`, lowercased as GHCR requires).
pub(crate) const REPOSITORY: &str = "ghcr.io/jackalope-dev/jackalope-computer";

/// A registry tag for `version` and `definition`; characters a tag cannot
/// hold (such as `+` in build metadata) become `-`, as in the workflow.
pub(crate) fn reference(version: &str, definition: &str) -> String {
    let tag: String = format!("{version}-{definition}")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("{REPOSITORY}:{tag}")
}

/// The published image for this app version and the bundled definition.
pub(crate) fn published(directory: &Path) -> Result<String, String> {
    let tag = super::docker::image_tag(directory)?;
    let definition = tag.rsplit(':').next().unwrap_or_default();
    Ok(reference(env!("CARGO_PKG_VERSION"), definition))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_follow_the_version_and_definition() {
        assert_eq!(
            reference("0.2.0", "a2510b669187"),
            "ghcr.io/jackalope-dev/jackalope-computer:0.2.0-a2510b669187"
        );
        assert_eq!(
            reference("0.2.0-beta.1+7", "abc"),
            "ghcr.io/jackalope-dev/jackalope-computer:0.2.0-beta.1-7-abc"
        );
    }

    /// The workflow computes the same digest; `scripts/release/computer-image.test.mjs`
    /// checks this fixture too.
    #[test]
    fn definition_digest_matches_the_publishing_workflow() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        for (name, body) in [
            ("Dockerfile", "FROM scratch\n"),
            ("start.sh", "#!/bin/sh\n"),
            ("agent.py", "print(1)\n"),
            ("protocol.json", "{}\n"),
        ] {
            std::fs::write(directory.join(name), body).unwrap();
        }
        assert_eq!(
            super::super::docker::image_tag(&directory).unwrap(),
            "jackalope-computer:d8ea7fb8a163"
        );
        assert!(published(&directory)
            .unwrap()
            .ends_with(&format!("{}-d8ea7fb8a163", env!("CARGO_PKG_VERSION"))));
        let _ = std::fs::remove_dir_all(&directory);
    }
}
