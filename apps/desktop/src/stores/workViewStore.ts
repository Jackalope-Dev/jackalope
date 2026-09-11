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
  request: { id: string; section: string; revision: number } | null;
  setScope: (scope: 'all' | 'project') => void;
  setView: (key: string, view: WorkView) => void;
  open: (id: string, section?: string) => void;
}
export const useWorkViewStore = create<WorkViewState>()(
  persist(
    (set) => ({
      scope: 'project',
      views: {},
      request: null,
      setScope: (scope) => set({ scope }),
      setView: (key, view) => set((state) => ({ views: { ...state.views, [key]: view } })),
      open: (id, section = 'result') =>
        set((state) => ({
          request: { id, section, revision: (state.request?.revision ?? 0) + 1 },
        })),
    }),
    { name: 'jackalope-work-views', partialize: ({ scope, views }) => ({ scope, views }) },
  ),
);
