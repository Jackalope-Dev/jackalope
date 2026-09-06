# Windows installer branding

The Windows packages use the shared Jackalope head silhouette and Mojave Sunset
palette. Welcome artwork uses the dark palette; content and header backgrounds
use its light palette so native controls retain readable Windows focus/selection
states. Installer artwork is static and does not read a user's saved app theme.

Regenerate on Windows after changing the theme or character geometry:

```powershell
pnpm --filter @jackalope/desktop brand:installer
```

The full `brand:generate` command also regenerates these files. The generator
reads `theme-engine.ts` and `character-paths.ts`, renders the artwork with
`@resvg/resvg-js`, and writes opaque 24-bit BMPs using NSIS/WiX's documented
layouts. NSIS artwork is rendered at 3x and fitted to its controls for sharper
display scaling; WiX artwork uses its required pixel dimensions.
Segoe UI is used for the wordmark and native EXE dialog text. Generated BMPs and
`theme.nsh` are checked in so packaging does not require font rendering.
The renderer is an MPL-2.0 development dependency; it is not bundled into the app.

`tauri.conf.json` selects the images and the app's existing installer/uninstaller
icon. `hooks.nsh` supplies Modern UI colors and welcome/finish copy through
Tauri's supported include. The upstream installer template, install scope,
WebView2 handling, upgrades, shortcuts and uninstall behavior remain unchanged.
The MSI uses native WiX controls with matching welcome and header artwork.

Build both packages with `pnpm tauri build`. Review EXE welcome, destination,
progress and finish pages, and MSI welcome/destination pages, including keyboard
focus and non-default display scaling. Installation/uninstallation is a separate
lifecycle check from opening and reviewing the wizard.

References: [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/),
[Tauri configuration](https://v2.tauri.app/reference/config/), and
[NSIS Modern UI](https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html).
