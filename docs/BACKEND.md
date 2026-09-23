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

## Telemetry and feedback

Configured official builds default telemetry **on**. Onboarding discloses collection
in a separate step with an opt-out. Settings can disable it later; disabling stops
sending immediately. Enabled telemetry sends automatically without a per-event action.

Telemetry contains metadata only:

- Allowed: fixed view/operation names and outcomes, task status transitions with
  allowlisted agent and task/Chat workflow, fixed error categories and page/operation context,
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

Feedback has separate consent and an explicit review/Send action. Disclose the
submitted fields before sending; never attach diagnostic bundles silently.
Submitting feedback does not require telemetry to be enabled. See
[monitoring and payload contracts](BETA-MONITORING.md) and
[feedback invitations](FEEDBACK-INVITATIONS.md) for delivery and retention behavior.

## Trusted hosts and companion

`commands/remote` owns a separate, disabled-by-default loopback service, normally port
9472. The UI enables explicit project templates; remote requests can supply a project
identifier and task text, never a project path, executable, agent account or arbitrary
native command. New sessions use isolation and the host's saved agent/check settings.
Native execution access and coordinator/runtime safeguards still apply.

The allowlisted API exposes pairing and task status, detail, review, start, follow-up,
question response, pause/resume and stop. Device tokens are random bearer credentials;
only their hashes are saved on the host. Single-use pairing codes expire after five
minutes and are limited to twenty attempts. Native host/client records use protected
storage; browser tokens stay on the paired origin. Revocation and project removal
reject subsequent requests. Already accepted actions can finish.

Host and Origin validation, request limits, same-origin assets and a restrictive CSP
protect the HTTP boundary. Desktop SSH transport requires an existing authenticated
alias and a verified host key; forwarding is loopback-only and process-owned. HTTPS
clients reject redirects and plain HTTP addresses. Phone access requires a trusted
HTTPS proxy. Optional Tailscale Serve setup uses private port 8443, refuses an existing
listener there and leaves other Serve configuration intact. Disabling Jackalope access
stops its API; Tailscale configuration remains with its owner.

Messages retain request IDs across reconnect/reload and reuse the native durable session
or follow-up receipts. Network failure never automatically resends a mutation. Disconnect
does not cancel host tasks; host exit follows normal local task shutdown/recovery rules.
The companion is a separate Vite entry served from bundled desktop assets. Installed
SSH, Tailscale, phone and cross-platform acceptance remain required.

## Remaining service work

Client disclosure, opt-out, bounded delivery and explicit feedback Send are implemented.
Activation still needs migrated infrastructure, configured private Access/email settings,
sender verification and installed beta traffic acceptance. Keep credentials out of source.

Managed hosting, shared remote workspaces and native mobile applications remain roadmap
work. They must preserve the separate remote API and its scoped authorization boundary.
