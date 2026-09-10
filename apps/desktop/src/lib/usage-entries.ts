import type { TaskRun } from './task-runtime.ts';

export function usageEntries(runs: TaskRun[]) {
  return [...new Map(runs.map((run) => [run.id, run])).values()].flatMap((run) => [
    ...(!run.routing || run.routing.decisions.length > run.routing.handoffs.length
      ? [{ ...run, usageKey: `${run.id}:worker`, purpose: 'Worker' }]
      : []),

    ...(run.routing?.handoffs ?? []).map((handoff, index) => ({
      ...run,
      agent: handoff.agent,
      model: handoff.model,
      account: handoff.binding.label,

      accountBinding: handoff.binding,
      usage: handoff.usage,
      usageObservations: [],
      effort: undefined,
      reasoningEffort: undefined,
      efficiency: undefined,

      startedAt: handoff.recordedAt,
      status: 'failed' as const,

      usageKey: `${run.id}:handoff:${index}`,
      purpose: 'Worker · quota handoff',
    })),

    ...(
      run.routing?.attempts ??
      run.routing?.decisions.map((decision) => ({
        agent: decision.orchestrator,
        model: decision.orchestratorModel,
        binding: {
          adapter: decision.orchestrator,
          profileId: null,
          directory: '',
          label: decision.orchestratorAccount,
        },
        usage: decision.usage,
        error: null,
        recordedAt: decision.checkedAt,
      })) ??
      []
    ).map((attempt, index) => ({
      ...run,
      agent: attempt.agent,
      model: attempt.model,
      account: attempt.binding.label,

      accountBinding: attempt.binding,
      usage: attempt.usage,
      usageObservations: [],
      effort: undefined,
      reasoningEffort: undefined,
      efficiency: undefined,

      startedAt: attempt.recordedAt,
      status: attempt.error ? ('failed' as const) : run.status,

      usageKey: `${run.id}:routing:${index}`,
      purpose: 'Routing',
    })),
  ]);
}
