# Native MCP discovery

In Connections, choose **Add tools** to browse the marketplace or **Custom connection**
to supply your own endpoint or command. Add or edit a project or all-project connection
and enable **On-demand tools**. New tasks include enabled project connections automatically; review them
under Customize task → Tools. Saved task connection restrictions remain honored,
with an explicit action to return to project defaults. Direct delivery
remains the default for existing connections. A task's selected connection IDs
carry into continuations; each attempt takes a fresh configuration snapshot.

Jackalope starts selected upstream connections lazily inside the native runtime.
Codex, Claude, OpenCode and Kimi receive the authenticated Jackalope MCP endpoint;
Grok and Antigravity use the
same search/execute operations through the local HTTP harness. Custom agents use
their configured adapter. Manual, queued and scheduled attempts use the same
launch path. No model API proxy, additional API key, Node sidecar or embedding
model is required by the broker (an upstream stdio server may require its own runtime).

## Marketplace and connection setup

The marketplace opens on a bundled Recommended collection. `curated-servers.ts`
contains publisher identity, source/setup links, authentication requirements and
connection presets. Keep these aligned with publisher documentation, pin local
package versions, and preserve isolated browser profiles. AllMCPs search is broader
discovery, not a source of trusted installation commands for curated entries;
matching directory IDs resolve to the bundled preset. Recommendations are editorial
choices, not security audits or live service-health claims.

Recommended browsing does not request the AllMCPs directory. All servers and search
use AllMCPs; opt-out hides both discovery views while preserving saved connections.
Source icons may load publisher avatars. Directory failures leave recommendations
and custom setup usable. Never load a detail endpoint for a made-up registry ID.

The form defaults to a remote URL and keeps identifiers, environment variables and
client JSON in Advanced settings. Bearer tokens use a masked field; unrelated
headers and client options survive token changes. Save and check stores the settings
before probing. A failed check offers editing and retry without losing the saved
connection. Local checks execute the configured process and may download packages.
Disabled connections are retained and omitted from new task attempts.

OAuth presets use direct Codex/Claude delivery and a separate sign-in step. Buttons
use the current project's selected agent account, including for all-project
connections. Other accounts require separate authorization. The native check cannot
verify CLI-owned OAuth. Platforms without the native sign-in launcher require the
agent's terminal flow. Saving does not establish authentication or tool execution.

Copied connection diagnostics redact credentials, environment values, arguments,
opaque options and URL paths/query values. They are for sharing structure, not
reinstallation. Tool lists and checks are observations; editing or deleting a
connection invalidates its check and discards late probe responses.

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

Remote HTTP and SSE endpoints require HTTPS. Plain HTTP is allowed only for
loopback hosts (`localhost`, `127.0.0.0/8` or `::1`). URLs cannot contain embedded
credentials or fragments; use the connection's authentication fields. Validation
also runs before native probes, authentication and task delivery. Existing saved
HTTP endpoints remain editable, but insecure remote endpoints must be changed to
HTTPS before use. Native requests do not follow redirects with credentials.

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

Calls may opt into `output: {jsonPointers: ["/structuredContent/items"], maxChars: 6000}`.
Pointers address the captured MCP response; missing pointers, errors and non-text
content preserve the original result. Small results also remain unchanged when
a preview would add overhead. A shorter response includes the selected data or a
clearly marked text preview and a `resultHandle`. `read_tool_result`, or authenticated
`POST /v1/tools/result`, accepts `{resultHandle, offset, limit}` to page through the
complete captured JSON without rerunning the upstream operation. Offsets count
Unicode characters. Follow `nextOffset` with the same handle.

Only the latest four selected results, each within the existing 1 MB capture limit,
remain in attempt-owned memory. Handles expire at attempt completion and cannot
cross attempts. These controls do not intercept tools delivered directly to a CLI,
grant permissions or filter failures. Usage records captured/returned response bytes
and snapshot reads, including expansion overhead; bytes do not establish token or
cost savings. Selection is deterministic and makes no model call.

Jackalope-owned global/project `mcp_servers.json` files use the same native protected
storage as device keys: Windows DPAPI, macOS Keychain or Linux Secret Service.
Valid legacy plaintext objects and existing Jackalope backup files migrate on read
or save; invalid files are preserved with an error. There is no plaintext fallback
when secure storage is unavailable. The configuration limit is 1 MiB. Save/rollback
preserves the protected format and selected tools still receive their credentials.
Third-party CLI configuration and delivery formats remain provider-owned and may
contain plaintext credentials; use environment references where the client supports
them. Configuration parse errors omit source snippets that could contain keys.


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

The broker serializes execution within each connection while allowing independent
connections to proceed without holding a shared catalog lock across network waits.
Schema/allowlist checks, attempt cancellation and account ownership remain in force.
Usage records connection waits and tool execution separately.

