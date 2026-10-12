import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkbenchState {
  seen: Record<string, string>;
  markSeen: (id: string, fingerprint: string) => void;
}
export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set) => ({
      seen: {},
      markSeen: (id, fingerprint) =>
        set((state) => ({
          seen: Object.fromEntries(
            [...Object.entries(state.seen).filter(([key]) => key !== id), [id, fingerprint]].slice(
              -100,
            ),
          ),
        })),
    }),
    // Earlier versions also saved a per-project layout; only review fingerprints remain.
    { name: 'jackalope-workbench', partialize: ({ seen }) => ({ seen }) },
  ),
);

export function observeWorkbenchPreferences() {
  const update = (event: StorageEvent) => {
    if (event.key === 'jackalope-workbench') void useWorkbenchStore.persist.rehydrate();
  };
  window.addEventListener('storage', update);
  return () => window.removeEventListener('storage', update);
}
