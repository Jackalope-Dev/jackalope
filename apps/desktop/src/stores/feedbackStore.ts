import { create } from 'zustand';
import { nativeTask } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';

export interface FeedbackView {
  enabled: boolean;
  promptsEnabled: boolean;
  completed: boolean;
  nextPromptAt: number;
  promptCount: number;
  eligible: boolean;
  claimed: boolean;
}
export type FeedbackAction =
  | { action: 'status' | 'stop' | 'completed' }
  | { action: 'activity'; runId?: string }
  | { action: 'preferences'; enabled: boolean; promptsEnabled: boolean }
  | { action: 'claim' | 'later'; id: string };
interface State {
  view: FeedbackView | null;
  error: string;
  busy: boolean;
  request: (action: FeedbackAction) => Promise<FeedbackView | null>;
}
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
export const useFeedbackStore = create<State>((set) => ({
  view: null,
  error: '',
  busy: false,
  request: (action) => {
    if (!isTauriEnvironment()) return Promise.resolve(null);
    pending++;
    set({ busy: true });
    const result = queue.then(async () => {
      try {
        const view = await nativeTask<FeedbackView>('app_account_feedback', { action });
        set({ view, error: '' });
        return view;
      } catch (error) {
        set((state) => ({
          error: String(error),
          view: state.view ? { ...state.view, eligible: false } : null,
        }));
        return null;
      } finally {
        pending--;
        set({ busy: pending > 0 });
      }
    });
    queue = result;
    return result;
  },
}));

export function observeFeedbackActivity() {
  if (!isTauriEnvironment()) return;
  let lastDay = '';
  let inFlight = false;
  let retryAfter = 0;
  const active = () => {
    const day = new Date().toISOString().slice(0, 10);
    if (
      document.visibilityState !== 'visible' ||
      !document.hasFocus() ||
      inFlight ||
      day === lastDay ||
      Date.now() < retryAfter
    )
      return;
    inFlight = true;
    void useFeedbackStore
      .getState()
      .request({ action: 'activity' })
      .then((view) => {
        if (view) lastDay = day;
        else retryAfter = Date.now() + 60_000;
        inFlight = false;
      });
  };
  // Real foreground interaction counts a day; background tasks and idle windows do not.
  window.addEventListener('pointerdown', active);
  window.addEventListener('keydown', active);
  return () => {
    window.removeEventListener('pointerdown', active);
    window.removeEventListener('keydown', active);
  };
}
