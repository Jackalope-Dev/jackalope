# Desktop account connection

A Jackalope account is optional. Local tasks, conversations, terminals, previews,
checks, swarms, MCP, bots, device pairing and the `jackalope` command run with the
person's own agent CLIs whether or not an account is connected, expired or revoked.
The welcome screen and Settings → Jackalope account connect an account to this
desktop; in waitlist mode, verified waitlist members can also connect to follow
their progress. With open signup, the production setting, confirming the signup
email approves the account.

Connecting adds the features that call the Jackalope service, and only these:

| Feature | Why it needs the account |
| --- | --- |
| Settings sync | Preferences are stored on the account for other desktops ([settings sync](SETTINGS-SYNC.md)) |
| Lesson sync | Learned lessons are stored on the account, on top of settings sync |
| Skill sync | Chosen skills are stored on the account, on top of settings sync |
| Invitations and Instant Access Passes | The share link, passes and their progress belong to the member |
| Member feedback invitations | The service coordinates cooldowns per member ([feedback invitations](FEEDBACK-INVITATIONS.md)) |
| Microsoft Store beta program | Flight requests are tied to the member for the operator |

Native `AccountFeature` in `commands/account.rs` lists them, and `AccountService::admit`
is their one gate: without an approved, unexpired account whose lease is current it
returns a "Connect your Jackalope account to …" error before any request, so nothing
reaches the service for someone who has not connected. The renderer mirrors the list
in `lib/account.ts`; `RequiresAccount` shows an explanation and a Connect button in
place of a gated view, and `AccountRequiredNotice` sits beside local controls such as
the settings-sync switch. Anonymous usage counts, written feedback and update checks
are separate services that do not use the account.

An approved account keeps its account features for at most 72 hours offline after the
last successful check, and never past the device credential's expiry. Expiry or
revocation turns account features off; local work is unaffected.
See [STORE-RELEASE.md](STORE-RELEASE.md) for distribution.
Account connection does not sync projects, enable remote execution or change
Microsoft Store audience membership.
Connection and optional settings sync are enabled on Windows, macOS and Linux;
macOS/Linux do not report unavailable solely because of the platform. Their
installed connection, expiry and revocation flows still require acceptance.

## User flow

The first-run welcome screen leads with **Create free account or sign in**.
**Continue without an account** applies the reviewed privacy defaults and goes
straight to project setup; the choice is remembered and the welcome screen does not
return. People who already finished setup go straight to their work, connected or
not. A quiet **Connect account** entry sits above Settings in the sidebar while no
account is connected. After the first finished task or on a second day of use, the
workspace shows one dismissible suggestion to connect. **Not now** brings it back
once a week later; closing it, a second **Not now** or connecting retires it. An
unanswered suggestion stays only for the launch it appeared in. These choices are
stored in the renderer's `jackalope-account-prompts-v1`.

Approval and direct-invitation emails open the website download page. The recipient
explicitly confirms the email link before an account session is created. The page
shows platform availability, signup and sign-in; confirming access does not imply
that a build is available for every platform. Account sign-in and waitlist
verification emails retain their existing routes.

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

With the service's `OPEN_SIGNUP` setting on, confirming the signup email approves
the account and signs the browser in, so a new member pairs the desktop as an
approved member. With it off, waitlist members follow the browser's waitlist
sign-in link, verify their email, and confirm the matching desktop code. Their connection persists across restarts
for the device credential's lifetime. Desktop shows their current queue position,
verified and pending referrals, earned priority, and copyable referral link and
share message. Each verified referral earns one day of priority using the same
server calculation as the website. An unavailable position stays unknown; offline
progress is labeled with its last successful check time and never grants access.
The welcome screen also links to the website and app tour before sign-in.

