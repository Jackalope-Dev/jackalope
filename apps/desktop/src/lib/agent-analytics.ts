import type { TaskRun } from './task-runtime.ts';

export function recordedOutcome(run: TaskRun): 'accepted' | 'changes' | null {
  const requirements = run.contract?.requirements.filter((item) => !item.checkpoint) ?? [];
  if (requirements.some((item) => item.receipt?.accepted === false)) return 'changes';
  if (
    requirements.length &&
    requirements[0].receipt?.tree &&
    requirements.every(
      (item) =>
        item.receipt?.accepted === true && item.receipt.tree === requirements[0].receipt?.tree,
    )
  )
    return 'accepted';
  return null;
}

export function latestTaskRuns(runs: TaskRun[]) {
  const latest = new Map<string, TaskRun>();
  for (const run of runs) {
    const key = JSON.stringify([run.projectId, run.projectPath, run.taskId]);
    const previous = latest.get(key);
    if (
      !previous ||
      run.startedAt > previous.startedAt ||
      (run.startedAt === previous.startedAt && run.id > previous.id)
    )
      latest.set(key, run);
  }
  return [...latest.values()];
}
