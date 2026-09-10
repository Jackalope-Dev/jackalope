# Native browser automation

Jackalope bundles [agent-browser 0.37.1](https://github.com/vercel-labs/agent-browser/tree/v0.37.1)
as its local browser engine. It replaces headless_chrome and launches installed
Edge, Chrome or Chromium in a fresh task profile. Users do not need npm, Node, a Vercel
account, a browser service subscription or a separate agent-browser installation.

## Agent capabilities

Both native MCP and the authenticated task HTTP bridge expose the same tools:

| Tool | Behavior |
| --- | --- |
| `browser_navigate` | Open an HTTP, HTTPS or file URL in the task's current tab. |
| `browser_snapshot` | Read a full accessibility tree with `@e` element references; optional interactive-only, scoped CSS selector or explicit HTML mode. |
| `browser_interact` | Click/double-click, append text (`type`), replace text (`fill`), select, scroll into view, hover, focus, check/uncheck, press keys or wait for an element/text. |
| `browser_configure` | Set viewport width/height, light/dark preference and reduced motion. Partial media updates preserve the other preference. |
| `browser_inspect` | Read element text/value/visibility/enabled/checked state, console messages, page errors, or run an axe accessibility audit. |
| `browser_tabs` | List, open, switch and close tabs within the same task session. |
| `browser_screenshot` | Save a full-page PNG through the existing task screenshot artifact and review flow. |

Take a new snapshot after navigation or a page change before using references.
The default snapshot includes static text and status output; interactive-only
snapshots can omit the result needed to verify a form submission. Existing CSS
selectors, append-style typing and stored screenshot records remain supported.
The default snapshot response now contains accessibility text instead of the
previous HTML snippet; callers that require markup must request `mode: "html"`.

For a text wait, call `browser_interact` with `action: "wait"`, `selector: ""`
and `text: "Expected message"`. A nonempty selector is an element wait, not text
to search for; putting `"Verified"` in `selector` searches for a `<Verified>` element.

Use `browser_inspect` with `kind: "accessibility"` for an automated axe-core audit
of the current page, optionally with a CSS `selector` scope. This differs from an
accessibility-tree snapshot: it checks rules and returns findings, affected selectors
and repair guidance. Both transports retain a validation checkpoint and the bounded
report. Violations produce a failed checkpoint; incomplete checks remain in progress;
zero violations and incomplete checks pass only the automated audit. Keyboard,
screen-reader and other manual acceptance remain necessary. Reports are untrusted
page content and may be truncated; the response and saved notes disclose truncation.

Codex receives explicit approval for these seven Jackalope tools through its
[per-tool MCP configuration](https://learn.chatgpt.com/docs/extend/mcp).
This applies only to the task's Jackalope server. Claude's existing launch allowlist
includes the same tools. No global CLI settings are written and unrelated project
MCP approvals are unchanged. Both installed adapters completed native trials;
other adapters retain their existing HTTP delivery and have not been trialed here.

## Ownership and limits

- Each attempt registers its own browser permission. The browser starts lazily;
  four tasks may reserve browsers at once, with up to 16 explicitly opened tabs each.
- Jackalope starts the daemon directly inside its existing owned process tree,
  before launching Chromium. Stop can interrupt startup or an in-flight command.
  Completion, continuation replacement and app shutdown close the session.
  A closed attempt cannot recreate a browser. A dead session requires task continuation.
- Calls serialize per task; unrelated sessions can proceed independently. Browser
  action waits are bounded at 15 seconds and transport calls at 30 seconds.
- The daemon gets an isolated working directory, HOME and temporary profile, an
  allowlisted OS environment and no task credentials. Windows USERPROFILE remains
  the OS profile to avoid WinINet cache junctions; Chromium still gets a fresh
  temporary user-data directory. Personal browser sessions are never attached.
- The internal transport is local TCP on Windows and a Unix socket elsewhere.
  It is a process integration, not a security boundary against other local programs.
  Streaming is disabled before browser launch. Global agent-browser configuration,
  cloud providers, persistent authentication/state, uploads and arbitrary script
  evaluation are not exposed. The HTML reader uses a fixed internal script.
- Page text remains untrusted data. Snapshots and diagnostic text are bounded to
  40,000 characters, transport responses to 2 MB and saved screenshots to the
  existing 8 MiB preview limit. Large pages can use a scoped snapshot.
- These browser tools do not automate native app windows, CAPTCHA or login consent.
  Separate [Windows desktop control](DESKTOP-CONTROL.md) requires a user-selected
  window grant. Browser-based actions may change a site; agents must continue to
  follow the task's authorization.

## Packaging and maintenance

The root dev dependency pins the upstream npm package exactly. `build.rs` checks
the version and stages the matching native executable into Tauri resources;
normal bundles and the Store staging script include it and its notices. Generated
executables are ignored by Git. Run `pnpm install --frozen-lockfile` before Cargo
builds. Do not replace the bundled binary with a user-configured executable.

The package provides Windows x64, macOS x64/arm64 and Linux x64/arm64 (glibc/musl)
binaries. Windows arm64 currently selects the x64 binary for OS emulation.
Only Windows x64 with installed Edge was exercised in this evaluation. Platform
browser discovery, signing and installed/update acceptance remain release gates.

The direct daemon protocol is upstream implementation detail. For upgrades,
review protocol and launch changes, update the dependency/version assertion and
license files together, regenerate `pnpm licenses:generate`, and rerun the native
engine and installed-agent trials below. This integration is pinned to upstream
revision `72007a6788d863611b23bed0b59d0d659c638d8e`.

## Verification

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.
