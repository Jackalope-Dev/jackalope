import { create } from 'zustand';
import { navigateWorkspace } from '../components/layout/navigation';

/** Which checkout the Changes page opens on; empty means the project folder itself. */
export const useCommitReviewStore = create<{ checkout: string; choose: (path: string) => void }>(
  (set) => ({
    checkout: '',
    choose: (checkout) => set({ checkout }),
  }),
);

export function openChanges(path = '') {
  useCommitReviewStore.getState().choose(path);
  navigateWorkspace('changes');
}
