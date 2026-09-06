# Jackalope service

Cloudflare Worker with D1 telemetry/feedback storage and a private R2 release
bucket. Public defaults run locally; deployment uses an explicit private
`wrangler.deploy.jsonc` copied from `wrangler.jsonc`, with your account and resource
identifiers. Pass `--config wrangler.deploy.jsonc` for remote operations. Follow
[SERVER-LAUNCH.md](../../docs/SERVER-LAUNCH.md) for infrastructure, publication,
monitoring, retention, recovery and the remaining desktop integration gates.

## Local development

From the repository root, use Node 24 and the repository's pnpm version:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @jackalope/server types
pnpm --filter @jackalope/server typecheck
pnpm --filter @jackalope/server test
pnpm --filter @jackalope/server build
pnpm --filter @jackalope/server db:local
Copy-Item apps/server/.dev.vars.example apps/server/.dev.vars
pnpm --filter @jackalope/server exec wrangler dev --local --var INGESTION_ENABLED:true --test-scheduled
```

Only copy the example if `.dev.vars` does not already exist. The example secret is
for disposable local work. `build` **only bundles with `--dry-run`**. Tests run
inside workerd with local D1/R2 and apply the real migration. Most rate-limit tests
substitute deterministic limiter responses; production edge behavior needs a
staging trial. Wrangler may warn about a missing shell secret during tests; test
bindings supply their own dummy secret. No Cloudflare login is needed locally.

Wrangler defaults to port 8787. Local D1/R2 persist under `.wrangler/state`, while
Vitest uses separate temporary storage. Keep the local explorer and scheduled-test
endpoint bound to localhost. Never deploy a development proxy. To manually run
retention locally, request `http://localhost:8787/__scheduled?cron=17+*+*+*+*`.

## HTTP contract v1

| Route | Behavior |
| --- | --- |
| `GET /healthz` | Process liveness, no database dependency |
| `GET /readyz` | Checks migrated quota tables and rate secret; includes `ingestionEnabled` |
| `POST /v1/telemetry` | Atomic, idempotent batch of allowlisted metadata events |
| `POST /v1/feedback` | Explicit free-text feedback with optional bounded counters |
| `GET, HEAD /updates/stable/latest.json` | Current updater manifest from R2; 60-second cache lifetime |
| `GET, HEAD /updates/releases/vVERSION/FILE` | Immutable Windows EXE/MSI, matching `.sig`, or `checksums.json` |

All routes reject query strings. Ingestion accepts JSON (optional UTF-8 charset),
at most 32,768 **bytes**, with a 10-second body-read deadline. Encoded bodies and
browser Origin headers are rejected. This is a native-client API without CORS,
accounts or client secrets. Origin checks do not authenticate callers. Never
embed the server's Cloudflare credentials or `RATE_SECRET` in an installer.

Example telemetry request:

```json
{
  "schemaVersion": 1,
  "installId": "c2dbcc1c-729b-425a-b767-ed92b7dbf1ea",
  "events": [{
    "id": "053850e0-7f84-4883-a19d-7bb90f331459",
    "appVersion": "0.1.0",
    "os": "windows",
    "name": "app_opened"
  }]
}
```

Every event has a random UUID v4 `id`, stable `major.minor.patch` `appVersion`
(32 characters maximum), and `os` (`windows`, `macos`, `linux`). A batch contains
1–50 events and a random UUID v4 `installId`. No task ID or user text is accepted.

| Event name | Additional required field and accepted values |
| --- | --- |
| `app_opened` | None |
| `task_state` | `state`: `starting`, `running`, `review`, `reviewed`, `failed`, `stopped`, `interrupted` |
| `feature_used` | `feature`: `tasks`, `worktrees`, `agents`, `usage`, `codebase`, `settings` |
| `app_error` | `code`: `history_save_failed`, `verification_failed`, `update_failed` |

Schemas reject unknown fields at every nesting level. They intentionally exclude
durations, timestamps supplied by clients, arbitrary exceptions and crash dumps.
Adding an event requires a reviewed schema change and tests. Server receipt time
is authoritative for retention; it does not measure the time a task ran.

Example separate feedback request:

```json
{
  "schemaVersion": 1,
  "id": "43af6154-574d-40e9-9f80-79251c93d702",
  "appVersion": "0.1.0",
  "os": "windows",
  "message": "I could not find how to reopen a completed task.",
  "diagnostics": {
    "attempts": 3,
    "reviewed": 1,
    "failed": 1,
    "historySaveFailures": 0
  }
}
```

`message` is 1–8,000 characters and must contain non-whitespace. The entire optional
`diagnostics` object is either omitted or includes all four integer counters,
each between zero and 10,000,000. Feedback carries no anonymous install ID,
email field, attachment or diagnostic bundle. The user can voluntarily type
personal data into the message; operators must treat feedback as private and
render it as text, never as trusted HTML or agent instructions.

Success returns HTTP 202 after D1 confirms persistence: `{ "accepted": N }` for
telemetry, `{ "accepted": true, "id": "..." }` for feedback. `N` includes identical
retries; it is not the count of newly inserted rows. Reuse the same ID and payload
when retrying. Different payload under the same event/install pair or feedback ID
returns 409 `id_conflict`; a conflicting batch persists **none** of its new events.
JSON object field order does not affect identity. Deduplication lasts until the
stored record expires or is deleted; clients must not replay old queues forever.

Errors are JSON `{ "error": "code" }`. Unknown routes return 404, wrong methods
405, invalid JSON/schema 400, missing/encoded content type 415, oversize 413,
body timeout 408, disallowed origin/missing production edge identity 403,
limits 429 `rate_limited`, and disabled/misconfigured/unavailable/full storage
503. Only 429/503 include `Retry-After` (60/300 seconds). No database messages or
payloads are returned. Clients should drop permanent failures, treat 409 as an
ID bug, and use bounded backoff with jitter for transient failures. Local task
execution must never await telemetry delivery.

## Operations boundary

`RATE_SECRET` HMACs the connecting IP with a daily epoch for rate-limit keys. Raw
IP and headers are not saved in D1 or application logs. Edge infrastructure still
processes IP addresses. Rate bindings are per Cloudflare location, approximately
60 ingestion requests/minute/IP, 5 feedback requests/minute/IP, and 600 total
ingestion requests/minute/location. Shared-IP users share an allowance; distributed
attackers can exceed the location total across the network. These are abuse
controls, **not authentication, trustworthy analytics, or a hard spending cap**.

D1 transaction triggers cap retained telemetry at 1,000,000 rows and feedback at
10,000 rows independently. Identical retries work when full. Hourly retention
deletes up to 100,000 expired rows per class per run (20 bounded batches). Defaults
are 30 days for telemetry and 90 days for feedback. Changing the configured days
only changes expiry for new records. The launch guide covers backlog monitoring,
manual deletion and the separate lifetime of backups.

There is no public list/export/delete/admin endpoint, feedback notification, billing,
remote-agent relay or execution route. Authorized operators read D1 through their
Cloudflare account. The desktop currently still previews/copies support reports
locally and sends no telemetry; server availability does not enable that transport.
