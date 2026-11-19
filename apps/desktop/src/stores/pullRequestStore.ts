import { describeError } from '@jackalope/contracts/errors';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invokeNative } from '../lib/native/transport.ts';
import { createPersistStorage } from '../lib/persist-storage.ts';
import {
  duePullRequests,
  isOpenPullRequest,
  isPullRequestUrl,
  NOTIFIED_PHASES,
  type PullRequestView,
  type TrackedPullRequest,
  trackedFrom,
} from '../lib/pull-requests.ts';

/** Finished pull requests kept so their tasks still read as merged. */
const KEPT = 200;

interface PullRequestState {
  /** Tracked pull requests by task. */
  tracked: Record<string, TrackedPullRequest>;
  /** Starts tracking the pull request a task opened; a later attempt re-points it. */
  track: (ids: { taskId: string; runId: string }, url: string, view?: PullRequestView) => void;
  untrack: (taskId: string) => void;
  /** Reads one pull request from GitHub now. */
  refresh: (taskId: string) => Promise<void>;
}

function bounded(tracked: Record<string, TrackedPullRequest>) {
  const done = Object.values(tracked)
    .filter((pr) => !isOpenPullRequest(pr))
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  if (done.length <= KEPT) return tracked;
  const next = { ...tracked };
  for (const pr of done.slice(KEPT)) delete next[pr.taskId];
  return next;
}

export const usePullRequestStore = create<PullRequestState>()(
  persist(
    (set, get) => ({
      tracked: {},
      track: (ids, url, view) => {
        if (!isPullRequestUrl(url)) return;
        const current = get().tracked[ids.taskId];
        const next: TrackedPullRequest = view
          ? trackedFrom(view, ids)
          : current?.url === url
            ? { ...current, ...ids }
            : { ...ids, url, phase: 'checking', failing: [], pending: 0, checks: 0, checkedAt: '' };
        set((state) => ({ tracked: bounded({ ...state.tracked, [ids.taskId]: next }) }));
      },
      untrack: (taskId) =>
        set((state) => {
          const { [taskId]: _removed, ...tracked } = state.tracked;
          return { tracked };
        }),
      refresh: async (taskId) => {
        const before = get().tracked[taskId];
        if (!before) return;
        let next: TrackedPullRequest;
        try {
          const view = await invokeNative<PullRequestView>('task_pull_request_status', {
            id: before.runId,
            url: before.url,
          });
          next = trackedFrom(view, before);
        } catch (cause) {
          next = { ...before, error: describeError(cause), checkedAt: new Date().toISOString() };
        }
        // The pull request may have been untracked or replaced while GitHub answered.
        if (get().tracked[taskId]?.url !== before.url) return;
        set((state) => ({ tracked: { ...state.tracked, [taskId]: next } }));
        // The first read only records where the pull request stands.
        if (before.checkedAt && next.phase !== before.phase && NOTIFIED_PHASES.includes(next.phase))
          void invokeNative('notification_pull_request', {
            phase: next.phase,
            runId: next.runId,
          }).catch(() => {});
      },
    }),
    {
      name: 'jackalope-pull-requests-v1',
      version: 1,
      storage: createPersistStorage(),
      partialize: (state) => ({ tracked: state.tracked }),
    },
  ),
);

/** Keeps open pull requests current while the app runs. */
export function observePullRequests() {
  let reading = false;
  const tick = async () => {
    if (reading) return;
    reading = true;
    try {
      const { tracked, refresh } = usePullRequestStore.getState();
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      // One at a time: each read is a GitHub CLI process.
      for (const pr of duePullRequests(Object.values(tracked), Date.now(), visible))
        await refresh(pr.taskId);
    } finally {
      reading = false;
    }
  };
  const timer = setInterval(() => void tick(), 15_000);
  void tick();
  return () => clearInterval(timer);
}
