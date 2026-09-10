# Desktop account connection

Settings → Jackalope account connects an approved early-access membership to this
desktop. All builds, including local development builds, require an approved
account for new native tasks and terminals, with a bounded 72-hour offline lease.
Saved work and running tasks remain accessible. There is no development bypass.
See [STORE-RELEASE.md](STORE-RELEASE.md) for enforcement and distribution.
Account connection does not sync projects, enable remote execution or change
Microsoft Store audience membership.
Connection and optional settings sync are enabled on Windows, macOS and Linux;
macOS/Linux no longer report unavailable solely because of the platform. Their
installed connection, expiry and revocation flows still require acceptance.

## User flow

1. Connect account opens the website in the system browser. The app displays a code.
2. The user signs in with the existing email magic link or uses their browser session.
   A link opened in another tab can complete sign-in; return to the approval tab.
3. The approval page identifies the signed-in email and requires confirmation that
   the displayed code matches the desktop. Visiting the link never approves it.
4. The desktop checks for approval, saves the connection securely and displays the
   email and approved access. Open browser, cancel, expiry and retry remain available.
5. Disconnect this desktop revokes the credential before removing the local record.
   It requires network access. The website's Connected desktops list can revoke a
   lost device; local projects and agent accounts are unaffected.
6. Settings → Invitations uses the same device credential to show the member's
   share link and acceptance, download and connection milestones. Sharing is always
   user initiated; email invitation management opens the authenticated website.

## Trust and storage

- The native process generates a random credential. Only its SHA-256 challenge is
  registered at `/v1/desktop/start`; a separate random approval token goes to the
  browser in a fragment. The browser removes the fragment and retains only this
  pending, ten-minute approval context in tab session storage, never a device credential.
- Browser approval requires the existing approved, verified member session and
  exact allowed Origin. A checkbox confirms the matching code. Native endpoints
  reject browser Origin headers and do not accept website session cookies.
- `/v1/desktop/exchange` requires native possession of the credential and explicit
  browser approval. Exchange atomically creates one device record; retries with the
  same secret recover a lost response. Consumed approval links cannot connect again.
- Server storage contains credential hashes, member association, random device ID,
  connection/expiry timestamps and short-lived pairing state. A member can have ten
  active devices. Device credentials expire after 90 days; pairing expires after ten
  minutes. The existing scheduled cleanup removes expired records.
- Revocation deletes both the device and any exchange receipt. Changing membership
  away from approved removes pending approvals and devices, preventing reactivation
  by simply restoring membership. Member deletion cascades to device records.
- Windows DPAPI encrypts `task-runs-v1/preferences/account.bin` for the current OS
  user. It contains the pending or connected credential, service binding and account
  metadata. The renderer receives only display status; exports, agent configuration
  and diagnostics do not include this record. There is no plaintext fallback.
  macOS Keychain and Linux Secret Service store credentials behind opaque local
  references; locked/unavailable stores fail without plaintext fallback. Native
  acceptance remains required. Reset removes local records and keyring secrets; use website
  revocation to remove the corresponding server credential.
- Credentials are bound to the embedded API origin. Native requests have bounded
  bodies and timeouts and do not follow redirects. No tokens enter URLs to the API,
  logs or user-facing errors. Local profiles and Windows user protection do not
  isolate this app from malicious software running as the same OS user.

## Deployment and acceptance

Connected desktops represents profile connections, not unique physical computers.
Isolated tests have independent credentials and local projects, so the same computer
name can appear more than once. Restarting a profile reuses its saved connection.
The access page distinguishes connections by a short ID, platform, app version,
development/release build and default/isolated profile. Account checks run while
the app is open; their timestamp does not establish human activity or task execution.
Settings checks record successful server reads/writes, not confirmation that the
renderer applied a setting. Projects and task history remain local.

Apply `0015_desktop_metadata.sql` before deploying the matching Worker and website.
Older records show unreported metadata until a compatible desktop checks in. The
native response advertises `deviceMetadata`; older services remain supported.
Only bounded version/platform/build/profile categories are sent, never profile
paths, hardware identifiers, project names or task data. Metadata is visible only
to the owning account and follows the existing device expiry/deletion lifecycle.

Local verification covers the real Settings component in browser fixtures at
1280×840 and 960×640, light/dark appearance, keyboard order, settings search and
focus return. Website fixtures cover signed-out handoff, sign-in in another tab,
matching-code confirmation, approval URL/storage cleanup, reused-tab recovery,
invalid requests and device revocation, including a 375px layout. Fixtures send no
emails and create no real native account sessions. Worker/D1 tests cover native
possession, concurrent exchange/retry, origin and membership boundaries, expiry,
polling limits, cancellation and revocation. Native tests cover DPAPI round-trip,
tamper rejection, service binding and renderer credential exclusion.

Apply `0004_desktop_accounts.sql` before deploying the server, then deploy the
website and ship a reviewed desktop build. Existing accounts/sessions are preserved;
no migration emails users or grants approval. No new email provider or Worker
secret is required. Sequenzy remains the magic-link sender.

Desktop `plugins.jackalope.accountServiceUrl` and `accountWebUrl` are trusted HTTPS
origins, independent of optional reporting. Defaults connect both release channels
to production membership. Release builds may set `JACKALOPE_ACCOUNT_API` and
`JACKALOPE_ACCOUNT_WEB` together for an isolated test deployment whose website uses
the same API. Do not expose these overrides as editable renderer settings.

Before release, record a real invited-user trial: sign in in a separate browser
tab, compare codes, approve, restart the desktop, verify identity, cancel an unused
request, expire one, disconnect locally and revoke another connection on the website.
Exercise offline recovery and revoked membership. Local D1/HTTP fixtures and native
DPAPI tests are narrower than this deployed/installed acceptance.
