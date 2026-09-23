import { readFile, writeFile } from 'node:fs/promises';
import { qualitySummary } from './quality-metrics.mjs';

export function speedReport(comparison, reviews = {}) {
  const seen = new Set();
  const trials = comparison.trials.map((trial) => {
    if (!trial.receipt || seen.has(trial.receipt))
      throw new Error('Every trial needs a unique receipt.');
    seen.add(trial.receipt);
    const review = reviews[trial.receipt];
    if (
      review &&
      (typeof review.accepted !== 'boolean' ||
        ![review.reviewMinutes, review.correctionMinutes].every(
          (value) => Number.isFinite(value) && value >= 0,
        ))
    ) {
      throw new Error(
        'Reviews need accepted, reviewMinutes and correctionMinutes; use explicit zero for no time.',
      );
    }
    return {
      ...trial,
      accepted: review?.accepted ?? null,
      reviewMinutes: review?.reviewMinutes ?? null,
      correctionMinutes: review?.correctionMinutes ?? null,
    };
  });
  if (Object.keys(reviews).some((receipt) => !seen.has(receipt)))
    throw new Error('A review names a receipt outside this comparison.');
  const variants = [...new Set(trials.map((trial) => trial.variant))];
  const cohorts = variants.map((variant) => {
    const rows = trials.filter((trial) => trial.variant === variant);
    return {
      variant,
      configurations: [
        ...new Set(
          rows.map((trial) =>
            JSON.stringify([
              trial.model ?? comparison.model,
              trial.profileFingerprint ?? null,
              trial.reasoningEffort ?? null,
              trial.requestedServiceTier ?? null,
            ]),
          ),
        ),
      ],
      cases: rows.map((trial) => `${trial.case}:${trial.repetition}`).sort(),
    };
  });
  return {
    version: 1,
    agent: comparison.agent,
    model: comparison.model,
    efforts: comparison.efforts,
    speeds: comparison.speeds,
    matchedCases:
      cohorts.length > 1 &&
      !comparison.interruptions?.length &&
      cohorts.every(
        (cohort) =>
          cohort.configurations.length === 1 &&
          JSON.stringify(cohort.cases) === JSON.stringify(cohorts[0].cases),
      ),
    cohorts,
    summary: qualitySummary(trials, variants),
    interruptions: comparison.interruptions?.length ?? 0,
    limitations:
      'Retained trials only. Include all failed attempts and human correction work. Missing reviews and durations remain unknown. Phase timings overlap; do not add them together. Matching cases do not establish equal quality. Crash interruptions can leave total time and usage unknown. No routing or speed setting is changed.',
  };
}

if (
  process.argv[1] &&
  import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href
) {
  const [input, reviews, output] = process.argv.slice(2);
  if (!input)
    throw new Error('Usage: pnpm evaluate:speed comparison.json [reviews.json] [report.json]');
  const report = speedReport(
    JSON.parse(await readFile(input, 'utf8')),
    reviews ? JSON.parse(await readFile(reviews, 'utf8')) : {},
  );
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, text);
  else process.stdout.write(text);
}
