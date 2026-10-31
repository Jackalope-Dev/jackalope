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

Codex, Claude Code, Grok, OpenCode and Kimi Code have helper adapters. A question can make
up to ten model requests, each limited to two minutes and 512 KB of output.
Stop cancels the loop and terminates its owned process tree. There is no automatic
agent/account failover. Execution-access and agent/model/account restrictions
apply. Provider sign-ins and CLI configuration remain owned by installed agents;
this is not an OS sandbox.

Each turn records when it happened, its agent, model, account label, account key
and reported tokens. It records the open project when project sharing is current. A stale
or disabled project context leaves the project unset. Turns saved before those
fields existed stay undated and unattributed. Helper usage stays in helper history
rather than project task usage, including archived conversations. A file that cannot
be read is reported and left in place. Kimi uses a
private tool-free agent definition; its print output does not include token totals,
so that helper usage remains unknown. The prompt
includes up to eight prior replies and recent action IDs/statuses so the agent
can check completion or Undo receipts. New conversation archives the old record
locally. On restart, working turns are interrupted and pending/applying actions
expire. Corrupt history is preserved and blocks writes until repaired.

App version, screen and agent availability are shared. Appearance/preferences
and project names and selected-project task statuses are enabled by default.
Use the settings button beside Close to change sharing, notifications and companion
animations. Existing saved sharing choices are preserved.
Task prompts/results, files, paths and credentials are excluded. Context older
than 15 seconds is rejected. Disabling sharing prevents new reads; previous
conversation text remains until the user starts a new conversation.

## Sharpen

Sharpen rewrites a composer draft into a deeper version of the same task: what a leading
professional would also do, the rawest material to start from, the methods and tools to
use, and an outside check that would show the result is right. Choices that belong to the
person stay open. It does not do the task and never sends.

The New work composer and the task capture dialog show it as an icon button with the
draft tools; the terminal offers `/sharpen <draft>`. It runs only on that explicit
action. `useSharpen` in `components/tasks/SharpenButton.tsx` calls `helper_sharpen`
with the composer's character limit; while it runs the draft is read-only and the
button stops it through `helper_sharpen_cancel`. The rewrite replaces the draft as
editable text. **Undo sharpen** restores the original while the draft still holds the
untouched rewrite; a draft that changed elsewhere meanwhile, such as from the shared
terminal draft, is kept and the rewrite is dropped. Without the desktop app or a ready,
enabled Claude Code, Codex, OpenCode, Grok or Kimi Code agent, the button is marked
unavailable and its tooltip and accessible name give the reason.

`commands/helper/sharpen.rs` owns the prompt, response validation and recording. It
picks agents and accounts through the same candidate list as Ask Jackalope and generated
commit messages, makes one tool-free request per candidate until one returns a valid
`{"prompt": ...}` within the limit (at most 24,000 characters), and treats the draft as
untrusted data. Each finished call is appended to `helper/generated.json` (the latest
2,000) with its agent, account, model, project and reported usage, and `source:
"sharpen"`; draft and rewrite text are not stored. `helper_usage` reports these entries
with Ask Jackalope turns. An unreadable `generated.json` is reported, left in place and
blocks Sharpen before any agent runs.

## Local MCP

Helper settings → External agent connection → Connect an external agent creates a random
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
protocol, mutation and MCP authorization contracts. `scripts/sharpen.test.mjs` and the
native `sharpen_*` helper tests cover availability, undo, the prompt contract, response
limits and usage recording. The ignored
`installed_helper_agent_answers_with_document_tools` test uses a signed-in
provider and its quota; set `JACKALOPE_HELPER_TRIAL_AGENT` to the intended adapter.
Follow [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md) for isolated native checks and
[CONTRIBUTING.md](../CONTRIBUTING.md) for the full gate. Browser fixtures do not
establish native process, installed window or provider acceptance.
