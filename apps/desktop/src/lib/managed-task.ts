import type { FeatureStep } from './feature-plan';
import type { QueueView } from './queue';
import type { RunRequest, TaskRun } from './task-runtime';
import { isActive, nativeTask } from './task-runtime.ts';
import type { TaskAssessment } from './task-strategy';

export interface ManagedTask {
  delivery?: {
    finalItem: string | null;
    integrationItems: string[];
    checkedItems: string[];
    repairs: { itemId: string; sourceRunId: string; runId: string; createdAt: string }[];
    repairLimit: number;
    workersFinishedAt: string | null;
    readyAt: string | null;
    appliedAt: string | null;
    reviewSeconds: number | null;
    interventions: number;
  } | null;
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
  const itemIds = new Set(items.map((item) => item.id));
  const pendingInterfaces = (queue.agreements ?? []).filter(
    (agreement) =>
      agreement.kind === 'interface' &&
      ['pending', 'rejected'].includes(agreement.status) &&
      (itemIds.has(agreement.taskId) || agreement.participants.some((id) => itemIds.has(id))),
  );
  const interfaceIssue = pendingInterfaces.length
    ? `Waiting for a shared interface decision: ${pendingInterfaces
        .map((agreement) => agreement.resource)
        .slice(0, 3)
        .join(', ')}.`
    : null;
  const active = work.filter(isActive);
  const questions = active.flatMap((run) =>
    (run.prompts ?? [])
      .filter((prompt) => prompt.status === 'pending')
      .map((prompt) => ({ run, prompt })),
  );
  const combined = (
    task.delivery?.finalItem
      ? steps.find(({ item }) => item.id === task.delivery?.finalItem)
      : steps.at(-1)
  )?.run;
  const integrationItems = new Set(task.delivery?.integrationItems ?? []);
  const assignments = steps.filter(({ item }) => !integrationItems.has(item.id));
  const combining = steps.some(
    ({ item, run }) => integrationItems.has(item.id) && run && isActive(run),
  );
  const repairing = active.some((run) =>
    task.delivery?.repairs.some((repair) => repair.runId === run.id),
  );
  const paused = !queue.enabledProjects.includes(`managed:${task.id}`);
  const failed =
    !!task.error ||
    steps.some(
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
    steps.every(({ run }) => !!run) &&
    !active.length &&
    !failed &&
    !interfaceIssue &&
    !!combined.verification?.result.success &&
    !!combined.verification.tree;
  const status = questions.length
    ? 'Needs input'
    : active.length
      ? task.started
        ? repairing
          ? 'Fixing checks'
          : combining
            ? 'Combining work'
            : 'Working'
        : 'Planning'
      : integrated
        ? 'Integrated'
        : failed ||
            (!task.started && (!planner || !['review', 'reviewed'].includes(planner.status)))
          ? 'Needs attention'
          : interfaceIssue
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
    assignments,
    combining,
    repairing,
    interfaceIssue,
  };
}

export function managedTaskProgress(task: ManagedTask, work: ReturnType<typeof managedTaskWork>) {
  const finished = work.assignments.filter(
    ({ run }) => run && !isActive(run) && run.verification?.result.success,
  ).length;
  const stage = work.integrated
    ? 4
    : work.ready
      ? 3
      : task.started && finished === work.assignments.length && finished > 0
        ? 2
        : task.started
          ? 1
          : 0;
  const description = work.questions.length
    ? 'A decision from you will help the task move forward.'
    : work.integrated
      ? 'Your changes have been applied. The review keeps the result and cleanup details.'
      : work.repairing
        ? 'Jackalope is resolving an issue and will verify the result again.'
        : work.interfaceIssue && !work.active.length
          ? work.interfaceIssue
          : work.failed
            ? (task.error ?? 'Your work is saved. Open the affected step for the next action.')
            : work.ready
              ? 'The complete result is ready. Review the changes, try the preview, then apply them when you’re happy.'
              : work.combining
                ? 'Jackalope is bringing the changes together and checking that they work as a whole.'
                : task.started
                  ? work.paused
                    ? 'Your work is saved. Resume when you’re ready.'
                    : `${finished} of ${work.assignments.length} assignments checked. Jackalope handles dependencies and combines the results.`
                  : work.status === 'Review plan'
                    ? 'Review the proposed approach. Jackalope will manage assignments, checks and up to two repair attempts.'
                    : 'Jackalope is finding a practical approach and identifying work that can happen together.';
  return { stage, description, finished };
}