Waitlist connections check for approval every minute and support manual refresh.
An approved membership with previously verified email can continue without pairing
again. Settings sync honors the saved preference after approval; waitlist connections
cannot sync settings, submit member feedback, or use Instant Access Passes, and can
use local work like anyone else. Users can disconnect in the app or revoke their
devices from the website's waitlist page.

## Trust and storage

- The native process generates a random credential. Only its SHA-256 challenge is
  registered at `/v1/desktop/start`; a separate random approval token goes to the
  browser in a fragment. The browser removes the fragment and retains only this
  pending, ten-minute approval context in tab session storage, never a device credential.
- Browser approval requires the existing approved member session or verified waitlist session and
  exact allowed Origin. A checkbox confirms the matching code. Native endpoints
  reject browser Origin headers and do not accept website session cookies.
- `/v1/desktop/exchange` requires native possession of the credential and explicit
  browser approval. Exchange atomically creates one device record; retries with the
  same secret recover a lost response. Consumed approval links cannot connect again.
- Clients advertise persistent waitlist support with `X-Jackalope-Waitlist: 1`.
  Older clients retain the temporary `202 waiting` response. Persistent waitlist
  devices can read account progress and manage their device name/metadata; approved
  API capabilities require approved membership and a previously verified email.
- Server storage contains credential hashes, member association, random device ID,
  connection/expiry timestamps and short-lived pairing state. A member can have ten
  active devices. Device credentials expire 90 days after they were last extended: a
  desktop's account check extends its connection to 90 days once it has fewer than 30
  left, so a desktop in use never has to reconnect. Pairing expires after ten minutes.
  The existing scheduled cleanup removes expired records.
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

Connected desktops lists profile connections grouped by computer. Isolated tests have
independent credentials and local projects, so one computer can hold several
connections. Restarting a profile reuses its saved connection. The service labels the
connections that share a machine key with the same per-response `computer` value (never
the key itself), and the access page groups them in an expandable list, preserving each
profile's details and disconnect action. Against an older service without the label, it
groups by matching name and platform; unnamed connections stay separate.
The access page distinguishes connections by a short ID, platform, app version,
development/release build and default/isolated profile. Account checks run while
the app is open; their timestamp does not establish human activity or task execution.
Settings checks record successful server reads/writes, not confirmation that the
renderer applied a setting. Projects and task history remain local.

Apply `0017_device_machine.sql` before expecting one computer to share a device
slot. Desktop connections send an opaque machine key: a hash of the platform
machine identifier, scoped to Jackalope. The raw identifier stays on the machine.
The ten-device limit counts distinct keys, so extra profiles, reinstalls and data
resets on one computer share a slot. When a computer connects again, the exchange
deletes that member's connections with the same key that have gone unseen for 14 days
(an old profile, a reset, a lapsed sign-in), with their pairing receipts and skill
holdings; live profiles keep their own. `0022_dedupe_machine_devices.sql` clears the
duplicates already stored the same way. Older clients omit the key, and each of those
connections still counts as its own machine.

The desktop names its connection after the computer: the Computer Name from macOS
Sharing settings, the Windows host name in its own case rather than the upper-case
NetBIOS name, or the Linux host name. It sends no name when only `localhost` is set,
and the app and website then show the platform instead.

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
tamper rejection, service binding and renderer credential exclusion, that every
account feature refuses without a current approved account, and that a local task,
its terminal, a conversation (the `jackalope` command's path) and scheduled work run
with no account, an expired credential, a lapsed lease or a revoked lease.
`scripts/verification/verify-optional-account.mjs` covers the welcome actions, the
gated Invitations view, the sidebar entry, suggestion snooze and retirement, waitlist
progress, themes, keyboard focus and narrow layouts in a browser fixture.

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
Also exercise waitlist pairing, restart, live referral progress, clipboard failure,
approval without re-pairing, offline recovery and revoked membership, and run a real
task in a profile that continued without an account. Local D1/HTTP fixtures and native
DPAPI tests are narrower than this deployed/installed acceptance.
