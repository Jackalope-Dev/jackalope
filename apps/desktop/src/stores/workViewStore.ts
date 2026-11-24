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
  /** The Inbox page is open in place of the all-projects work list; picking a scope closes it. */
  inbox: boolean;
  openInbox: () => void;
  closeInbox: () => void;
  views: Record<string, WorkView>;
  reading: Record<string, string>;
  split: Record<string, boolean>;
  /** The attempt whose task page is on screen, so notices about it are not repeated. */
  viewing: string | null;
  setViewing: (id: string | null) => void;
  /** The app sidebar shows icons only. */
  navCollapsed: boolean;
  toggleNav: () => void;
  /** Projects folded in the sidebar tree; absent projects are expanded. */
  collapsedProjects: Record<string, boolean>;
  toggleProject: (id: string) => void;
  /** Panel sizes the user dragged, in pixels, by panel; absent panels use their default. */
  sizes: Record<string, number>;
  setSize: (id: string, size: number | null) => void;
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
      inbox: false,
      openInbox: () => set({ scope: 'all', inbox: true }),
      closeInbox: () => set({ inbox: false }),
      views: {},
      reading: {},
      split: {},
      navCollapsed: false,
      viewing: null,
      setViewing: (viewing) => set({ viewing }),
      toggleNav: () => set((state) => ({ navCollapsed: !state.navCollapsed })),
      collapsedProjects: {},
      toggleProject: (id) =>
        set((state) => {
          const collapsedProjects = { ...state.collapsedProjects };
          if (collapsedProjects[id]) delete collapsedProjects[id];
          else collapsedProjects[id] = true;
          return { collapsedProjects };
        }),
      sizes: {},
      setSize: (id, size) =>
        set((state) => {
          const sizes = { ...state.sizes };
          if (size === null) delete sizes[id];
          else sizes[id] = size;
          return { sizes };
        }),
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
      openList: (filter) => set({ scope: 'all', inbox: false, listRequest: filter }),
      clearListRequest: () => set({ listRequest: null }),
      setScope: (scope) => set({ scope, inbox: false }),
      setView: (key, view) => set((state) => ({ views: { ...state.views, [key]: view } })),
      open: (id, section = 'result') =>
        set((state) => ({
          request: { id, section, revision: (state.request?.revision ?? 0) + 1 },
        })),
    }),
    {
      name: 'jackalope-work-views',
      partialize: ({
        scope,
        inbox,
        views,
        reading,
        split,
        navCollapsed,
        collapsedProjects,
        sizes,
      }) => ({
        scope,
        inbox,
        views,
        reading,
        split,
        navCollapsed,
        collapsedProjects,
        sizes,
      }),
    },
  ),
);
