import type { TaskTicket } from '../stores/taskStore.ts';
import { type LiveSession, sessionWork } from './live-session.ts';
import { managedTaskWork } from './managed-task.ts';
import type { QueueView } from './queue.ts';
import { collectWorkspaceWork, type WorkItem, workPresence } from './task-collection.ts';
import { isActive, type TaskRun } from './task-runtime.ts';
import { taskDecision } from './task-workflow.ts';

export function returnToProject(
  runs: TaskRun[],
  projectId: string,
  integratedIds: string[],
  {
    ideas = [],
    sessions = [],
    queue,
  }: { ideas?: TaskTicket[]; sessions?: LiveSession[]; queue?: QueueView } = {},
) {
  return collectWorkspaceWork(projectId, ideas, runs, sessions, integratedIds, false, queue).filter(
    (item) => item.stage !== 'ideas' && item.stage !== 'finished',
  );
}

export function projectTaskPresence(item: WorkItem, runs: TaskRun[], queue: QueueView) {
  const managed = item.managed ? managedTaskWork(item.managed, queue, runs) : undefined;
  const session = item.session ? sessionWork(item.session, runs) : undefined;
  const active =
    managed?.active ??
    (session
      ? session.active
        ? [session.active]
        : []
      : item.run && isActive(item.run)
        ? [item.run]
        : []);
  const waiting = active.some((run) => run.prompts?.some((prompt) => prompt.status === 'pending'));
  return {
    label:
      managed?.status ??
      session?.status ??
      (item.run ? taskDecision(item.run).label : 'Task history unavailable'),
    agents: active.length
      ? [...new Set(active.map((run) => run.agent))]
      : workPresence(item).agents,
    state: waiting
      ? ('waiting' as const)
      : active.length
        ? ('working' as const)
        : ('idle' as const),
  };
}

export function recoveryHandoff(run: TaskRun, original: string, next: string) {
  return `Continue the requested work in a new isolated workspace. First inspect the preserved workspace and compare its changes with the current target. Do not overwrite, delete or assume those changes are already integrated.\n\nOriginal request:\n${original.slice(0, 16000)}\n\nPrevious result:\n${run.result.slice(0, 8000)}\n\nRecorded state: ${run.status}\nFailure: ${run.error ?? 'None recorded'}\nPreserved workspace: ${run.workspace}\nOriginal base: ${run.baseHead}\nTarget branch: ${run.targetBranch ?? 'Not recorded'}\n\nExpected outcomes:\n${(run.contract?.requirements ?? []).map((r) => `- ${r.title}${r.receipt ? `: ${r.receipt.note}` : ' (not verified)'}`).join('\n')}\n\nPrevious checks: ${run.verification ? `${run.verification.command}: ${run.verification.result.success ? 'passed for the prior snapshot only' : 'failed'}` : 'No checks recorded'}\n\nNext requested step:\n${next}`;
}
