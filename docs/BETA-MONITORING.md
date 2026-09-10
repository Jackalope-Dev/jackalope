# Beta releases, private monitoring and feedback

The desktop and service implement these flows. They are disabled in contributor
builds and are not a claim that signing, production infrastructure or email is live.
Use [RELEASE-AUTOMATION.md](RELEASE-AUTOMATION.md) for publication and
[SERVER-LAUNCH.md](SERVER-LAUNCH.md) for resource provisioning and recovery.

## Release channels

Maintain `beta` for testing and `master` for stable releases. Update beta from the
reviewed source revision intended for testing.
Beta pushes run verification and a disposable-key rehearsal. Run **Desktop release**
manually on beta with channel beta/mode candidate for a signed candidate; stable
candidates run on master with channel stable. Publish through the separate workflow
on master. It verifies the candidate's branch, source SHA, signatures and receipt.
Rehearsals cannot be published. Promotion requires a stable build with stable metadata.

Both feeds use the same trusted updater key and app identity. Numeric versions must
increase: a user leaving beta waits until the stable feed offers a higher version.
Settings → Updates & support persists the selection in the native profile. A channel
change clears the offered update and is blocked during checking/installation; the
native install command also rechecks the chosen channel and version. The telemetry
channel comes from the installed binary, not the selected feed.

Candidate configuration uses these trusted build inputs (never renderer-controlled):

| Input | Purpose |
| --- | --- |
| `STABLE_UPDATE_ENDPOINT` | HTTPS URL ending `/updates/stable/latest.json` |
| `BETA_UPDATE_ENDPOINT` | HTTPS URL ending `/updates/beta/latest.json` |
| `COMMUNITY_SERVICE_URL` | Optional HTTPS origin for native telemetry and feedback |

The hosted candidate workflow supplies both update URLs. Set its
`COMMUNITY_SERVICE_URL` repository variable only after service acceptance. Point both
beta and stable clients at the same accepted service if you want one dashboard to
compare them; release artifacts remain isolated in staging/production feeds. Forks
can supply their own endpoints. Rehearsals strip community endpoints and channel
switching, so they cannot accidentally send real usage data.

Server deployment follows beta → staging and manual master → production. If using
Cloudflare native Builds, change the staging build's watched production branch to
beta; the marketing website continues to track master. Do not enable both native
Builds and the GitHub server deployment job for the same environment.

## What monitoring means

The dashboard reports app opens, task status transitions, feature-view visits and
fixed error categories, filtered by receipt day, binary version and binary channel.
OS is another aggregate dimension. It helps find release regressions and frequently
used surfaces. It cannot measure unique people, individual retention, conversion
funnels, exact crash-free rates, or all native failures. Feature visits are not proof
of successful use. Public ingestion cannot authenticate an open-source client;
rate limits and quotas reduce abuse but do not make counts authoritative.

Before any upload, desktop onboarding presents the usage-sharing disclosure.
Usage defaults on with a one-click continue-without-sharing choice, as recorded in
[BACKEND.md](BACKEND.md). Existing saved opt-outs are preserved. Native preferences
are authoritative. Turning sharing off clears the in-memory queue and cancels native
requests; already transmitted bytes cannot be recalled. Error categories have a
separate control under usage sharing. There is no disk spool or replay of old history.
The queue holds up to 50 events, sends up to 50 at once and retries twice with backoff.
Local execution never waits for the network. Short sessions or outages may lose counts.

No installation/account/device IDs, prompts, code, paths, command output, raw errors
or stacks are accepted. The server atomically increments daily totals and saves only
an event UUID/hash/expiry receipt for retry deduplication. Default retention is 30 days;
daily buckets expire at UTC day boundaries. Legacy v1 event rows expire through the
old cleanup path; v1 ingestion returns 410. D1/application logs exclude raw IPs and
headers. Cloudflare still processes network addresses and login identities: configure
edge, security, Access and backup retention separately. Do not claim that transport
infrastructure never sees identifying data.

## Private dashboard configuration

Provision a Cloudflare Access self-hosted application covering the service's `/admin`
and every `/admin/*` path. Permit only the owner's verified email with an appropriate
identity provider. Restrict the origin's alternate hostnames as well; the Worker
independently verifies the signed assertion, exact issuer/audience and owner email,
so an unprotected workers.dev URL cannot bypass the application check. Protect only
admin paths: desktop ingestion and updater downloads do not use browser Access.

