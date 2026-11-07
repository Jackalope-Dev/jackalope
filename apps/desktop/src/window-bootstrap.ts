import { applyThemeTokens, startThemeClock } from '@jackalope/brand/theme';
import { useEffect } from 'react';
import { observeTelemetry, observeUiTelemetry } from './lib/observe-telemetry';
import { windowKind } from './lib/window-kind';
import { useAgentConfigStore } from './stores/agentConfigStore';
import { observeCommunity } from './stores/communityStore';
import { useProjectStore } from './stores/projectStore';
import { useSettingsStore } from './stores/settingsStore';
import { useThemeStore } from './stores/themeStore';

/** Saved stores a secondary window reloads when the main window changes them. */
const SHARED_STORES = [useThemeStore, useProjectStore, useSettingsStore, useAgentConfigStore];

/** Starts what every window root needs: the theme clock, privacy settings and telemetry. */
export function bootstrapWindow() {
  const main = windowKind().kind === 'main';
  const stops = [
    startThemeClock(),
    observeCommunity(),
    main ? observeTelemetry() : observeUiTelemetry(),
  ];
  if (!main) {
    const reload = (event: StorageEvent) => {
      for (const store of SHARED_STORES)
        if (event.key === store.persist.getOptions().name) void store.persist.rehydrate();
    };
    window.addEventListener('storage', reload);
    stops.push(() => window.removeEventListener('storage', reload));
  }
  return () => {
    for (const stop of stops) stop?.();
  };
}

/** Colours a secondary window by its project's theme, or the app theme when it has none. */
export function useWindowTheme(projectId: string | undefined) {
  const appTheme = useThemeStore((state) => state.appTheme);
  const projectTheme = useProjectStore(
    (state) => state.projects.find((project) => project.id === projectId)?.preferences?.theme,
  );
  useEffect(() => {
    applyThemeTokens(projectTheme ?? appTheme);
  }, [projectTheme, appTheme]);
}
