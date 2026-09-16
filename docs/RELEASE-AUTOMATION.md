# Release automation

This is the maintainer entry point for desktop releases. Windows uses Microsoft
Store MSIX; macOS and Linux use CrabNebula installers and update feeds. GitHub Actions
builds and verifies both delivery paths from the same version and release notes.
Azure signing is not required for the Store path. See [signing setup](CRABNEBULA-RELEASE.md),
[installed acceptance](RELEASE.md) and [platform requirements](CROSS-PLATFORM-RELEASES.md).
These instructions describe the workflow, not live enrollment or release acceptance.

## Branches and version preparation

`master` is ongoing development and never triggers desktop publication. `beta`
feeds prereleases; `stable` feeds production releases. CI runs on all three branches.
Keep committing and pushing development to master while a beta or stable candidate
is being tested. Release branches advance only when a maintainer delivers a reviewed
release cut; they do not automatically follow master.

Prepare a release from the repository root:

```powershell
pnpm release:cut beta patch
# Later, promote the beta snapshot to stable:
pnpm release:cut stable patch
# Select an earlier tested beta snapshot explicitly:
pnpm release:cut stable patch store-beta/v0.1.1
```

The beta default source is fetched `origin/master`; stable defaults to fetched
`origin/beta`. An optional source branch, tag or SHA must belong to fetched master,
beta or stable history. Prefer the exact tested beta SHA/tag if beta has advanced.
A release cut fetches origin and tags, creates `.worktrees/release-CHANNEL-VERSION`
on `release/CHANNEL/VERSION` from the destination branch, and merges the selected
source with `--no-commit --no-ff`. The starting development checkout can have local
work: only committed source enters the cut. Both source and destination SHAs are
printed for review. The destination branch and remote remain unchanged.

The command chooses the next patch, minor, major or explicit version above all
fetched channel/development versions and reserved Cloud/Store tags. It updates the
root/desktop package versions, Tauri configuration and native package/lock entry,
and creates draft `releases/VERSION.md`. Numeric `major.minor.patch` versions are
shared across platforms; beta/stable are channels, not version suffixes. Stable
gets a new version so installed Store beta packages can upgrade to stable.
Finish reviewing and pushing one release cut before preparing the next channel's
cut: an uncommitted local preparation does not reserve a version for other checkouts.

In the printed worktree:

1. Review the merged source and version changes. Replace release-note placeholders,
   use an appropriate date and set `Status: ready`.
2. Run `pnpm install --frozen-lockfile`, `pnpm verify` and `pnpm check:secrets`.
3. Commit the reviewed result yourself, including the merge and version changes.
4. Push `HEAD:beta` or `HEAD:stable` as an administrator, or push the preparation
   branch and open a PR to that release branch. Use a merge commit for release-cut
   PRs to retain source ancestry. A destination that advanced requires reconciliation
   and fresh verification; never force push it.
5. Follow **Store release** and **Cloud release** in Actions. Approve stable publication
   after the builds and required checks complete. Store certification finishes separately.

The helper never commits, pushes or creates release tags. Git stages the source
merge; version edits and notes still need inclusion in the maintainer's commit.
If a merge conflicts, it leaves the isolated worktree for resolution and prints
`pnpm release:prepare VERSION --merged`. Resolve and stage conflicts first, preserving
both branches' code and a consistent existing version across the five version files,
then run that command to apply the new version. It requires a pending resolved merge.
Do not rerun `release:cut` into an existing preparation branch/worktree.

For a hotfix, cut from `origin/stable`, make only the needed fix in that worktree,
and follow the same review and verification process. Merge reviewed release fixes
back into master and beta, including version metadata, before the next cut. This
keeps fixes and ancestry flowing forward and reduces later version conflicts.
For an already clean release branch, `git fetch origin --prune --tags` followed by
`pnpm release:prepare patch` prepares only the version and notes. It refuses master.
Ordinary commits never silently bump versions. Publication workflows create immutable
channel/version tags only after their source and artifact checks pass.

Agents can use the repository [release skill](../.agents/skills/jackalope-release/SKILL.md)
for requests such as “prepare the next beta from master” or “promote this tested beta
SHA to stable.” It follows the same commands and leaves commits to the maintainer.

## Windows Store releases

Set `RELEASE_DISTRIBUTION=store` and configure Cloud targets to
`["darwin-aarch64","darwin-x86_64","linux-x86_64"]`. Cloud builds exclude Windows in
this mode. Existing EXE tooling remains available for separately configured direct
distribution; it is not needed for Windows Store signing or updates.

**Store release** follows the same release-branch pushes as Cloud:
`beta` selects the tester flight and `stable` selects the base Store product. Manual
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

**Cloud release** runs on pushes to beta or stable
when `CLOUD_RELEASE_ENABLED=true`. Draft notes skip automatic releases. Manual runs
are also available. Automatic runs skip versions whose channel tag already exists;
use publication recovery for an interrupted tagged attempt. Manual runs
select rehearsal, candidate, draft or publish; the selected branch determines the
channel. The optional Windows-only selection supports initial installer testing.

The default Cloud matrix builds macOS Apple Silicon and Intel DMGs plus app
updater archives, and Linux x64 AppImage. Windows x64 NSIS remains available only
for separately configured direct distribution with `RELEASE_DISTRIBUTION=cloud`. AppImage is the supported Linux
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
and permits only beta/stable. Stable publication uses `cloud-stable`, restricted to
stable and requiring the release owner's approval. This puts the stable approval
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
| `RELEASE_DISTRIBUTION=store` | Windows uses Store; Cloud handles Mac/Linux. `cloud` additionally permits direct Windows EXE builds. Legacy R2 requires `legacy` and remains disabled |
| `CLOUD_RELEASE_TARGETS` | JSON array of intended targets; the Store configuration contains the three Mac/Linux targets |
| `CLOUD_SIGNING_READY` | Optional direct Windows Azure signing is configured; unnecessary for Store/Mac/Linux |
| `APPLE_SIGNING_READY` | Developer ID signing and notarization are configured |
| `CLOUD_DRAFT_UPLOAD_ENABLED` | Permit validated candidates to be uploaded |
| `CLOUD_PUBLISH_ENABLED` | Permit publication, including manually dispatched beta trials |
| `CLOUD_ACCEPTED_TARGETS` | JSON array of targets with completed installed acceptance; must exactly match a normal publication's target set |
| `CLOUD_BETA_TEST_TARGETS` | Explicit initial update-trial target set; permits manual beta publication before older-to-newer acceptance, never stable or automatic publication |
| `CLOUD_RELEASE_ENABLED` | Enable publication triggered by a ready release commit |

Target names are `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64` and
`linux-x86_64`. Empty acceptance/trial arrays permit no publication. For an initial
Cloud trial, configure the intended/trial arrays to the Mac/Linux targets being tested and select configured candidates. Windows Store trials use
the separate Store flags above. Expand the intended and accepted Cloud sets
together after the remaining platforms pass their installed checks.

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
removes Windows from Cloud target/acceptance lists and preserves Unix target choices. It creates missing beta/stable branches from current remote master; existing branches
are never reset. Bootstrap branches are not evidence of a tested release. Existing enablement flags and secrets are preserved.
The command does not change visibility or commit code. For initial migration, keep
publication gates off, commit/push the new workflows to master, apply setup, then
prepare the first beta cut. Ensure beta and stable receive the new workflow files
before enabling automation. Missing gates default off; existing true gates are not
silently disabled by setup.

All three branches require current Windows/Linux/macOS/security checks, reviewed PRs for
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
