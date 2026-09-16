import type { FeatureStep } from './feature-plan';
import type { QueueView } from './queue';
import type { RunRequest, TaskRun } from './task-runtime';
import { isActive, nativeTask } from './task-runtime.ts';
import type { TaskAssessment } from './task-strategy';

export interface ManagedTask {
  id: string;
  title: string;
  request: RunRequest;
  assessment: TaskAssessment;
  plannerRunId: string;
  runIds: string[];
  createdAt: string;
  started: boolean;
  error: string | null;
}

export const managedTaskCommand = <T>(
  action: 'create' | 'start' | 'action' | 'preview',
  args: Record<string, unknown>,
) => nativeTask<T>(`task_plan_${action}`, args);

export const previewTaskPlan = (id: string) => managedTaskCommand<FeatureStep[]>('preview', { id });

export function managedTaskWork(task: ManagedTask, queue: QueueView, runs: TaskRun[]) {
  const items = queue.items.filter((item) => item.featureId === task.id);
  const roots = new Set([
    task.plannerRunId,
    ...(task.runIds ?? []),
    ...items.flatMap((item) => (item.runId ? [item.runId] : [])),
  ]);
  const taskIds = new Set(runs.filter((run) => roots.has(run.id)).map((run) => run.taskId));
  const work = runs.filter((run) => roots.has(run.id) || taskIds.has(run.taskId));
  const loadedIds = new Set(work.map((run) => run.id));
  const missingAttempts = [...roots].filter((id) => !loadedIds.has(id));
  const latest = (id: string | null) => {
    const original = runs.find((run) => run.id === id);
    return original
      ? work
          .filter((run) => run.taskId === original.taskId)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
      : undefined;
  };
  const planner = latest(task.plannerRunId);
  const steps = items.map((item) => ({ item, run: latest(item.runId) }));
  const active = work.filter(isActive);
  const questions = active.flatMap((run) =>
    (run.prompts ?? [])
      .filter((prompt) => prompt.status === 'pending')
      .map((prompt) => ({ run, prompt })),
  );
  const combined = steps.at(-1)?.run;
  const paused = !queue.enabledProjects.includes(`managed:${task.id}`);
  const failed = steps.some(
    ({ item, run }) =>
      item.error ||
      item.canceled ||
      (item.runId && !run) ||
      (run &&
        !isActive(run) &&
        (!['review', 'reviewed'].includes(run.status) ||
          run.error ||
          run.persistenceError ||
          run.verificationError ||
          run.dependencyInvalidated ||
          !run.verification?.result.success ||
          !run.verification.tree)),
  );
  const integrated =
    !!steps.length &&
    steps.every(({ item, run }) => {
      const id = run?.id ?? item.runId;
      return id != null && queue.mergedRunIds.includes(id);
    });
  const ready =
    !!combined &&
    !active.length &&
    !failed &&
    !!combined.verification?.result.success &&
    !!combined.verification.tree;
  const status = questions.length
    ? 'Needs input'
    : active.length
      ? task.started
        ? 'Working'
        : 'Planning'
      : integrated
        ? 'Integrated'
        : failed ||
            (!task.started && (!planner || !['review', 'reviewed'].includes(planner.status)))
          ? 'Needs attention'
          : ready
            ? 'Ready to review'
            : task.started
              ? paused
                ? 'Paused'
                : 'Queued'
              : 'Review plan';
  return {
    items,
    work,
    missingAttempts,
    steps,
    planner,
    combined,
    active,
    questions,
    paused,
    failed,
    integrated,
    ready,
    status,
  };
}
