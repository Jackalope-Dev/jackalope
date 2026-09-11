import type { TaskRun } from './task-runtime.ts';

export function taskDecision(run: TaskRun, integrated = false, verifyCommand?: string) {
  const active = ['starting', 'running', 'stopping'].includes(run.status);
  const state = (
    label: string,
    action: string,
    section: string,
    tone: 'default' | 'warning' | 'success' = 'default',
  ) => ({ label, action, section, tone });
  if (run.persistenceError)
    return state('History needs saving', 'Recover saved history', 'recovery', 'warning');
  if (active) {
    if (run.status === 'stopping') return state('Stopping', 'View activity', 'activity');
    if (!run.finishing && run.prompts?.some((p) => p.status === 'pending'))
      return state('Waiting for your answer', 'Answer question', 'question', 'warning');
    if (run.finishing) return state('Checking result', 'View checks', 'changes');
    return state(
      run.progress?.label || (run.status === 'starting' ? 'Preparing' : 'Working'),
      'View activity',
      'activity',
    );
  }
  if (integrated)
    return state('Changes integrated locally', 'View delivery', 'delivery', 'success');
  if (run.status === 'interrupted')
    return state('Work interrupted', 'Inspect interrupted work', 'activity', 'warning');
  if (
    run.verificationError ||
    (run.verification && (!run.verification.result.success || !run.verification.tree))
  )
    return state('Checks need attention', 'Inspect failed check', 'changes', 'warning');
  if (!['review', 'reviewed'].includes(run.status))
    return state(
      run.status === 'stopped' ? 'Work stopped' : 'Work needs attention',
      'Inspect and continue',
      'activity',
      'warning',
    );
  if (!run.verification && (run.verifyCommand || verifyCommand))
    return state('Checks not run', 'Run checks', 'verify', 'warning');
  if (run.status === 'reviewed') {
    const isolated =
      run.workspace.replaceAll('\\', '/').toLowerCase() !==
      run.projectPath.replaceAll('\\', '/').toLowerCase();
    return isolated
      ? state('Reviewed · not integrated', 'Review merge', 'integrate')
      : state('Reviewed locally', 'View delivery', 'delivery');
  }
  return state('Ready for your review', 'Review result', 'changes');
}

export function latestAttempt(runs: TaskRun[], taskId: string) {
  return runs
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
}

export function taskNextAction(run: TaskRun): string {
  return taskDecision(run).action;
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
