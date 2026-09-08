# Contributing to Jackalope

Bug reports, focused fixes and improvements to the documentation are welcome.
For a larger feature, open an issue describing the workflow and proposed behavior
before investing in an implementation. Please keep discussion respectful and
reviewable changes focused on one problem.

## Development

Use Node 24.18 or later within Node 24, pnpm 10.11.0 (pinned in package.json),
and Rust 1.98.1 with rustfmt. CI tests that Rust toolchain; update its workflow
and this guide together when raising the baseline. The crate declares Rust 1.98.
Windows native development also needs the MSVC C++ build tools and WebView2.
Git and an installed, signed-in supported agent CLI are needed to run real tasks.

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm dev:website
pnpm tauri dev
```

Run each development server in its own terminal. The desktop preview uses port
5173 and the website uses 5180. Browser previews cannot execute native tasks;
the component lab at `/design-lab.html` contains explicitly fictional UI fixtures.
For a separate static lab build, use `pnpm --filter @jackalope/desktop build:lab`.
Ordinary desktop builds exclude that entry point.

The [architecture guide](docs/ARCHITECTURE.md) maps the code. Follow
[DESIGN.md](docs/DESIGN.md) for UI changes and [SELF-DEVELOPMENT.md](docs/SELF-DEVELOPMENT.md)
when testing the native app without disturbing an existing profile. Server
development is independent and requires no Cloudflare login; see its
[README](apps/server/README.md).

## Checks

```powershell
pnpm verify
pnpm check:secrets
```

`verify` runs Biome, local documentation links, release-script tests, generated server bindings, server
typecheck/tests/dry-run build, desktop JavaScript tests, Rust formatting/native
unit tests and frontend production builds. Install [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) to run the
separate secret check; it scans reachable history and current nonignored files.
CI runs both checks without deployment credentials. `pnpm licenses:generate` regenerates
the [dependency inventory](docs/DEPENDENCIES.md) after dependency changes.

User-visible product and website changes also need one concise public milestone.
Add it to the website's shared changelog source with:

```powershell
pnpm changelog:add -- --title "A clearer task review." --description "Review now keeps the task and evidence together." --item "The exact patch and checks appear in one view." --note "Development milestone, not a public release."
```

Repeat `--item` for additional bullets. Optional `--id`, `--date`, and `--status`
flags override the generated ID, today's date, and `In development` status. The
website changelog and LLM-readable discovery output both consume the resulting
JSON directly. `pnpm verify` rejects duplicate IDs, invalid dates, unsupported
statuses, incorrect ordering, empty fields, and em dashes.

Use targeted checks while iterating; finish with the combined check. For UI
changes, exercise keyboard/focus behavior, light/dark appearance, reduced motion,
960×640 and 1280×840 layouts, theme persistence and preview cancellation. Keep
fixtures separate from real execution and state which checks used fixtures.
Native execution changes need disposable-repository tests and relevant actual
app checks. Opt-in native trials are excluded from the ordinary suite.

## Pull requests and reports

Explain the trigger, resulting behavior and verification. Include screenshots
for UI changes and identify any remaining limitations. Keep generated lockfiles
in sync using package tools. Add comments for non-obvious invariants rather than
narrating the code. Preserve saved-data compatibility, process ownership and the
coordinator → execution guard → runtime lock order.

The project currently targets Windows for native release acceptance. Other
platform fixes are welcome, but a passing frontend build alone does not establish
native platform support. See [TODO.md](docs/TODO.md) for current priorities.

Use the issue forms for bugs and feature requests. Review support reports before
sharing them; omit credentials, private prompts and personal paths. Report
vulnerabilities privately using [SECURITY.md](SECURITY.md).
