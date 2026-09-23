import type { TaskRun } from './task-runtime';

export interface TaskChanges {
  revision: number;
  runs: TaskRun[];
  ids: string[];
}

export function mergeTaskChanges(previous: TaskRun[], changes: TaskChanges): TaskRun[] {
  const updated = new Map(changes.runs.map((run) => [run.id, run]));
  const retained = new Set(changes.ids);
  const next = previous
    .filter((run) => retained.has(run.id))
    .map((run) => {
      const replacement = updated.get(run.id);
      updated.delete(run.id);
      return replacement && JSON.stringify(replacement) !== JSON.stringify(run) ? replacement : run;
    });
  next.push(...updated.values());
  if (next.length === previous.length && next.every((run, index) => run === previous[index]))
    return previous;
  return next.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
