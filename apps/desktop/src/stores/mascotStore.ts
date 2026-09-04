import { create } from 'zustand';

export type MascotMood = 'idle' | 'thinking' | 'working' | 'success' | 'sleep';

interface MascotState {
  mood: MascotMood;
  message: string | null;
  petCount: number;
  setMood: (mood: MascotMood) => void;
  say: (message: string, durationMs?: number) => void;
  clearMessage: () => void;
  pet: () => void;
}

export const useMascotStore = create<MascotState>((set, get) => ({
  mood: 'idle',
  message: "Hi! I'm Jackalope. I'll watch over your agent fleet and workspaces.",
  petCount: 0,
  setMood: (mood: MascotMood) => set({ mood }),
  say: (message: string, durationMs: number = 6000) => {
    set({ message });
    if (durationMs > 0) {
      setTimeout(() => {
        if (get().message === message) {
          set({ message: null });
        }
      }, durationMs);
    }
  },
  clearMessage: () => set({ message: null }),
  pet: () => {
    const nextCount = get().petCount + 1;
    set({
      petCount: nextCount,
      mood: 'success',
      message: nextCount === 1 ? "*happy ear wiggle*" : nextCount > 5 ? "*zooming across the plains!*" : "*nuzzle! Ready to build.*",
    });
    setTimeout(() => {
      set({ mood: 'idle' });
    }, 2500);
  },
}));
