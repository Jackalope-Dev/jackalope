import { isDarkAtTime, type ThemePalette, themeTokens } from './tokens.ts';

export * from './tokens.ts';

let activeTheme: ThemePalette | undefined;
let activeDark: boolean | undefined;

/**
 * Re-applies the theme when its light or dark answer has changed. Callers that change
 * what the webview reports as the system scheme, such as setting the native window theme,
 * call this afterwards because WebView2 does not always fire a media query change.
 */
export function refreshThemeAppearance() {
  if (activeTheme && isDarkAtTime(activeTheme) !== activeDark) applyThemeTokens(activeTheme);
}

export function startThemeClock() {
  const refresh = refreshThemeAppearance;
  let timer: number;
  const tick = () => {
    refresh();
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000));
  };
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  system?.addEventListener('change', refresh);
  tick();
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    system?.removeEventListener('change', refresh);
  };
}

/** Whether the applied theme follows the system's light or dark setting. */
export function themeFollowsSystem() {
  return activeTheme?.appearance === 'automatic';
}

export function applyThemeTokens(theme: ThemePalette) {
  activeTheme = theme;
  activeDark = isDarkAtTime(theme);
  for (const [name, value] of Object.entries(themeTokens(theme))) {
    document.documentElement.style.setProperty(name, value);
  }
}
