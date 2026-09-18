export function aggregateAttempts(report) {
  const runs = report?.attempts ?? (report?.run ? [report.run] : []);
  const ids = new Set(runs.map((run) => run.id));
  const helpers = [
    ...new Map(
      (report?.decisionRecords ?? [])
        .filter((record) => !record.accountedElsewhere && ids.has(record.runId))
        .map((record) => [record.id, record]),
    ).values(),
  ];
  const helperUsages = helpers.map((record) => record.decision?.usage ?? { reported: false });
  const sum = (values) =>
    values.length && values.every((value) => Number.isFinite(value) && value >= 0)
      ? values.reduce((a, b) => a + b, 0)
      : null;
  const aggregate = (usages) => {
    const measured = usages.every(
      (usage) =>
        usage?.reported &&
        ['input', 'output', 'cacheRead', 'cacheWrite'].every(
          (key) => Number.isFinite(usage[key]) && usage[key] >= 0,
        ),
    );
    return measured
      ? Object.fromEntries(
          ['input', 'output', 'cacheRead', 'cacheWrite'].map((key) => [
            key,
            usages.reduce((sum, usage) => sum + usage[key], 0),
          ]),
        )
      : null;
  };
  const agentUsage = runs.length ? aggregate(runs.map((run) => run.usage)) : null;
  const usage = runs.length ? aggregate([...runs.map((run) => run.usage), ...helperUsages]) : null;
  const accounting = {
    runs,
    usage,
    agentUsage,
    agentReportedCostUsd: sum(runs.map((run) => run.usage?.estimatedCostUsd)),
    helperUsages,
    helperUsage: aggregate(helperUsages),
    helperAccountingComplete: Array.isArray(report?.decisionRecords),
    helperCostUsd: helpers.length ? sum(helperUsages.map((usage) => usage.estimatedCostUsd)) : 0,
  };
  if (runs.length < 2) return { ...accounting, efficiency: report?.run?.efficiency ?? null };
  const tools = {};
  for (const run of runs)
    for (const [name, count] of Object.entries(run.efficiency?.toolCalls ?? {}))
      tools[name] = (tools[name] ?? 0) + count;
  return {
    ...accounting,
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
          'jevQuestionCalls',
          'jevQuestions',
        ].map((key) => [key, sum(runs.map((run) => run.efficiency?.[key]))]),
      ),
    },
  };
}
