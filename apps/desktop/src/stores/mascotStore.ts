import { create } from 'zustand';

export type MascotMood = 'idle' | 'thinking' | 'working' | 'success' | 'sleep';

let petTimer: ReturnType<typeof setTimeout> | undefined;
let messageTimer: ReturnType<typeof setTimeout> | undefined;
let resumeMood: MascotMood = 'idle';

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
  message: null,
  petCount: 0,
  setMood: (mood: MascotMood) => {
    clearTimeout(petTimer);
    petTimer = undefined;
    set({ mood });
  },
  say: (message: string, durationMs: number = 6000) => {
    clearTimeout(messageTimer);
    set({ message });
    if (durationMs > 0) {
      messageTimer = setTimeout(() => {
        if (get().message === message) {
          set({ message: null });
        }
      }, durationMs);
    }
  },
  clearMessage: () => { clearTimeout(messageTimer); set({ message: null }); },
  pet: () => {
    if (!petTimer) resumeMood = get().mood;
    clearTimeout(petTimer);
    const nextCount = get().petCount + 1;
    set({
      petCount: nextCount,
      mood: 'success',
    });
    get().say(nextCount === 1 ? 'A little encouragement goes a long way.' : 'Right here with you.', 2500);
    petTimer = setTimeout(() => {
      petTimer = undefined;
      set({ mood: resumeMood });
    }, 2500);
  },
}));
