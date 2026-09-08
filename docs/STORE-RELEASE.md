# Microsoft Store releases

The Store path packages the native desktop as a full-trust x64 MSIX. Microsoft
signs certified Store submissions; this does not supply a signed EXE/MSI for an
independent download. The existing installer release path remains separate.

## Build and review

Install the Windows SDK (MakeAppx), Node/pnpm and the repository Rust toolchain.
Run from the repository root:

~~~powershell
pnpm verify
./scripts/release/store.ps1 -Mode rehearsal
~~~

Rehearsals build a debug executable with embedded frontend assets, required beta
access and Store-managed updates. A separate local package identity and desktop
data directory protect the everyday installation. Output goes to a fresh
`output/store/<id>/` directory: an unsigned MSIX, expanded package, generated
Tauri config and receipt recording source revision/dirty state and hashes.
Rehearsals without a fixed WebView2 runtime depend on the machine's installed
Evergreen runtime and cannot establish clean-machine acceptance.

The **Store release** workflow defaults to a manually dispatched rehearsal.
Rehearsals verify and package without publication. Submission mode builds release
packages and calls the Store API only after the owner enables automation.

For a submission, enroll at [Store developer registration](https://storedeveloper.microsoft.com/)
and reserve an MSIX product. Copy the exact package name, publisher identity and
publisher display name from Partner Center. Set these nonsecret values in the
current shell and provide an extracted, current **x64 Fixed Version WebView2**
runtime downloaded from Microsoft:

~~~powershell
$env:STORE_IDENTITY_NAME = '<Package/Identity/Name>'
$env:STORE_PUBLISHER = '<Package/Identity/Publisher>'
$env:STORE_PUBLISHER_DISPLAY_NAME = '<publisher display name>'
$env:STORE_WEBVIEW2_PATH = 'C:\path\to\extracted-fixed-runtime'
./scripts/release/store.ps1 -Mode submission
~~~

Submission builds use release optimization, require real identity inputs and a
Microsoft-signed WebView2 runtime, and include the runtime in the package.
Supply the extracted runtime directory itself, containing `msedgewebview2.exe`.
Keep this pinned runtime current with security releases and test each update.
The app version must have three numeric parts; the Store package adds the reserved
fourth component `.0`. A build receipt is not Store certification or installation
evidence. Upload the first reviewed MSIX manually to Partner Center. Subsequent
updates can use the automated submission workflow below.

## Automatic beta and stable delivery

MSIX packages installed through Microsoft Store receive Store-managed automatic
updates, subject to the user's Store settings and Windows delivery timing. After
a successful submission, Microsoft certifies, signs and distributes the update.
No paid publisher certificate or public GitHub Release download is needed for this
Store path. Certification can fail and is not instantaneous.

One-time setup:

1. Reserve the product, complete its listing/age ratings/privacy/certification
   instructions, and publish the first submission to the intended private audience.
   Create a beta package flight and assign the intended tester group. Store flight
   membership uses Microsoft accounts; Jackalope approval is a separate decision.
2. Link an Entra tenant/application to Partner Center with access to this product,
   using Microsoft's submission API prerequisites. Store its client secret only in
   the `store-beta` and `store-stable` GitHub environment secrets as
   `STORE_CLIENT_SECRET`. Set an expiry reminder through your existing secret process.
3. Set repository variables `STORE_APP_ID`, `STORE_BETA_FLIGHT_ID`, `STORE_TENANT_ID`,
   `STORE_CLIENT_ID`, `STORE_IDENTITY_NAME`, `STORE_PUBLISHER`,
   `STORE_PUBLISHER_DISPLAY_NAME`, `STORE_WEBVIEW2_URL`, `STORE_WEBVIEW2_SHA256`.
   The runtime URL must be Microsoft's direct x64 Fixed Version CAB download URL;
   review/accept its license and independently verify the SHA256 before configuring.
   The package retains the complete extracted runtime including its notices. Review
   required runtime notices and SmartScreen disclosures before submitting.
4. Complete installed acceptance, then set `STORE_AUTOMATION_ENABLED=true`.
   Use `RELEASE_DISTRIBUTION=store` to skip automatic legacy installer builds on beta
   pushes. Add repository tag rules and optional environment reviewers to match
   who should be allowed to publish; neither replaces Microsoft certification.

For each release, update the app's version and release notes, review/commit the
change, and push a tag matching `store-beta/vX.Y.Z` or `store-stable/vX.Y.Z`.
The tag must match `tauri.conf.json`. Manual dispatch also supports either channel.
The workflow runs verification, builds a real-identity MSIX with fixed WebView2,
checks artifact hashes, uploads it, and submits it with publication after
certification. Beta targets the configured flight; stable targets the base product
and preserves its existing audience/listings. Both retain approved-account access
while this preview is underway; `stable` does not mean publicly discoverable.

Use increasing three-part versions across both channels. The fourth MSIX part is
always zero. A stable release should be newer than the latest beta if beta testers
should move to it; the Store does not downgrade installed packages. The app's own
channel selector cannot change Store flight membership.

The submission script never deletes a draft. An existing pending submission stops
the run. Failures after creation preserve a `submission.json` with the ID for
recovery. Inspect its status in Partner Center or with the Microsoft Store CLI
before retrying; do not edit API-created submissions in the portal or blindly
resubmit after an uncertain network result. Resolve failed drafts deliberately.
`Submitted` means processing started, not certified or published. Partner Center
notifications/status remain the source for certification success or rejection.

The workflow exits after submission, avoiding Windows runner charges while Store
certification runs. It caches Rust dependencies/build outputs and retains package
artifacts for 14 days. Review current GitHub runner, cache and artifact-storage billing for the
repository's visibility and plan before enabling frequent packaging jobs. The same scripts work on another Windows CI runner:

~~~powershell
./scripts/release/store-runtime.ps1
./scripts/release/store.ps1 -Mode submission -Channel beta
node scripts/release/store-submit.mjs 'C:\path\to\output\store\id'
~~~

Locally, assign the path printed by `store-runtime.ps1` to `STORE_WEBVIEW2_PATH`.
The download helper exports that variable automatically only under GitHub Actions.
No workflow has been run against a real Store product as part of implementation.

## Access and invitations

Start with **Private audience** and a small known-user group. Collect the personal
Microsoft-account emails used by those testers, and send Partner Center's special
authenticated listing link. Work/school identities are not accepted for this mode.
The Jackalope email used inside the app can differ from the Store account email.

For the broader waitlist, use **Public audience → available but not discoverable →
direct link only**, with required approved Jackalope login. Approve members using
the existing administration flow and send the Store link to each invited batch.
After installed acceptance, configure private server `ACCESS_STORE_URL` with the
exact Microsoft product link (`https://apps.microsoft.com/detail/<id>` or
`https://www.microsoft.com/store/apps/<id>`). The admin page reports the Store link
as configured; approved members' download action redirects there without an R2
installer. This is configuration readiness, not a live Store availability probe.
The link takes precedence over `ACCESS_INSTALLER_KEY`. Keep it blank until usable.
The existing approval email points to the member hub and requires no email change.
Pass `STAGING_ACCESS_STORE_URL` / `PRODUCTION_ACCESS_STORE_URL` through deployment
configuration, or include `ACCESS_STORE_URL` in the private community configuration.

The current referral system also grants invitations to approved members; account
approval does not impose an exact operator-only cohort size.

A hidden link can be forwarded and permits installation. Jackalope membership
controls new execution inside official beta builds. No raw installer download is
needed for this path. Later, enable Store discoverability and deliberately decide
whether to remove the beta-access build feature.

Private-to-public audience is a one-way change for that product. Removing a tester
from the Store private audience does not revoke an installed app. Membership and
device revocation are handled by Jackalope's service.

## Native beta gate

The `store` Cargo feature includes `beta-access`. Official EXE/MSI beta builds
also enable `beta-access`; ordinary local developer builds remain independent.
Changing a renderer preference or update channel cannot disable the compiled gate.

The native runtime starts denied until it checks the encrypted account record.
Only a successful server verification supplies an authorization timestamp. The
lease lasts at most 72 hours from that verification and never beyond device
expiry. Background checks run once per minute; failures cannot extend the lease.
Clock rollback before verification, missing/corrupt storage and unverified legacy
records fail closed. Confirmed revocation removes the credential and denies new work.

Direct launches, continuations, queued and scheduled tasks share native enforcement;
new PTY sessions are also guarded. Denied schedule occurrences record a skip without
starting an attempt. Saved results, export/recovery, stopping work and existing
processes remain available. This is beta admission control, not tamper-proof DRM
against someone modifying a local binary or running a separately built client.
See [DESKTOP-ACCOUNT.md](DESKTOP-ACCOUNT.md) for approval and credential storage.

## Remaining acceptance

- Deploy and verify the existing account migration/API/website before inviting anyone.
- Provide Partner Center identity, a fixed WebView2 runtime and a working certification
  account with reproducible login/agent instructions. Magic-link-only access must be
  workable for reviewers; do not add an unauthenticated reviewer bypass.
- Test the expanded package in a disposable Windows user/VM with Developer Mode,
  using `Add-AppxPackage -Register <expanded-package>\AppxManifest.xml`. For testing
  the actual MSIX installation, use a test certificate trusted only in the disposable
  machine, or install a certified private Store submission. Do not install local
  signing certificates or replace an everyday installation as part of a build.
- Test installed clean-profile startup, offline WebView2 loading, approved/pending/
  revoked accounts, grace expiry/restart, project creation, Git worktrees, agent
  discovery and execution, provider credentials, PTY, cancellation, scheduled work,
  browser pairing and saved-data persistence. MSIX file/registry virtualization
  must be tested with real supported agent CLIs.
- Test Store update/restart during and after active work, uninstall/reinstall and
  data retention. Store updates are not controlled by the direct installer's
  task-aware update button; native interrupted-history recovery must be accepted.
- Verify light/dark, keyboard/focus, reduced motion and both supported window sizes.
- Submit first to a private audience. No claim of certification or Store-installed
  acceptance follows from a successful package build or browser fixture.

## References

- [Microsoft packaging instructions](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion)
- [Store audience and direct-link options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/visibility-options)
- [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Store certification requirements](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies-and-code-of-conduct)

- [Store submission API setup](https://learn.microsoft.com/en-us/windows/uwp/monetize/create-and-manage-submissions-using-windows-store-services)
- [App submissions](https://learn.microsoft.com/en-us/windows/uwp/monetize/manage-app-submissions)
- [Flight submissions](https://learn.microsoft.com/en-us/windows/uwp/monetize/manage-flight-submissions)
- [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
