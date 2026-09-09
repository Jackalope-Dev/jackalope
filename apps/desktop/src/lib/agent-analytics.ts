import type { TaskRun } from './task-runtime.ts';

export interface AgentPerformanceMetric {
  agent: string;
  attempts: number;
  completed: number;
  failed: number;
  durationSamples: number;
  avgDurationMs: number | null;
}

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

export function computeAgentAnalytics(input: TaskRun[]) {
  const runs = [...new Map(input.map((run) => [run.id, run])).values()];
  const latest = latestTaskRuns(runs);
  const accepted = latest.filter((run) => recordedOutcome(run) === 'accepted');
  const changes = latest.filter((run) => recordedOutcome(run) === 'changes');
  const measured = accepted.length + changes.length;
  const agents = [...new Set(runs.map((run) => run.agent))].sort();
  const metrics: AgentPerformanceMetric[] = agents.map((agent) => {
    const attempts = runs.filter((run) => run.agent === agent);
    const durations = attempts.flatMap((run) => {
      if (
        !run.endedAt ||
        run.routing?.handoffs.length ||
        ['starting', 'running', 'stopping'].includes(run.status)
      )
        return [];
      const value = run.durationMs ?? Date.parse(run.endedAt) - Date.parse(run.startedAt);
      return Number.isFinite(value) && value >= 0 ? [value] : [];
    });
    return {
      agent,
      attempts: attempts.length,
      completed: attempts.filter((run) => ['review', 'reviewed'].includes(run.status)).length,
      failed: attempts.filter((run) => run.status === 'failed').length,
      durationSamples: durations.length,
      avgDurationMs: durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null,
    };
  });
  return {
    metrics,
    outcomes: {
      accepted: accepted.length,
      changes: changes.length,
      measured,
      total: latest.length,
      acceptanceRate: measured ? Math.round((100 * accepted.length) / measured) : null,
    },
    handoffs: runs.reduce((count, run) => count + (run.routing?.handoffs.length ?? 0), 0),
    completedAfterHandoff: runs.filter(
      (run) => run.routing?.handoffs.length && ['review', 'reviewed'].includes(run.status),
    ).length,
    contextTasks: latest.filter((run) => run.contextReceipt?.entries.length).length,
  };
}
