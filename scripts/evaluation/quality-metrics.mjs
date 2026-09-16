function measurements(values) {
  const measured = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const percentile = (fraction) =>
    measured[Math.max(0, Math.ceil(measured.length * fraction) - 1)] ?? null;
  return {
    coverage: measured.length,
    total:
      measured.length === values.length && values.length
        ? measured.reduce((sum, value) => sum + value, 0)
        : null,
    p50: percentile(0.5),
    p95: percentile(0.95),
  };
}

export function qualitySummary(trials, variants = ['before', 'after']) {
  return Object.fromEntries(
    variants.map((variant) => {
      const rows = trials.filter((trial) => trial.variant === variant);
      const measured = rows.filter(
        (trial) => Number.isFinite(trial.totalTokens) && trial.totalTokens >= 0,
      );
      const total =
        rows.length && measured.length === rows.length
          ? measured.reduce((sum, trial) => sum + trial.totalTokens, 0)
          : null;
      const successes = rows.filter((trial) => trial.oraclePassed).length;
      const elapsed = measurements(rows.map((trial) => trial.elapsedMs));
      const phases = [
        ...new Set(rows.flatMap((trial) => Object.keys(trial.efficiency?.timings ?? {}))),
      ].sort();
      return [
        variant,
        {
          trials: rows.length,
          oraclePassed: successes,
          usageCoverage: measured.length,
          totalTokens: total,
          tokensPerOracleSuccess: successes && total !== null ? total / successes : null,
          elapsedMs: elapsed,
          msPerOracleSuccess:
            successes && elapsed.total !== null ? elapsed.total / successes : null,
          firstActivityMs: measurements(rows.map((trial) => trial.efficiency?.firstActivityMs)),
          timings: Object.fromEntries(
            phases.map((phase) => [
              phase,
              measurements(rows.map((trial) => trial.efficiency?.timings?.[phase]?.totalMs)),
            ]),
          ),
        },
      ];
    }),
  );
}
