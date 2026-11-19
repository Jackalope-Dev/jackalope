import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The Library page's filters as the person last set them; `all` means unfiltered. */
interface LibraryState {
  project: string;
  kind: 'all' | 'screenshots' | 'images' | 'files';
  setProject: (project: string) => void;
  setKind: (kind: LibraryState['kind']) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      project: 'all',
      kind: 'all',
      setProject: (project) => set({ project }),
      setKind: (kind) => set({ kind }),
    }),
    {
      name: 'jackalope-library-v1',
      partialize: ({ project, kind }) => ({ project, kind }),
    },
  ),
);
