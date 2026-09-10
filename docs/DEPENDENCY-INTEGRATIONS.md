# Dependency integration contracts

See [DEPENDENCIES.md](DEPENDENCIES.md) for the generated package inventory and
bundled license notices. This guide describes behavior that dependency upgrades
must preserve.

## Results and patch review

Pierre Diffs renders highlighted unified and split patches with wrapping and
virtualization. Preserve access to the original patch when parsing or loading
fails. Rendering must not change integration approval or Git mutation safeguards.

Streamdown renders incomplete streaming Markdown in task results. Preserve safe
external-link handling and HTML exclusion. Static release notes and connection
documentation use react-markdown.

The pinned `@streamdown/code` patch keys highlighted results by the complete input
tuple. The upstream key used the language, themes, length and ends of a block,
allowing different middle content to reuse stale tokens. Keep the regression test
that reconstructs highlighted text after an equal-length middle edit. Remove the
patch only when an upgraded dependency passes that test.

Shiki uses its JavaScript regex engine under the production `script-src 'self'`
policy. Do not add eval or WebAssembly permissions for highlighting. Use the
resolved brand appearance for code colors, including previews and clock changes.
Keep one compatible Shiki version across renderers. Grammars load on demand but
still increase distribution size; measure packaged size when changing bundles.

The desktop bundle retains every language and only its existing GitHub light/dark
code themes. Markdown uses a view-owned worker with a shared highlighter and a bounded
renderer cache keyed by complete options. Large patch parsing and diff highlighting use
workers; retain original-patch access on failure. The upstream cache regression stays
as a dependency check, and the production browser fixture checks the active renderer.
See [performance checks](PERFORMANCE.md).

## Repository analysis

The notify watcher invalidates an open codebase view after debounced source
changes. Preserve generated-file filtering, subscription bounds and cleanup.
Manual refresh and focus invalidation remain available when watching fails.
Branch monitors continue to observe committed Git content.

gix performs read-only readiness checks with isolated configuration and repository
trust checks. Preserve Git CLI fallback and tests for SHA-1, SHA-256, packed refs,
detached HEAD and linked worktrees. Mutations, integration and worktree cleanup
continue through the existing guarded Git command paths.

## Browser accessibility

The bundled agent-browser exposes axe-core through `browser_inspect` with
`kind: "accessibility"`. MCP and HTTP calls retain bounded reports as validation
evidence. Preserve axe-core's bundled license and corresponding-source notice;
see [browser automation](BROWSER-AUTOMATION.md).

## Verification

Run the affected renderer, watcher, readiness and browser tests when upgrading
these dependencies, then `pnpm verify`. Check the production CSP, keyboard access,
themes, reduced motion and incomplete Markdown in the component lab. Native
platform and installed-agent acceptance require their separate checks.
