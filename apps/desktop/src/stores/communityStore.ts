import { create } from 'zustand';
import { nativeTask } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';
import { createTelemetry } from '../lib/telemetry';
import { useSettingsStore } from './settingsStore';

export interface CommunitySettings {
  reviewed: boolean;
  telemetry: boolean;
  errors: boolean;
  configured: boolean;
  buildChannel: 'stable' | 'beta';
}
export const telemetry = createTelemetry((events) => nativeTask('app_telemetry', { events }));
interface State {
  settings: CommunitySettings | null;
  busy: boolean;
  error: string | null;
  load: () => Promise<void>;
  applyDefaults: () => Promise<void>;
  save: (usage: boolean, errors: boolean) => Promise<void>;
}
let loaded: Promise<void> | undefined;
let opened = false;
function activate(settings: CommunitySettings) {
  const enabled = settings.configured && settings.reviewed && settings.telemetry;
  telemetry.configure(enabled, settings.errors);
  if (enabled && !opened) {
    opened = true;
    telemetry.track({ name: 'app_opened' });
  }
}
export const useCommunityStore = create<State>((set, get) => ({
  settings: null,
  busy: false,
  error: null,
  load: async () => {
    if (get().settings || !isTauriEnvironment()) return;
    if (loaded) return loaded;
    loaded = (async () => {
      try {
        const settings = await nativeTask<CommunitySettings>('app_community_settings');
        set({ settings, error: null });
        activate(settings);
      } catch {
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
    try {
      const settings = await nativeTask<CommunitySettings>('app_community_configure', {
        telemetry: usage,
        errors,
      });
      set({ settings });
      activate(settings);
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
