import { refreshThemeAppearance, themeFollowsSystem } from '@jackalope/brand/theme';
import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { isTauriEnvironment } from './native/env';
import { isMacPlatform } from './platform-shortcuts';

type ClientHints = {
  platform: string;
  getHighEntropyValues: (hints: string[]) => Promise<{ platformVersion?: string }>;
};

/**
 * macOS vibrancy works on every supported version; the sidebar material lets the desktop
 * show through, where the window background material is nearly opaque. Windows uses
 * Acrylic, the see-through frosted material, only on Windows 11 (it lags while dragging on
 * Windows 10); WebView2 reports Windows 11 as platform version 13 or later through client
 * hints.
 */
async function supportsGlass() {
  if (matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
  if (isMacPlatform()) return true;
  const hints = (navigator as Navigator & { userAgentData?: ClientHints }).userAgentData;
  if (hints?.platform !== 'Windows') return false;
  const { platformVersion } = await hints.getHighEntropyValues(['platformVersion']);
  return Number.parseInt(platformVersion ?? '0', 10) >= 13;
}

/**
 * Re-reads the light or dark scheme after a native window theme change, once straight
 * away and once after the webview has caught up.
 */
function settleAppearance() {
  refreshThemeAppearance();
  window.setTimeout(refreshThemeAppearance, 150);
}

/** Whether the app's current background is dark, read from the applied theme tokens. */
function appIsDark() {
  const probe = document.createElement('span');
  probe.style.color = 'var(--color-bg)';
  document.body.append(probe);
  const [red = 255, green = 255, blue = 255] = (
    getComputedStyle(probe).color.match(/[\d.]+/g) ?? []
  )
    .slice(0, 3)
    .map(Number);
  probe.remove();
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 < 0.5;
}

/** Screens currently asking for the frosted window; the OS effect stays on while any do. */
let holders = 0;
/** The applied effect's theme observer, or null while the window is opaque. */
let applied: MutationObserver | null = null;
/**
 * Native effect calls run one at a time. Screens hand the window over by unmounting one
 * WindowGlass and mounting the next (and dev StrictMode remounts), so unordered calls could
 * clear the effect after the next screen applied it, leaving `data-window-glass` panes over
 * an unblurred desktop.
 */
let queue: Promise<void> = Promise.resolve();

/** Brings the OS effect in line with whether any screen holds it. */
function syncGlass() {
  queue = queue
    .then(async () => {
      if (holders > 0 && !applied) await applyGlass();
      else if (holders === 0 && applied) await clearGlass();
    })
    .catch(() => {});
}

async function applyGlass() {
  if (!(await supportsGlass())) return;
  const { Effect, EffectState, getCurrentWindow } = await import('@tauri-apps/api/window');
  const window = getCurrentWindow();
  const root = document.documentElement;
  // An automatic theme leaves the window following the system, so the system preference
  // stays readable; otherwise the material follows the app's chosen appearance.
  const windowTheme = (): 'dark' | 'light' | null =>
    themeFollowsSystem() ? null : appIsDark() ? 'dark' : 'light';
  let theme = windowTheme();
  await window.setTheme(theme);
  settleAppearance();
  // Active keeps the window frosted while another app has focus; following the window's
  // active state would drop to the flat inactive material.
  await window.setEffects(
    isMacPlatform()
      ? { effects: [Effect.Sidebar], state: EffectState.Active }
      : { effects: [Effect.Acrylic] },
  );
  root.dataset.windowGlass = '';
  // Theme tokens are applied as inline styles on the root element.
  const observer = new MutationObserver(() => {
    const next = windowTheme();
    if (next === theme) return;
    theme = next;
    // Releasing the window theme can flip the scheme an automatic theme reads.
    void window
      .setTheme(theme)
      .then(settleAppearance)
      .catch(() => {});
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style'] });
  applied = observer;
}

async function clearGlass() {
  applied?.disconnect();
  applied = null;
  delete document.documentElement.dataset.windowGlass;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const window = getCurrentWindow();
  await window.clearEffects();
  await window.setTheme(null);
  settleAppearance();
}

/**
 * Shows the desktop through a frosted window while the calling screen is mounted.
 * The window is transparent on Windows and macOS (tauri.windows.conf.json and
 * tauri.macos.conf.json; effects need it), so pages paint an opaque background
 * unless `data-window-glass` is set; it is set only once the OS effect is applied,
 * which keeps unsupported systems on the normal opaque look. The window's theme follows
 * the app's appearance so the OS material matches it, and returns to the system's after.
 * Turning off Settings → Appearance → Frosted window keeps every screen opaque.
 */
function useWindowGlass() {
  const enabled = useSettingsStore((state) => state.frostedWindow);
  useEffect(() => {
    if (!enabled || !isTauriEnvironment()) return;
    holders += 1;
    syncGlass();
    return () => {
      holders -= 1;
      syncGlass();
    };
  }, [enabled]);
}

/** Frosts the window while rendered; see useWindowGlass. */
export function WindowGlass() {
  useWindowGlass();
  return null;
}
