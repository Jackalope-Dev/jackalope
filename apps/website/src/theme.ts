import { DEFAULT_THEME, PRESET_THEMES, type ThemePalette } from '@jackalope/brand/theme';

const storageKey = 'jackalope-website-theme';
export const DEFAULT_WEBSITE_THEME = { ...DEFAULT_THEME, isDark: false, atmosphere: 18 };

export function readWebsiteTheme(): ThemePalette {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_WEBSITE_THEME;
    const preset = 'id' in saved && PRESET_THEMES.find((theme) => theme.id === saved.id);
    return {
      ...(preset || DEFAULT_WEBSITE_THEME),
      isDark: 'isDark' in saved && typeof saved.isDark === 'boolean' ? saved.isDark : false,
      atmosphere: 18,
    };
  } catch {
    return DEFAULT_WEBSITE_THEME;
  }
}

export function saveWebsiteTheme(theme: ThemePalette) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ id: theme.id, isDark: theme.isDark }));
  } catch {
    // Appearance remains usable when browser storage is unavailable.
  }
}
