import { create } from 'zustand';

export type MascotMood = 'idle' | 'thinking' | 'working' | 'success' | 'sleep';

/** What the mascot reflects: work that is running, and a repository scan someone asked for. */
type Activity = 'runs' | 'scan';

let petTimer: ReturnType<typeof setTimeout> | undefined;
let messageTimer: ReturnType<typeof setTimeout> | undefined;

interface MascotState {
  /** Derived from `activity`, a recent pat and a design preview; never set directly. */
  mood: MascotMood;
  activity: Record<Activity, boolean>;
  petted: boolean;
  /** A mood shown for inspection in the design lab, over any activity. */
  preview: MascotMood | null;
  message: string | null;
  petCount: number;
  setActivity: (source: Activity, active: boolean) => void;
  previewMood: (mood: MascotMood | null) => void;
  say: (message: string, durationMs?: number) => void;
  clearMessage: () => void;
  pet: () => void;
}

function moodOf({
  activity,
  petted,
  preview,
}: Pick<MascotState, 'activity' | 'petted' | 'preview'>) {
  if (petted) return 'success';
  if (preview) return preview;
  if (activity.runs) return 'working';
  if (activity.scan) return 'thinking';
  return 'idle';
}

export const useMascotStore = create<MascotState>((set, get) => {
  const update = (patch: Partial<Pick<MascotState, 'activity' | 'petted' | 'preview'>>) =>
    set((state) => {
      const next = { ...state, ...patch };
      return { ...patch, mood: moodOf(next) };
    });
  return {
    mood: 'idle',
    activity: { runs: false, scan: false },
    petted: false,
    preview: null,
    message: null,
    petCount: 0,
    setActivity: (source, active) => {
      if (get().activity[source] !== active)
        update({ activity: { ...get().activity, [source]: active } });
    },
    previewMood: (mood) => {
      clearTimeout(petTimer);
      update({ preview: mood, petted: false });
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
    clearMessage: () => {
      clearTimeout(messageTimer);
      set({ message: null });
    },
    pet: () => {
      clearTimeout(petTimer);
      const nextCount = get().petCount + 1;
      set({ petCount: nextCount });
      update({ petted: true });
      get().say(
        nextCount === 1 ? 'A little encouragement goes a long way.' : 'Right here with you.',
        2500,
      );
      petTimer = setTimeout(() => update({ petted: false }), 2500);
    },
  };
});
