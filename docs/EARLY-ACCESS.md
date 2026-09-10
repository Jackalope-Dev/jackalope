# Early access and invitations

See [waitlist referrals and passes](WAITLIST-REFERRALS.md) for the new ranked
waitlist, separate status sessions, Instant Access Pass presentation, and migration
0008 email lifecycle. The signup confirmation below now contains a waitlist-only
verification link; it still cannot grant membership or download access.

The website collects admission requests in D1. An owner approves them from
`https://api.jackalope.dev/admin/access`, behind Cloudflare Access. The worker also
verifies the Access JWT issuer, audience, expiry, signature and exact owner email.
Public request bodies cannot approve members or choose invitation limits.

The admin dashboard includes setup checks, access filters/search, person details,
website/desktop sign-in progress, recent email history and confirmed access actions.
Approval requires a private download or an explicit missing-download acknowledgement.
Setup checks establish configuration and object availability, not signed-build or
inbox acceptance.

## Member experience

- `/access/` is excluded from search indexing, sitemap and LLM discovery links.
- Approved members receive a branded Sequenzy email with a single-use link. A
  fragment carries the token; the page clears it before requesting the API.
  The recipient explicitly continues, so email preview bots do not consume it.
- Verified sign-in creates a hashed server session and a Secure, HttpOnly,
  SameSite=Lax host cookie lasting 30 days. Sign out deletes the server session.
- Each member starts with five invitations. Email invitations reserve a place
  for seven days. Shared links spend a place after email verification. D1 batch
  transactions, unique indexes and capacity triggers arbitrate competing claims.
- Resending and withdrawing pending invitations are available in the hub. Referral
  progress distinguishes acceptance, the first authenticated download request and
  the first connected desktop. Inviters see those milestones, not projects, agent
  accounts or task activity.
  Accepted invitations remain counted, including after access revocation.
  Owners see their invitees' emails and acceptance status; recipients see that
  disclosure before accepting through a shared link.
- The gate covers the member hub and private prerelease downloads. Desktop
  developer builds and standalone local CLI use do not require a Jackalope cloud
  sign-in. Official beta builds additionally enforce approved native access; see
  [DESKTOP-ACCOUNT.md](DESKTOP-ACCOUNT.md) and [STORE-RELEASE.md](STORE-RELEASE.md).

## Configuration

Apply `apps/server/migrations/0003_early_access.sql` after the first two migrations.
The additive migration creates access members, invitations, tokens, sessions and
an encrypted email outbox. Existing telemetry and feedback tables are unchanged.
Apply outstanding migrations 0004 (desktop accounts), 0005 (mail delivery
references), 0006 (referral progress), 0007 (waitlist insights), 0008 (referrals)
and 0009 (explicit waitlist join time) before deploying the current Worker. Migrations preserve existing data;
older mail remains readable without a delivery lookup reference.

| Setting | Value / purpose |
| --- | --- |
| `EARLY_ACCESS_ENABLED` | `true` after migration, email and owner policy setup |
| `ACCESS_WEB_ORIGIN` | Exact HTTPS marketing origin, normally `https://jackalope.dev` |
| `ACCESS_EMAIL_FROM` | Verified Sequenzy sender, `Jackalope <hello@hello.jackalope.dev>` |
| `ACCESS_EMAIL_REPLY_TO` | `contact@jackalope.dev` |
| `ACCESS_NEWSLETTER_FORM` | Published Sequenzy form ID; empty disables newsletter syncing |
| `ACCESS_INSTALLER_KEY` | Empty until a reviewed installer exists |
| `ADMIN_EMAIL`, `ACCESS_ISSUER`, `ACCESS_AUD` | Exact owner and Cloudflare Access application |
| `ACCESS_SECRET` | Worker secret, independent random 32+ characters for each environment |
| `SEQUENZY_API_KEY` | Worker secret with `transactional:send`; verify minimum permission for email-send lookups before enabling admin delivery checks |
| `VITE_ACCESS_API` | Website build variable, `https://api.jackalope.dev` |

The shared deployment helper reads individual `STAGING_` / `PRODUCTION_` settings
or a single `STAGING_COMMUNITY_CONFIG` / `PRODUCTION_COMMUNITY_CONFIG` JSON object
containing the non-secret service settings above. Nonempty individual settings win;
empty CI variables retain bundled values or defaults. Use an empty string in the
bundle to clear an optional setting.
Unknown keys and malformed values fail the build. Keep this JSON in Cloudflare
Builds or CI settings, not in public source. Worker secrets stay in Worker secret
bindings; they are not website build variables.

The private Access application should cover `api.jackalope.dev/admin` and
`staging-api.jackalope.dev/admin`, including their descendants, and allow only the
owner's email. Keep public `/v1/access/*` and release endpoints outside that policy.
The worker denies admin requests even on a workers.dev URL without a valid JWT.

## Email and newsletter behavior

