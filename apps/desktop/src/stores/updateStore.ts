import { create } from 'zustand';
import { nativeTask } from '../lib/task-runtime.ts';
import { isTauriEnvironment } from '../lib/tauri-bridge.ts';

export interface ReleaseStatus {
  currentVersion: string;
  channel: 'stable' | 'beta';
  betaAvailable: boolean;
  configured: boolean;
  storeManaged?: boolean;
  availableVersion: string | null;
  notes: string | null;
}
export interface UpdateProgress {
  phase: 'downloading' | 'installing';
  downloaded: number;
  total: number | null;
}
interface UpdateBridge {
  desktop: () => boolean;
  status: (check: boolean) => Promise<ReleaseStatus>;
  setChannel?: (channel: 'stable' | 'beta') => Promise<void>;
  install: (
    version: string,
    progress: (value: UpdateProgress) => void,
    channel: 'stable' | 'beta',
  ) => Promise<void>;
  now: () => number;
}
interface UpdateState {
  autoCheck: boolean;
  release: ReleaseStatus | null;
  changingChannel: boolean;
  setChannel: (channel: 'stable' | 'beta') => Promise<void>;
  checking: boolean;
  installing: boolean;
  progress: UpdateProgress | null;
  error: string | null;
  lastAttempt: number | null;
  lastChecked: number | null;
  dismissedVersion: string | null;
  setAutoCheck: (value: boolean) => void;
  dismiss: () => void;
  load: () => Promise<void>;
  check: (automatic?: boolean) => Promise<void>;
  install: () => Promise<void>;
}
export const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}
export function createUpdateStore(bridge: UpdateBridge, storage?: PreferenceStorage) {
  let autoCheck = true;
  try {
    storage ??= localStorage;
    autoCheck = storage.getItem('jackalope-auto-update-check') !== 'false';
  } catch {
    autoCheck = false;
  }
  let loading: Promise<void> | undefined;
  return create<UpdateState>()((set, get) => ({
    autoCheck,
    release: null,
    changingChannel: false,
    setChannel: async (channel) => {
      if (
        !bridge.setChannel ||
        get().checking ||
        get().installing ||
        get().changingChannel ||
        loading
      )
        return;
      set({ changingChannel: true, error: null });
      try {
        await bridge.setChannel(channel);
        set({ release: null, lastAttempt: null, lastChecked: null, dismissedVersion: null });
        await get().load();
      } catch (error) {
        set({ error: String(error) });
      } finally {
        set({ changingChannel: false });
      }
    },
    checking: false,
    installing: false,
    progress: null,
    error: null,
    lastAttempt: null,
    lastChecked: null,
    dismissedVersion: null,
    setAutoCheck: (autoCheck) => {
      set({ autoCheck });
      try {
        storage?.setItem('jackalope-auto-update-check', String(autoCheck));
      } catch {
        set({ error: 'This preference could not be saved. It applies until Jackalope closes.' });
      }
    },
    dismiss: () => set({ dismissedVersion: get().release?.availableVersion ?? null }),
    load: async () => {
      if (!bridge.desktop() || get().release) return;
      if (loading) return loading;
      loading = (async () => {
        try {
          set({ release: await bridge.status(false), error: null });
        } catch (error) {
          set({ error: String(error) });
        }
      })();
      try {
        await loading;
      } finally {
        loading = undefined;
      }
    },
    check: async (automatic = false) => {
      const state = get();
      if (!bridge.desktop() || state.checking || state.installing || state.changingChannel) return;
      if (
        automatic &&
        (!state.autoCheck ||
          (state.lastAttempt !== null && bridge.now() - state.lastAttempt < UPDATE_INTERVAL))
      )
        return;
      set({ checking: true, error: null, lastAttempt: bridge.now() });
      try {
        await get().load();
        if (!get().release?.configured || (automatic && !get().autoCheck)) return;
        const release = await bridge.status(true);
        set({ release, lastChecked: bridge.now() });
      } catch (error) {
        set({ error: String(error) });
      } finally {
        set({ checking: false });
      }
    },
    install: async () => {
      const state = get();
      const version = state.release?.availableVersion;
      if (!version || state.checking || state.installing || state.changingChannel) return;
      set({ installing: true, error: null, progress: null });
      try {
        await bridge.install(
          version,
          (progress) => set({ progress }),
          state.release?.channel ?? 'stable',
        );
      } catch (error) {
        set({ error: String(error) });
      } finally {
        set({ installing: false, progress: null });
      }
    },
  }));
}
export const useUpdateStore = createUpdateStore({
  desktop: isTauriEnvironment,
  status: (check) => nativeTask<ReleaseStatus>('app_release_status', { check }),
  setChannel: (channel) => nativeTask('app_release_channel', { channel }),
  install: async (version, onProgress, channel) => {
    const { Channel } = await import('@tauri-apps/api/core');
    const progress = new Channel<UpdateProgress>();
    progress.onmessage = onProgress;
    await nativeTask('app_install_update', { version, progress, channel });
  },
  now: Date.now,
});
