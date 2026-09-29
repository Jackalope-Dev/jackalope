import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const MAX_OPEN_WORK = 8;

/** Recently opened tasks, chats and plans shown as tabs, keyed like work signals. */
interface OpenWorkState {
  keys: string[];
  open: (key: string) => void;
  close: (key: string) => void;
  retain: (keys: Set<string>) => void;
}

export const useOpenWorkStore = create<OpenWorkState>()(
  persist(
    (set) => ({
      keys: [],
      // A newly opened item joins at the end; the oldest drops off when full.
      open: (key) =>
        set((state) =>
          state.keys.includes(key) ? state : { keys: [...state.keys, key].slice(-MAX_OPEN_WORK) },
        ),
      close: (key) => set((state) => ({ keys: state.keys.filter((item) => item !== key) })),
      retain: (keys) =>
        set((state) => {
          const next = state.keys.filter((key) => keys.has(key));
          return next.length === state.keys.length ? state : { keys: next };
        }),
    }),
    {
      name: 'jackalope-open-work-v1',
      merge: (saved, current) => {
        const keys = (saved as Partial<OpenWorkState> | undefined)?.keys;
        return {
          ...current,
          keys: Array.isArray(keys)
            ? keys.filter((key): key is string => typeof key === 'string').slice(-MAX_OPEN_WORK)
            : [],
        };
      },
    },
  ),
);
