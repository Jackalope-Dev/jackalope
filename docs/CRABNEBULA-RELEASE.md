# Cloud signing and release setup

Windows releases use [Microsoft Store](STORE-RELEASE.md); Azure signing is needed
only when separately enabling direct EXE distribution. Cloud handles macOS/Linux.

Use [release automation](RELEASE-AUTOMATION.md) for branches, versions, workflow
selection, publication and recovery. This guide covers the external signing inputs
and repeatable installed update trial. The Cloud application is
`jackalope-digital/jackalope`; Windows publisher verification requires
Jackalope Digital LLC. Keep enrollment state and completed trial receipts private.

## Optional direct Windows signing

1. Create an Azure Artifact Signing account and complete **Organization → Public**
   identity validation for Jackalope Digital LLC. Create a **Public Trust** certificate
   profile. Partner Center certification is separate: Store signing covers MSIX,
   not the independently downloaded EXE. A self-signed Key Vault certificate does
   not supply publisher trust.
2. Configure an Entra app/service principal for GitHub OIDC with issuer
   `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`
   and subject `repo:Jackalope-Dev/jackalope:environment:cloud-beta`.
   The shared candidate environment builds both channels. An existing cloud-stable
   federation may remain, but publication does not sign new files.
3. Assign **Artifact Signing Certificate Profile Signer** at the intended certificate
   profile scope. Set the variables below; the Azure CLI signing adapter needs no
   Azure client secret. Enable `CLOUD_SIGNING_READY` only after configuration.

| GitHub variable | Value/purpose |
| --- | --- |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | Entra application and subscription identifiers |
| `AZURE_SIGNING_ENDPOINT` | Account region's HTTPS `codesigning.azure.net` endpoint |
| `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | Artifact Signing account/profile names |

The Tauri signing hook uses Microsoft's SignTool and pinned Artifact Signing client.
It signs executables and installer components during packaging, then independently
checks the native executable and final EXE for a valid timestamped signature and
publisher name. Certificate rotation does not require pinning a new thumbprint.

[Azure setup](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart),
[OIDC setup](https://github.com/Azure/artifact-signing-action/blob/main/docs/OIDC.md).

## macOS signing and notarization

Enroll the company in the Apple Developer Program. Create a **Developer ID
Application** certificate, export it with its private key to a password-protected
P12, and encode that file as base64. Create an App Store Connect API key authorized
for notarization; download its P8 key to private storage.

| Setting | Location | Purpose |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | `cloud-beta` secret | Base64 P12 including private key |
| `APPLE_CERTIFICATE_PASSWORD` | `cloud-beta` secret | P12 password |
| `APPLE_API_PRIVATE_KEY` | `cloud-beta` secret | P8 key contents |
| `APPLE_SIGNING_IDENTITY` | Repository variable | Full `Developer ID Application: … (TEAMID)` identity |
| `APPLE_TEAM_ID` | Repository variable | Expected certificate team |
| `APPLE_API_KEY`, `APPLE_API_ISSUER` | Repository variables | App Store Connect key ID and issuer ID |

The native Mac jobs use their matching architectures. The builder creates a temporary
keychain, signs bundled browser/desktop-control executables with hardened runtime,
then bundles, signs and notarizes the app through Tauri. It verifies the app's publisher,
deep signature, Gatekeeper assessment and stapled ticket before recording artifacts.
The temporary keychain, P12/P8 files and rehearsal updater key are removed on exit;
ephemeral hosted runners discard them if a job is terminated. Enable
`APPLE_SIGNING_READY` only after configuration. Signing code has to pass on real Mac
runners before it establishes release acceptance.

[Tauri signing/notarization](https://v2.tauri.app/distribute/sign/macos/),
[Apple Developer ID](https://developer.apple.com/developer-id/).

## Cloud and updater credentials

Confirm the application uses Tauri v2 in CrabNebula. Store `CN_API_KEY` in
`cloud-beta` and `cloud-stable`; do not paste key values into source, command arguments
or chat. Preserve the existing updater key and keep a private recovery backup.

| Setting | Location | Purpose |
| --- | --- | --- |
| `CN_APPLICATION` | Repository variable | `jackalope-digital/jackalope` |
| `TAURI_SIGNING_PRIVATE_KEY` | `cloud-beta` secret | Existing updater key used by every platform/channel |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `cloud-beta` secret, if required | Existing key password |
| `TAURI_UPDATER_PUBLIC_KEY` | Repository variable | Matching key embedded in clients and checked by publication |
| `CN_API_KEY` | Both Cloud environment secrets | Draft/upload/publication access |

Linux AppImage needs the updater key but no additional publisher-signing subscription.
Candidates include both trusted Cloud channel endpoints, retain approved native
account access and use the existing task-aware update installation safeguards.
Signing credentials and live deployment state never belong in tracked configuration.

Publication uses CN CLI 0.13.4; Windows signing uses
Microsoft.ArtifactSigning.Client 1.0.128. Asset URLs and SHA-256 pins live in
`cloud-tools.ps1`. Review a pin update explicitly if a vendor asset changes.
CLI quality reports are disabled. Verify authenticated API/metadata and draft-byte
read-back before enabling publication; fixture tests do not establish vendor access.

[Cloud API keys](https://docs.crabnebula.dev/cloud/org-management/create-api-key/),
[asset metadata](https://docs.crabnebula.dev/cloud/cli/fetch-latest-release/).

## Run a rehearsal

Dispatch **Cloud release** with `mode=rehearsal` from beta or stable. It retains
artifacts without upload/publication. For a local Windows rehearsal:

```powershell
pnpm verify
./scripts/release/cloud-build.ps1 -Mode rehearsal -Channel beta
```

For a local macOS/Linux rehearsal:

```sh
node scripts/release/cloud-build-unix.mjs rehearsal beta
```

Rehearsals use a separate app identity/name, a debug native build with embedded
production frontend, an ephemeral updater key and disabled update endpoints.
They cannot be promoted or used as the old version of an installed update test.
Use isolated profiles and keep other users' running apps untouched.

## Test an installed update

Use two increasing versions from committed beta source with the same real updater
key and application identity. Configure the explicit manual beta trial target list
as described in [release automation](RELEASE-AUTOMATION.md#enablement-and-first-update-test).

1. Prepare the older version and reviewed notes. Build a signed beta candidate,
   install it in a disposable OS user/profile, and verify its version, publisher,
   architecture and installation path.
2. Connect an approved account, create saved work in a disposable repository, execute
   a real task, quit and reopen, and confirm data persists.
3. Prepare and build the newer version. Check the draft's notes, platform artifacts,
   signatures and receipts. Use **Publish Cloud candidate** to publish the exact
   tested run. Beta assets are accessible by public URLs even if not advertised.
4. In the older installation, open App updates and choose **Check for updates**,
   then **Install and restart**. Automatic checks discover updates; installation
   remains a user action. Confirm the newer version after restart and saved work.
5. Exercise active-task blocking, offline/download recovery, account expiry/revocation,
   channel selection and rejection of a wrongly signed artifact on a separate
   controlled test feed. On macOS check both architectures and permission continuity;
   on Linux run the AppImage directly. Follow [release acceptance](RELEASE.md).

Only after each platform passes should it enter the accepted-target list and the
website download catalog. Build/signing success, a published feed or a mocked test
is not proof of an installed upgrade. The optional [Store path](STORE-RELEASE.md)
retains its independent MSIX certification and update model.
