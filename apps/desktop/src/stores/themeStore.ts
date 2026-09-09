import {
  applyThemeTokens,
  DEFAULT_THEME,
  hexToHsl,
  hslToHex,
  type ThemePalette,
} from '@jackalope/brand/theme';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useProjectStore } from './projectStore';

interface ThemeState {
  currentTheme: ThemePalette;
  appTheme: ThemePalette;
  setAppTheme: (theme: ThemePalette) => void;
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
      appTheme: initialTheme,
      setAppTheme: (appTheme) => {
        set({ appTheme });
        refreshProjectTheme();
      },
      setTheme: (theme: ThemePalette) => {
        const { projects, activeProjectId, updateProjectPreferences } = useProjectStore.getState();
        const project = projects.find((item) => item.id === activeProjectId);
        if (project?.preferences?.theme) updateProjectPreferences(project.id, { theme });
        else get().setAppTheme(theme);
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
        get().setTheme(updated);
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
        get().setTheme(updated);
      },
    }),
    {
      name: 'jackalope-theme',
      merge: (persisted, current) => {
        const saved = persisted as Partial<ThemeState>;
        return { ...current, ...saved, appTheme: saved.appTheme ?? saved.currentTheme ?? initialTheme };
      },
      onRehydrateStorage: () => (state) => {
        if (state) applyThemeTokens(state.currentTheme);
      },
    },
  ),
);

export function refreshProjectTheme() {
  const { projects, activeProjectId } = useProjectStore.getState();
  const theme = projects.find((project) => project.id === activeProjectId)?.preferences?.theme ?? useThemeStore.getState().appTheme;
  if (theme !== useThemeStore.getState().currentTheme) {
    useThemeStore.setState({ currentTheme: theme });
    applyThemeTokens(theme);
  }
}
useProjectStore.subscribe(refreshProjectTheme);
refreshProjectTheme();
