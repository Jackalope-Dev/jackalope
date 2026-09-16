# Release automation

This is the maintainer entry point for desktop releases. Windows uses Microsoft
Store MSIX; macOS and Linux use CrabNebula installers and update feeds. GitHub Actions
builds and verifies both delivery paths from the same version and release notes.
Azure signing is not required for the Store path. See [signing setup](CRABNEBULA-RELEASE.md),
[installed acceptance](RELEASE.md) and [platform requirements](CROSS-PLATFORM-RELEASES.md).
These instructions describe the workflow, not live enrollment or release acceptance.

## Branches and version preparation

`beta` supplies the beta channel; `master` supplies stable. Merge reviewed changes
into beta for testing, then integrate the tested changes into master for stable.
Keep fixes flowing between the branches through reviewed merges. There is no
separate stable branch. Each published channel version is immutable.

From a clean release branch, prepare the next version:

```powershell
pnpm release:prepare patch
# Or: pnpm release:prepare minor, major, or an explicit higher version.
```

The command updates root/desktop package versions, Tauri configuration and the
native package/lock entry, and creates `releases/VERSION.md`. It does not stage,
commit, push or create a tag. Review the version diff, replace the note placeholders,
set an appropriate date and `Status: ready`, run `pnpm verify`, then commit and push.
Versioning is explicit; ordinary commits do not silently bump or publish versions.
Only numeric `major.minor.patch` versions are supported. Beta/stable are separate
channels, not version suffixes. A new beta iteration needs a higher numeric version;
the same tested version can subsequently be built for Cloud stable. Store beta
testers need a higher stable version to move from their installed flight package;
use a new patch version when promoting tested changes to master.

## Windows Store releases

Set `RELEASE_DISTRIBUTION=store` and configure Cloud targets to
`["darwin-aarch64","darwin-x86_64","linux-x86_64"]`. Cloud builds exclude Windows in
this mode. Existing EXE tooling remains available for separately configured direct
distribution; it is not needed for Windows Store signing or updates.

**Store release** follows the same ready release-note/root-package pushes as Cloud:
`beta` selects the tester flight and `master` selects the base Store product. Manual
runs select rehearsal, candidate or submission; the branch determines the channel.
Candidate mode builds the real-identity unsigned MSIX and upload archive without
submitting. Microsoft signs the certified package. Stable approval occurs after
packaging, in `store-stable`; beta submission uses `store-beta` without a reviewer.
Neither environment allows feature branches or release tags to access its secrets.

`STORE_SUBMISSION_ENABLED=true` permits submissions after Partner Center setup.
Before installed acceptance, `STORE_BETA_TEST_ENABLED=true` permits only manual beta
submissions for the two-version trial. `STORE_ACCEPTED=true` permits stable and
automatic submission; set it only after installed checks pass. Finally enable
`STORE_AUTOMATION_ENABLED=true` and clear the temporary beta trial flag. All four
flags default off. A ready release commit then starts both Store and Cloud workflows.
Their certification/publication completes independently; this is not an atomic
cross-platform rollout.

Submission checks the package/archive hashes, exact source/channel, ready notes and
required source CI checks before reserving `store-beta/vVERSION` or
`store-stable/vVERSION` and calling Partner Center. Automatic runs skip reserved
versions. Retained artifacts include `upload.zip`, the MSIX and receipts for 30 days.
After a failure, rerun only the failed submission job to reuse the original bytes.
A pending or uncertain Partner Center submission stops retries for inspection;
never delete it or move a release tag to force a retry. A successful workflow means
submitted for certification, not yet published. See [Store setup and acceptance](STORE-RELEASE.md).

## Cloud build and release

**Cloud release** runs on release-note/root-package changes pushed to beta or master
when `CLOUD_RELEASE_ENABLED=true`. Draft notes skip automatic releases. Manual runs
are also available. Automatic runs skip versions whose channel tag already exists;
use publication recovery for an interrupted tagged attempt. Manual runs
select rehearsal, candidate, draft or publish; the selected branch determines the
channel. The optional Windows-only selection supports initial installer testing.

The configured matrix builds Windows x64 NSIS, macOS Apple Silicon and Intel DMGs
plus app updater archives, and Linux x64 AppImage. AppImage is the supported Linux
in-app update path; OS-managed package upgrades and Store updates are separate.
Every candidate runs repository verification and native account-access tests.
Signing credentials are passed only to signing/build steps, not dependency installation
or test steps. Every platform supplies a receipt with source, version, channel,
configuration and artifact hashes. Candidate artifacts are retained for 30 days.

A publication job runs only after every selected build succeeds. It checks the
complete target set, shared source/notes/updater key, Windows publisher signature,
all required source checks, remote asset bytes and platform/signature metadata.
It then reserves `beta-vVERSION` or `stable-vVERSION` at the exact source commit,
publishes the complete Cloud draft, and checks each public update feed and its bytes.
Tags are not moved or deleted. A reserved tag alone does not prove publication.
CrabNebula is the release catalog; this workflow does not create GitHub Releases.

