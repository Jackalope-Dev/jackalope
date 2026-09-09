# Windows releases and updates

This is the maintainer guide for preparing Jackalope for distribution.
It covers the first release, subsequent updates, validation, publication, and
failure recovery. Read [STATUS.md](STATUS.md), [TODO.md](TODO.md), and
[BACKEND.md](BACKEND.md) first.

## 1. Scope, authority, and present state

The initial supported target is **Windows x64**, using locally installed,
signed-in Codex and Claude Code CLIs. Grok is implemented but needs the same
release trial before being advertised as supported. macOS/Linux and remote pairing remain outside the validated Windows release target.
Local recurring execution and codebase mapping are implemented; see FEATURE-COMPLETION.md
for their verification and limits.

Prepare reviewable artifacts before publication. Protect signing and publication
credentials separately from pull-request verification.

| Area | Current implementation | Still required |
| --- | --- | --- |
| Packaging | Tauri NSIS EXE and WiX MSI builds, branded installers | Clean-machine trials and signed final artifacts |
| Update client | Trusted key/HTTPS source from build config; automatic checks; manual installation; progress and recovery | Configure real key/feed; exercise installed old-to-new upgrades |
| Release scripts | Local signing/configuration, Authenticode checks, checksums, EXE/MSI manifest generation | Run with real credentials and validate downloaded bytes |
| CI | `.github/workflows/verify.yml`: frontend/native tests and unsigned NSIS artifact | Successful CI run, separate protected signing/publication setup |
| Hosted services | Workers/D1 telemetry/feedback and private R2 update hosting implemented locally | Deployment acceptance via SERVER-LAUNCH.md; desktop telemetry/feedback integration remains separate |

Inspect the candidate revision, local diff and remote before releasing. An old
installer is not proof of current source behavior; never publish an artifact
merely because it exists in target/.

## 2. Start here and record the candidate

Run from the repository root in PowerShell. Commands in this guide are preparation
instructions, not a record that a future release has passed them.

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git worktree list --porcelain
git remote -v
node --version
pnpm --version
rustc --version
cargo --version
git --version
```

Read local `AGENTS.md` instructions and the `jackalope-workflow` skill. Preserve
unrelated drafts. If parallel work is still running, coordinate a stable candidate
before building release artifacts. A dirty checkout is acceptable for a local
trial if its exact diff is recorded; public artifacts require a maintainer-reviewed,
reproducible source revision.

Copy [RELEASE-RECORD-TEMPLATE.md](releases/RELEASE-RECORD-TEMPLATE.md) to
a private release-record location outside the repository. Fill in source identity,
intended previous version, scope, decisions and unresolved gates. Keep operational
records, logs and screenshots private; publish user-facing changes in release notes.
Inspect other worktrees without discarding unfinished work when selecting a candidate.

## 3. Resolve the release inputs

Fill these in the release record before a distribution build. Example URLs are
illustrations; neither the domain nor repository is a configured service.

| Input | Required decision / invariant |
| --- | --- |
| Version | Stable `major.minor.patch`, higher than the installed release; the current manifest script rejects prerelease suffixes |
| Source revision | Owner-reviewed commit and any explicitly documented local trial patch |
| Supported scope | Windows x64, selected adapters, minimum Windows version supported by actual trials |
| Release repository/host | Public unauthenticated downloads; use a separate public distribution repository if source stays private |
| Stable update URL | HTTPS JSON URL embedded in all releases, `https://api.jackalope.dev/updates/stable/latest.json` |
| Artifact directory | Immutable version directory, `https://api.jackalope.dev/updates/releases/v<version>` |
| Windows signer | Installed certificate thumbprint, access to its private key, and provider's HTTPS timestamp URL |
| Updater signer | Durable private key/password reference in the signing environment and matching public-key file |
| Trial feed | Separate controlled HTTPS feed, reachable by trial clients, with the same protocol but no effect on production users |
| Operations | Release owner, support destination, hosting access, key custodian, incident contact, evidence retention location |

The current configuration assumes certificate-store signing on Windows. If the
chosen signing service requires an HSM/cloud-specific command rather than the
existing thumbprint flow, implement and validate that integration before calling
this runbook complete. Do not replace it with an unsigned build.