The optional `JACKALOPE_BATCH_READ=on` experiment exposes `read_tools` for up to eight
independent read-only calls with at most four connections active. Results retain input
order and per-call errors. Each call can select exact JSON fields or filter/project/count
array rows through `output.rows`. Calls without an explicit selection retain full results.
Missing required fields preserve the original result;
row outputs include source indices and pagination. Complete selected results remain
recoverable through `read_tool_result` for the latest sixteen selections in the attempt.
Batching never authorizes a mutable operation or retries one automatically.

`JACKALOPE_RESULT_QUERIES=on` independently enables local queries over a captured
result through `read_tool_result.output`. It accepts the same row selection as the
initial read, without another upstream call. Row pages contain complete JSON rows
and a matching-row `nextOffset`; large individual rows require narrower columns or
a larger output budget. Truncated previews include bounded, partial array paths to
help form a query. Missing paths fail explicitly, and raw character reads still
recover the original. Attempt usage distinguishes selections, row queries,
fallbacks, truncation and snapshot queries so repeated expansion remains measurable.
Selected responses expose the same payload as text and `structuredContent` for
programmatic consumers. HTTP help describes row-query inputs, selected-row paths
and captured-result queries when the experiment is enabled.

With queries enabled, `JACKALOPE_RESULT_PREVIEW=on` additionally captures text/JSON
results larger than 16 KB when no output selection was requested, returning an
explicitly truncated 2,000-character preview and partial array paths. The full
original stays queryable through its handle; previews never establish all matching
records. Errors and non-text content remain intact, and explicit selections take
precedence. Both experiments are off by default and require end-to-end evaluation.
Lean HTTP tasks receive compact help with full browser, desktop and coordination
contracts available through `GET /v1/help?full=true`.

`JACKALOPE_INITIAL_TOOLS=small` can provide a complete small catalog and its handles
in launch context, avoiding a separate agent discovery call. It has a three-second
initialization budget and a four-tool, 6 KB limit. Partial, failed or larger catalogs
retain ordinary discovery. Metadata remains untrusted and each call still validates
the live schema and permissions. Include initialization and prompt bytes in comparisons.

Settings → Decisions includes an off-by-default Jev tool-discovery experiment.
In Jev mode it can promote strongly relevant tools for ambiguous searches using
the query, at most 4,000 task characters and 32 descriptions capped at 1,200
characters each. Exact tool names, empty-query browsing and nonempty local results
that fit the requested page stay local; reranking only helps when keyword search
misses or overflows that page. Schemas,
credentials and tool results are not included. The existing candidate scope and
execution permissions still apply; uncertain or failed evaluations retain local
ordering. Decision receipts record usage separately from agent execution, and
search responses include the receipt reference and elapsed decision time. Include
that overhead when comparing complete workflows. Downstream savings require live
task evidence; relevance scores alone do not establish correctness or savings.

The separate agent-questions option exposes `ask_jev` only for connected Jev scopes.
It accepts `{state, questions, sources?}`. Jev sees the task objective and acceptance
requirements as `task`, the supplied state as `input`, and native reads as `sources`.
For example:

```json
{
  "state": {"focus": "build failures"},
  "sources": {"report": {"kind": "file", "path": "report.md", "startLine": 1, "lines": 80}},
  "questions": {
    "dependency": {"type": "noul", "instructions": "Does `sources.report.text` describe a missing dependency?"}
  }
}
```

A source can instead use `{"kind":"tool_result","resultHandle":"...","jsonPointer":"/structuredContent/items"}`.
This reads the original captured response without reexecuting the upstream tool.
Expired handles, another attempt's handles, missing pointers and oversized evidence
fail explicitly. Batch independent questions sharing evidence; use a later request
only when it needs an earlier answer. Unknown or uncertain answers require inspection,
not automatic exclusion. See [usage and routing](USAGE-AND-ROUTING.md) for limits,
accounting and the opt-in policy.

With `JACKALOPE_CONTEXT_PRUNING=on` and connected, enabled Jev agent questions,
`read_relevant_tool` (`POST /v1/tools/read-relevant`) can assess a large read-only
response before agent delivery. Supply `{handle, arguments, pointer, query,
keepIndices?}`; the array pointer is relative to `structuredContent`. It accepts
8–32 rows in 16–80 KB of complete structured evidence, with text content that
exactly mirrors that evidence. Errors, media, additional text, partial results,
unsupported shapes and failed assessments retain the original response. Exact
predicates should use local row selection instead.

Each row is scored against the complete task, acceptance requirements and read
purpose. Only unrelated probabilities of at least 0.95 permit removal; pinned
rows, explicit error rows, malformed scores and uncertainty are retained. Metadata
outside the array stays intact. A selection receipt supplies original source
indices, a hash, the decision record and a recovery handle in the attempt's
latest-16 snapshot buffer. Assessment uses the shared eight-request Jev limit and
records helper usage separately; broker byte accounting measures actual delivery.
This opt-in experiment does not modify provider session history or establish
completeness, quality equivalence or net savings.

