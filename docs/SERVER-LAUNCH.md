# Cloudflare server launch and operations

Maintainer procedure for deploying and operating an independent service.
Commands using `--remote` or omitting `--local` affect the selected account.
Deployment state and credentials belong in private operator records.

The service is in [`apps/server`](../apps/server/README.md). Its reviewed wire
contract covers metadata telemetry, explicit feedback and Windows update files.
Desktop delivery is implemented but contributor builds have no reporting endpoint.
Hosting the service does not activate installed clients. See [BETA-MONITORING.md](BETA-MONITORING.md). Follow [RELEASE.md](RELEASE.md) for installer signing and
installed-app acceptance, and [BACKEND.md](BACKEND.md) for the later remote backend.

## 1. Record the launch inputs

Use a maintainer-reviewed revision and record these values privately.
Keep secrets in your password manager/Cloudflare secret store, not this document.

| Input | Required value or decision |
| --- | --- |
| Operator and incident contact | Who owns deploys, feedback triage, deletion and outages |
| Cloudflare account | Account ID, access roles and chosen Workers/D1/R2 plan; configured CPU limits require Workers Paid |
| Monthly budget | Operator-set alert thresholds, estimated request/storage volumes and response when exceeded |
| Staging hostname | For example `service-staging.YOUR-DOMAIN`; an actual Cloudflare-managed zone you control |
| Production hostname | For example `service.YOUR-DOMAIN`; preserve this hostname across desktop releases |
| D1 placement | Select location hint or jurisdiction when creating each database; do not infer it from your workstation |
| Storage policy | Proposed defaults: 30-day telemetry, 90-day feedback, five-minute expiry; approve and publish actual policy before client activation |
| Backup/log policy | D1 Time Travel, private exports, platform access/security logs, deletion and operator access |
| Names and bindings | Separate staging/production databases, buckets, rate namespaces and secrets |
| Signing inputs | Existing Windows signer and updater key references; private signing keys stay off this Worker |
| Client activation | Visible onboarding disclosure/opt-out, installed traffic acceptance still required |

