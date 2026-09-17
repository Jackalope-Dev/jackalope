import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FileReviewState {
  reviewed: Record<string, string[]>;
  mark: (revision: string, file: string, reviewed: boolean) => void;
}

export const useFileReviewStore = create<FileReviewState>()(
  persist(
    (set) => ({
      reviewed: {},
      mark: (revision, file, reviewed) =>
        set((state) => ({
          reviewed: Object.fromEntries(
            [
              ...Object.entries(state.reviewed).filter(([key]) => key !== revision),
              [
                revision,
                reviewed
                  ? [...new Set([...(state.reviewed[revision] ?? []), file])]
                  : (state.reviewed[revision] ?? []).filter((path) => path !== file),
              ],
            ].slice(-100),
          ),
        })),
    }),
    { name: 'jackalope-file-reviews' },
  ),
);
