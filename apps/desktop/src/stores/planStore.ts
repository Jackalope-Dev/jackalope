import { create } from 'zustand';

/** Which plan the Plans page shows; set when a plan starts from the composer. */
export const usePlanStore = create<{
  selectedId: string | null;
  select: (id: string | null) => void;
}>((set) => ({
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
}));
