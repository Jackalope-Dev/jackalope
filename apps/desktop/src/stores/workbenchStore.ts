import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_WORKSPACE_PRESET, type WorkspacePreset } from '../lib/workbench';

interface WorkbenchState {
  presets: Record<string, WorkspacePreset>;
  seen: Record<string, string>;
  setPreset: (projectId: string, preset: WorkspacePreset) => void;
  markSeen: (id: string, fingerprint: string) => void;
}
export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set) => ({
      presets: {},
      seen: {},
      setPreset: (id, preset) => set((state) => ({ presets: { ...state.presets, [id]: preset } })),
      markSeen: (id, fingerprint) =>
        set((state) => ({
          seen: Object.fromEntries(
            [...Object.entries(state.seen).filter(([key]) => key !== id), [id, fingerprint]].slice(
              -100,
            ),
          ),
        })),
    }),
    { name: 'jackalope-workbench' },
  ),
);

export function observeWorkbenchPreferences() {
  const update = (event: StorageEvent) => {
    if (event.key === 'jackalope-workbench') void useWorkbenchStore.persist.rehydrate();
  };
  window.addEventListener('storage', update);
  return () => window.removeEventListener('storage', update);
}

/** The project's chosen layout; projects that never chose one use the work sidebar layout. */
export function useWorkspacePreset(projectId: string | null | undefined): WorkspacePreset {
  return useWorkbenchStore((state) => state.presets[projectId ?? ''] ?? DEFAULT_WORKSPACE_PRESET);
}
