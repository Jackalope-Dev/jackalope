import {
  applyThemeTokens,
  DEFAULT_THEME,
  hexToHsl,
  hslToHex,
  type ThemePalette,
} from '@jackalope/brand/theme';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  currentTheme: ThemePalette;
  setTheme: (theme: ThemePalette) => void;
  setCustomAccentHex: (hex: string) => void;
  setCustomHsl: (h: number, s: number, l: number) => void;
}

const initialTheme = DEFAULT_THEME;
applyThemeTokens(initialTheme); // avoids a flash of unstyled theme before persisted state rehydrates

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      currentTheme: initialTheme,
      setTheme: (theme: ThemePalette) => {
        applyThemeTokens(theme);
        set({ currentTheme: theme });
      },
      setCustomAccentHex: (hex: string) => {
        if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return;
        const { h, s, l } = hexToHsl(hex);
        const updated: ThemePalette = {
          ...get().currentTheme,
          id: 'custom',
          name: 'Custom Accent',
          accentHex: hex,
          accentHue: h,
          accentSat: s,
          accentLight: l,
        };
        applyThemeTokens(updated);
        set({ currentTheme: updated });
      },
      setCustomHsl: (h: number, s: number, l: number) => {
        const hex = hslToHex(h, s, l);
        const updated: ThemePalette = {
          ...get().currentTheme,
          id: 'custom',
          name: 'Custom Accent',
          accentHex: hex,
          accentHue: Math.round(h),
          accentSat: Math.round(s),
          accentLight: Math.round(l),
        };
        applyThemeTokens(updated);
        set({ currentTheme: updated });
      },
    }),
    {
      name: 'jackalope-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyThemeTokens(state.currentTheme);
      },
    },
  ),
);
