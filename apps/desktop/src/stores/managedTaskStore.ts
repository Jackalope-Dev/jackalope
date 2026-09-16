import { create } from 'zustand';
import { observeRefresh } from '../lib/observe-refresh';
import { type QueueView, queueSnapshot } from '../lib/queue';
import { isTauriEnvironment } from '../lib/tauri-bridge';

const empty: QueueView = {
  items: [],
  managedTasks: [],
  messages: [],
  enabledProjects: [],
  concurrency: 3,
  bridgeUrl: null,
  bridgeError: null,
  mergedRunIds: [],
};
interface ManagedState {
  queue: QueueView;
  selectedId: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
}
let refreshing: Promise<void> | undefined;
export const useManagedTaskStore = create<ManagedState>((set) => ({
  queue: empty,
  selectedId: null,
  error: null,
  select: (selectedId) => set({ selectedId }),
  refresh: () => {
    if (!refreshing)
      refreshing = queueSnapshot()
        .then((queue) => set({ queue, error: null }))
        .catch((error) => set({ error: String(error) }))
        .finally(() => {
          refreshing = undefined;
        });
    return refreshing;
  },
}));

export function observeManagedTasks() {
  if (!isTauriEnvironment()) return;
  return observeRefresh({
    refresh: () => useManagedTaskStore.getState().refresh(),
    interval: () =>
      document.hidden || !useManagedTaskStore.getState().queue.enabledProjects.length ? 8000 : 2000,
  });
}
