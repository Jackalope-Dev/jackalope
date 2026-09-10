import { isDarkAtTime, type ThemePalette, themeTokens } from './tokens.ts';

export * from './tokens.ts';

let activeTheme: ThemePalette | undefined;
let activeDark: boolean | undefined;

export function startThemeClock() {
  const refresh = () => {
    if (activeTheme && isDarkAtTime(activeTheme) !== activeDark) applyThemeTokens(activeTheme);
  };
  let timer: number;
  const tick = () => {
    refresh();
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000));
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  tick();
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}

export function applyThemeTokens(theme: ThemePalette) {
  activeTheme = theme;
  activeDark = isDarkAtTime(theme);
  for (const [name, value] of Object.entries(themeTokens(theme))) {
    document.documentElement.style.setProperty(name, value);
  }
}
