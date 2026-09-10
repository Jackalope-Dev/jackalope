import type { TaskRun } from './task-runtime.ts';

export function latestAttempt(runs: TaskRun[], taskId: string) {
  return runs
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
}

export function taskNextAction(run: TaskRun): string {
  if (run.persistenceError) return 'Recover saved history';
  if (run.status === 'running' || run.status === 'starting') {
    if (run.prompts?.some((prompt) => prompt.status === 'pending')) return 'Answer a question';
    return run.finishing ? 'Checking the result' : 'View progress';
  }
  if (run.status === 'stopping') return 'Stopping work';
  if (run.status === 'interrupted') return 'Inspect interrupted work';
  if (run.verification && (!run.verification.result.success || !run.verification.tree))
    return 'Inspect checks';
  if (run.status === 'review') return 'Review result';
  if (run.status === 'reviewed') return 'Open result';
  return 'Inspect and continue';
}

export function safeResultLink(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
