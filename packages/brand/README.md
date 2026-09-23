# Shared branding

Both applications import `@jackalope/brand/theme`, `@jackalope/brand/character`
and `@jackalope/brand/fonts.css`. This package owns theme token derivation,
palette presets, vector geometry and bundled fonts. App-specific state and
components stay in their applications.

Theme functions require a document only when applying tokens or starting the
appearance clock. Importing geometry and presets is safe in build scripts.
The desktop visual-state tests exercise contrast and theme transitions. After
changing character geometry, regenerate desktop icons and installer artwork with
`pnpm --filter @jackalope/desktop brand:generate`; website favicons derive from
the same geometry during development/build.

Project-authored artwork and code follow the root [Apache-2.0 license](../../LICENSE).
Bundled fonts retain their OFL-1.1 notices. The copyright license does not grant
trademark rights or permission to imply endorsement; see [licensing](../../docs/LICENSING.md).
