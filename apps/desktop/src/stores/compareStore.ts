import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** One prompt sent to several agents, each in its own isolated task. */
export interface Comparison {
  id: string;
  projectId: string;
  prompt: string;
  /** Task ids in launch order; each task keeps its own attempts and review. */
  taskIds: string[];
  createdAt: string;
  /** Agents that could not start, with the reason reported at launch. */
  failures?: string[];
  /** The task the user picked to continue with, if any. */
  chosenTaskId?: string;
}

interface CompareState {
  comparisons: Comparison[];
  add: (comparison: Comparison) => void;
  choose: (id: string, taskId: string) => void;
  remove: (id: string) => void;
  dismissFailure: (id: string, failure: string) => void;
}

export const MAX_COMPARED_AGENTS = 4;

export const useCompareStore = create<CompareState>()(
  persist(
    (set) => ({
      comparisons: [],
      add: (comparison) =>
        set((state) => ({
          // Bounded so a long-lived profile does not accumulate stale groups.
          comparisons: [
            comparison,
            ...state.comparisons.filter((c) => c.id !== comparison.id),
          ].slice(0, 100),
        })),
      choose: (id, chosenTaskId) =>
        set((state) => ({
          comparisons: state.comparisons.map((c) => (c.id === id ? { ...c, chosenTaskId } : c)),
        })),
      dismissFailure: (id, failure) =>
        set((state) => ({
          comparisons: state.comparisons.map((c) =>
            c.id === id ? { ...c, failures: c.failures?.filter((item) => item !== failure) } : c,
          ),
        })),
      remove: (id) =>
        set((state) => ({ comparisons: state.comparisons.filter((c) => c.id !== id) })),
    }),
    {
      name: 'jackalope-comparisons-v1',
      merge: (saved, current) => {
        const value = saved as Partial<CompareState> | undefined;
        const comparisons = Array.isArray(value?.comparisons)
          ? value.comparisons.filter(
              (c): c is Comparison =>
                !!c &&
                typeof c.id === 'string' &&
                typeof c.projectId === 'string' &&
                typeof c.prompt === 'string' &&
                Array.isArray(c.taskIds) &&
                c.taskIds.every((id) => typeof id === 'string'),
            )
          : [];
        return { ...current, comparisons };
      },
    },
  ),
);

export function comparisonForTask(comparisons: Comparison[], taskId: string) {
  return comparisons.find((comparison) => comparison.taskIds.includes(taskId));
}
