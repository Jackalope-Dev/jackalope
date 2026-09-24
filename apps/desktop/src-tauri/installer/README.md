# Windows installer branding

The Windows packages use the shared Jackalope head silhouette and the brand's
default theme, matching the website. Welcome artwork uses the dark palette; content and header backgrounds
use its light palette so native controls retain readable Windows focus/selection
states. Installer artwork is static and does not read a user's saved app theme.

Regenerate on Windows after changing the theme or character geometry:

```powershell
pnpm --filter @jackalope/desktop brand:installer
```

The full `brand:generate` command also regenerates these files. The generator
reads `@jackalope/brand/theme` and `@jackalope/brand/character`, renders the artwork with
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

The EXE installer also adds its install folder to the current user's `PATH` so
terminals can run `jackalope`, and its uninstaller removes that entry. The hook
edits the `Path` registry value directly, preserving its expandable type, and
broadcasts the change; new terminals see it, already-open ones do not. The MSI
does not change `PATH`. Store packages expose the command through an execution
alias instead.

The macOS disk image opens on the website's light default theme with the mark's echo and
an arrow from Jackalope to Applications. It stays light because Finder draws the
icon labels in dark text. `dmg-background.tiff` holds 1x and 2x images so Retina
displays stay sharp, and `bundle.macOS.dmg` in `tauri.conf.json` places the icons
over the arrow. Regenerate it on macOS, which provides `tiffutil`:

```sh
pnpm --filter @jackalope/desktop brand:dmg
```

Build both packages with `pnpm tauri build`. Review EXE welcome, destination,
progress and finish pages, and MSI welcome/destination pages, including keyboard
focus and non-default display scaling. Installation/uninstallation is a separate
lifecycle check from opening and reviewing the wizard.

References: [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/),
[Tauri configuration](https://v2.tauri.app/reference/config/), and
[NSIS Modern UI](https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html).
