import { measured, quantile, sum } from '../lib/stats.mjs';

function measurements(values) {
  const recorded = values.filter(measured);
  return {
    coverage: recorded.length,
    total: sum(values),
    p50: quantile(recorded, 0.5),
    p95: quantile(recorded, 0.95),
  };
}

export function qualitySummary(trials, variants = ['before', 'after']) {
  return Object.fromEntries(
    variants.map((variant) => {
      const rows = trials.filter((trial) => trial.variant === variant);
      const usage = rows.filter((trial) => measured(trial.totalTokens));
      const total = sum(rows.map((trial) => trial.totalTokens));
      const successes = rows.filter((trial) => trial.oraclePassed).length;
      const elapsed = measurements(rows.map((trial) => trial.elapsedMs));
      const accepted = rows.filter((trial) => trial.accepted === true).length;
      const reviewed = rows.filter((trial) => typeof trial.accepted === 'boolean').length;
      const delivery = measurements(
        rows.map((trial) =>
          [trial.elapsedMs, trial.reviewMinutes, trial.correctionMinutes].every(measured)
            ? trial.elapsedMs + (trial.reviewMinutes + trial.correctionMinutes) * 60_000
            : null,
        ),
      );
      const phases = [
        ...new Set(rows.flatMap((trial) => Object.keys(trial.efficiency?.timings ?? {}))),
      ].sort();
      return [
        variant,
        {
          trials: rows.length,
          oraclePassed: successes,
          accepted,
          reviewCoverage: reviewed,
          deliveryMs: delivery,
          msPerAcceptedResult:
            accepted && reviewed === rows.length && delivery.total !== null
              ? delivery.total / accepted
              : null,
          usageCoverage: usage.length,
          totalTokens: total,
          tokensPerOracleSuccess: successes && total !== null ? total / successes : null,
          elapsedMs: elapsed,
          msPerOracleSuccess:
            successes && elapsed.total !== null ? elapsed.total / successes : null,
          firstActivityMs: measurements(rows.map((trial) => trial.efficiency?.firstActivityMs)),
          firstTokenMs: measurements(rows.map((trial) => trial.efficiency?.firstTokenMs)),
          // Later turns of a continued conversation, where a warm session can skip startup.
          followUpFirstTokenMs: measurements(
            rows.flatMap((trial) =>
              (trial.efficiency?.turns ?? []).slice(1).map((turn) => turn.firstTokenMs),
            ),
          ),
          turnMs: measurements(
            rows.flatMap((trial) => (trial.efficiency?.turns ?? []).map((turn) => turn.elapsedMs)),
          ),
          cacheRead: measurements(rows.map((trial) => trial.cacheRead)),
          cacheWrite: measurements(rows.map((trial) => trial.cacheWrite)),
          attempts: measurements(rows.map((trial) => trial.attempts)),
          firstCheckPassed: {
            passed: rows.filter((trial) => trial.efficiency?.firstCheckPassed === true).length,
            measured: rows.filter(
              (trial) => typeof trial.efficiency?.firstCheckPassed === 'boolean',
            ).length,
          },
          stopCheckRounds: measurements(rows.map((trial) => trial.efficiency?.stopCheckRounds)),
          verificationReuses: measurements(
            rows.map((trial) => trial.efficiency?.verificationReuses),
          ),
          preparationReuses: measurements(rows.map((trial) => trial.efficiency?.preparationReuses)),
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
