import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { type SessionSnapshot, sessionCommand } from '../lib/live-session';
import { observeRefresh } from '../lib/observe-refresh';
import { isTauriEnvironment } from '../lib/tauri-bridge';

interface SessionsState extends SessionSnapshot {
  selectedId: string | null;
  loading: boolean;
  refresh: (id?: string | null) => Promise<void>;
  select: (id: string | null) => void;
}
let refresh: Promise<void> | undefined;
export const useLiveSessionStore = create<SessionsState>((set, get) => ({
  sessions: [], runs: [], error: null, selectedId: null, loading: true,
  select: (selectedId) => { set({selectedId}); void get().refresh(selectedId); },
  refresh: (id = get().selectedId) => {
    if (refresh) return refresh;
    refresh = sessionCommand<SessionSnapshot>('snapshot', {id})
      .then((snapshot) => set({...snapshot, loading: false}))
      .catch((error) => set({error: String(error), loading: false}))
      .finally(() => { refresh = undefined; });
    return refresh;
  },
}));

export function observeLiveSessions(id?: string) {
  if (!isTauriEnvironment()) { useLiveSessionStore.setState({loading: false}); return; }
  return observeRefresh({
    refresh: () => useLiveSessionStore.getState().refresh(id),
    interval: () => document.hidden ? 8000 : 1500,
    subscribe: (changed) => listen('live-sessions-changed', changed),
  });
}
