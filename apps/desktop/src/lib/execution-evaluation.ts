import { latestTaskRuns, recordedOutcome } from './agent-analytics.ts';
import type { TaskRun } from './task-runtime.ts';

function elapsed(start: string, end?: string | null) {
  const value = end ? Date.parse(end) - Date.parse(start) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function executionEvaluation(input: TaskRun[]) {
  const runs = [...new Map(input.map((run) => [run.id, run])).values()];
  const episodes = latestTaskRuns(runs).map((latest) => {
    const attempts = runs.filter((run) => run.taskId === latest.taskId && run.projectId === latest.projectId && run.projectPath === latest.projectPath);
    const first = attempts.reduce((a, b) => a.startedAt < b.startedAt ? a : b);
    const outcome = recordedOutcome(latest);
    const acceptanceTimes = latest.contract?.requirements.filter((r) => !r.checkpoint).map((r) => r.receipt?.recordedAt ?? '').sort();
    const stages: Record<string, number> = {};
    for (const run of attempts) for (const stage of run.stages ?? []) {
      if (stage.endedAt && stage.durationMs !== null && stage.durationMs >= 0) stages[stage.stage] = (stages[stage.stage] ?? 0) + stage.durationMs;
    }
    const usageReported = attempts.every((run) => run.usage.reported);
    return {
      taskId: latest.taskId, projectId: latest.projectId, attemptIds: attempts.map((r) => r.id),
      outcome, attempts: attempts.length, elapsedMs: elapsed(first.startedAt, latest.endedAt),
      acceptedAfterMs: outcome === 'accepted' ? elapsed(first.startedAt, acceptanceTimes?.at(-1)) : null,
      answeredQuestions: attempts.reduce((n, r) => n + (r.prompts?.filter((p) => p.status === 'answered').length ?? 0), 0),
      correctionAttempts: Math.max(0, attempts.length - 1),
      stages, timingCoverage: attempts.filter((r) => r.stages?.length).length,
      reportedTokens: usageReported ? attempts.reduce((n, r) => n + r.usage.input + r.usage.output
        + (r.routing?.attempts ?? []).reduce((m, a) => m + a.usage.input + a.usage.output, 0), 0) : null,
      reviewMinutes: null, escapedDefects: null,
    };
  });
  const totals: Record<string, number> = {};
  for (const episode of episodes) for (const [stage, ms] of Object.entries(episode.stages)) totals[stage] = (totals[stage] ?? 0) + ms;
  return {
    version: 1,
    coverage: 'Loaded history only. Acceptance is historical and snapshot-bound. Summed stage time is work time, not parallel wall time. Review effort and escaped defects require a separate evaluation rubric. Tokens exclude unreported usage and are not a spending limit.',
    episodes, stageTotalsMs: totals,
  };
}