Set deployment configuration, never app source:

| Worker variable | Value |
| --- | --- |
| `ADMIN_EMAIL` | Sole permitted owner email |
| `ACCESS_ISSUER` | `https://YOUR-TEAM.cloudflareaccess.com` |
| `ACCESS_AUD` | Access application's audience tag |
| `INGESTION_ENABLED` | `true` only after migration and acceptance |
| `FEEDBACK_EMAIL_ENABLED` | `true` only after sender setup |
| `FEEDBACK_EMAIL_FROM` | Address on an onboarded sending domain |
| `FEEDBACK_EMAIL_TO` | Private inbox recipient |

For generated deployment config, use `STAGING_` or `PRODUCTION_` prefixes on those
environment variables. `apps/server/scripts/community-config.mjs` validates/copies
them into that environment; native Builds and GitHub deployment use the same helper.
Generated deployment configuration omits the email binding while sending is disabled.
Keep `RATE_SECRET` in Worker secrets and resource IDs in private deployment settings.
An unset admin identity/issuer/audience fails closed. Public configuration uses blank
admin values and disabled ingestion/email; it contains no owner's login address.

Open `/admin` through Access. The dashboard provides 7/30-day filters, channel/version
comparisons and a paginated feedback inbox with new/reviewing/planned/closed states.
Writes require a same-origin request in addition to the verified JWT. Responses are
uncached, framed pages are blocked, and submitted text is never rendered as HTML.
If the aggregate result limit is reached, the page labels results partial and asks
for narrower filters. Missing/expired login shows an error; there is no public bypass.

## Feedback and notification email

Settings → Updates & support offers bug, feature and idea submissions. The user
reviews their message and optional four task counters before Send. Version, binary
channel and OS are attached by the native host. Telemetry opt-out does not disable
feedback. No email identity is automatically attached; include contact details
voluntarily to request a reply. Written feedback may contain personal information,
so it is separate from anonymous metrics and retained privately for 90 days by default.

Acceptance is HTTP 202 only after D1 persistence. Retries reuse the same report UUID
and body; editing after a failed attempt creates a new UUID. A lost acknowledgement
followed by an edit can therefore create a second report. Closing the form does not
persist an unsent draft. The dashboard is the inbox of record.

Cloudflare Email Service needs an onboarded sending domain and its DNS records
before enabling mail. Configure the binding's allowed destination through the helper.
A saved report queues email independently;
the request's background task tries delivery, and the five-minute cron retries with
a lease and backoff, up to five attempts. Provider failures never discard feedback.
The dashboard displays delivery state. After resolving a persistent delivery fault,
an operator can reset `email_attempts=0, email_next=0, email_state='pending'` for a
confirmed report ID in private D1. Delivery is at least once: a process failure after
send but before acknowledgement may duplicate email. Use the report UUID to recognize it.
Mail copies and Cloudflare backups have separate retention from D1; handle deletions
in all of them. Do not forward private reports into public issues automatically.

## Activation acceptance

- Apply all pending service migrations to staging, then validate `/readyz` schema 2,
  quotas and cron.
- Configure Access issuer/audience/owner. Test owner login, another account, expired
  sessions and direct alternate-host requests; only the owner may read or change data.
- Onboard a sender, enable a verified recipient, and submit one deliberate test report.
  Verify dashboard persistence, email arrival, retry behavior and cleanup. Local tests
  mock email and do not establish real deliverability.
- With an isolated installed beta, inspect traffic before disclosure, after opt-out,
  after restart and during outages. Confirm no content/identifiers and correct installed
  channel. Test feedback with telemetry disabled and an uncertain acknowledgement.
- Install a signed stable → beta update, switch back and wait for a higher stable
  version. Test both installer formats, tampered signatures and active-task guards.
- Configure budget alerts, service health checks and quota/expiry backlog monitoring.
  Review edge/Access/email/backup retention and publish accurate privacy language.
- Enable the reporting URL for reviewed candidates only after those checks pass.

Local unit, native and browser-fixture tests cover code behavior; they do not complete
these hosted, installed-app or delivery gates.
