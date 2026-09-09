# CrabNebula release testing

This guide covers Windows x64 NSIS packaging, Azure Artifact Signing
integration and upload to an unpublished CrabNebula draft. The application is
`jackalope-digital/jackalope`; publisher verification requires Jackalope Digital LLC.
This complements the [cross-platform plan](CROSS-PLATFORM-RELEASES.md). Store
automation and existing R2 publication settings remain unchanged.

## Run a rehearsal

From a reviewed source revision, run **Cloud release rehearsal**
from master with `mode=rehearsal` and either `beta` or `stable`. The workflow runs
repository verification and access-gate tests, builds the installer and retains
the package, configuration and receipt as a GitHub artifact for 14 days. It is
manual only.

For a local rehearsal:

```powershell
pnpm verify
./scripts/release/cloud-build.ps1 -Mode rehearsal -Channel beta
```

Each run writes a fresh directory under `output/cloud/`. Rehearsals use the
separate `dev.jackalope.cloud.rehearsal` identity, the name Jackalope Rehearsal,
the executable `jackalope-rehearsal.exe`, a debug native build with embedded production frontend, a temporary updater key
and no live update endpoints. They compile the native approval gate for both
channels. They are unsigned tests and cannot be uploaded by the draft command.
Do not use this installer as an external beta release or infer publisher trust
from it. Always use an isolated profile for native trials.

## Account setup

Keep account state, enrollment progress and detailed trial receipts in private
operator records. The following steps describe the required configuration.

1. In CrabNebula, confirm this app is Tauri v2 and retain the intended visibility.
   Create an API key for release uploads and put it directly in the GitHub
   `CN_API_KEY` secret. Never put its value in source, command arguments or chat.
2. In Azure, enroll the organization and validate Jackalope Digital LLC. Create
   an Artifact Signing Basic account and **Public Trust** certificate profile.
   An ordinary self-signed Key Vault certificate does not supply publisher trust.
3. Configure an Entra app/service principal for GitHub OIDC with issuer
   `https://token.actions.githubusercontent.com` and audience
   `api://AzureADTokenExchange`. Add the subjects
   `repo:Jackalope-Dev/jackalope:environment:cloud-beta` and
   `repo:Jackalope-Dev/jackalope:environment:cloud-stable`.
   Give it **Artifact Signing Certificate Profile Signer** at the intended profile
   scope. The signing adapter uses Azure CLI authentication after `azure/login`;
   no Azure client secret is needed.
4. Restrict the GitHub environments `cloud-beta` and `cloud-stable` to the intended
   trusted release branch. Set the variables below and preserve updater key continuity.
5. Once the Azure identity is ready, set `CLOUD_SIGNING_READY=true` and request
   `mode=candidate`. This builds and checks publisher-signed files without upload.
6. After testing that candidate, configure `CN_API_KEY` and set
   `CLOUD_DRAFT_UPLOAD_ENABLED=true` to use `mode=draft`. This additionally uploads
   the signed installer to an unpublished draft. This workflow has no publish step.

[Azure setup](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart),
[OIDC setup](https://github.com/Azure/artifact-signing-action/blob/main/docs/OIDC.md),
[CrabNebula API keys](https://docs.crabnebula.dev/cloud/org-management/create-api-key/).

| Setting | Location | Value/purpose |
| --- | --- | --- |
| `CN_APPLICATION` | GitHub variable | `jackalope-digital/jackalope` |
| `CLOUD_SIGNING_READY` | GitHub variable | `false` until Azure setup is complete |
| `CLOUD_DRAFT_UPLOAD_ENABLED` | GitHub variable | `false` until a candidate and Cloud access are tested |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | GitHub variables | Entra OIDC application and Azure subscription identifiers |
| `AZURE_SIGNING_ENDPOINT` | GitHub variable | Regional HTTPS `codesigning.azure.net` endpoint for the account |
| `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | GitHub variables | Existing Artifact Signing account/profile names |
| `TAURI_SIGNING_PRIVATE_KEY` | GitHub secret | Existing private updater key; preserve continuity |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | GitHub secret, if required | Password for the existing key |
| `TAURI_UPDATER_PUBLIC_KEY` | GitHub variable | Matching updater public key |
| `CN_API_KEY` | GitHub secret | Cloud release upload credential |

Candidate builds require a clean committed tree, matching version files, reviewed
release notes with `Status: ready`, Azure configuration and the existing updater
key. The legacy `RELEASE_SIGNING_READY` and `RELEASE_DISTRIBUTION` flags do not
control this separate rehearsal workflow.

## Signing and update behavior

The Tauri custom signing hook uses Microsoft's SignTool and pinned Artifact Signing
client package. It signs app executables and installer components during packaging.
The build separately checks the final native executable and installer for a valid
Authenticode signature, timestamp and publisher name. It permits Azure certificate
rotation without pinning the old thumbprint. Tauri then signs the final update
artifact with the existing updater key.

Candidate builds include both trusted Cloud channel endpoints. Native and build
validation permit only the exact configured application's beta/stable query;
account and telemetry URLs still reject queries. Both channels require approved
native access during preview. Existing task-aware update installation remains in
control, and switching channels does not enable arbitrary endpoint selection.

The pinned tools are CN CLI 0.13.4 (vendor asset ID and SHA-256 in `cloud-tools.ps1`)
and Microsoft.ArtifactSigning.Client 1.0.128 (NuGet URL and SHA-256). A missing or
changed vendor asset fails verification; review and update the pin explicitly.
CN CLI quality reports are disabled for release commands.
[Microsoft signing integration](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations),
[Tauri signing](https://v2.tauri.app/distribute/sign/windows/).

## Draft upload and recovery

`cloud-upload.mjs` validates the candidate's application, channel, target, source,
approval requirement, configured updater key and artifact hashes, and verifies
the installer publisher before network writes. It checks for an existing release
at the same version/channel and refuses duplicates or versions older than an existing release. It uploads only
the exact NSIS file/signature, with `nsis-x86_64` public platform and
`windows-x86_64` updater platform, then checks the returned draft metadata.

`cloud-draft.json` records the source receipt hash, draft ID and phase. Completed
uploads are not repeated. An uncertain draft creation or upload stops rather than
blindly retrying a mutation. Recover using the Cloud dashboard and the original
artifact/checkpoint; do not delete a draft just to make a retry pass. If creation
succeeded but the response was lost, confirm the exact app, version, channel and
notes before recording its ID and returning the phase to `created`. If an upload
is uncertain, inspect the remote asset before any retry. An unrecognized CLI
response also stops. Live API response compatibility still needs an authenticated
trial; mock command tests do not establish it.

## Remaining release acceptance

- Complete live Azure signing and authenticated Cloud draft upload; verify the
  real CLI response and metadata contracts against the saved candidate.
- Accept clean Windows installation, first approved sign-in, saved-work recovery,
  offline expiry/revocation, real agent execution and an older-to-newer signed
  update. Confirm the installed executable's publisher and default install path.
- Implement R2 archival copies and automatic publication only after candidate
  acceptance; test remote byte read-back and interrupted promotion. No release
  or public download is created by the current workflow.
- Add platform-native Mac/Linux jobs, secure account storage and execution
  acceptance, Apple signing/notarization and tested multi-target Cloud selection.
- Connect the approved-member download catalog to accepted Cloud artifacts;
  preserve the login gate and replace any active Store URL override deliberately.

This is release preparation. A successful build, mocked CLI test or draft upload
does not establish installed updates or macOS/Linux readiness.
