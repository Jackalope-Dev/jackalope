# Release automation

Use [RELEASE.md](RELEASE.md) for installed acceptance,
[SERVER-LAUNCH.md](SERVER-LAUNCH.md) for service operations, and the checked-in
[workflows](../.github/workflows) and [release scripts](../scripts/release) for
exact inputs. This document does not record live account configuration.

## Build, acceptance and publication

Rehearsals are unsigned trials, not distributable releases. Candidates require
reviewed source, matching versions, ready release notes and the signing inputs
required by their channel. Receipts identify source state, configuration and
artifact hashes. Accept the exact candidate before publication; do not substitute
different bytes under the same version.

- The direct installer path separates candidate preparation from manual R2
  publication. Publication validates artifacts before updating a channel manifest.
- The [cloud path](CRABNEBULA-RELEASE.md) supports Windows x64 preparation and
  unpublished drafts. Its rehearsal workflow does not publish releases.
- The [Store path](STORE-RELEASE.md) supports MSIX packaging and gated submission.
  Submission is not certification or proof of installed updates.

Retain detailed receipts privately and investigate uncertain remote writes before
retrying. Do not delete pending drafts or overwrite releases to make a retry pass.

## Configuration and trust

Keep signing/publication switches disabled until their acceptance gates pass.
Configure credentials in CI secrets; public variable names and verification keys
are safe to document, secret values are not.

Windows publisher signing and Tauri updater signing are separate. Preserve the
updater key trusted by installed clients and maintain a secure recovery backup.
Never regenerate it simply because CI fails. Store updates follow the Store's
delivery model rather than the direct installer's controls.

Use narrowly scoped credentials and protected release environments. Anyone able
to alter trusted release workflows must be trusted with their credentials.
Review permissions and public-repository triggers before allowing untrusted
branches or pull requests to run release jobs.

Website/service deployment is separate from desktop publication. Choose one
controller per Worker. Keep optional Actions deployments disabled when another
controller owns the environment. Deployment hooks are credentials.

## GitHub protections

Inspect repository protections with an authenticated maintainer's GitHub CLI:

```powershell
node scripts/security/github.mjs --repo OWNER/REPOSITORY --reviewer MAINTAINER_LOGIN
```

Replace the placeholders with the target repository and its release reviewer.
For a public repository containing the reviewed protection script, add `--apply` to
configure branch checks and review, release-environment approval, immutable Action
references, read-only default workflow tokens, external-contributor workflow
approval, secret scanning and private vulnerability reporting. The command never
changes visibility or enables individual release workflows. GitHub plan restrictions
can prevent these protections on private repositories.

The single-maintainer policy permits administrator branch bypass and manual
approval of one's own deployment. Other writers require a reviewed pull request;
release jobs still require an explicit environment approval. Revisit those
exceptions when adding maintainers. Check the configured check names after CI
actually runs and keep them aligned with the workflow jobs.

Store signing keys, publication tokens and deployment hooks in the corresponding
`cloud-beta`, `cloud-stable`, `store-beta` or `store-stable` environment. Provision
credentials from private storage and verify the environment secret names. When
migrating repository-level secrets, remove those copies after verification.
GitHub cannot export an existing secret value.
Keep release workflows disabled until credentials, branch restrictions and
reviewers have been checked. Credential-consuming steps receive only the inputs
they need; dependency installation and test steps must not receive those secrets.

## Required evidence

Checks must actually execute and pass; an empty, skipped or blocked run is not
evidence. Verify candidate hashes, publisher signatures and updater signatures,
then test clean installation, real execution, saved-data recovery and an
older-to-newer update in an isolated profile. Validate service readiness and
downloaded bytes independently. Keep deployment state and receipts outside public
source. See [platform requirements](CROSS-PLATFORM-RELEASES.md).
