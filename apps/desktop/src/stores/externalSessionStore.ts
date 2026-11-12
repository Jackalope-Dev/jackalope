import { describeError } from '@jackalope/contracts/errors';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { type ExternalSession, listExternalSessions } from '../lib/external-sessions';
import { isTauriEnvironment } from '../lib/native/env';
import { observeRefresh } from '../lib/observe-refresh';

interface ExternalSessionsState {
  enabled: boolean;
  sessions: ExternalSession[];
  error: string | null;
  loaded: boolean;
  selectedKey: string | null;
  refresh: () => Promise<void>;
  select: (key: string | null) => void;
}

export const useExternalSessionStore = create<ExternalSessionsState>((set, get) => ({
  enabled: true,
  sessions: [],
  error: null,
  loaded: false,
  selectedKey: null,
  select: (selectedKey) => set({ selectedKey }),
  refresh: async () => {
    try {
      const view = await listExternalSessions();
      const current = get();
      const same =
        current.loaded &&
        current.enabled === view.enabled &&
        current.error === (view.error ?? null) &&
        JSON.stringify(current.sessions) === JSON.stringify(view.sessions);
      if (!same)
        set({
          enabled: view.enabled,
          sessions: view.sessions,
          error: view.error ?? null,
          loaded: true,
        });
    } catch (error) {
      set({ error: describeError(error), loaded: true });
    }
  },
}));

/** Keeps the list current: the native side refreshes in the background and announces changes. */
export function observeExternalSessions() {
  if (!isTauriEnvironment()) return;
  return observeRefresh({
    refresh: () => useExternalSessionStore.getState().refresh(),
    interval: () => (document.hidden ? 300_000 : 60_000),
    subscribe: (changed) => listen('external-sessions-changed', changed),
  });
}
