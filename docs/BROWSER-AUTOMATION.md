# Native browser automation

Jackalope bundles [agent-browser 0.38.1](https://github.com/vercel-labs/agent-browser/tree/v0.38.1)
as its local browser engine. It launches installed
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
| `browser_open_profile` | Switch the task's browser tools to a persistent profile: `profile: "project"` (default) or `"bot"` in a bot conversation. See [Persistent agent browser profiles](#persistent-agent-browser-profiles). HTTP bridge: `POST /v1/browser/profile`. |

Take a new snapshot after navigation or a page change before using references.
The default snapshot includes static text and status output; interactive-only
snapshots can omit the result needed to verify a form submission. Existing CSS
selectors, append-style typing and stored screenshot records remain supported.
The default snapshot response contains accessibility text instead of the
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

Codex receives explicit approval for these eight Jackalope tools through its
[per-tool MCP configuration](https://learn.chatgpt.com/docs/extend/mcp).
This applies only to the task's Jackalope server. Claude's existing launch allowlist
includes the same tools. No global CLI settings are written and unrelated project
MCP approvals are unchanged. Other adapters use their configured transport; validate each provider separately.

## Ownership and limits

- Each attempt registers its own browser permission. The browser starts lazily;
  four tasks may reserve browsers at once, with up to 16 explicitly opened tabs each.
- Jackalope starts the daemon directly inside its existing owned process tree,
  before launching Chromium. On Unix, Jackalope also launches Chromium directly
  in a separate guarded process group and connects the daemon to its temporary
  loopback CDP endpoint. This keeps browser descendants owned even when the
  helper exits unexpectedly. Stop can interrupt startup or an in-flight command.
  Completion, continuation replacement and app shutdown close the session.
  Temporary profile removal retries transient filesystem locks for up to three seconds.
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
  cloud providers, agent-browser authentication/state files, uploads and arbitrary script
  evaluation are not exposed. Persistent profiles are Jackalope's own, described below. HTML reading and preview selection use fixed internal scripts.
- Page text remains untrusted data. Snapshots and diagnostic text are bounded to
  40,000 characters, transport responses to 2 MB and saved screenshots to the
  existing 8 MiB preview limit. Large pages can use a scoped snapshot.
- These browser tools do not automate native app windows, CAPTCHA or login consent.
  Separate [native desktop control](DESKTOP-CONTROL.md) operates the user's own
  logged-in browser or other apps after a window, app or desktop grant. Browser-based actions may change a site; agents must continue to
  follow the task's authorization.

## Persistent agent browser profiles

Disposable temporary profiles stay the default for tasks, previews, review captures
and tests. For signed-in or long-running work, a project has one **Project browser**
and each saved bot may have its own **<bot> browser**, usable from that bot's
conversations in any project. Project profiles are never shared across projects. The
person's everyday browser and its profiles are never opened or copied.

- **Storage.** Each profile is a Chromium user-data directory at
  `task-runs-v1/browser-profiles/<id>/data` in the desktop profile, indexed by
  `browser-profiles/profiles.json` (name, owner kind and ID, created and last-used
  times, and site names). Profiles are created on first use and removed only by
  **Delete profile** or a full Jackalope reset. Settings sync and lesson sync read named
  files only, so profile folders are never synced or exported.
- **Privacy.** Jackalope never reads, stores or sends passwords. The site list is the
  set of cookie domain names (leading dot and `www.` removed, at most 200) read through
  the DevTools protocol when a profile closes; cookie names, values and paths are
  discarded immediately. The model never receives cookies or profile files.
- **One session at a time.** An in-memory lease admits one live session per profile:
  a task, the person's sign-in window, a site cleanup or a deletion. A second request
  fails with what holds the profile. Leases end with their session, so a crash leaves
  nothing locked; a stale `DevToolsActivePort` file is discarded at launch, and a
  profile still open in an orphaned Chromium reports that it is already open.
- **Agent use.** `browser_open_profile` closes the task's disposable browser and opens
  the profile headless in a Chromium Jackalope launches directly on every platform,
  with agent-browser attached over loopback CDP. Each command checks the page before
  and after it runs. The first use of a site asks the person with the desktop-control
  choices (allow for this task, always allow, not now, never allow); saved answers use
  the project's desktop site decisions, or `bot:<id>` for a bot's browser. Loopback
  pages are allowed. While a question is open, or after a decline, the command returns
  an error and page content is withheld. Agents are told to confirm purchases,
  sending, deleting and account, billing or security changes with `ask_user`.
- **Sign in once.** When a permitted page shows a visible password field, the agent's
  browser closes gracefully, a visible window of the same profile opens at that page
  and the task asks **Sign in needed** (`I signed in` / `Skip sign-in`). Agent commands
  wait until the person answers; the window then closes and the agent continues
  headless and must navigate again. A skipped site is not asked again in that task.
  People can also open the profile from Project settings → **Browser profiles**, the
  bot editor, or the terminal's `/browser open [url]`; closing the window or choosing
  **Done signing in** (`/browser done`) records its sites.
- **Closing.** Persistent Chromium is closed with `Browser.close` before its process
  tree ends, so new sign-ins reach disk. An idle task profile closes this way when the
  attempt ends; one busy in a command is stopped at once. **Clear site data** removes a
  site's and its subdomains' cookies and the stored data of its `https`, `https://www.`
  and `http` origins in a short headless session.

## Screen view

Task and chat Screen views poll an active attempt's existing browser every two seconds
through `task_agent_screen`. A read never starts a browser, reserves a slot or waits
behind an agent command; a busy browser keeps the previous frame. Frames capture only
the visible viewport, are returned to the renderer and are not saved as artifacts.
The same view reports desktop grant state without changing it. **Stop browser** closes
the attempt's session and **Revoke desktop access** releases its desktop grant; both
record an activity entry, and the agent receives the existing revoked-access errors.
Only HTTP and HTTPS pages can be reopened in the person's browser, without task state.

## Visual preview selection

Preview's **Select in preview** opens a separate task-owned browser window. Users can
navigate and sign in there, then select an element without resetting that browser's
current state. The picker runs only on the managed preview's loopback port. Captures
save a cropped screenshot and bounded HTML/computed-style context in the task workspace;
page-reported source attributes remain untrusted hints. Selection notes persist in the
desktop profile. Stopping the preview closes its selection browser and temporary profile.
The embedded iframe and fresh-page capture do not share that window's state.

## Review screenshots

When an attempt that changed files finishes successfully, its result is recorded first
and Jackalope then captures review screenshots in the background if the project saves a preview command containing
`{port}` and **Capture review screenshots** is on (the default once a command exists).
It runs the command on a free loopback port in the task workspace, waits up to 60
seconds for an HTTP answer and opens each page in a headless disposable browser with a
temporary profile, a fixed viewport (desktop 1280×800, optional narrow 390×844), a
light color scheme and reduced motion. Each image is the first screen as a PNG, at most
4 MiB, saved under `.jackalope/artifacts/screenshots` in the task workspace and recorded
in the attempt's `reviewCaptures`.

Pages are the configured review pages (default `/`), then paths named in plan criteria
tagged `browser` (`AC-n: [browser] …` requirement titles), then feature-map pages whose
sources the attempt changed, then local pages the agent opened with `browser_navigate`
or captured, newest first; at most six distinct pages.

### Feature map

Project settings keep an optional feature map beside the capture settings
(`featureMap` in project preferences, mirrored to the native project ledger). Each
entry has a name, a page, what working looks like, optional steps to reach it and
project-relative source globs (`*`, `**`, `?`, `{a,b}`; a plain path also covers the
folder beneath it). Screenshots only open the page, so a state worth checking has to
be reachable by URL, such as `/settings?tab=billing`; the steps are reviewer guidance.
Changed files are the attempt's diff from its starting commit plus untracked,
non-ignored files. Every capture of a page carries the entries for that page
(`features` on the capture), and Review shows their name, working line and steps.

**Suggest from code** reads route files and router setup locally, with no model call:
Next.js app and pages routers, SvelteKit, Remix and React Router framework routes,
TanStack Router file routes, Astro and Nuxt pages, plus quoted `path` values in
router files and `href`/`to` values in navigation files for React Router, Vue Router,
Angular, wouter, Solid and Preact routers. Each package is read against its own
`package.json`; dynamic, private and API routes are skipped, and projects without a
recognized router get no suggestions. The person picks which suggestions to add.
Settings flag entries whose route file or source globs no longer match any tracked or
untracked file; **Drop missing paths** and **Remove** change the map only when chosen.
Entries without sources still label their page but are never preferred. A saved
entry this build cannot read is dropped when the ledger loads instead of hiding the
project list. The map is not added to agent context: matches depend on changed files,
which are known only after the attempt finishes.
The "before" side runs the same command in the project checkout only when the task used
a separate worktree, the checkout is at the attempt's starting commit with no
uncommitted tracked changes and no other work runs there. Otherwise only the result is
captured and the review notes say why.

While capture runs the attempt carries `reviewCapturing` and Review shows
**Capturing screenshots…**; the run updates when images are saved. All capture work
stops after 150 seconds or when the result leaves review (merged, discarded or
continued). If Jackalope closes mid-capture, the flag is cleared on the next launch with
a note. Each preview
holds the workspace like a running check, so checks, managed previews and integration
wait; its process tree and browser session are closed as soon as that side finishes.
Failures become notes and never fail the attempt. Browser criteria with a matching page
gain a `pending` validation step (`AC-n review screenshots`) that cites the image files;
screenshots do not change a criterion's check state. Review shows each page as a slider
or side-by-side comparison with its viewport and a link to the live preview. The
terminal's `/review`, changes panel and `jackalope diff` report how many screenshots
are in the app; `/settings` toggles capture for the project.

## Packaging and maintenance

The root dev dependency pins the upstream npm package exactly. `build.rs` checks
the version and stages the matching native executable into Tauri resources;
normal bundles and the Store staging script include it and its notices. Generated
executables are ignored by Git. Run `pnpm install --frozen-lockfile` before Cargo
builds. Do not replace the bundled binary with a user-configured executable.

The package provides Windows x64, macOS x64/arm64 and Linux x64/arm64 (glibc/musl)
binaries. Windows arm64 currently selects the x64 binary for OS emulation.
Native browser behavior, confined Linux browser packages, signing and installed
updates require separate platform acceptance.

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

The opt-in native `real_preview_picker_preserves_current_state_and_crops_the_selection`
test opens an owned preview browser, selects changed page content, checks screenshot
dimensions and closes the browser. Run it with Cargo's `--ignored --nocapture` flags
on an interactive desktop; it retains the screenshot in its temporary fixture folder.
The opt-in `real_review_capture_saves_result_screenshots_and_cleans_up` test runs a
disposable Node server through the review-screenshot path at both viewports and checks
that the preview process released the workspace.
