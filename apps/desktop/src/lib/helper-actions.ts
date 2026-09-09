import { hexToHsl, type ThemePalette } from '@jackalope/brand/theme';
import type { SettingsState } from '../stores/settingsStore';

export interface ThemeChange {
  scope: 'app' | 'project';
  appearance?: 'light' | 'dark' | 'auto' | null;
  accent?: string | null;
  harmony?: 'single' | 'duo' | 'trio' | null;
  atmosphere?: number | null;
}

export function helperTheme(base: ThemePalette, change: ThemeChange): ThemePalette {
  const theme = { ...base };
  if (change.appearance) {
    if (!['light', 'dark', 'auto'].includes(change.appearance))
      throw new Error('Invalid appearance.');
    theme.appearance = change.appearance === 'auto' ? 'automatic' : 'manual';
    if (change.appearance !== 'auto') theme.isDark = change.appearance === 'dark';
  }
  if (change.accent) {
    if (!/^#[\da-f]{6}$/i.test(change.accent)) throw new Error('Use a six-digit hex color.');
    const { h, s, l } = hexToHsl(change.accent);
    Object.assign(theme, {
      id: 'custom',
      name: 'Custom Accent',
      accentHex: change.accent,
      accentHue: h,
      accentSat: s,
      accentLight: l,
    });
  }
  if (change.harmony) {
    if (!['single', 'duo', 'trio'].includes(change.harmony)) throw new Error('Invalid harmony.');
    theme.harmony = change.harmony;
  }
  if (change.atmosphere != null) {
    if (!Number.isInteger(change.atmosphere) || change.atmosphere < 0 || change.atmosphere > 64)
      throw new Error('Atmosphere must be between 0 and 64.');
    theme.atmosphere = change.atmosphere;
  }
  return theme;
}

export function helperPreferencePatch(input: Record<string, unknown>): Partial<SettingsState> {
  const patch: Partial<SettingsState> = {};
  const bools = {
    mascot_animations: 'mascotReactions',
    show_theme_picker: 'showThemePickerInToolbar',
    auto_scroll_logs: 'autoScrollLogs',
    os_notifications: 'osNotifications',
  } as const;
  for (const [name, value] of Object.entries(input)) {
    if (value == null) continue;
    if (name === 'notifications') {
      if (!['all', 'failures-only', 'none'].includes(String(value)))
        throw new Error('Invalid notification preference.');
      patch.notifications = value as SettingsState['notifications'];
    } else if (Object.hasOwn(bools, name) && typeof value === 'boolean') {
      patch[bools[name as keyof typeof bools]] = value;
    } else throw new Error('Unsupported preference.');
  }
  if (!Object.keys(patch).length) throw new Error('No preferences to change.');
  return patch;
}

export function sameHelperValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && sameHelperValue(left[key], right[key]),
    )
  );
}
