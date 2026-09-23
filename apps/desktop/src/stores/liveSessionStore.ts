import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { type SessionSnapshot, sessionCommand } from '../lib/live-session';
import { observeRefresh } from '../lib/observe-refresh';
import { knownSessionRevisions, mergeSessionChanges } from '../lib/session-changes';
import { isTauriEnvironment } from '../lib/tauri-bridge';

interface SessionsState extends SessionSnapshot {
  selectedId: string | null;
  loading: boolean;
  refresh: (id?: string | null) => Promise<void>;
  select: (id: string | null) => void;
}
let refresh: Promise<void> | undefined;
let pendingId: string | null | undefined;
export const useLiveSessionStore = create<SessionsState>((set, get) => ({
  sessions: [],
  runs: [],
  error: null,
  selectedId: null,
  loading: true,
  select: (selectedId) => {
    set({ selectedId });
    void get().refresh(selectedId);
  },
  refresh: (id = get().selectedId) => {
    if (refresh) {
      pendingId = id;
      return refresh.then(() => (pendingId !== undefined ? get().refresh(pendingId) : undefined));
    }
    pendingId = undefined;
    refresh = sessionCommand<SessionSnapshot>('snapshot', {
      id,
      known: knownSessionRevisions(get().revisions),
    })
      .then((snapshot) => {
        const current = get();
        const next = mergeSessionChanges(current, snapshot);
        if (
          !current.loading &&
          next.sessions === current.sessions &&
          next.runs === current.runs &&
          next.error === current.error
        )
          return;
        set({ ...next, loading: false });
      })
      .catch((error) => set({ error: String(error), loading: false }))
      .finally(() => {
        refresh = undefined;
      });
    return refresh;
  },
}));

export function observeLiveSessions(id?: string) {
  if (!isTauriEnvironment()) {
    useLiveSessionStore.setState({ loading: false });
    return;
  }
  return observeRefresh({
    refresh: () => useLiveSessionStore.getState().refresh(id),
    interval: () => (document.hidden ? 8000 : 1500),
    subscribe: (changed) => listen('live-sessions-changed', changed),
  });
}