Beta builds/publication use the `cloud-beta` environment without a manual approval.
This environment also supplies shared signing credentials to stable candidate jobs
and permits only beta/master. Stable publication uses `cloud-stable`, restricted to
master and requiring the release owner's approval. This puts the stable approval
after all builds, rather than before each platform build.

To publish an already tested candidate or draft, run **Publish Cloud candidate**
from its original branch and enter its successful Cloud release run ID. This
checks run provenance, branch ancestry and all artifact receipts, and reuses the
original bytes. Do not rebuild a draft to promote it. Beta-to-stable uses a stable
candidate build because the packaged default channel changes; inspect that candidate.

## Enablement and first update test

Keep these repository variables disabled until their prerequisites pass:

| Variable | Purpose |
| --- | --- |
| `RELEASE_DISTRIBUTION=cloud` | Select the Cloud path; legacy R2 workflows require `legacy` and remain disabled |
| `CLOUD_RELEASE_TARGETS` | JSON array of intended targets; the Store configuration contains the three Mac/Linux targets |
| `CLOUD_SIGNING_READY` | Windows Azure signing is configured |
| `APPLE_SIGNING_READY` | Developer ID signing and notarization are configured |
| `CLOUD_DRAFT_UPLOAD_ENABLED` | Permit validated candidates to be uploaded |
| `CLOUD_PUBLISH_ENABLED` | Permit publication, including manually dispatched beta trials |
| `CLOUD_ACCEPTED_TARGETS` | JSON array of targets with completed installed acceptance; must exactly match a normal publication's target set |
| `CLOUD_BETA_TEST_TARGETS` | Explicit initial update-trial target set; permits manual beta publication before older-to-newer acceptance, never stable or automatic publication |
| `CLOUD_RELEASE_ENABLED` | Enable publication triggered by a ready release commit |

Target names are `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64` and
`linux-x86_64`. Empty acceptance/trial arrays permit no publication. For a
Windows-only initial trial, select Windows-only candidates and configure the
intended/trial target arrays to `["windows-x86_64"]`. Expand the intended and
accepted sets together after the remaining platforms pass their installed checks.

First validate a signed candidate and authenticated unpublished draft. Then allow
manual beta trial publication and test two increasing versions with the same app
identity/updater key. Record clean installation, real execution, saved-data recovery,
account lifecycle and older-to-newer update behavior privately. After acceptance,
set the accepted target list, clear the temporary beta trial list, and enable the
automatic trigger. Beta asset URLs are public; account approval still gates execution.
See the [installed update procedure](CRABNEBULA-RELEASE.md#test-an-installed-update).

## Recovery

If publication fails, retain the successful build artifacts and rerun only failed
jobs. Alternatively promote a successful candidate/draft run. Do not rerun successful
build jobs: signing/notarization can change bytes while leaving the version unchanged.

Retries identify the existing channel/version and compare the source/artifact digest
in its notes before writing. Existing assets must match metadata and downloaded
hashes; missing assets can be uploaded. A lost publish response is reconciled by
reading remote status. Foreign drafts, extra assets, changed bytes, moved tags and
newer channel versions stop publication. An uncertain remote state requires operator
inspection, not deletion or overwrite. Preserve candidates outside expiring Actions
artifacts if a trial will exceed retention. Publish a higher-version fix for a bad
release; never repoint an existing version to replacement bytes.

## GitHub configuration

```powershell
pnpm release:setup
pnpm release:setup --apply
```

The first command audits; `--apply` configures the release branches/protections,
branch-scoped environments, default-off missing gates and immutable tag rules,
and disables the two legacy R2 workflows. It selects Store Windows distribution,
removes Windows from Cloud target/acceptance lists and preserves Unix target choices. It creates beta from current remote master
only when beta does not exist. Existing enablement flags and secrets are preserved.
The command does not change visibility, commit code or deploy a release.

Both branches require current Windows/Linux/macOS/security checks, reviewed PRs for
ordinary writers and resolved conversations; force pushes and branch deletion are
blocked. The single-maintainer policy retains administrator branch bypass and permits
approval of one's own stable deployment. Publication independently requires successful
source checks even when a branch administrator bypassed merge checks. Revisit review
exceptions when adding maintainers. Workflow actions are pinned and tokens default
to read-only access. Do not give untrusted code access to release environments.

## Website and services

Desktop publication does not deploy the server or automatically advertise unaccepted
platforms. Keep one deployment controller per Worker; leave optional Actions deployment
disabled when Cloudflare Git builds own it. Set `VITE_WINDOWS_STORE_URL` and server `ACCESS_STORE_URL` to the accepted Store
product link. Website Mac/Linux download variables must identify accepted Cloud artifacts; review any Store URL override before changing distribution.
The legacy website synchronization script reads the R2 feed and must not be used as
a Cloud catalog synchronizer. See [server operations](SERVER-LAUNCH.md).
