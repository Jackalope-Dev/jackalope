import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ContextSelection } from '../lib/knowledge';
import { observeRefresh } from '../lib/observe-refresh';
import { mergeTaskChanges, type TaskChanges } from '../lib/task-changes';
import type { TaskEffort } from '../lib/task-effort';
import {
  isActive,
  nativeTask,
  type Runner,
  type RunRequest,
  type TaskRun,
} from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';
import { syncAgentConfig } from './agentConfigStore';
import { useMascotStore } from './mascotStore';
import type { TaskStatus } from './taskStore';

export interface TaskDraft {
  effort?: TaskEffort;
  model?: string;
  contextSelection?: ContextSelection;
  prompt: string;
  projectId?: string;
  title?: string;
  planningStatus?: TaskStatus;
  agent: string;
  isolated: boolean;
  skills?: string[];
  connectionIds?: string[];
}
export const emptyDraft: TaskDraft = { prompt: '', agent: '', isolated: true };
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
              runners: await nativeTask<Runner[]>('task_runners'),
              lastDiscovered: Date.now(),
              error: null,
              discoveryError: null,
            });
          } catch (error) {
            set({ error: String(error), discoveryError: String(error) });
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
              const changes = await nativeTask<TaskChanges>('task_changes', {
                since: revision ?? null,
                detailId,
                previousDetailId,
              });
              runs = mergeTaskChanges(runs, changes);
              revision = changes.revision;
              previousDetailId = detailId;
            }
            const working = runs.some(isActive);
            const wasWorking = get().runs.some(isActive);
            if (runs !== get().runs || get().loading || get().error || get().historyError)
              set({ runs, loading: false, error: null, historyError: null });
            if (working !== wasWorking)
              useMascotStore.getState().setMood(working ? 'working' : 'idle');
          } catch (error) {
            set({ error: String(error), historyError: String(error), loading: false });
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
          await syncAgentConfig();
          const id = await nativeTask<string>('task_start', {
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
      name: 'jackalope-execution-ui-v1',
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
