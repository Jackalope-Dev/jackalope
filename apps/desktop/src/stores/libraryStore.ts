import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Paths kept as moved to the Trash; the oldest are dropped past this. */
const TRASHED_LIMIT = 2000;

/** The Library page's filters as the person last set them; `all` means unfiltered. */
interface LibraryState {
  project: string;
  kind: 'all' | 'screenshots' | 'images' | 'files';
  /** Screenshots moved to the Trash. Runs keep recording them, so the page hides them. */
  trashed: string[];
  setProject: (project: string) => void;
  setKind: (kind: LibraryState['kind']) => void;
  hide: (paths: string[]) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      project: 'all',
      kind: 'all',
      trashed: [],
      setProject: (project) => set({ project }),
      setKind: (kind) => set({ kind }),
      hide: (paths) =>
        set(({ trashed }) => ({
          trashed: [...new Set([...trashed, ...paths])].slice(-TRASHED_LIMIT),
        })),
    }),
    {
      name: 'jackalope-library-v1',
      partialize: ({ project, kind, trashed }) => ({ project, kind, trashed }),
    },
  ),
);
