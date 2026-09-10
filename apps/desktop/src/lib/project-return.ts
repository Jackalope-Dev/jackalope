import { isActive, type TaskRun } from './task-runtime.ts';

export function returnToProject(runs: TaskRun[], projectId: string, integratedIds: string[]) {
  const latest = new Map<string, TaskRun>();
  for (const run of runs.filter((r) => r.projectId === projectId)) {
    const old = latest.get(run.taskId);
    if (!old || Date.parse(run.startedAt) > Date.parse(old.startedAt)) latest.set(run.taskId, run);
  }
  const priority = (run: TaskRun) =>
    run.prompts?.some((p) => p.status === 'pending') ||
    ['failed', 'interrupted', 'stopped'].includes(run.status)
      ? 0
      : run.status === 'review'
        ? 1
        : isActive(run)
          ? 2
          : 3;
  return [...latest.values()]
    .filter(
      (r) =>
        !integratedIds.includes(r.id) &&
        (r.status !== 'reviewed' || (!!r.workspace && r.workspace !== r.projectPath)),
    )
    .sort((a, b) => priority(a) - priority(b) || Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function nextAction(run: TaskRun) {
  if (run.persistenceError) return 'Recover the unsaved result';
  if (run.status === 'interrupted') return 'Inspect the workspace and resolve process ownership';
  if (run.prompts?.some((p) => p.status === 'pending')) return 'Answer the outstanding question';
  if (run.status === 'failed' || run.status === 'stopped')
    return 'Inspect the failure and prepare a recovery';
  if (run.status === 'reviewed') return 'Integrate the reviewed changes when ready';
  if (run.status === 'review') return 'Review the expected outcomes and changes';
  return 'Check progress';
}

export function recoveryHandoff(run: TaskRun, original: string, next: string) {
  return `Continue the requested work in a new isolated workspace. First inspect the preserved workspace and compare its changes with the current target. Do not overwrite, delete or assume those changes are already integrated.\n\nOriginal request:\n${original.slice(0, 16000)}\n\nPrevious result:\n${run.result.slice(0, 8000)}\n\nRecorded state: ${run.status}\nFailure: ${run.error ?? 'None recorded'}\nPreserved workspace: ${run.workspace}\nOriginal base: ${run.baseHead}\nTarget branch: ${run.targetBranch ?? 'Not recorded'}\n\nExpected outcomes:\n${(run.contract?.requirements ?? []).map((r) => `- ${r.title}${r.receipt ? `: ${r.receipt.note}` : ' (not verified)'}`).join('\n')}\n\nPrevious checks: ${run.verification ? `${run.verification.command}: ${run.verification.result.success ? 'passed for the prior snapshot only' : 'failed'}` : 'No checks recorded'}\n\nNext requested step:\n${next}`;
}
