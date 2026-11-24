import { describeError } from '@jackalope/contracts/errors';
import { create } from 'zustand';
import { isTauriEnvironment } from '../lib/native/env';
import {
  EMPTY_SKILLS_PAGE,
  type SkillSyncAction,
  type SkillsPage,
  skillSync,
} from '../lib/skill-sync';
import { useSettingsSyncStore } from './settingsSyncStore';

interface SkillSyncState {
  page: SkillsPage;
  loaded: boolean;
  /** A transfer with the account is running. */
  busy: boolean;
  error: string;
  /** Reads local skills and saved sync state without contacting the account. */
  load: () => Promise<void>;
  /** Loads, then syncs when skill sync is on here. */
  refresh: () => Promise<void>;
  configure: (enabled: boolean) => Promise<void>;
  share: (id: string, share: boolean) => Promise<void>;
  resolve: (id: string, keep: 'local' | 'account') => Promise<void>;
  remove: () => Promise<void>;
  clearError: () => void;
}

/** Local edits upload within this interval while the app is open. */
const SYNC_INTERVAL = 2 * 60_000;
let running: Promise<void> | undefined;

export const useSkillSyncStore = create<SkillSyncState>()((set) => {
  // One native operation at a time; later requests wait for the current one.
  const exclusive = async (work: () => Promise<SkillsPage | undefined>, transfer = true) => {
    while (running) await running.catch(() => undefined);
    set({ busy: transfer, error: '' });
    running = (async () => {
      try {
        const page = await work();
        if (page) set({ page, loaded: true });
      } catch (error) {
        set({ error: describeError(error), loaded: true });
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
  const withOwner = async (action: (owner: string) => SkillSyncAction) => {
    await exclusive(async () => {
      const status = await skillSync({ action: 'status' });
      if (!status.sync.owner) return status;
      set({ page: status });
      return skillSync(action(status.sync.owner));
    });
  };
  return {
    page: EMPTY_SKILLS_PAGE,
    loaded: false,
    busy: false,
    error: '',
    load: async () => {
      if (!isTauriEnvironment()) return;
      await exclusive(() => skillSync({ action: 'status' }), false);
    },
    refresh: async () => {
      if (!isTauriEnvironment()) return;
      await exclusive(async () => {
        const status = await skillSync({ action: 'status' });
        if (!status.sync.enabled || !status.sync.owner) return status;
        set({ page: status, loaded: true, busy: true });
        return skillSync({ action: 'sync', owner: status.sync.owner });
      }, false);
    },
    configure: (enabled) => withOwner((owner) => ({ action: 'configure', enabled, owner })),
    share: (id, share) => withOwner((owner) => ({ action: 'share', owner, id, share })),
    resolve: (id, keep) => withOwner((owner) => ({ action: 'resolve', owner, id, keep })),
    remove: () => withOwner((owner) => ({ action: 'delete', owner })),
    clearError: () => set({ error: '' }),
  };
});

/** Syncs while the app is open: at start, every two minutes, on focus (at most
 * once a minute) and when the connection returns or settings sync changes. */
export function observeSkillSync() {
  if (!isTauriEnvironment()) return;
  let timer: ReturnType<typeof setTimeout>;
  let last = 0;
  // Periodic, focus and network checks run only while skill sync is on here
  // (or before the first read); starting and settings sync changes always run.
  const schedule = (force = false) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { loaded, page } = useSkillSyncStore.getState();
      if (!force && loaded && !page.sync.enabled) return;
      last = Date.now();
      void useSkillSyncStore.getState().refresh();
    }, 2500);
  };
  const tick = () => schedule();
  const focused = () => {
    if (Date.now() - last > 60_000) schedule();
  };
  const unsubscribe = useSettingsSyncStore.subscribe((value, previous) => {
    if (value.enabled !== previous.enabled || value.owner !== previous.owner) schedule(true);
  });
  const interval = setInterval(tick, SYNC_INTERVAL);
  window.addEventListener('focus', focused);
  window.addEventListener('online', tick);
  schedule(true);
  return () => {
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
    window.removeEventListener('focus', focused);
    window.removeEventListener('online', tick);
  };
}
