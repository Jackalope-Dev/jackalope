import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { nativeTask } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';
import { telemetry } from '../lib/telemetry-client';
import { useSettingsStore } from './settingsStore';

export interface CommunitySettings {
  reviewed: boolean;
  telemetry: boolean;
  errors: boolean;
  configured: boolean;
  buildChannel: 'stable' | 'beta';
}
export { telemetry } from '../lib/telemetry-client';

interface State {
  settings: CommunitySettings | null;
  busy: boolean;
  error: string | null;
  load: (force?: boolean) => Promise<void>;
  applyDefaults: () => Promise<void>;
  save: (usage: boolean, errors: boolean) => Promise<void>;
}
let loaded: Promise<void> | undefined;
let opened = false;
let revision = 0;
function activate(settings: CommunitySettings) {
  const enabled = settings.configured && settings.reviewed && settings.telemetry;
  telemetry.configure(enabled, settings.errors);
  if (enabled && !opened && !new URLSearchParams(window.location.search).has('liveSession')) {
    opened = true;
    telemetry.track({ name: 'app_opened' });
  }
}
export const useCommunityStore = create<State>((set, get) => ({
  settings: null,
  busy: false,
  error: null,
  load: async (force = false) => {
    if ((!force && get().settings) || !isTauriEnvironment()) return;
    if (loaded) {
      await loaded;
      if (force) await get().load(true);
      return;
    }
    loaded = (async () => {
      const before = revision;
      try {
        const settings = await nativeTask<CommunitySettings>('app_community_settings');
        if (before !== revision) return;
        set({ settings, error: null });
        activate(settings);
      } catch {
        if (before !== revision) return;
        telemetry.stop();
        set({ error: 'Privacy settings could not be read. Usage sharing is paused.' });
      }
    })();
    await loaded;
    loaded = undefined;
  },
  applyDefaults: async () => {
    await get().load();
    const { settings, busy, error } = get();
    if (!settings || settings.reviewed || busy || error) return;
    const legacy = useSettingsStore.getState();
    await get().save(legacy.telemetryEnabled, legacy.crashReportingEnabled);
  },
  save: async (usage, errors) => {
    if (get().busy) return;
    telemetry.stop();
    set({ busy: true, error: null });
    const before = revision;
    try {
      const settings = await nativeTask<CommunitySettings>('app_community_configure', {
        telemetry: usage,
        errors,
      });
      if (before === revision) {
        set({ settings });
        activate(settings);
      }
      try {
        useSettingsStore.setState({ telemetryEnabled: usage, crashReportingEnabled: errors });
      } catch {
        // Native preferences are authoritative; a full webview cache cannot undo the save.
      }
    } catch {
      set({ error: 'This choice could not be saved. Usage sharing is paused; please retry.' });
    } finally {
      set({ busy: false });
    }
  },
}));

export function observeCommunity() {
  if (!isTauriEnvironment()) return;
  let disposed = false;
  let stop: (() => void) | undefined;
  void listen<CommunitySettings>('community-settings-changed', ({ payload }) => {
    revision++;
    useCommunityStore.setState({ settings: payload, error: null });
    activate(payload);
  })
    .then((unlisten) => {
      if (disposed) unlisten();
      else {
        stop = unlisten;
        void useCommunityStore.getState().load(true);
      }
    })
    .catch(() => {
      telemetry.stop();
    });
  return () => {
    disposed = true;
    stop?.();
  };
}
