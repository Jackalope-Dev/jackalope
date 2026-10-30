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
  /** A read-only task the user started to grade the attempts. */
  judge?: ComparisonJudge;
  /** Parts of other attempts the kept task was asked to bring over. */
  combine?: ComparisonCombine;
}

export interface ComparisonJudge {
  taskId: string;
  agent: string;
  /** Task ids in the order the judge labelled them A, B, C… */
  labels: string[];
  startedAt: string;
}

export interface ComparisonCombine {
  baseTaskId: string;
  /** Archived attempts whose worktrees the follow-up reads. */
  sources: { taskId: string; workspace: string }[];
  draftedAt: string;
}

interface CompareState {
  comparisons: Comparison[];
  add: (comparison: Comparison) => void;
  choose: (id: string, taskId: string) => void;
  setJudge: (id: string, judge: ComparisonJudge) => void;
  setCombine: (id: string, combine: ComparisonCombine) => void;
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
      setJudge: (id, judge) =>
        set((state) => ({
          comparisons: state.comparisons.map((c) => (c.id === id ? { ...c, judge } : c)),
        })),
      setCombine: (id, combine) =>
        set((state) => ({
          comparisons: state.comparisons.map((c) => (c.id === id ? { ...c, combine } : c)),
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
          ? value.comparisons
              .filter(
                (c): c is Comparison =>
                  !!c &&
                  typeof c.id === 'string' &&
                  typeof c.projectId === 'string' &&
                  typeof c.prompt === 'string' &&
                  Array.isArray(c.taskIds) &&
                  c.taskIds.every((id) => typeof id === 'string'),
              )
              .map(({ judge, combine, ...comparison }) => ({
                ...comparison,
                ...(validJudge(judge) && { judge }),
                ...(validCombine(combine) && { combine }),
              }))
          : [];
        return { ...current, comparisons };
      },
    },
  ),
);

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function validJudge(judge: unknown): judge is ComparisonJudge {
  const value = judge as Partial<ComparisonJudge> | undefined;
  return (
    !!value &&
    typeof value.taskId === 'string' &&
    typeof value.agent === 'string' &&
    typeof value.startedAt === 'string' &&
    strings(value.labels)
  );
}

function validCombine(combine: unknown): combine is ComparisonCombine {
  const value = combine as Partial<ComparisonCombine> | undefined;
  return (
    !!value &&
    typeof value.baseTaskId === 'string' &&
    typeof value.draftedAt === 'string' &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) => typeof source?.taskId === 'string' && typeof source?.workspace === 'string',
    )
  );
}

export function comparisonForTask(comparisons: Comparison[], taskId: string) {
  return comparisons.find((comparison) => comparison.taskIds.includes(taskId));
}
