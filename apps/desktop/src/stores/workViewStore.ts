import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WorkView {
  filter: string;
  layout: 'list' | 'board';
  query: string;
}
export const defaultWorkView: WorkView = { filter: 'all', layout: 'list', query: '' };
interface WorkViewState {
  scope: 'all' | 'project';
  views: Record<string, WorkView>;
  reading: Record<string, string>;
  split: Record<string, boolean>;
  setSplit: (id: string, split: boolean) => void;
  resetSplits: (ids: string[]) => void;
  remember: (id: string, section: string) => void;
  request: { id: string; section: string; revision: number } | null;
  listRequest: string | null;
  openList: (filter: string) => void;
  clearListRequest: () => void;
  setScope: (scope: 'all' | 'project') => void;
  setView: (key: string, view: WorkView) => void;
  open: (id: string, section?: string) => void;
}
export const useWorkViewStore = create<WorkViewState>()(
  persist(
    (set) => ({
      scope: 'project',
      views: {},
      reading: {},
      split: {},
      resetSplits: (ids) =>
        set((state) => ({
          split: Object.fromEntries(
            Object.entries(state.split).filter(([id]) => !ids.includes(id)),
          ),
        })),
      setSplit: (id, split) => set((state) => ({ split: { ...state.split, [id]: split } })),
      remember: (id, section) =>
        set((state) => ({
          reading: Object.fromEntries(
            [...Object.entries(state.reading).filter(([key]) => key !== id), [id, section]].slice(
              -100,
            ),
          ),
        })),
      request: null,
      listRequest: null,
      openList: (filter) => set({ scope: 'all', listRequest: filter }),
      clearListRequest: () => set({ listRequest: null }),
      setScope: (scope) => set({ scope }),
      setView: (key, view) => set((state) => ({ views: { ...state.views, [key]: view } })),
      open: (id, section = 'result') =>
        set((state) => ({
          request: { id, section, revision: (state.request?.revision ?? 0) + 1 },
        })),
    }),
    {
      name: 'jackalope-work-views',
      partialize: ({ scope, views, reading, split }) => ({ scope, views, reading, split }),
    },
  ),
);
