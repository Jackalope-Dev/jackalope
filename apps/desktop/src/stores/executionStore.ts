import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ContextSelection } from '../lib/knowledge';
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
export const emptyDraft: TaskDraft = { prompt: '', agent: '', isolated: true, skills: [] };
interface ExecutionState {
  runs: TaskRun[];
  runners: Runner[];
  selectedId: string | null;
  error: string | null;
  historyError: string | null;
  discoveryError: string | null;
  loading: boolean;
  discovering: boolean;
  submitting: boolean;
  drafts: Record<string, TaskDraft>;
  select: (id: string | null) => void;
  draft: (key: string, value: Partial<TaskDraft>) => void;
  discover: () => Promise<void>;
  refresh: () => Promise<void>;
  start: (request: Omit<RunRequest, 'id'>, options?: { background?: boolean }) => Promise<string>;
}
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
      discover: () => {
        if (discovering) return discovering;
        set({ discovering: true, discoveryError: null });
        discovering = Promise.resolve().then(async () => {
          try {
            set({
              runners: await nativeTask<Runner[]>('task_runners'),
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
            const runs = isTauriEnvironment()
              ? await nativeTask<TaskRun[]>('task_runs', { detailId })
              : [];
            const working = runs.some(isActive);
            const wasWorking = get().runs.some(isActive);
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
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    await useExecutionStore.getState().refresh();
    if (!disposed)
      timer = setTimeout(poll, useExecutionStore.getState().runs.some(isActive) ? 1000 : 8000);
  };
  void poll();
  if (isTauriEnvironment()) void useExecutionStore.getState().discover();
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}
