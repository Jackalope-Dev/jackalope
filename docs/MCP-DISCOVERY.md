# Native MCP discovery

In Connections, add or edit a **project** connection and enable **Discover tools on
demand**. New tasks include enabled project connections automatically; review them
under Customize task → Tools. Saved task connection restrictions remain honored,
with an explicit action to return to project defaults. Direct delivery
remains the default for existing connections. A task's selected connection IDs
carry into continuations; each attempt takes a fresh configuration snapshot.

Jackalope starts selected upstream connections lazily inside the native runtime.
Codex and Claude receive the authenticated Jackalope MCP endpoint; Grok, OpenCode
and Antigravity use the
same search/execute operations through the local HTTP harness. Custom agents use
their configured adapter. Manual, queued and scheduled attempts use the same
launch path. No model API proxy, additional API key, Node sidecar or embedding
model is required by the broker (an upstream stdio server may require its own runtime).

## Discovery and execution

- `search_tools` / `POST /v1/tools/search`: keyword search over connection IDs,
  tool names and descriptions. All query terms must match. Empty queries browse;
  `server`, `offset` and `limit` support narrowing and pagination. Responses
  include complete matching schemas, opaque execution handles and the appropriate
  read/execute operation. No match does not mean the capability is absent; broaden the query or browse the connection.
- `read_tool` / `POST /v1/tools/read`: executes only definitions whose selected
  server declares `readOnlyHint: true` without `destructiveHint: true`. The
  declaration is a server contract, not a sandbox; only enable trusted connections.
- `execute_tool` / `POST /v1/tools/execute`: accepts a discovered `handle` and
  `arguments`. The upstream server validates arguments against its own schema.
  Jackalope checks that the full tool definition still matches discovery and
  preserves the upstream content, structured output and error flag. Completed results
  from older MCP revisions receive the discriminator required by the downstream
  [protocol](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.json); this does not repeat the upstream operation.
- The broker preserves configured `enabled_tools` and `disabled_tools` lists.
  Discovery is not permission to perform an action. Execution is deliberately
  absent from Claude's automatically allowed harness tools. Codex's current
  noninteractive approval policy also blocks writes that require confirmation; use
  direct delivery or explicitly configure the client's permissions for those tools.
  A denied CLI permission must not be bypassed using HTTP or another tool.

Catalogs, handles, processes and connection credentials are isolated by attempt.
The selected agent account directory is applied to upstream stdio processes;
HTTP connections use their explicitly configured headers or bearer environment
variable. The broker does not read another agent's OAuth tokens. Server metadata
is untrusted and cannot add connections or expand task scope.

Discovery returns five tools by default (maximum eight), with a 64 KB schema
budget. At most 32 handles are retained; old handles require another search.
Catalogs are cached for 60 seconds, with explicit refresh. Every execution checks
the current tool definition. Calls are serialized within an attempt. There is
no automatic replay after disconnect, timeout or failure because the operation
may already have taken effect.

Limits: 16 selected discovery connections, 1,024 tools and 2 MB of definitions per
connection, 32 KB per definition, 64 catalog pages, 15-second upstream discovery,
45-second overall search, 60-second execution and 1 MB returned result. Excessive
catalogs fail explicitly; use direct delivery when these limits are unsuitable.
Stopping/completing an attempt revokes access and terminates its owned MCP process
trees. The broker persists only usage counters, not credentials or its catalog.
Tool schemas/results may still appear in activity reported by the agent.

## Management and measurement

Configured-connection search also matches the last checked tool names and
descriptions. Expand a connection's tool list to inspect matches. A successful
check describes that observation, not persistent connection health.

Task details include discovery searches, upstream calls, failures, catalog size
and cumulative schema bytes returned. These are observed broker counters, not
billed tokens, total context size or proven savings. Small catalogs may cost more
with discovery; evaluate real tasks before enabling it broadly.

## Compatibility and follow-up

Use direct delivery for CLI-owned OAuth, legacy SSE, resources/prompts, sampling,
elicitation and other advanced client-specific fields. Unsupported configuration
fields fail explicitly instead of silently changing their behavior. Global and
per-agent configurations retain their existing delivery. Sharing OAuth across
agents/accounts is not implemented. Semantic ranking, batch execution, persistent
catalog caching and cross-project connection identity remain follow-up work.

Codex configuration overrides put server IDs inside a TOML table value. Its CLI
interprets the override key as a dotted path, so quoting a name inside that path
would become part of the server name. The table value preserves dotted IDs and
merges with existing configuration. Verified with the installed CLI and its
[configuration documentation](https://learn.chatgpt.com/docs/config-file/config-advanced).

## Verification

Ordinary native tests cover stdio and authenticated HTTP discovery, pagination,
small schema responses, execution handles, changed definitions, allow/deny lists,
account-directory separation, protocol revision conversion and process cleanup. These are protocol fixtures.
Rendered browser checks cover connection/tool filtering, discovery editing, keyboard
focus and dismissal, light/dark appearance, reduced motion, 960×640 layout and the
task usage disclosure. Browser checks do not establish native or installed-app acceptance.

The opt-in `installed_agents_use_native_discovery` trial launches real installed
agents through TaskRuntime and Coordinator against a local echo fixture. Set
`JACKALOPE_MCP_TRIAL_REPO` to an absolute disposable Git checkout and
`JACKALOPE_MCP_TRIAL_PROFILE` to a new absolute profile directory. Optional
`JACKALOPE_MCP_TRIAL_AGENTS` is a comma-separated adapter list (default `codex,grok`).
The trial uses existing CLI sign-ins, makes model requests, retains local attempt
history, and removes only its temporary project connection. It does not establish
third-party OAuth, multiple live account or installed-app acceptance.
