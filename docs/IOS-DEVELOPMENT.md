# iOS development

How Jackalope works on iOS projects on a Mac: the Xcode toolchain it uses, the
Simulator each task gets, the tools agents use to see and drive an app, previews and
review captures, workspace caches, project file merges, physical devices, TestFlight
delivery and remote Macs. Web projects use [browser automation](BROWSER-AUTOMATION.md)
for the same jobs.

## Xcode toolchain and project detection

<!-- section: toolchain -->

## Task simulators

<!-- section: simulators -->

## Simulator tools

<!-- section: simulator-tools -->

## Simulator previews and review captures

<!-- section: simulator-preview -->

## Workspaces and build caches

<!-- section: workspaces -->

## Xcode project merges

<!-- section: pbxproj -->

## Physical devices

<!-- section: devices -->

## Signing and TestFlight

Agents never upload. They prepare a project for TestFlight, and the person starts
every upload from the task and confirms the app and build by name.

### App Store Connect connection

Project settings → **Integrations** → **App Store Connect** holds an App Store Connect
API key for the project: the Issuer ID, the Key ID, the `.p8` key (picked from disk or
pasted; picking `AuthKey_<KEYID>.p8` fills in the Key ID), the Team ID, and optionally
the bundle ID, the scheme to archive and the export method (`app-store-connect`, or
`app-store` for older Xcode). `commands/app_store_connect.rs` refuses a key that is not
an ES256 PKCS#8 private key, and keeps the whole connection, key included, in one
protected record (`app-store-connect/<project>.bin` in the task profile, through the
same Keychain, DPAPI or Secret Service storage as project secrets). The app sees every
field but the key; saving without a key keeps the saved one. Task agents never receive
this key. A person who wants an agent to sign with a key adds it as a
[file secret](AGENT-ACCOUNTS.md#project-secrets).

**Check key** signs a 15-minute ES256 token with the key (`ring`, already in the
dependency graph through rustls) and calls `GET /v1/apps?limit=1`. Success records
when the key was checked and names what it can see; a failure shows App Store
Connect's status, error code, title and detail as Apple sent them. Changing the key,
Key ID or Issuer ID clears the check.

### Upload to TestFlight

A task whose workspace has an Xcode workspace or project (in its root or one folder
down, skipping `Pods`, `node_modules`, `build` and `DerivedData`; a workspace wins over
a project at the same depth) and whose project has a connection offers **Upload to
TestFlight…** under the delivery **More** menu while its agent is not running.
`commands/testflight.rs` then:

1. Reads the project with `xcodebuild -list -json` and `xcodebuild -showBuildSettings
   -json -configuration Release -sdk iphoneos` through the resolved Xcode. The scheme
   is the configured one, the only one, the one named like the container, or the only
   non-test, non-CocoaPods one; otherwise the dialog asks for it in the connection.
   The app target's `PRODUCT_BUNDLE_IDENTIFIER`, `MARKETING_VERSION` and
   `CURRENT_PROJECT_VERSION` are used, unless its Info.plist spells out
   `CFBundleShortVersionString` or `CFBundleVersion`.
2. Asks App Store Connect for the app with that bundle ID and its most recent build
   number. A read failure is shown in App Store Connect's words and does not block.
3. Blocks the upload, saying why, when there is no connection, the bundle ID differs
   from the connection's, the version or build number is missing or not one to three
   period-separated integers, the project signs with a different team than the key's,
   App Store Connect has no app with the bundle ID, or the build number is not higher
   than the last uploaded one.
4. Offers a higher build number. **Set build number** rewrites
   `CURRENT_PROJECT_VERSION = <old>;` lines in the app's `project.pbxproj`,
   `CURRENT_PROJECT_VERSION: <old>` in an XcodeGen `project.yml`, and a literal
   `CFBundleVersion` in the Info.plist, only inside the task workspace. It is an
   ordinary uncommitted change that review shows; a number set in an `.xcconfig` is
   reported instead of edited.
5. Uploads only after the person ticks a confirmation naming the app, version and
   build, and refuses if the project no longer builds exactly that.

The upload runs in the task workspace with output in app data
(`testflight/<run>/current/`; a new upload of the same task replaces it):

```sh
xcodebuild archive -workspace|-project <container> -scheme <scheme> \
  -configuration Release -destination generic/platform=iOS \
  -archivePath <app data>/<scheme>.xcarchive -allowProvisioningUpdates \
  -authenticationKeyPath <key> -authenticationKeyID <key id> \
  -authenticationKeyIssuerID <issuer> [DEVELOPMENT_TEAM=<team>]
xcodebuild -exportArchive -archivePath <archive> \
  -exportOptionsPlist <app data>/ExportOptions.plist -exportPath <app data>/export \
  -allowProvisioningUpdates -authenticationKeyPath <key> ...
```

`DEVELOPMENT_TEAM` is added only when the project sets no team. `ExportOptions.plist`
sets `method` to the connection's export method, `destination` `upload`, `teamID`,
automatic signing, `uploadSymbols` and `manageAppVersionAndBuildNumber` false, so the
confirmed version and build are the ones uploaded. The key is written to a `0600` file
in a `0700` folder beside the archive for the upload only and deleted when it ends,
however it ends. Each step is an owned process tree, stopped after 90 minutes or when
it is silent for 20 minutes (archive) or 30 minutes (upload). **Cancel upload** stops
xcodebuild and ends **Canceled**.

The dialog and a status line in the delivery section follow the upload: the phase
(Archiving, Uploading, Processing on App Store Connect, Uploaded, Failed or Canceled),
the newest 400 lines of output, and the full log path (`upload.log`, up to 32 MB). A
failed step shows xcodebuild's own `error:` lines and exit code, or its last lines
when it printed none. After the upload, Jackalope asks App Store Connect for the build's
`processingState` every 30 seconds for about 30 minutes: `VALID` ends **Uploaded** and
ready to test, `INVALID` or `FAILED` ends **Failed** (Apple emails the reason), and a
build still processing ends **Uploaded** with that said. **Stop checking** only stops
following processing. The last state is saved in `testflight/<run>/upload.json`; an
upload that was running when Jackalope quit reads as failed, so check App Store
Connect before uploading again.

### Agents and signing

**Ask the agent to prepare… → TestFlight** (shown when the task has an Xcode project)
hands the agent a delivery handoff that asks it to check and fix signing settings
(team, automatic signing, a bundle ID that matches App Store Connect), the version and
a build number higher than the last upload, the privacy manifest
(`PrivacyInfo.xcprivacy`, with required-reason API declarations), an Info.plist usage
description for every protected API, app icons and the launch screen, and to report
what the person must do. It never archives, exports or uploads, and never asks for the
API key. For a step only the person can take in Xcode, on the Apple Developer site or
in App Store Connect, agents use `request_human_action` with kind `signing`, which the
task shows as **Signing setup** with a pointer to Xcode's Signing & Capabilities and
to this connection.

### Not verified here

A real upload, App Store Connect processing and a key Apple accepts need Apple
developer credentials and are covered only by fakes: a stand-in xcodebuild drives the
upload states, key handling and error reporting, and a local server stands in for the
App Store Connect API. `cargo test real_archive -- --ignored` archives a generated
one-screen app for `generic/platform=iOS` with `CODE_SIGNING_ALLOWED=NO`, using the
upload's own archive command, and changes its build number through XcodeGen's
`project.yml` and the `.pbxproj`; it needs Xcode and XcodeGen.

## Remote Macs

<!-- section: remote-macs -->

## Verification

<!-- section: verification -->
