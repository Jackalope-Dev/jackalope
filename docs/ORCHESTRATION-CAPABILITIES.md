# Agent orchestration capabilities

Source support and live acceptance are
separate; a CLI's permissions, version and account still determine availability.

## Automatic assignment

Automatic work uses the default agent to rank eligible agents, configured models and
project-permitted accounts using task context and reported quota. Native policy and
quota checks constrain the final selection. Recognized quota exhaustion can hand off
to another eligible worker in the same worktree, with recorded progress and usage.
A prior default-agent ranking can survive exhaustion of the coordinator account.
Explicit assignments and continuations are pinned; missing quota is unknown.
Antigravity can execute work but cannot coordinate routing-only requests. See
[USAGE-AND-ROUTING.md](USAGE-AND-ROUTING.md) for the bounds and acceptance evidence.

## Shared tools and guidance

All six adapters receive the task intent, repository rules, frozen project context,
verification instructions and a task-scoped authenticated bridge. Codex, Claude,
OpenCode and Kimi receive native MCP tools on bridged tasks. Grok and Antigravity
use permitted HTTP calls. The same bridge implements project awareness, messages,
user questions and saved answers, browser evidence, validation and selected
on-demand connection discovery. No transport bypasses a denied permission.

Project awareness now includes manual tasks, queued assignments, latest attempts,
declared scopes and dependencies. Manual scopes are explicitly unknown. Inventory
covers loaded history; archived runs are excluded. Agents read it before editing
and at shared-interface checkpoints. The response includes contract version 1.

Jackalope supplies a bounded live project briefing at every launch and continuation,
including active tasks, queued work, work awaiting review, agent ownership, scope
previews, dependencies and recent messages. Active work is prioritized; unknown
manual scopes stay unknown. Task titles and message text are untrusted data.
The briefing contains up to 24 tasks within 10 KB and up to eight message excerpts
within 6 KB; omission counts point to the full project inventory and inbox.

The coordinator automatically records starting and finished/failed/stopped/interrupted
attempts in the existing project journal. These notices include the task, agent,
scope, attempt ID and recorded check counts. A finished process is awaiting review,
not accepted or integrated. Historical records are baselined on migration; saved
lifecycle state prevents repeat announcements after restart and allows recovery
notices for interrupted work. Failed journal writes remain retryable.

Normal authenticated Jackalope tool responses carry new updates automatically:
HTTP JSON adds coordinationUpdates; native MCP appends a text content block while
preserving the original structured result. Direct messages, blockers and related
scopes/dependencies take priority. Each response adds at most eight excerpts within
6 KB. Delivery is deduplicated per attempt and never implies a read acknowledgment.
After the startup briefing, broadcasts older than the attempt are available through
the inbox instead of repeatedly replaying history. Unread direct messages remain
eligible across continuations. Full messages and explicit acknowledgments retain
their existing APIs.
If another launch owns the coordinator, optional delivery defers to the next
checkpoint without consuming messages or delaying the completed tool result.

This is delivery at Jackalope tool-response boundaries, not arbitrary shell or
provider-tool calls. Non-JSON, streaming and responses over 8 MB remain unchanged;
no polling model turns, automatic follow-ups or interruptions are introduced.
Agents should still check the inbox before shared-interface changes when they have
not used the harness recently. A transport interruption can lose a delivered excerpt;
the durable inbox remains authoritative. Bridge unavailability blocks new launches
with a retryable explanation so they cannot silently omit coordination. Bound due
schedules wait for bridge readiness without consuming the occurrence; their normal
missed-run policy still applies.

Messages may be addressed to a task ID or broadcast within the project. The inbox
supports bounded cursor pagination and explicit cursor-expiry reporting. Durable
acknowledgments mean read, not approval. Continuations retain the task identity.
Messages are untrusted observations and cannot schedule, wake, interrupt, approve,
commit or merge work. Questions needing user input use ask_user, not just a blocker
message. Agents must read pending answers; elapsed time is never an answer.

| Operation | Native MCP | HTTP |
| --- | --- | --- |
| Inventory and capabilities | project | GET /v1/project |
| Publish a note | message | POST /v1/messages |
| Read messages | inbox | GET /v1/messages?after=cursor&limit=50 |
| Acknowledge reading | acknowledge_message | POST /v1/messages/ack with id |
| Ask a question | ask_user | POST /v1/user-prompt |
| Retrieve an answer | user_response | GET /v1/user-prompt/poll?id=question |
| Record checks | record_validation_step | POST /v1/validation-step |
| Windows window control | desktop_control | POST /v1/desktop/control |

