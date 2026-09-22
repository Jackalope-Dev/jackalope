import type { WorkItem } from './task-collection.ts';
import type { TaskRun } from './task-runtime.ts';
import { taskDecision } from './task-workflow.ts';

export type WorkspacePreset = 'focus' | 'build' | 'oversee';
export const workspacePresets = [
  { id: 'focus', label: 'Focus', description: 'A quiet canvas for one task or conversation.' },
  { id: 'build', label: 'Build', description: 'Conversation, changes and tools side by side.' },
  {
    id: 'oversee',
    label: 'Oversee',
    description: 'A live board for progress, questions and reviews.',
  },
] as const;

export function workSummary(run: TaskRun) {
  const question = run.prompts?.find((prompt) => prompt.status === 'pending');
  const checks = run.verificationError
    ? 'Checks could not finish'
    : run.verification
      ? run.verification.result.success && run.verification.tree
        ? 'Saved checks passed · current changes still need review'
        : 'Saved checks need attention'
      : 'No saved check result';
  const state = JSON.stringify([
    run.id,
    run.status,
    run.result,
    run.error,
    run.persistenceError,
    run.verification?.checkedAt,
    run.verificationError,
    run.prompts?.map((prompt) => [prompt.id, prompt.status]),
  ]);
  let hash = 2166136261;
  for (let i = 0; i < state.length; i++) hash = Math.imul(hash ^ state.charCodeAt(i), 16777619);
  return {
    decision: taskDecision(run),
    question: question?.question,
    checks,
    blocker: run.persistenceError || run.error || run.verificationError,
    fingerprint: `${run.id}:${state.length}:${hash >>> 0}`,
  };
}

export function attentionPriority(item: WorkItem) {
  if (item.run?.persistenceError) return 0;
  if (item.run?.prompts?.some((prompt) => prompt.status === 'pending')) return 1;
  if (item.stage === 'attention') return 2;
  return 3;
}

export function attentionQueue(items: WorkItem[]) {
  return items
    .filter((item) => item.stage === 'attention' || item.stage === 'review')
    .sort(
      (a, b) =>
        attentionPriority(a) - attentionPriority(b) || Date.parse(a.date) - Date.parse(b.date),
    );
}
