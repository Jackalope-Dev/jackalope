import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { portableSettings, sameSettings, syncDecision, syncedTheme, type SyncedSettings, type SyncView } from '../lib/settings-sync';
import { nativeTask } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';
import { useSettingsStore } from './settingsStore';
import { useThemeStore } from './themeStore';

interface SyncState {
  available: boolean;
  enabled: boolean;
  busy: boolean;
  error: string;
  conflict: SyncView | null;
  owner: string | null;
  base: SyncedSettings | null;
  lastSynced: number | null;
  configure: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  resolve: (choice: 'local' | 'remote') => Promise<void>;
  remove: () => Promise<void>;
}
let epoch = 0;
let running: Promise<void> | undefined;
let paused = false;
const snapshot = () => portableSettings(useThemeStore.getState().appTheme, useSettingsStore.getState());
const invoke = (action: object) => nativeTask<SyncView>('app_settings_sync', { action });
function apply(settings: SyncedSettings) {
  useThemeStore.getState().setAppTheme(syncedTheme(settings));
  useSettingsStore.getState().updateSettings({
    mascotReactions: settings.mascotReactions,
    notifications: settings.notifications,
    osNotifications: settings.osNotifications,
  });
}
export const useSettingsSyncStore = create<SyncState>()(persist((set, get) => ({
  available: false, enabled: false, busy: false, error: '', conflict: null,
  owner: null, base: null, lastSynced: null,
  remove: async () => {
    const owner = get().owner;
    if (!owner || get().busy) return;
    const generation = ++epoch;
    paused = true;
    set({ enabled: false, busy: true, conflict: null, error: '' });
    try {
      await running;
      await invoke({ action: 'delete', owner });
      if (generation === epoch) { set({ base: null, lastSynced: null }); paused = false; }
    } catch (error) {
      if (generation === epoch) set({ error: `Could not delete saved settings. Retry Delete synced settings when online. ${String(error)}` });
    } finally {
      if (generation === epoch) set({ busy: false });
    }
  },
  configure: async (enabled) => {
    const generation = ++epoch;
    paused = true;
    set({ enabled: false, busy: true, conflict: null, error: '' });
    try {
      await running;
      const view = await invoke({ action: 'configure', enabled });
      if (generation !== epoch) return;
      if (view.owner !== get().owner) set({ owner: view.owner, base: null, lastSynced: null });
      set({ enabled: view.enabled, available: view.available });
      paused = false;
    } catch (error) {
      if (generation === epoch) set({ error: String(error) });
    } finally {
      if (generation === epoch) set({ busy: false });
    }
    if (enabled && !paused) await get().refresh();
  },
  refresh: async () => {
    if (!isTauriEnvironment() || paused) return;
    if (running) return running;
    const generation = epoch;
    running = (async () => {
      try {
        const status = await invoke({ action: 'status' });
        if (generation !== epoch) return;
        if (status.owner !== get().owner) set({ owner: status.owner, base: null, lastSynced: null, conflict: null });
        set({ enabled: status.enabled, available: status.available });
        if (!status.enabled || !status.owner) { set({ conflict: null }); return; }
        if (get().conflict || useThemeStore.getState().previewing) return;
        set({ busy: true, error: '' });
        const before = snapshot();
        const remote = await invoke({ action: 'read', owner: status.owner });
        if (generation !== epoch || !sameSettings(before, snapshot()) || useThemeStore.getState().previewing) return;
        if (!remote.enabled) { set({ enabled: false, base: null, lastSynced: null, conflict: null }); return; }
        const decision = syncDecision(before, get().base, remote.settings);
        if (decision === 'conflict') { set({ conflict: remote }); return; }
        if (decision === 'upload') {
          const result = await invoke({ action: 'write', owner: status.owner, revision: remote.revision, settings: before });
          if (generation !== epoch) return;
          if (!result.enabled) { set({ enabled: false, base: null, lastSynced: null }); return; }
          if (result.conflict) { set({ error: 'Settings changed on another device. Retry to review the latest version.' }); return; }
          set({ base: result.settings, lastSynced: Date.now() });
        } else {
          if (decision === 'download' && remote.settings) apply(remote.settings);
          set({ base: remote.settings, lastSynced: Date.now() });
        }
      } catch (error) {
        if (generation === epoch) set({ error: String(error) });
      } finally {
        if (generation === epoch) set({ busy: false });
      }
    })();
    try { await running; } finally { running = undefined; }
  },
  resolve: async (choice) => {
    const remote = get().conflict;
    if (!remote?.settings || !remote.owner || get().busy || paused) return;
    const generation = epoch;
    set({ busy: true, error: '' });
    try {
      // A fresh native read rechecks consent and account ownership before applying either choice.
      const latest = await invoke({ action: 'read', owner: remote.owner });
      if (generation !== epoch) return;
      if (!latest.enabled) { set({ enabled: false, conflict: null, base: null, lastSynced: null }); return; }
      if (latest.revision !== remote.revision) { set({ conflict: latest, error: 'Saved settings changed again. Choose which version to keep.' }); return; }
      if (choice === 'remote') {
        if (useThemeStore.getState().previewing) throw new Error('Finish your theme preview before restoring settings.');
        apply(remote.settings);
        set({ base: remote.settings, conflict: null, lastSynced: Date.now() });
      } else {
        const local = snapshot();
        const result = await invoke({ action: 'write', owner: remote.owner, revision: remote.revision, settings: local });
        if (generation !== epoch) return;
        if (!result.enabled) { set({ enabled: false, conflict: null, base: null, lastSynced: null }); return; }
        if (result.conflict) throw new Error('Saved settings changed again. Retry before choosing a version.');
        set({ base: result.settings, conflict: null, lastSynced: Date.now() });
      }
    } catch (error) {
      if (generation === epoch) set({ error: String(error) });
    } finally {
      if (generation === epoch) set({ busy: false });
    }
  },
}), {
  name: 'jackalope-settings-sync-v1',
  partialize: ({ owner, base, lastSynced }) => ({ owner, base, lastSynced }),
}));

export function observeSettingsSync() {
  if (!isTauriEnvironment()) return;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void useSettingsSyncStore.getState().refresh(), 1500);
  };
  const unsubSettings = useSettingsStore.subscribe((value, previous) => {
    if (!sameSettings(portableSettings(useThemeStore.getState().appTheme, value), portableSettings(useThemeStore.getState().appTheme, previous))) schedule();
  });
  const unsubTheme = useThemeStore.subscribe((value, previous) => {
    if (value.appTheme !== previous.appTheme || value.previewing !== previous.previewing) schedule();
  });
  const interval = setInterval(schedule, 60000);
  window.addEventListener('focus', schedule);
  window.addEventListener('online', schedule);
  void useSettingsSyncStore.getState().refresh();
  return () => {
    clearTimeout(timer); clearInterval(interval); unsubSettings(); unsubTheme();
    window.removeEventListener('focus', schedule); window.removeEventListener('online', schedule);
  };
}