[Native desktop control](DESKTOP-CONTROL.md) requires a fresh human window grant
for each attempt. It supports accessibility snapshots, screenshots, focus and
guarded input on Windows; other platforms return unavailable.

HTTP messages use recipientTaskId; the MCP schema uses recipient_task_id. Omit it
for broadcasts. Agents can see project broadcasts, their received messages and
their own sent messages. The user sees all project messages and acknowledgment
counts. The retained journal is bounded to 2,000 messages; expired cursors require
rereading and deduplicating retained messages. There is no infinite audit archive.

## Visible support

Agent Configuration shows the selected adapter's support and limitations. Task
options describe tool delivery, and incompatible selected connections show an
explanation before launch. Custom agents inherit their configured adapter.
The shared agent-capabilities.json drives frontend checks and native direct
connection validation.

| Capability | Codex | Claude | Grok | OpenCode | Kimi | Antigravity |
| --- | --- | --- | --- | --- | --- | --- |
| Shared harness | MCP | MCP | HTTP | MCP | MCP | HTTP |
| On-demand stdio / HTTP | Yes | Yes | Yes | Yes | Yes | Yes |
| Direct project connections | stdio / HTTP | stdio / HTTP / SSE | No | stdio / HTTP / SSE | stdio / HTTP / SSE | No |
| Continuation, stop, history | Yes | Yes | Yes | Yes | Yes | Yes |
| Separate managed accounts | Yes | Yes | Yes | Yes | Yes | Gemini API keys |
| Capacity reader | Yes | Yes | When reported | No universal provider quota | Managed membership | Subscription login |
| Default coordinator / helper | Yes | Yes | Yes | Yes | Yes | No verified tool-free interface |

Unknown capacity stays unknown. Kimi ACP approvals and structured questions are
connected to Jackalope's question UI. Other native terminal prompts need their
adapter's supported protocol. All providers can request input through the shared harness;
permission escalation still requires a supported adapter protocol or continuation.

## User notifications

In-app companion notices remain authoritative for pending answers, failed or
interrupted tasks and review. Windows OS notifications now run from native task
state while the app is in the background, including close-to-tray operation.
They honor the shared All / Needs attention / Quiet setting and a separate OS
switch. Existing notices are baselined on startup, event identities prevent repeats,
and the foreground window suppresses OS delivery. No prompt, project name, path,
answer or credential appears in a toast. Settings offers a test notification and
reports delivery errors; Windows can suppress banners independently.

Clicking a toast brings the running app forward and opens the exact saved attempt.
Resolved questions open their current task state. Quitting stops native observation;
cold-start activation from an old toast is not implemented. Windows packaged builds
use their registered application identity. Unpackaged release builds require the
installer's registered identifier; debug notices may appear under PowerShell.
macOS/Linux OS delivery is not implemented and is labeled unavailable. In-app
notices remain available. Certified installed Store identity, Focus Assist and
real notification click acceptance must be tested separately from source tests.

## Open-source evaluation

- Reuse the existing [official Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk)
  3.2.0 (Apache-2.0) and Axum for the shared bridge; no second server framework.
- Adopt [tauri-winrt-notification](https://github.com/tauri-apps/winrt-notification)
  0.8.1 (MIT/Apache-2.0) for Windows toast activation callbacks. The standard
  [Tauri notification plugin](https://v2.tauri.app/plugin/notification/) supports
  desktop delivery but documents its Actions API as mobile-only.
- [Agent Client Protocol](https://agentclientprotocol.com/protocol/v1/initialization)
  drives Kimi lifecycle, capability negotiation, approvals and structured questions.
  Its [Rust SDK](https://github.com/agentclientprotocol/rust-sdk) remains a possible shared implementation.
  Replacing tested CLI adapters requires provider-specific acceptance; ACP is not
  assumed to be available on every installed agent.
- [OpenCode's runtime configuration](https://opencode.ai/docs/config/) supports
  per-process configuration and native MCP. Project connections are merged into
  OPENCODE_CONFIG_CONTENT without replacing unrelated inline settings.

## Remaining improvements

Directed wake/steering needs provider protocol support and explicit scheduling
policy. Structured completion reports could build on saved validation/evidence
receipts. Automatic routing needs capacity freshness, budgets and account limits;
no automatic spending or scheduling is introduced here. Expand native transport
coverage only with live permission and continuation trials.
