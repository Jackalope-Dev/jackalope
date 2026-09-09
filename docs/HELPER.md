# Ask Jackalope

The bottom-right companion contains Ask and Activity. Ask uses the configured
default agent, model and active account. Activity retains existing notices,
feedback and shortcuts. The helper has its own persistent conversation and works
without a selected Git project.

The helper searches bundled official guides, reads shared app context, proposes
appearance/preferences changes, opens app destinations, prepares task drafts,
opens/stops shared tasks and changes the default agent. Mutations are proposals
for review in the helper. Theme previews use Keep theme and Cancel; closing a
preview restores saved appearance. Applied theme/preferences changes have Undo
while the panel remains mounted and the affected values have not changed again.
Stale proposals fail instead of overwriting newer preferences. Task drafts use
distinct keys and retain normal launch checks. Stop uses native cancellation.

## Agent and context delivery

`commands/helper.rs` owns persistence, bounded model/tool loops and connections.
`tasks/helper_process.rs` reuses routing-only provider configuration, account
binding, event parsing, bounded I/O and process-tree ownership. Built-in CLI tools
are disabled for helper requests; the model returns one validated JSON answer or
application operation per exchange. The same dispatcher serves local MCP.
This is separate from project task MCP delivery and creates no Git worktree.

Codex, Claude Code, Grok and OpenCode have helper adapters. A question can make
up to ten model requests, each limited to two minutes and 512 KB of output.
Stop cancels the loop and terminates its owned process tree. There is no automatic
agent/account failover. Execution-access and agent/model/account restrictions
apply. Provider sign-ins and CLI configuration remain owned by installed agents;
this is not an OS sandbox.

Each turn records its actual agent, model, account label and reported tokens.
Helper usage stays in helper history rather than project task usage. The prompt
includes up to eight prior replies and recent action IDs/statuses so the agent
can check completion or Undo receipts. New conversation archives the old record
locally. On restart, working turns are interrupted and pending/applying actions
expire. Corrupt history is preserved and blocks writes until repaired.

App version, screen and agent availability are shared. Appearance/preferences
can be disabled. Project names and selected-project task statuses are opt-in.
Task prompts/results, files, paths and credentials are excluded. Context older
than 15 seconds is rejected. Disabling sharing prevents new reads; previous
conversation text remains until the user starts a new conversation.

## Local MCP

Ask → Context & connections → Connect an external agent creates a random
in-memory credential. Copy MCP connection returns the ephemeral loopback URL and
HTTP bearer configuration. A new connection replaces the old credential;
disconnect, restart or the one-hour expiry revokes it. Credentials never enter
helper history or global agent configuration.

The native server binds only to `127.0.0.1`. Streamable HTTP validates the bearer
credential, bound Host and absence of browser Origin. Transport is stateless and
request bodies are bounded. Cloud agents cannot reach this address directly.
There is no hosted remote management API. Connected agents use the same context
controls and proposal review. `get_action` reads proposal status and actual results.

Copied JSON follows Claude Code's `mcpServers` HTTP shape. Other clients may need
conversion; Codex uses the URL and `bearer_token_env_var`, with the credential
supplied through that environment variable. Keep credentials out of repositories
and shared support reports.

## Documentation and verification

`packages/knowledge/src/content.ts` owns shared public guides. The website renders
them and publishes `/knowledge/llms.txt` and `/knowledge/<slug>/index.md`.
Copy for your agent includes source URLs, examples, bullets and callouts.
`node scripts/knowledge.mjs` generates the native catalog; verification rejects
a stale catalog.

Run the JavaScript helper suite and native helper tests for context, history,
protocol, mutation and MCP authorization contracts. The ignored
`installed_helper_agent_answers_with_document_tools` test uses a signed-in
provider and its quota; set `JACKALOPE_HELPER_TRIAL_AGENT` to the intended adapter.
Follow [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md) for isolated native checks and
[CONTRIBUTING.md](../CONTRIBUTING.md) for the full gate. Browser fixtures do not
establish native process, installed window or provider acceptance.
