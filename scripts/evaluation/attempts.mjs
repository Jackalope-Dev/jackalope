export function aggregateAttempts(report) {
  const runs = report?.attempts ?? (report?.run ? [report.run] : []);
  const sum = (values) =>
    values.length && values.every((value) => Number.isFinite(value) && value >= 0)
      ? values.reduce((a, b) => a + b, 0)
      : null;
  const measured =
    runs.length > 0 &&
    runs.every(
      (run) =>
        run.usage?.reported &&
        ['input', 'output', 'cacheRead', 'cacheWrite'].every(
          (key) => Number.isFinite(run.usage[key]) && run.usage[key] >= 0,
        ),
    );
  const usage = measured
    ? Object.fromEntries(
        ['input', 'output', 'cacheRead', 'cacheWrite'].map((key) => [
          key,
          sum(runs.map((run) => run.usage[key])),
        ]),
      )
    : null;
  if (runs.length < 2) return { runs, usage, efficiency: report?.run?.efficiency ?? null };
  const tools = {};
  for (const run of runs)
    for (const [name, count] of Object.entries(run.efficiency?.toolCalls ?? {}))
      tools[name] = (tools[name] ?? 0) + count;
  return {
    runs,
    usage,
    efficiency: {
      firstActivityMs: runs[0].efficiency?.firstActivityMs ?? null,
      toolCalls: runs.every((run) => run.efficiency?.toolCalls) ? tools : null,
      ...Object.fromEntries(
        [
          'launches',
          'launchPromptBytes',
          'verificationCalls',
          'verificationFailures',
          'verificationReuses',
          'nativeVerificationCalls',
          'contextBlocksUnchanged',
          'delegationPlans',
          'delegationPlansAdmitted',
        ].map((key) => [key, sum(runs.map((run) => run.efficiency?.[key]))]),
      ),
    },
  };
}
