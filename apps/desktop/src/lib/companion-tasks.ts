import type { CompanionNotice } from '../stores/companionStore.ts';
import { isActive, type TaskRun } from './task-runtime.ts';
import { taskTitle } from './task-title.ts';

export function taskNotices(runs: TaskRun[], open: (run: TaskRun) => void): CompanionNotice[] {
  const latest = new Map<string, TaskRun>();
  const titles = new Map<string, string>();
  for (const run of [...runs].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))) {
    const key = `${run.projectId}:${run.taskId}`;
    latest.set(key, run);
    if (!titles.has(key)) titles.set(key, taskTitle(run.prompt));
  }
  return [...latest.values()].reverse().flatMap((run): CompanionNotice[] => {
    const detail = `${run.projectName} · ${titles.get(`${run.projectId}:${run.taskId}`)}`;
    const onOpen = () => open(run);
    const pending = isActive(run)
      ? (run.prompts?.filter((prompt) => prompt.status === 'pending') ?? [])
      : [];
    if (pending.length)
      return [
        {
          id: `task:${run.id}:question:${pending
            .map((prompt) => prompt.id)
            .sort()
            .join(',')}`,
          kind: 'attention',
          title: 'Your answer is needed',
          detail: `${detail}\n${pending[0].question}`,
          actionLabel: 'Answer question',
          onOpen,
        },
      ];
    if (run.status === 'failed' || run.status === 'interrupted')
      return [
        {
          id: `task:${run.id}:${run.status}`,
          kind: 'attention',
          title: run.status === 'failed' ? 'Task needs attention' : 'Task was interrupted',
          detail,
          actionLabel: 'Open task',
          onOpen,
        },
      ];
    if (run.status === 'review')
      return [
        {
          id: `task:${run.id}:review`,
          kind: 'success',
          title: 'Ready for your review',
          detail,
          actionLabel: 'Review task',
          onOpen,
        },
      ];
    return [];
  });
}
