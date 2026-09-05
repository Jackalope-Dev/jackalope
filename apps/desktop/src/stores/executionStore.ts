import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  isActive,
  nativeTask,
  type Runner,
  type RunRequest,
  type TaskRun,
} from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';
import { useMascotStore } from './mascotStore';

export interface TaskDraft {
  prompt: string;
  agent: string;
  isolated: boolean;
}
export const emptyDraft: TaskDraft = { prompt: '', agent: 'codex', isolated: true };
interface ExecutionState {
  runs: TaskRun[];
  runners: Runner[];
  selectedId: string | null;
  error: string | null;
  loading: boolean;
  discovering: boolean;
  submitting: boolean;
  drafts: Record<string, TaskDraft>;
  select: (id: string | null) => void;
  draft: (key: string, value: Partial<TaskDraft>) => void;
  discover: () => Promise<void>;
  refresh: () => Promise<void>;
  start: (request: Omit<RunRequest, 'id'>) => Promise<string>;
}
let refreshing: Promise<void> | undefined;
export const useExecutionStore = create<ExecutionState>()(
  persist(
    (set, get) => ({
      runs: [],
      runners: [],
      selectedId: null,
      error: null,
      loading: true,
      discovering: false,
      submitting: false,
      drafts: {},
      select: (selectedId) => set({ selectedId }),
      draft: (key, value) =>
        set((state) => ({
          drafts: { ...state.drafts, [key]: { ...emptyDraft, ...state.drafts[key], ...value } },
        })),
      discover: async () => {
        if (get().discovering) return;
        set({ discovering: true });
        try {
          set({ runners: await nativeTask<Runner[]>('task_runners'), error: null });
        } catch (error) {
          set({ error: String(error) });
        } finally {
          set({ discovering: false });
        }
      },
      refresh: () => {
        if (refreshing) return refreshing;
        refreshing = (async () => {
          try {
            const runs = isTauriEnvironment() ? await nativeTask<TaskRun[]>('task_runs') : [];
            const working = runs.some(isActive);
            const wasWorking = get().runs.some(isActive);
            set({ runs, loading: false, error: null });
            if (working !== wasWorking)
              useMascotStore.getState().setMood(working ? 'working' : 'idle');
          } catch (error) {
            set({ error: String(error), loading: false });
          } finally {
            refreshing = undefined;
          }
        })();
        return refreshing;
      },
      start: async (request) => {
        if (get().submitting) throw new Error('A task is already being submitted.');
        set({ submitting: true });
        try {
          const id = await nativeTask<string>('task_start', {
            request: { ...request, id: crypto.randomUUID() },
          });
          set({ selectedId: id });
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
