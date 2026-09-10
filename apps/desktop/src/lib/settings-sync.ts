import { hexToHsl, type ThemePalette } from '@jackalope/brand/theme';

export interface SyncedSettings {
  version: 1;
  accentHex: string;
  isDark: boolean;
  appearance: 'manual' | 'automatic';
  atmosphere: number;
  harmony: 'single' | 'duo' | 'trio';
  mascotReactions: boolean;
  notifications: 'all' | 'failures-only' | 'none';
  osNotifications: boolean;
}
export interface SyncView {
  available: boolean;
  enabled: boolean;
  owner: string | null;
  revision: number;
  settings: SyncedSettings | null;
  conflict: boolean;
}
export function portableSettings(
  theme: ThemePalette,
  preferences: Pick<SyncedSettings, 'mascotReactions' | 'notifications' | 'osNotifications'>,
): SyncedSettings {
  return {
    version: 1,
    accentHex:
      theme.accentHex.length === 4
        ? `#${theme.accentHex
            .slice(1)
            .split('')
            .map((c) => c + c)
            .join('')}`
        : theme.accentHex,
    isDark: theme.isDark,
    appearance: theme.appearance ?? 'manual',
    atmosphere: theme.atmosphere ?? 12,
    harmony: theme.harmony ?? 'single',
    mascotReactions: preferences.mascotReactions,
    notifications: preferences.notifications,
    osNotifications: preferences.osNotifications,
  };
}
export function syncedTheme(settings: SyncedSettings): ThemePalette {
  const { h, s, l } = hexToHsl(settings.accentHex);
  return {
    id: 'synced',
    name: 'Synced theme',
    accentHue: h,
    accentSat: s,
    accentLight: l,
    accentHex: settings.accentHex,
    isDark: settings.isDark,
    appearance: settings.appearance,
    atmosphere: settings.atmosphere,
    harmony: settings.harmony,
  };
}
export function sameSettings(a: SyncedSettings | null, b: SyncedSettings | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      Object.keys(a).every(
        (key) => a[key as keyof SyncedSettings] === b[key as keyof SyncedSettings],
      ))
  );
}
export function syncDecision(
  local: SyncedSettings,
  base: SyncedSettings | null,
  remote: SyncedSettings | null,
) {
  if (sameSettings(local, remote)) return 'same';
  if (!remote) return 'upload';
  if (!base || sameSettings(local, base)) return 'download';
  return sameSettings(remote, base) ? 'upload' : 'conflict';
}