The Worker runs at the edge. A D1 location hint is a placement hint, not a
guarantee that the whole service processes data only there. Review Cloudflare's
[D1 location options](https://developers.cloudflare.com/d1/configuration/data-location/)
before choosing a jurisdiction. No region choice is embedded in the scaffold.

## 2. Verify the source locally

Run from the repository root in PowerShell, using Node 24 and the repository's
pinned pnpm version. Preserve unrelated drafts. Stop on any nonzero exit code.

```powershell
git status --short
git rev-parse HEAD
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter @jackalope/server types
pnpm --filter @jackalope/server typecheck
pnpm --filter @jackalope/server test
pnpm --filter @jackalope/server build
pnpm build
```

The server build is `wrangler deploy --dry-run`, which only bundles locally.
Tests use the Workers runtime and real local D1/R2 bindings; they cover schemas,
atomic retries/conflicts, concurrent row limits, retention, HTTP boundaries and
release streaming. They do not prove your future account's DNS, TLS, billing,
rate-limit distribution, cron delivery or installed-app updates. The Windows
verification workflow includes these server checks but performs no deployment.

For an HTTP smoke trial, follow the service README's local migration/dev steps.
Use its disposable sample secret only locally. Confirm `/readyz`, POST a synthetic
event twice, inspect one D1 row, and trigger `/__scheduled` locally. Restart the
dev process and confirm the row persists. Never place real feedback in fixtures.

## 3. Create isolated resources

### Preserve ingestion across deployments

Set the ingestion decision in the controller that actually deploys the Worker.
GitHub Actions repository variables are not available to Cloudflare Workers Builds.
For Workers Builds, open the Worker settings, find its build configuration and add
`PRODUCTION_INGESTION_ENABLED=true` to the production build's variables. Use
`STAGING_INGESTION_ENABLED` for staging. The corresponding `COMMUNITY_CONFIG` JSON
can also carry `INGESTION_ENABLED`; a nonempty standalone variable takes precedence.
Keep the value `false` until activating that environment is intended.

Configure `PRODUCTION_ACCESS_AUDIENCE_LIST` in the same build controller using the
verified list ID from the service's Sequenzy workspace. The corresponding bundled
`ACCESS_AUDIENCE_LIST` setting is also supported. Keep staging disconnected or use
a separate test list. To clear a previously bundled list, remove any standalone
override and set `ACCESS_AUDIENCE_LIST` to an empty string in the bundle. Empty
standalone CI variables preserve bundled values. Runtime secrets and build-time
variables are separate; retain the existing service API key in its secret binding.
The Sequenzy key needs `subscribers:write` in addition to its transactional sending
permission. Audience reconciliation uses explicit lists, disables sequence
enrollment, preserves unrelated tags and attributes, and does not reactivate
provider-unsubscribed contacts. Confirm provider acceptance after deployment;
setting a list ID alone does not verify the key's permissions. See Sequenzy's
[create](https://docs.sequenzy.com/api-reference/subscribers/create) and
[update](https://docs.sequenzy.com/api-reference/subscribers/update) contracts.

Use the generated configuration from `node scripts/release/cloudflare.mjs prepare`
for deployment, then run `node scripts/release/cloudflare.mjs verify` with the same
environment variables. Both commands run from the repository root and require
`DEPLOY_ENV` and `UPDATE_BASE_URL`; preparation also requires `CLOUDFLARE_ACCOUNT_ID`
and `SERVER_D1_ID`. Deploy with the matching `--env` and
`--config .wrangler/release/wrangler.json` from `apps/server`.
Retain the existing build checks, resource bindings, secret configuration and
migration steps when changing the controller commands.

Preparation rejects a missing ingestion decision instead of falling back to the
disabled contributor default. Verification rejects an unexpected ingestion state,
even if `/readyz` otherwise reports ready. The public source configuration stays
disabled. A dashboard runtime edit alone can be overwritten on the next deploy;
`--keep-vars` does not override a conflicting value explicitly present in the
deployment configuration. For an incident shutdown, set the controller's explicit
value to `false` as well as changing the live setting.

After updating the controller, deploy the reviewed revision and confirm `/readyz`
reports the intended `ingestionEnabled` value. Allow for deployment propagation
before rerunning a failed post-deployment check. Keep one deployment controller
per Worker, as described in [release automation](RELEASE-AUTOMATION.md).

All remaining `pnpm exec wrangler --config wrangler.deploy.jsonc` examples run from **`apps/server`**. Open that
directory in a dedicated PowerShell terminal; do not mix root-relative commands
from the release guide into this terminal. The pinned package provides Wrangler.

```powershell
Set-Location apps/server
if (!(Test-Path -LiteralPath wrangler.deploy.jsonc)) {
    Copy-Item -LiteralPath wrangler.jsonc -Destination wrangler.deploy.jsonc
}
pnpm exec wrangler --config wrangler.deploy.jsonc login
pnpm exec wrangler --config wrangler.deploy.jsonc whoami
```

Set `account_id` in `wrangler.deploy.jsonc` to the confirmed account ID so a multi-account
login cannot silently target the wrong account. Review account roles: the launch
operator needs Workers/scripts/secrets, D1, R2 and the chosen zone's domain access.
For future automation use a scoped API token in the CI secret store. The verification job needs no deployment token. Optional deployment workflows
require separate, explicitly configured credentials and enablement.

The example resource names already match the configuration. Change them together
if necessary. Pick the D1 location/jurisdiction first; append the chosen
`--location <hint>` or `--jurisdiction <value>` to each D1 create command. The
unqualified example lets Cloudflare choose placement.

```powershell
pnpm exec wrangler --config wrangler.deploy.jsonc d1 create jackalope-service-staging --env staging --update-config=false
pnpm exec wrangler --config wrangler.deploy.jsonc r2 bucket create jackalope-releases-staging --env staging --update-config=false
pnpm exec wrangler --config wrangler.deploy.jsonc d1 create jackalope-service-production --env production --update-config=false
pnpm exec wrangler --config wrangler.deploy.jsonc r2 bucket create jackalope-releases-production --env production --update-config=false
```

Replace each environment's placeholder `database_id` in `wrangler.deploy.jsonc` with the
UUID returned for that database. Verify names and UUIDs as a pair. The IDs ending
`0002`/`0003` are placeholders, never usable deployment values. Keep R2 buckets
private: do not enable `r2.dev` or public bucket domains. The Worker exposes only
the reviewed release-key allowlist; feedback and exports never go in this bucket.

Rate-limit `namespace_id` values must be unused numeric strings in your account.
The six values `2001`–`2003`/`3001`–`3003` are proposed, not reserved. Verify them
against existing Workers and assign distinct IDs per environment and limiter.
There is no separate database or Durable Object to provision for these bindings.
See [rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## 4. Configure domains and secrets

For the initial staging trial, `env.staging.workers_dev` is now enabled so Wrangler
can print a reachable workers.dev URL without custom DNS. When moving staging to
a custom domain, disable that setting as described below. Production remains
disabled until explicitly configured.

Under `env.staging`, add this field using your owned hostname; repeat under
`env.production` with the production hostname:

```json
"routes": [{ "pattern": "service-staging.YOUR-DOMAIN", "custom_domain": true }]
```

Keep `workers_dev: false` and `preview_urls: false`. Cloudflare provisions DNS/TLS
for the custom domain during deployment; resolve any existing conflicting record
deliberately. This route owns the entire hostname, so use a dedicated subdomain.
See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Keep `INGESTION_ENABLED: "false"` initially in both environments. The service can
host updates while collection is off. `ENVIRONMENT` must match its environment;
never deploy the top-level local configuration. Retention values are integer days
between 1 and 365; defaults are 30/90. The configured CPU ceiling is a guardrail,
not measured capacity: load-test representative batches and retention on staging.

Create a different cryptographically random secret per environment, at least 32
characters (for example a password-manager-generated 64-character value). Paste
only at Wrangler's hidden prompt:

```powershell
pnpm exec wrangler --config wrangler.deploy.jsonc secret put RATE_SECRET --env staging
pnpm exec wrangler --config wrangler.deploy.jsonc secret put RATE_SECRET --env production
```

If Wrangler asks to create the missing named Worker on the first secret upload,
verify the name/environment before accepting. This creates the initial script
container; the application deploy follows. Never use the local example secret,
put the value on a command line, or commit `.dev.vars`. The rate secret only
HMACs a daily IP-derived limiter key; it is not client authentication. Rotating it
resets those limiter identities without affecting stored rows or update signatures.

## 5. Migrate and launch staging with ingestion off

```powershell
pnpm exec wrangler --config wrangler.deploy.jsonc d1 migrations list DB --env staging --remote
pnpm exec wrangler --config wrangler.deploy.jsonc d1 migrations apply DB --env staging --remote
pnpm exec wrangler --config wrangler.deploy.jsonc deploy --env staging --dry-run --outdir dist/staging
pnpm exec wrangler --config wrangler.deploy.jsonc deploy --env staging
```

Record the deployed Worker version ID, source revision, database UUID, bucket,
hostname, migration list, settings and timestamp. These are not secret values.
Check HTTPS on the actual host:

```powershell
$serviceUrl = 'https://service-staging.YOUR-DOMAIN'
Invoke-RestMethod "$serviceUrl/healthz"
Invoke-RestMethod "$serviceUrl/readyz"
```

Expect `status: ok`, then `status: ready`, `schemaVersion: 2`,
`ingestionEnabled: false`. Readiness checks the database schema and secret, not
R2 contents, quota headroom, cron health or delivery guarantees. An absent update
manifest is 404 until uploaded. Anonymous POSTs should return 503
`ingestion_disabled`, with `Retry-After: 300`.

## 6. Exercise staging ingestion, then pause it

Change only staging `INGESTION_ENABLED` to `"true"` and deploy staging again.
Use synthetic data. Run this from the server terminal:

```powershell
$eventId = [guid]::NewGuid().ToString()
$eventBody = @{
  schemaVersion = 2
  events = @(@{ id = $eventId; appVersion = '0.1.0'; os = 'windows'; channel = 'stable'; name = 'app_opened' })
} | ConvertTo-Json -Depth 5 -Compress
Invoke-WebRequest "$serviceUrl/v2/telemetry" -Method Post -ContentType application/json -Body $eventBody
Invoke-WebRequest "$serviceUrl/v2/telemetry" -Method Post -ContentType application/json -Body $eventBody
$feedbackId = [guid]::NewGuid().ToString()
$feedbackBody = @{
  schemaVersion = 2; kind = 'bug'; id = $feedbackId; appVersion = '0.1.0'; os = 'windows'; channel = 'stable'
  message = 'Synthetic staging launch check'
} | ConvertTo-Json -Compress
Invoke-WebRequest "$serviceUrl/v2/feedback" -Method Post -ContentType application/json -Body $feedbackBody
pnpm exec wrangler --config wrangler.deploy.jsonc d1 execute DB --env staging --remote --command 'SELECT name, retained, max_rows FROM quotas'
```

Expect all POSTs to return 202, one event despite its retry, and one feedback row
above the prior counts. Inspect the synthetic rows in the private D1 console and
application logs: no raw IP, authorization header, prompt or file path should be
recorded. Use the README error table to trial an unknown field (400), changed
payload with the same ID (409), oversized body (413), Origin header (403), and
burst from one client (429). Limiters are approximate and shared-IP users share
their allowance. Do not run an unbounded load generator against production.

For cron acceptance, expire only these synthetic staging rows using their
confirmed UUIDs in the private D1 console. Never paste arbitrary user input into
SQL. Use `UPDATE ... SET expires_at=0 WHERE id='CONFIRMED-SYNTHETIC-UUID'` on the
correct table; wait for the hourly `17 * * * *` UTC trigger. Confirm the rows and
quota counts decrease, and check invocation outcome. The local `/__scheduled`
test route is not a production API. Rehearse the restore process below with
staging test data. Reset staging ingestion to false after the trial if unused.

## 7. Publish update files through R2

In a **separate repository-root terminal**, prepare signed installers using
[RELEASE.md](RELEASE.md). For the chosen release version, pass these values to
`scripts/build-signed-release.ps1` along with its signing arguments:

```text
UpdateUrl:       https://service.YOUR-DOMAIN/updates/stable/latest.json
ArtifactBaseUrl: https://service.YOUR-DOMAIN/updates/releases/v0.2.0
```

Use the staging hostname for a trial installer/feed. Update URLs and the trusted
public key are embedded at build time; the Worker holds neither signing key.
Use the version actually in `tauri.conf.json`, not an example copied from here.
The script emits installers plus `.sig` files, `output/release/checksums.json`,
and `output/release/latest.json`. Complete signature and installed-upgrade trials
before promoting a production manifest.

Back in the **server terminal**, upload to staging first. Example for 0.2.0:

```powershell
$releaseVersion = '0.2.0'
$releaseBucket = 'jackalope-releases-staging'
$releaseEnvironment = 'staging'
$bundleRoot = [System.IO.Path]::GetFullPath('../desktop/src-tauri/target/release/bundle')
$releaseOutput = [System.IO.Path]::GetFullPath('../../output/release')
$releaseFiles = @(
  (Join-Path $bundleRoot "nsis/Jackalope_${releaseVersion}_x64-setup.exe"),
  (Join-Path $bundleRoot "nsis/Jackalope_${releaseVersion}_x64-setup.exe.sig"),
  (Join-Path $bundleRoot "msi/Jackalope_${releaseVersion}_x64_en-US.msi"),
  (Join-Path $bundleRoot "msi/Jackalope_${releaseVersion}_x64_en-US.msi.sig"),
  (Join-Path $releaseOutput 'checksums.json')
)
foreach ($releaseFile in $releaseFiles) {
  if (!(Test-Path -LiteralPath $releaseFile)) { throw "Missing artifact: $releaseFile" }
  $releaseName = [System.IO.Path]::GetFileName($releaseFile)
  pnpm exec wrangler --config wrangler.deploy.jsonc r2 object put "$releaseBucket/releases/v$releaseVersion/$releaseName" --file $releaseFile --remote --env $releaseEnvironment
  if ($LASTEXITCODE -ne 0) { throw "Upload failed: $releaseName" }
}
```

Adjust `$bundleRoot` if the signing build used `CARGO_TARGET_DIR`. Verify every
uploaded artifact by downloading its public HTTPS URL into a private trial
directory and comparing SHA-256 with the signed candidate. Also verify
Authenticode and the updater signature through the installed-app trial. Check
HEAD/content length and the manifest's EXE/MSI platform URLs. Only after files
and their signatures are reachable, upload the manifest **last**:

```powershell
pnpm exec wrangler --config wrangler.deploy.jsonc r2 object put "$releaseBucket/stable/latest.json" --file (Join-Path $releaseOutput 'latest.json') --content-type application/json --remote --env $releaseEnvironment
```

The Worker serves exactly `stable/latest.json` and `releases/vVERSION/` keys for
`Jackalope_VERSION_x64-setup.exe`, `Jackalope_VERSION_x64_en-US.msi`, their `.sig`
files and `checksums.json`. It streams downloads, supports HEAD/ETag, and does
not implement ranged resume. Never overwrite a versioned artifact; it has a
one-year immutable cache header. Preserve older installers referenced by clients.
Save each published manifest alongside its version's release record in your
artifact archive. Replacing `stable/latest.json` may take up to 60 seconds to be
seen by clients; avoid extra cache rules that extend that lifetime.

For production, use the production bucket/environment and a manifest built with
production URLs. Do not copy a staging manifest unchanged. Publication of the
production manifest is the final release promotion, separate from Worker deploy.

## 8. Launch production and activate clients separately

Repeat staging's migration, dry-run, deployment and HTTPS checks with
`--env production`; confirm the production UUID/bucket/hostname each time. Keep
production ingestion **off** while first bringing up updates. Record the exact
Worker version, schema and published manifest hash in the release record.

Before enabling ingestion, complete the installed-app acceptance in
[BETA-MONITORING.md](BETA-MONITORING.md): disclosure before any upload, opt-out
across restart, fixed allowlists, bounded retry deduplication, actual binary channel
attribution and feedback independent from telemetry. Current implementation holds
at most 50 queued events, sends batches up to 50, retries twice, and has no disk
spool or historical replay. Native cancellation stops in-flight requests when
privacy choices change; bytes already transmitted cannot be recalled.

Configure the private Access application and verified email sender, then deploy
with reviewed environment flags. Roll out through a small beta before widening
collection. Pairing, teams and hosted execution remain separate roadmap work.

## 9. Operate and review feedback

Use the Access-protected /admin dashboard for aggregates and a paginated inbox
(new, reviewing, planned, closed). Email notifications retry independently from
submission acceptance. Assign an owner before advertising Send. Export private
feedback only into access-controlled storage, never into public issues without
the submitter's agreement. See BETA-MONITORING.md for setup and delivery limits.

Useful private D1 queries (the console can run these directly):

```sql
SELECT name, retained, max_rows FROM quotas;
SELECT count(*) AS expired FROM events WHERE expires_at <= unixepoch()*1000;
SELECT count(*) AS expired FROM feedback WHERE expires_at <= unixepoch()*1000;
SELECT id, received_at, payload FROM feedback ORDER BY received_at DESC, id DESC LIMIT 100;
SELECT name, sum(count) AS total FROM metrics WHERE day >= date('now','-7 days') GROUP BY name;
SELECT count(*) AS expired FROM telemetry_receipts WHERE expires_at <= unixepoch()*1000;
```

Analytics are event counts, not people or retention. Ingestion cannot prove that
an event represents a real client; days use receipt time. Do not use for billing.

Watch Worker errors/CPU/requests, D1 failures/storage/reads/writes, R2 usage,
quota headroom and expired-row backlog. Set operator-chosen billing alerts in the
account, and investigate retained counts approaching 80% of either cap. Schedule
an external `/readyz` check and update-file availability check if your operations
tool supports it. No external monitor is provisioned by this repository.

Logs contain only allowlisted `service_error` codes and retention outcome/counts;
unexpected exception text is suppressed. Invocation logs are disabled, with 10%
sampling for enabled Worker observability. Therefore absence of an individual
retention log is not proof cron failed; inspect cron outcomes and the database.
Cloudflare's own edge/security/access logs may still carry network metadata;
review their access and retention before publishing privacy language. Never
enable body dumps, full-URL request logging, session replay or raw-error tracing.

The five-minute job deletes at most 100,000 expired rows per class. Backlogs or failed
cron runs extend actual retention until cleanup succeeds. Alert on expired rows
remaining across two scheduled runs, then investigate load/failures. Changing the
receipt/feedback retention vars affects only new rows (aggregate retention uses the current window); shortening existing lifetimes needs an
maintainer-reviewed SQL update and cleanup. Deleted records release quota atomically.

Rate limits apply per edge location, not globally. Attackers may fill anonymous
storage despite them. Quotas, payload bounds and CPU limits are **not a hard bill
cap**; Worker requests and rejected traffic still cost resources. If abused,
pause ingestion and use account-level WAF/rate controls scoped to `/v2/*` after
testing native clients. Keep `/updates/*` available. Avoid interactive browser
challenges on a native updater or silently adding a desktop-wide shared secret.

## 10. Deletion, backup and recovery

For manual deletion, use the private D1 console and a confirmed report UUID.
There is no installation ID or per-user lookup in new telemetry: individual
contributions cannot be recovered from aggregate counts. Delete selected aggregate
cohorts only through an operator-reviewed query, and purge receipts separately.
Legacy v1 rows may still carry install_id until their expiry; use that field only
for legacy deletion. Feedback uses its separate id. Run SELECT before DELETE,
verify scope and quota counts, and use bounded batches. Email copies and backups
have separate retention; delete those too when handling a feedback deletion.

Before migrations/repair, save a recovery point and, where needed, an encrypted
private export. From `apps/server`:

```powershell
New-Item -ItemType Directory -Path backups -Force | Out-Null
pnpm exec wrangler --config wrangler.deploy.jsonc d1 time-travel info DB --env production
pnpm exec wrangler --config wrangler.deploy.jsonc d1 export DB --env production --remote --output backups/pre-migration.sql
```

Use a unique dated filename in practice; do not overwrite your last good export.
`backups/` and `exports/` are ignored, which prevents accidental commits but does
not encrypt or restrict access. Move required archives into managed private
storage and expire them under the approved policy. D1 Time Travel history is
separate from live-row retention; deletion does not erase historical recovery
points. Review the account plan's recovery window and disclose backup lifetime.
See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

For a bad **Worker code deploy**, inspect versions and roll back the explicit
known-good version, or redeploy the prior reviewed source with current config:

```powershell
pnpm exec wrangler --config wrangler.deploy.jsonc versions list --env production
pnpm exec wrangler --config wrangler.deploy.jsonc rollback KNOWN_GOOD_WORKER_VERSION_ID --env production --message 'Restore verified service version'
```

Check effective settings after rollback, especially the ingestion kill switch.
Worker rollback does not undo D1 data/schema or R2 uploads. Keep migrations additive
and backward compatible; a forward migration is generally safer than restoring
data. See [Worker rollback scope](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

For a **database incident**, first pause ingestion and temporarily remove the
environment's cron trigger before deploying that configuration; otherwise cleanup
can race a restore. Export the current state and note both the pre-incident and
current bookmarks. Rehearse on staging, then restore the explicitly selected
production bookmark if losing newer writes is acceptable:

```powershell
pnpm exec wrangler --config wrangler.deploy.jsonc d1 time-travel restore DB --env production --bookmark VERIFIED_PRE_INCIDENT_BOOKMARK
```

This overwrites the database and cancels in-flight queries. Verify migration
history, table counts and quota counters against actual rows before reopening
ingestion. Restore cron, remove newly expired rows, and reapply any required
deletions that a backup resurrected. A SQL export is a secondary recovery artifact:
import it into a **new empty recovery D1 database**, verify schema/indexes/triggers
and quota consistency, then deliberately rebind the Worker. Do not execute a full
dump over a live database. The launch acceptance includes a staging recovery drill;
an untested export is not evidence of a successful restore.

Example secondary recovery commands, after selecting a unique recovery name and
the same approved data placement as production:

```powershell
pnpm exec wrangler --config wrangler.deploy.jsonc d1 create jackalope-service-recovery-YYYYMMDD --env production --update-config=false
pnpm exec wrangler --config wrangler.deploy.jsonc d1 execute jackalope-service-recovery-YYYYMMDD --env production --remote --file backups/pre-migration.sql
pnpm exec wrangler --config wrangler.deploy.jsonc d1 execute jackalope-service-recovery-YYYYMMDD --env production --remote --command 'SELECT name, retained, max_rows FROM quotas'
```

Do not apply migrations to the empty recovery database before importing the full
dump; it already contains schema and migration history. Compare actual event and
feedback counts with `quotas.retained`, inspect all indexes/triggers and apply any
subsequent reviewed migrations before switching `env.production.DB` to the recovery
database name/UUID. Keep the original database until the recovery is accepted.

For a **bad desktop release**, republish the prior trusted `stable/latest.json`
from the release archive. Do not overwrite immutable installer keys. This prevents
further offers after cache expiry; it does not downgrade users who already
installed the newer version. Ship a higher-version corrective update using the
same trust chain. Use RELEASE.md's key-compromise and failed-upgrade procedures.

For **ingestion abuse/outage**, set the affected environment's
`INGESTION_ENABLED: "false"` and deploy it. Verify POSTs return 503 and signed update
downloads still succeed. If the Worker itself is compromised, disable its route
or deploy the known-good source as an incident action; account for update downtime.

## 11. Launch acceptance and handoff record

Record actual deployment evidence privately; local unit tests do not establish
these results:

- [ ] Reviewed revision, account/plan/budget, owner, hostnames and region policy recorded.
- [ ] Separate resources and secrets verified; no placeholder UUIDs or public R2 bucket.
- [ ] Staging migration, HTTPS, duplicate/schema/rate-limit and cron trials passed.
- [ ] Private feedback triage and monitoring configured; backup/deletion recovery rehearsed.
- [ ] Signed artifact downloads match local hashes; manifest uploaded last and cache behavior checked.
- [ ] Packaged old-to-new update, failure/tamper and clean-profile journeys passed per RELEASE.md.
- [ ] Production migrated/deployed with exact Worker version and manifest hash recorded.
- [ ] Before activation: installed disclosure, opt-out, explicit Send, Access login and email delivery verified.

Keep live endpoints, ingestion state, migration versions and recovery records in
private operator storage. Update public documentation when the supported service
contract changes. This service does not implement the remote execution backend.