Release delivery needs static hosting, not an account system, database, or remote
execution server. The selected Cloudflare host is documented in
[SERVER-LAUNCH.md](SERVER-LAUNCH.md), including exact R2 upload order and recovery.
See [BACKEND.md](BACKEND.md) for the separate remote backend roadmap.

## 4. Prepare the Windows build/signing machine

Use Windows x64, a supported Node 24 runtime (matching current CI), and the pnpm
version in root `package.json`. Install Git, Rust
with the MSVC toolchain, Visual Studio C++ build tools/Windows SDK, and WebView2.
Record exact versions. Packaging may download WiX/NSIS tooling on its first run;
allow for that in a clean runner. Current platform prerequisites are documented by
[Tauri](https://v2.tauri.app/start/prerequisites/).

Use the existing lockfiles; do not upgrade dependencies as part of a routine
release. Keep the pinned `portable-pty` version until an upgrade passes native
process and cancellation checks. Use an absolute `CARGO_TARGET_DIR` if overriding Cargo output,
or leave it unset. Record the target directory so stale artifacts cannot be mixed.

```powershell
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'Baseline build failed.' }
```

### Signing material: first setup only

Windows Authenticode and Tauri update signing serve different purposes. Both are
required by this project's release gate. The public updater key is embedded in
the app; never embed the private key. Back up signing material through the owner's
approved secret store before the first release. Do not rotate the updater key on
a routine update: existing clients trust the key they were built with.
[Tauri signing requirements](https://v2.tauri.app/plugin/updater/).

If no updater key exists and its creation is authorized, run this interactively
outside the repository, supplying an actual secure location. The CLI prompts for
password input. Do not use `--force`, print key contents, paste passwords into a
command, or regenerate an existing production key.

```powershell
$releaseKeyFile = 'D:\SecureSigning\jackalope-updater.key'
if (Test-Path -LiteralPath $releaseKeyFile) { throw 'Reuse the existing release key.' }
pnpm tauri signer generate -w $releaseKeyFile
if ($LASTEXITCODE -ne 0) { throw 'Updater key generation failed.' }
```

Use the generated public-key file's **contents**, not its filename, in release
configuration. In the signing job, securely inject `TAURI_SIGNING_PRIVATE_KEY`
(path or contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when applicable.
The scripts read process environment variables, not a repository `.env` file.
Do not log either value or dump the environment. Use a short-lived signing session
and clear its secret variables afterward. For Windows certificate setup follow
[Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/)
and the selected provider's current instructions.

## 5. Version and prepare the source

Update these files together, preserving surrounding formatting:

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`
- The root package version if maintaining the current single product version.

Refresh the root package entry in `apps/desktop/src-tauri/Cargo.lock` using Cargo,
not a blanket dependency upgrade. After editing the version, `cargo check
--offline --manifest-path apps/desktop/src-tauri/Cargo.toml` can refresh the local
package entry when cached dependencies are present. Inspect the lockfile diff;
resolve missing dependencies normally if offline resolution cannot complete.
Then run all locked checks below.

Search for user-visible hardcoded version text and reconcile it with the actual
native version. Keep the privacy disclosure consistent with the native user-agent,
which reads `CARGO_PKG_VERSION`.

Keep `identifier: dev.jackalope.desktop`, installer identity, and compatible data
locations stable. Review migrations and rollback limitations before changing
storage schemas. Readable task history must survive upgrades. Do not apply Reset
to fix an upgrade. Use release notes written for users: improvements, fixes,
behavior changes, known limitations, and any required migration steps.

## 6. Validate and build

Run each command to completion and retain its exit code/log. Do not run overlapping
release builds into the same output directory.

```powershell
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
pnpm --filter '@jackalope/desktop' test
if ($LASTEXITCODE -ne 0) { throw 'JavaScript tests failed.' }
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features
if ($LASTEXITCODE -ne 0) { throw 'Native tests failed.' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Diff whitespace check failed.' }
```

Run Biome on changed frontend files and relevant native tests for any new fix.
The general test script includes visual-state, update-store, release-config, and
manifest tests. Opt-in installed-account checks are excluded from the ordinary
suite; a passing suite does not exercise actual provider accounts. Record the
checks and skipped coverage for the candidate being released.

For an unsigned local packaging trial only:

```powershell
pnpm tauri build --bundles 'nsis,msi'
if ($LASTEXITCODE -ne 0) { throw 'Trial packaging failed.' }
```

For the signed distribution build, fill in real approved inputs. The certificate
thumbprint is public metadata; secrets must already be injected into the process.
Use a public-key file, never the private-key file, for `UpdaterPublicKey`.

```powershell
$releaseArguments = @{
    UpdateUrl = 'https://RELEASE-HOST/stable/latest.json'
    UpdaterPublicKey = (Get-Content -Raw -LiteralPath 'D:\SecureSigning\jackalope-updater.key.pub').Trim()
    CertificateThumbprint = 'REPLACE_WITH_40_HEX_CHARACTER_CERTIFICATE_THUMBPRINT'
    TimestampUrl = 'https://TIMESTAMP-SERVICE'
    ArtifactBaseUrl = 'https://RELEASE-HOST/releases/v0.2.0'
    ReleaseNotesFile = (Resolve-Path 'docs/releases/0.2.0-notes.md').Path
}
./scripts/build-signed-release.ps1 @releaseArguments
```

The script runs checks, creates `output/release/tauri.release.json`, builds both
installers, verifies their Authenticode status/signer, requires `.sig` files, and
writes checksums and the manifest. It throws on failure and never uploads anything.
Do not publish outputs from a failed invocation. On a successful default build:

| Output | Path relative to root |
| --- | --- |
| NSIS installer and signature | `apps/desktop/src-tauri/target/release/bundle/nsis/Jackalope_<version>_x64-setup.exe` and adjacent `.exe.sig` |
| MSI installer and signature | `apps/desktop/src-tauri/target/release/bundle/msi/Jackalope_<version>_x64_en-US.msi` and adjacent `.msi.sig` |
| Update manifest | `output/release/latest.json` |
| Installer SHA-256 values | `output/release/checksums.json` |
| Build configuration | `output/release/tauri.release.json` — retain with build evidence; not a required public asset |

The manifest contains version, notes, publication timestamp, and
`windows-x86_64-nsis` / `windows-x86_64-msi` entries with artifact URL and signature
contents. It intentionally preserves the client's installation type. It does not
contain a signing private key. Signature-file syntax validation in the generator
is **not** cryptographic verification; actual signature acceptance must be exercised
by the updater. Do not hand-edit signatures or replace installers after signing.

The standalone manifest command, for verified existing signed artifacts, is:

```powershell
node scripts/update-manifest.mjs $releaseVersion $artifactBaseUrl $notesFile $nsisFile $msiFile $manifestFile
if ($LASTEXITCODE -ne 0) { throw 'Manifest generation failed.' }
```

All six variables must identify the same reviewed release. Generated artifacts
need durable retention outside ignored `output/`/`target/` before another build.

## 7. Installed-app acceptance matrix

Use a disposable Windows VM/user profile and ordinary trial repositories, not the
owner's working projects. For process-kill, corrupt-storage, read-only, and disk-full
trials use VM snapshots or dedicated disposable volumes. Do not run destructive
fault injection against a real profile. Native task files normally live beneath
the app data directory in `task-runs-v1`; frontend state also lives in WebView
storage. Back up both, plus repositories, before migration tests. Copying only
one task JSON is not a complete user backup. `JACKALOPE_PROFILE_DIR` is an absolute
profile override for controlled trials; verify the same profile is used after
installer relaunch. Debug-only `JACKALOPE_TEST_DATA_DIR` is not a release override.

Each row needs the exact candidate, machine, steps, observation, and evidence.
A browser fixture proves UI behavior only. A build proves compilation/packaging,
not a clean install, real agent execution, or signed upgrade.

| Gate | Exercise | Required result |
| --- | --- | --- |
| Installation | Fresh Windows user; EXE and MSI separately; start, quit from tray, uninstall/reinstall | Starts without developer tools; no unintended data removal; required runtime/elevation behavior understood |
| First task | Existing CLI sign-in; add repo; isolated task; question; output; checks; review; integration | Completes without coaching; correct project/account/branch throughout |
| Git compatibility | `main`, `master`, custom branch; spaces/Unicode; dirty tree; changed target; conflict; missing identity | Clear failure/recovery; never overwrite unrelated changes |
| Accounts | Two real accounts; concurrent tasks; switch default; continuation; deleted profile; revoked credentials; replace credentials in same directory | Correct identity retained or explicit rejection; no silent cross-account fallback |
| Recovery | Stop during launch/run; terminate app; verify descendants; restart; deliberate continuation | No duplicate replay or orphaned contained processes; output/source preserved; legacy interrupted state handled honestly |
| Checks | Pass/fail/timeout; large output; changed files during/after check; combined integration result | Failed/stale required checks block integration; combined-result verification has its own evidence |
| Persistence | Prior profile upgrade; corrupt history; read-only/full volume; retry and recovery copy; large history | Last checkpoint survives; unsaved warning truthful; no silent queue replacement; copies not advertised as automatic restore |
| Worktree cleanup | Clean merged tree; dirty/ignored files; stale refs; active task; nested/locked tree | Only proven safe trees removed; source branches/history retained; rejected removal preserves files |
| Security | Packaged CSP; bridge auth/scope; tools/credentials; updater signatures | No insecure bypass, leaked secrets, or unsupported remote-execution claim |
| Support/privacy | Preview/copy report; inspect actual network activity | No automatic feedback, prompt/path/output upload, or false telemetry disclosure |
| Accessibility | Keyboard-only setup/work/review; screen reader; high DPI; reduced motion; 960×640 and 1280×840 in both themes | Reachable controls, readable content, visible focus, Escape/focus return |
| Performance | Cold start; idle; running agent; large diff/history; WebView/descendant accounting | Repeatable measurements and agreed budgets; no unexplained regressions |

`scripts/measure-desktop.ps1 -AppProcessId <pid>` samples process-tree memory and
cumulative CPU. Record hardware, scenario, duration and descendant coverage.
Working set is not startup latency. Existing Vite ResizeObserver warnings during
browser resizing are not evidence of acceptable packaged performance.

### Signed update rehearsal — both installation types

Before the first public release, create two distinct trial versions on a separate
feed. Install the older signed version, then offer the newer one. Later releases
must also upgrade from the actual previously supported public versions. Use the
same signer/public key and stable feed within that trial lineage. Do not contaminate
the public feed with rehearsal versions.

1. Create representative tasks, saved preferences, account bindings, and a reviewed
   worktree in the old version. Record hashes/state. Quit and relaunch to verify
   the baseline actually persists.
2. Upload the candidate artifacts to the trial host and then its manifest. Confirm
   both download URLs return exact bytes matching recorded checksums.
3. Open the old app: the automatic check should occur shortly after the workspace
   opens; confirm notes and version. Opt out, restart, and verify no automatic check.
   Manual checking must still work. Later dismisses the notice for that session and
   version; Settings → Updates & support keeps the update accessible.
4. While a task is active/interrupted or history is unsaved, try installation.
   It must be blocked. Resolve the condition, choose Install, inspect progress,
   and verify new work/integration cannot race installation.
5. After installer completion/reopen, inspect the installed version and repeat a
   normal task/check/review journey. Confirm preferences, history, bindings and
   source worktrees remain intact. Test EXE→EXE and MSI→MSI independently.
6. Repeat controlled failures: offline check; broken/missing download; interruption
   during download; changed advertised version between review and install; modified
   artifact with old signature; wrong-key signature. Installation must not accept
   invalid artifacts or silently switch to a version the user did not review.
   Keep tampered copies isolated from legitimate immutable release artifacts.
7. After each failed attempt, verify the installed version and existing data,
   restore the trial feed, and retry. Record which failures require reopening.

Current automatic checks are throttled to six hours, run while the workspace is
visible, and catch up on return. A failed check does not retry continuously; use
manual Check for updates during a trial. Download begins only after Install.
Local builds without key/feed cannot participate. First-version users must receive
a build with the production key/feed already embedded; an unconfigured older
installer cannot discover its update source retroactively.

## 8. CI and publication

The existing Windows workflow is verification only: read-only repository
permissions, unsigned NSIS artifact, 14-day retention. It neither signs nor creates
releases. Do not treat its artifact as the signed output of section 6.

Before adding signing CI, choose a trusted Windows signer/runner and protected
release environment. Keep secrets out of pull-request jobs and untrusted forks.
Separate build verification from the authorized distribution job; publish only
from a maintainer-reviewed revision. Record the exact workflow run and artifact hashes.
A GitHub environment approval policy is an infrastructure decision to configure,
not something the current workflow already enforces.

For an authorized release:

1. Assemble the reviewed EXE, MSI, their `.sig` files, `checksums.json`, user-facing
   release notes and `latest.json`. Check version, URL, signature, and source identity
   together. Ensure the release record has no unexplained critical failure.
2. Upload immutable versioned installers first. Retrieve them over their final
   unauthenticated HTTPS URLs and compare SHA-256 to the signed-build checksums.
   Check MIME/download behavior and storage/CDN limits on the chosen host.
3. Publish the stable manifest last. Serve it as JSON with a short/revalidated cache
   lifetime where the host permits. For GitHub, upload all assets to a draft release
   first, then publish and explicitly verify which release is marked latest. Private
   repository assets and draft assets are not an unauthenticated production feed.
4. Fetch the final manifest and both URLs from a machine without release credentials.
   Exercise an installed old client's check/upgrade against the actual public feed.
   Record time, versions, checksums, and result. Do not substitute a local fixture.
5. Retain previous artifacts/manifests/build configuration and secure signing-key
   backups. Record the public release URL and operational owner.

Use a separate stable trial feed for controlled previews; do not accidentally point
production clients at a GitHub prerelease/draft. Percentage rollouts, release
channels, server-enforced version policies, and unattended installation are not
implemented in the current static-feed setup.

## 9. Failure handling and recovery

| Symptom | Action |
| --- | --- |
| “No configured update service” | Inspect the candidate's merged release config/public key/feed; rebuild correctly. Settings cannot repair an old binary's missing trust configuration. |
| Check fails / no update appears | Inspect actual public JSON response, TLS/redirects, cache, version comparison and installer-specific platform entries. Confirm client opted in or use manual check. |
| Manifest generation fails | Verify stable version, exact expected filenames, nonempty installers/signatures, notes path and HTTPS base URL. Do not publish a prior leftover `latest.json`. |
| Signature rejected | Stop distribution; compare exact downloaded bytes, signature and pinned public key. Rebuild/re-sign intentionally; never disable verification. |
| Windows signing fails | Verify certificate validity, thumbprint/private-key access and timestamp service. Use the provider's supported signing flow. |
| New build will not start | Preserve user data and artifacts; reproduce in a VM, identify schema/runtime failure and publish a higher-version fix. Do not prescribe Reset. |
| Feed/artifact hosting outage | Restore serving/permissions or the last known-good complete feed; local task work must remain available. Verify downloaded bytes before reopening distribution. |
| Updater private key lost/compromised | Stop affected distribution, involve the key owner, recover a secure backup or plan a separately trusted migration/manual installer. Existing clients cannot simply trust a replacement key. |

Do not promise automatic rollback. Default version comparison does not downgrade
already updated clients. Restoring an older manifest can stop older clients being
offered the bad version, but it does not undo installed updates. Prefer a fixed
release with a higher version and compatible data handling. Any manual downgrade
needs backups and an explicit schema-compatibility trial. Retain the bad artifact
privately for diagnosis; do not overwrite the same public version with different
bytes. Restrict incident actions to authorized release operators.

## 10. Beta, readiness, and handoff completion

Include user acceptance of setup, real task execution, recovery and review before
widening a release. Obtain consent before recording or collecting feedback.

Open gates include clean-machine and signed-upgrade trials, real account lifecycle,
large-history retention/restoration, legacy interrupted-process reconciliation,
combined-result checks, packaged cleanup/security/accessibility/performance, and
external beta evidence. Consult current TODO: this list changes as work lands.
Do not declare broad release readiness because automated checks pass.

Keep the exact source, artifacts, checks, failures and operational publication
state in the private release record. Update public status and backlog only when
capabilities, known limitations or contributor priorities change.
