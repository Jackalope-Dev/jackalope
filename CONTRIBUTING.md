# Contributing to Jackalope

Bug reports, focused fixes and improvements to the documentation are welcome.
For a larger feature, open an issue describing the workflow and proposed behavior
before investing in an implementation. Please keep discussion respectful and
reviewable changes focused on one problem. Follow our [community guidelines](CODE_OF_CONDUCT.md).

## Your first contribution

1. Read the [current status](docs/STATUS.md) and [open priorities](docs/TODO.md).
2. Fork the repository, clone your fork and create a branch from current `master`.
3. Make a focused change with the relevant checks and documentation.
4. Open a pull request against `Jackalope-Dev/jackalope:master`, describing the
   problem, resulting behavior and what you verified.

Documentation fixes, reproducible bug reports, accessibility work and tests are
welcome alongside features. Maintainers review contributions before merging;
discuss larger changes before investing in an implementation. No hosted Jackalope
account, signing key or deployment credential is needed for source contributions.
Running native tasks requires an approved Jackalope account in every build,
including local development builds. Automated tests use isolated access fixtures.

## Development

Use Node 24.18 or later within Node 24, pnpm 10.11.0 (pinned in package.json),
and Rust 1.98.1 with rustfmt. CI tests that Rust toolchain; update its workflow
and this guide together when raising the baseline. The crate declares Rust 1.98.
Windows native development also needs the MSVC C++ build tools and WebView2.
macOS needs Xcode command-line tools; Linux needs Tauri's WebKitGTK/system packages
and `libdbus-1-dev`. See the [platform prerequisites and device checks](docs/CROSS-PLATFORM-RELEASES.md#native-checks-on-your-devices).
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
[UI-GUIDELINES.md](docs/UI-GUIDELINES.md) for UI changes and [SELF-DEVELOPMENT.md](docs/SELF-DEVELOPMENT.md)
when testing the native app without disturbing an existing profile. Server
development is independent and requires no Cloudflare login; see its
[README](apps/server/README.md).

## Checks

Use `pnpm test` for the release, desktop JavaScript and server suites. Desktop
tests are discovered from `apps/desktop/scripts/*.test.mjs`; new suites do not
need a package script entry. Desktop tests also retain the shared release-config
and update-manifest checks used by release builds.

For a single suite or test name, pass Node test-runner arguments to `test:file`:

```powershell
pnpm --filter @jackalope/desktop test:file scripts/onboarding.test.mjs
pnpm --filter @jackalope/desktop test:file --test-name-pattern="first launch" scripts/onboarding.test.mjs
pnpm --filter @jackalope/server test
pnpm test:release
```

Run the full verification gate before submitting changes:

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

CI also runs `pnpm check:dependencies` against current advisory databases. To run
it locally, install `cargo-audit` 0.22.2 with
`cargo install cargo-audit --version 0.22.2 --locked`. The offline vendored-patch
integrity check is included in `pnpm verify`; the full advisory check needs network
access. See [dependency contracts](docs/DEPENDENCY-INTEGRATIONS.md).

After `pnpm build:website`, run `pnpm check:links:website` to check live HTTP(S)
destinations linked by the rendered pages. It writes statuses, redirects, headings,
anchors and referring labels to `scratch/website-link-audit.json`. This network
check is separate from `verify`; review source content as well, because a working
URL does not establish that a linked page supports a claim. The build checks local
routes, anchors and linked files, including Markdown guides and embedded media.
To audit an unpublished production preview, pass `--origin http://127.0.0.1:<port>`;
external sources are still checked live. See [knowledgebase content and media](docs/KNOWLEDGE-MEDIA.md)
for guide ownership, clip provenance and accessibility checks.

Reserve public changelog entries for notable features, meaningful improvements
and larger milestones readers would care about. Group related work into one
concise update; omit routine copy, spacing, icon and internal maintenance changes.
Add qualifying updates to the website's shared changelog source with:

```powershell
pnpm changelog:add -- --title "A clearer task review." --description "Review now keeps the task and evidence together." --item "The exact patch and checks appear in one view."
```

Repeat `--item` for additional bullets. Use optional `--note` only for useful
context or a specific limitation, without repeating a development-release disclaimer.
Optional `--id`, `--date`, and `--status`
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

Cargo defaults to two concurrent native tests through `.cargo/config.toml`.
The subprocess and Git fixtures share execution guards and write durable history;
CPU-count concurrency can exhaust their deadlines on busy Windows machines.
Set `RUST_TEST_THREADS` or pass `-- --test-threads=N` to override this for stress runs.

## Pull requests and reports

Follow the [documentation policy](docs/DOCUMENTATION.md). Tracked guides describe
current behavior and repeatable engineering workflows. Keep feature proposals,
decision records, experiment reports, dated test results and work summaries in
task/PR discussion or private storage. Update existing guides when their behavior
changes; new guides need a distinct purpose and a documentation-index entry.
Use the [behavior template](docs/templates/BEHAVIOR-GUIDE.md) only when useful.
Detailed local receipts belong in ignored scratch/output, not STATUS or TODO.

Explain the trigger, resulting behavior and verification. Include screenshots
for UI changes and identify any remaining limitations. Keep generated lockfiles
in sync using package tools. Add comments for non-obvious invariants rather than
narrating the code. Preserve saved-data compatibility, process ownership and the
coordinator → execution guard → runtime lock order.

Native release acceptance is platform-specific across Windows, macOS and Linux.
A passing frontend build alone does not establish native platform support. See [TODO.md](docs/TODO.md) for current priorities.

Use the [issue forms](https://github.com/Jackalope-Dev/jackalope/issues/new/choose)
for bugs, feature requests and documentation problems. Ask setup, workflow and
development questions in [GitHub Discussions](https://github.com/Jackalope-Dev/jackalope/discussions/categories/q-a).
Review support reports before sharing them; omit credentials, private prompts and
personal paths. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Contribution license

You retain ownership of your contributions. Unless explicitly stated otherwise,
work intentionally submitted for inclusion is contributed under the repository's
[Apache License 2.0](LICENSE), as described in section 5. Submit only work you
have permission to contribute under that license, including any employer-owned
or third-party material. Preserve applicable copyright and license notices.

If you use coding agents, review their output and verify its behavior and
provenance before submitting it. You remain responsible for the contribution.
See [licensing and redistribution](docs/LICENSING.md) for asset and dependency scope.
