import { isActive } from '@jackalope/contracts/runs';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ContextSelection } from '../lib/knowledge-types';
import { isTauriEnvironment } from '../lib/native/env';
import { invokeNative } from '../lib/native/transport';
import { observeRefresh } from '../lib/observe-refresh';
import type { Runner, RunRequest, TaskRun } from '../lib/run-types';
import { mergeTaskChanges, type TaskChanges } from '../lib/task-changes';
import type { TaskEffort } from '../lib/task-effort';
import { windowKind } from '../lib/window-kind';
import { useMascotStore } from './mascotStore';
import type { TaskStatus } from './taskStore';
import { describeError } from '@jackalope/contracts/errors';

interface TaskDraft {
  effort?: TaskEffort;
  codexSpeed?: 'standard' | 'fast';
  model?: string;
  contextSelection?: ContextSelection;
  prompt: string;
  projectId?: string;
  title?: string;
  planningStatus?: TaskStatus;
  agent: string;
  isolated: boolean;
  /** A read-only helper such as a review: no prepare command and no saved check. */
  readOnly?: boolean;
  skills?: string[];
  connectionIds?: string[];
}
const emptyDraft: TaskDraft = { prompt: '', agent: '', isolated: true };
interface ExecutionState {
  runs: TaskRun[];
  runners: Runner[];
  selectedId: string | null;
  error: string | null;
  historyError: string | null;
  discoveryError: string | null;
  loading: boolean;
  discovering: boolean;
  lastDiscovered: number;
  submitting: boolean;
  drafts: Record<string, TaskDraft>;
  select: (id: string | null) => void;
  draft: (key: string, value: Partial<TaskDraft>) => void;
  discover: (force?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  start: (request: Omit<RunRequest, 'id'>, options?: { background?: boolean }) => Promise<string>;
}
let revision: number | undefined;
let previousDetailId: string | null = null;
let refreshing: Promise<void> | undefined;
let discovering: Promise<void> | undefined;
const root = windowKind();
export const useExecutionStore = create<ExecutionState>()(
  persist(
    (set, get) => ({
      runs: [],
      runners: [],
      selectedId: null,
      error: null,
      historyError: null,
      discoveryError: null,
      loading: true,
      discovering: false,
      lastDiscovered: 0,
      submitting: false,
      drafts: {},
      select: (selectedId) => {
        set({ selectedId });
        void get().refresh();
      },
      draft: (key, value) =>
        set((state) => ({
          drafts: { ...state.drafts, [key]: { ...emptyDraft, ...state.drafts[key], ...value } },
        })),
      discover: (force = true) => {
        if (discovering) return discovering;
        if (!force && get().lastDiscovered > 0 && Date.now() - get().lastDiscovered < 120_000)
          return Promise.resolve();
        set({ discovering: true, discoveryError: null });
        discovering = Promise.resolve().then(async () => {
          try {
            set({
              runners: await invokeNative<Runner[]>('task_runners'),
              lastDiscovered: Date.now(),
              error: null,
              discoveryError: null,
            });
          } catch (error) {
            set({ error: describeError(error), discoveryError: describeError(error) });
          } finally {
            discovering = undefined;
            set({ discovering: false });
          }
        });
        return discovering;
      },
      refresh: () => {
        if (refreshing) return refreshing;
        const detailId = get().selectedId;
        refreshing = Promise.resolve().then(async () => {
          try {
            let runs = get().runs;
            if (isTauriEnvironment()) {
              const changes = await invokeNative<TaskChanges>('task_changes', {
                since: revision ?? null,
                detailId,
                previousDetailId,
              });
              runs = mergeTaskChanges(runs, changes);
              revision = changes.revision;
              previousDetailId = detailId;
            }
            if (runs !== get().runs || get().loading || get().error || get().historyError)
              set({ runs, loading: false, error: null, historyError: null });
            useMascotStore.getState().setActivity('runs', runs.some(isActive));
          } catch (error) {
            set({ error: describeError(error), historyError: describeError(error), loading: false });
          } finally {
            refreshing = undefined;
            if (get().selectedId !== detailId) queueMicrotask(() => void get().refresh());
          }
        });
        return refreshing;
      },
      start: async (request, options) => {
        if (get().submitting) throw new Error('A task is already being submitted.');
        set({ submitting: true });
        try {
          const id = await invokeNative<string>('task_start', {
            request: { ...request, id: crypto.randomUUID() },
          });
          if (!options?.background) set({ selectedId: id });
          await get().refresh();
          return id;
        } finally {
          set({ submitting: false });
        }
      },
    }),
    {
      name:
        root.kind === 'workPane'
          ? `jackalope-execution-ui-v1:work-pane:${root.id}:${root.pane}`
          : 'jackalope-execution-ui-v1',
      partialize: (state) => ({ drafts: state.drafts, selectedId: state.selectedId }),
    },
  ),
);

export function observeExecution() {
  let eventsAvailable = false;
  if (isTauriEnvironment()) void useExecutionStore.getState().discover();
  return observeRefresh({
    refresh: () => useExecutionStore.getState().refresh(),
    interval: () =>
      !eventsAvailable
        ? useExecutionStore.getState().runs.some(isActive)
          ? 1000
          : 8000
        : document.hidden
          ? 60_000
          : 15_000,
    subscribe: isTauriEnvironment()
      ? async (changed) => {
          const stop = await listen('task-state-changed', changed);
          eventsAvailable = true;
          changed();
          return stop;
        }
      : undefined,
  });
}