`JACKALOPE_RESULT_EXCERPTS=on` adds `output.text` to ordinary read selection and
captured-result queries through both MCP and HTTP. It requires result queries and
result selection. Supply `terms` (one to eight literal phrases), optional `pointer`
into the original MCP envelope, `contextChars` (0–1000), `cursor` and `limit`.
For example, `output:{text:{terms:['lock order','interrupted work']},maxChars:6000}`
searches all string values in `structuredContent`, or text-only `content` when
structured data is absent. Matching uses OR and ASCII case folding, without
regular expressions or semantic ranking. JSON keys are not searched.

Results contain verbatim excerpts with RFC 6901 pointers, Unicode character
`start`/`end` offsets (end exclusive), total string lengths and an original-source
hash. An enclosing string `source` field is carried as an untrusted label when
available. Nearby overlapping windows merge. Pages alternate between terms so
common terms do not crowd out distinct matches; each term retains source order
and all conflicting matches remain pageable. Send `nextCursor` as
`output.text.cursor` with an unchanged query and captured handle. Cursors bind to
the source content, terms, pointer and context size; changing these requires a new
search without a cursor. Recovery never makes another remote call. Metadata includes the scope,
searched strings/characters, matching occurrences/excerpts and source partiality.
No literal match does not establish irrelevance; paraphrases can require different
terms or original-source recovery. Traversal, match and output limits fail
explicitly with a recovery handle instead of claiming a complete empty search.
This experiment remains off by default and does not search provider-owned tools.

`JACKALOPE_READ_PIPELINE=on` exposes `read_pipeline` and the equivalent
`POST /v1/tools/pipeline`. Supply one to four uniquely named sources, each with
`read:{handle,arguments}` or `read:{name,server?,arguments}`, or a captured
`resultHandle`. `source` chooses the base; `rows` supplies its array pointer,
equality filters, final columns, pagination or count. Up to three `joins` specify
`source`, `pointer`, `leftKey` and `rightKey`. Joins retain unmatched left rows as
null and reject duplicate right keys. Base columns keep their original paths;
`/row/...` explicitly qualifies base fields and `/joined/<source>/...` selects
joined fields. Only the final output is delivered, with source indices
and original recovery handles. Missing fields, partial data and nonmirrored
content produce explicit failures. All reads preserve existing connection scope,
allowlists, schema revalidation and cancellation. This experiment requires result
queries; it does not execute generated code or intercept provider-owned tools.

`JACKALOPE_AUTO_RELEVANCE=on` additionally requires context pruning and enabled,
connected Jev agent questions. Ordinary, named and batched broker reads without
exact row or field selection assess eligible results containing one unambiguous
array. Character budgets apply after assessment; exact selections retain their
semantics. Pipelines can assess
complete results without filters, projection or count-only requests. Small,
ambiguous and unsupported results retain local handling. Eligible failed Jev
assessments retain the full result unless an explicit character budget was supplied.
Recovery never repeats the remote read or Jev assessment. These controls remain
off by default pending necessary-evidence and total cost/latency evaluation.

Ordinary native tests cover stdio and authenticated HTTP discovery, pagination,
small schema responses, execution handles, changed definitions, allow/deny lists,
account-directory separation, protocol revision conversion and process cleanup. These are protocol fixtures.
Rendered browser checks cover connection/tool filtering, discovery editing, keyboard
focus and dismissal, light/dark appearance, reduced motion, 960×640 layout and the
task usage disclosure. Browser checks do not establish native or installed-app acceptance.

With the desktop Vite server running, execute
`node apps/desktop/scripts/verify-mcp-marketplace.mjs`. Set `JACKALOPE_PREVIEW_URL`
to its origin (default `http://127.0.0.1:5197`). The isolated browser fixture checks
curated discovery, token editing, OAuth handoff, saved-check recovery, duplicate
prevention, redacted copying and marketplace opt-out without using live accounts.

The opt-in `installed_agents_use_native_discovery` trial launches real installed
agents through TaskRuntime and Coordinator against a local echo fixture. Set
`JACKALOPE_MCP_TRIAL_REPO` to an absolute disposable Git checkout and
`JACKALOPE_MCP_TRIAL_PROFILE` to a new absolute profile directory. Optional
`JACKALOPE_MCP_TRIAL_AGENTS` is a comma-separated adapter list (default `codex,grok`).
The trial uses existing CLI sign-ins, makes model requests, retains local attempt
history, and removes only its temporary project connection. It does not establish
third-party OAuth, multiple live account or installed-app acceptance.
