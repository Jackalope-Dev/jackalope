import { create } from 'zustand';
import { EMPTY_LESSON_SYNC, type LessonSyncView, parseLessonSyncView } from '../lib/lesson-sync';
import { nativeTask } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';
import { useSettingsSyncStore } from './settingsSyncStore';

interface LessonSyncState {
  view: LessonSyncView;
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  configure: (enabled: boolean) => Promise<void>;
  sync: () => Promise<void>;
  remove: () => Promise<void>;
}

const SYNC_INTERVAL = 5 * 60_000;
let running: Promise<void> | undefined;

async function invoke(action: object) {
  return parseLessonSyncView(await nativeTask<unknown>('app_lesson_sync', { action }));
}

export const useLessonSyncStore = create<LessonSyncState>()((set, get) => {
  // One native operation at a time; later requests wait for the current one.
  const exclusive = async (work: () => Promise<LessonSyncView | undefined>) => {
    while (running) await running.catch(() => undefined);
    set({ busy: true, error: '' });
    running = (async () => {
      try {
        const view = await work();
        if (view) set({ view });
      } catch (error) {
        set({ error: String(error) });
      } finally {
        set({ busy: false });
      }
    })();
    try {
      await running;
    } finally {
      running = undefined;
    }
  };
  return {
    view: EMPTY_LESSON_SYNC,
    busy: false,
    error: '',
    refresh: async () => {
      if (!isTauriEnvironment()) return;
      await exclusive(async () => {
        const status = await invoke({ action: 'status' });
        if (!status.enabled || !status.owner) return status;
        set({ view: status });
        return invoke({ action: 'sync', owner: status.owner });
      });
    },
    configure: async (enabled) => {
      await exclusive(async () => {
        const status = await invoke({ action: 'status' });
        if (!status.owner) return status;
        return invoke({ action: 'configure', enabled, owner: status.owner });
      });
    },
    sync: async () => {
      const owner = get().view.owner;
      if (!owner) return get().refresh();
      await exclusive(() => invoke({ action: 'sync', owner }));
    },
    remove: async () => {
      const owner = get().view.owner;
      if (!owner) return;
      await exclusive(() => invoke({ action: 'delete', owner }));
    },
  };
});

/** Syncs while the app is open: at start, every five minutes, on focus and
 * when the connection returns or settings sync changes. */
export function observeLessonSync() {
  if (!isTauriEnvironment()) return;
  let timer: ReturnType<typeof setTimeout>;
  let last = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      last = Date.now();
      void useLessonSyncStore.getState().refresh();
    }, 2000);
  };
  // Focus changes often; sync on focus at most once a minute.
  const focused = () => {
    if (Date.now() - last > 60_000) schedule();
  };
  const unsubscribe = useSettingsSyncStore.subscribe((value, previous) => {
    if (value.enabled !== previous.enabled || value.owner !== previous.owner) schedule();
  });
  const interval = setInterval(schedule, SYNC_INTERVAL);
  window.addEventListener('focus', focused);
  window.addEventListener('online', schedule);
  schedule();
  return () => {
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
    window.removeEventListener('focus', focused);
    window.removeEventListener('online', schedule);
  };
}