New waitlist registrations queue a separate transactional signup confirmation in
the same D1 batch as the member insert. It does not create an access token, grant
approval, or require newsletter consent. The generated member ID makes the outbox
insert conditional on a new registration, so duplicate requests and old members
do not resend confirmations even after the 30-day mail retention period. Existing
waitlist members are not bulk emailed by this change. Confirmation mail does not
consume the sign-in/approval cooldown. It uses the same delivery leases and retries
as access mail. Preview it privately at `/admin/access/email-preview?kind=waitlist`.

Approval and invitation emails use the shared Jackalope palette, logo, company
identity, download availability and setup guidance. The admin page offers a
welcome-email preview. The provider acknowledges queue acceptance, not delivery.
New messages retain Sequenzy's durable `emailSendId` separately from legacy job IDs.
Details → Check delivery performs a bounded lookup, caches successful checks for
30 seconds and exposes only normalized status and check time. Older messages and
lookup failures direct the operator to Sequenzy. A queued status is not an inbox
receipt. Each access send explicitly disables open and click tracking through
`trackingSettings`; workspace marketing defaults remain separate.

Private link payloads are encrypted with AES-GCM; only SHA-256 token hashes are
used for token lookup. Five email jobs run concurrently with a 15-second provider
timeout, 32 KB response bound, leases, exponential retry and five-attempt limit.
The five-minute cron retries durable jobs. Delivery is at least once: a worker
crash after provider acceptance can duplicate an email, but not consume two places.
Provider requests use manual redirect handling and reject non-success responses.
Worker logs report failed delivery stages, HTTP status when available and attempt
number without exposing recipients, access tokens or provider response bodies.
Access-link requests are capped at one per minute and ten per day. Members can
create at most 25 invitations per day, including withdrawn invitations.

Newsletter consent is optional and unchecked. D1 accepts the admission request
before attempting newsletter synchronization. Consented addresses sync through
Sequenzy's subscriber API with the signup choice recorded as confirmed opt-in;
this path does not send a separate newsletter confirmation or start a sequence.
The email-only website fallback uses a saved form with its own provider-managed
confirmation settings. Sync has independent bounded retries. Existing active
subscribers must be imported only from the exact
Jackalope waitlist audience, never the company's entire subscriber database.

After five failures, inspect the sender/provider configuration first. The private
admin's Send access link action creates a fresh request subject to the cooldown.
For unsynced newsletter consent, an operator may reset `newsletter_attempts` and
`newsletter_next_at` for the affected consenting member after correcting the cause.
Never reset `newsletter_synced_at` to resubscribe someone who opted out.

## Private installers and rollout

Approved members can also connect the desktop through browser approval using the
same magic-link sign-in. This adds device membership, not a download or updater
credential. Apply migration 0004 before deploying the new routes; follow
[DESKTOP-ACCOUNT.md](DESKTOP-ACCOUNT.md) for storage, revocation and acceptance.

Connected desktops can read their member's invitation link and bounded invitation
progress through the device credential. The desktop cannot send or revoke email
invitations; those remain explicit website actions. The first authenticated download
request and first desktop connection are retained for referral attribution even if a
device is later disconnected.

Upload only a reviewed, signed candidate to the selected private R2 bucket under
`early-access/vX.Y.Z/Jackalope-setup.exe`, then set `ACCESS_INSTALLER_KEY` in the
environment's deployment configuration. The authenticated download endpoint streams
that object with `no-store`; the public update route rejects this prefix. Do not
enable the R2 public development URL. No installer is seeded by this feature.

Public stable/beta update feeds are a separate release decision. This feature does
not retroactively make a published update object private. Keep public publication
disabled while prerelease distribution is invite-only.

For rollback, disable `EARLY_ACCESS_ENABLED`, clear `VITE_ACCESS_API` and rebuild
the website. Preserve the additive D1 tables and Worker secrets for recovery.
Rotating `ACCESS_SECRET` makes pending encrypted outbox jobs unreadable; drain or
invalidate them and issue fresh links. Token and session hashes do not use that key.

## Retention and acceptance

Expired sessions/tokens are pruned every five minutes. Used tokens are removed
after one day, mail records after 30 days, and encrypted payloads after queue
acceptance or seven days. Members and accepted referral records persist for access
and quota management until an operator handles a deletion request. Include related
referral records, pending mail, Sequenzy records and backups in that request; revoke
access first. Do not delete an accepted referral merely to recover an invitation.

The current local checks cover racing sixth claims, replay, origin checks, expired
links, revoked owners/members, email reservation rollback, newsletter consent,
provider retry bounds, private admin routes and authenticated private R2 downloads.
Browser checks cover explicit token acceptance, URL cleanup, invitation send and
withdraw, sign out/sign in, optional consent and responsive light/dark rendering.
They use mocked provider responses and local installer fixtures. Real inbox
delivery and signed installer acceptance must be recorded separately.
