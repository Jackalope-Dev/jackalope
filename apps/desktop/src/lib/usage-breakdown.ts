import type { RunUsage, TaskRun } from './task-runtime.ts';

function total(usages: RunUsage[]) {
  const reported = usages.filter((usage) => usage.reported);
  const complete = reported.length === usages.length;
  return {
    observations: usages.length,
    reported: reported.length,
    input: complete ? reported.reduce((sum, u) => sum + u.input, 0) : null,
    output: complete ? reported.reduce((sum, u) => sum + u.output, 0) : null,
    tokens: complete ? reported.reduce((sum, u) => sum + u.input + u.output, 0) : null,
    cacheRead: complete ? reported.reduce((sum, u) => sum + u.cacheRead, 0) : null,
  };
}

export function runUsageBreakdown(runs: TaskRun[]) {
  const routing: RunUsage[] = [];
  const execution: RunUsage[] = [];
  const retries: RunUsage[] = [];
  for (const run of runs) {
    const history = run.routing;
    routing.push(...(history?.attempts ?? history?.decisions ?? []).map((a) => a.usage));
    retries.push(...(history?.handoffs ?? []).map((a) => a.usage));
    if (!history || history.decisions.length > history.handoffs.length) execution.push(run.usage);
  }
  return {
    routing: total(routing),
    execution: total(execution),
    quotaRetries: total(retries),
    total: total([...routing, ...execution, ...retries]),
    verificationTokens: null,
    limitations:
      'Cached input is included in input. Execution includes agent verification and internal retries; providers do not expose a reliable token split for those stages. Separate continuation attempts must all be supplied. Byte counts are not tokens or quota.',
  };
}
