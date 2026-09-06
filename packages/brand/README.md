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
