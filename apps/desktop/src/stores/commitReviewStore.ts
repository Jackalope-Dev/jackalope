import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { navigateWorkspace } from '../components/layout/navigation';

interface CommitReviewState {
  /** Which checkout the Changes page opens on; empty means the project folder itself. */
  checkout: string;
  choose: (path: string) => void;
  /**
   * Files left out of the next commit, per checkout. Everything else is
   * included, so new changes start selected and a deliberate "leave this out"
   * survives refreshes, navigation and restarts.
   */
  excluded: Record<string, string[]>;
  setExcluded: (checkout: string, paths: string[]) => void;
}

export const useCommitReviewStore = create<CommitReviewState>()(
  persist(
    (set) => ({
      checkout: '',
      choose: (checkout) => set({ checkout }),
      excluded: {},
      setExcluded: (checkout, paths) =>
        set((state) => {
          const excluded = { ...state.excluded };
          if (paths.length) excluded[checkout] = [...new Set(paths)].sort();
          else delete excluded[checkout];
          return { excluded };
        }),
    }),
    {
      name: 'jackalope-commit-review',
      partialize: ({ excluded }) => ({ excluded }),
    },
  ),
);

export function openChanges(path = '') {
  useCommitReviewStore.getState().choose(path);
  navigateWorkspace('changes');
}
