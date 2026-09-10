# Native and hosted services

Desktop tasks, history, coordination, schedules, browser sessions and repository
inspection run in the Rust/Tauri host. New execution requires approved Jackalope account access in every build; saved
work remains readable when access expires. CLIs contact their providers, configured MCP tools
may be remote, the optional marketplace uses AllMCPs, and configured releases
check an HTTPS update feed. Local-first does not mean network-free.

The coordination bridge binds to loopback. It is not a remote execution server
and must not be exposed by changing its bind address. See [ARCHITECTURE.md](ARCHITECTURE.md).

apps/server implements Cloudflare ingestion with D1 and private R2 update serving.
Deployment state is operator-specific and belongs in private records. Public
configuration is local/example configuration; remote operations explicitly select
wrangler.deploy.jsonc. See [SERVER-LAUNCH.md](SERVER-LAUNCH.md) and
the [service README](../apps/server/README.md) for setup and acceptance.

Signed releases can configure native HTTPS telemetry and feedback. Contributor and
rehearsal builds have no reporting endpoint. Disclosure precedes the first upload;
feedback always needs a separate review and Send action. Hosting updates alone
does not activate ingestion. See [BETA-MONITORING.md](BETA-MONITORING.md).

## Telemetry: on by default, opt-out

Configured official builds default telemetry **on**, with an opt-out. Requirements:

- Disclosed as its own step in the onboarding flow, plain language, with a
  clear one-click way to turn it off right there — not buried in a settings
  submenu the user has to go find.
- Also toggleable at any later point from Settings; toggling off must stop
  sending immediately, not just suppress future opt-in prompts.
- Fully automatic once enabled: no user action per event. This is the
  opposite of feedback (below), which is never automatic.

**Payload boundary — metadata only, never content.** This is the hard
constraint, not a nice-to-have, because Jackalope runs against users' private
codebases and agent conversations:

- Allowed: fixed feature names, task status transitions, fixed error categories,
  installed app version, installed channel and OS. Each event gets a random UUID
  for bounded retry deduplication; it is never an installation identifier.
- Never: installation/account/device IDs, prompts, agent output, source, paths,
  project/repository names, diffs, environment variables, raw exceptions or stacks.
- The native host injects version/channel/OS and validates a closed schema. The
  server stores daily aggregate counts and expiring ID/hash receipts, not event
  payloads. There is no per-user timeline, retention or unique-user measurement.
- Network infrastructure necessarily sees connection addresses. D1 and application
  logs do not store IPs or headers. Daily keyed hashes serve only rate limiting;
  review Cloudflare edge/Access log retention before activating collection.

## Feedback: separate, explicit, user-initiated

Feedback is not telemetry and must never be bundled into it:

- Settings provides feedback review and an explicit Send action. Nothing is sent
  until the user triggers it.
- The submission can reasonably include more context than telemetry does
  (the user is choosing to share it), but still needs a clear "what gets
  sent" disclosure at the point of submission — don't silently attach a full
  diagnostic bundle without saying so.
- No implicit dependency on telemetry being enabled — a user who opted out of
  telemetry can still submit feedback, and vice versa; keep the two toggles
  independent in the data model and the UI.


## Remaining service work

Client disclosure, opt-out, bounded delivery and explicit feedback Send are implemented.
Activation still needs migrated infrastructure, configured private Access/email settings,
sender verification and installed beta traffic acceptance. Keep credentials out of source.

Pairing, presence, remote dispatch/reconnect, companion clients and a compatible
self-hosted/managed offering remain roadmap work. They need an explicit architecture
and authorization model rather than reuse of the local bridge as a public API.
