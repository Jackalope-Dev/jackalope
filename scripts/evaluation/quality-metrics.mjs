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
      return [
        variant,
        {
          trials: rows.length,
          oraclePassed: successes,
          usageCoverage: measured.length,
          totalTokens: total,
          tokensPerOracleSuccess: successes && total !== null ? total / successes : null,
        },
      ];
    }),
  );
}
