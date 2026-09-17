import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../../apps/website/public/research/benchmarks.json', import.meta.url);
const target = new URL('../../apps/website/src/benchmark-summary.json', import.meta.url);
const data = JSON.parse(await readFile(source, 'utf8'));
const identities = new Set();
const comparisons = data.comparisons.map(({ report, ...item }) => {
  for (const row of report.trialMeasurements)
    identities.add(`${report.sourceSha256}:${row.case}:${row.variant}:${row.repetition}`);
  const { model, cliVersion, baseline, candidate, totals, cases, metrics, blockers, toolPayload } =
    report;
  return {
    ...item,
    report: {
      model,
      cliVersion,
      baseline,
      candidate,
      totals,
      cases,
      metrics,
      blockers,
      toolPayload,
    },
  };
});
const discovery = data.discovery
  ? Object.fromEntries(
      Object.entries(data.discovery).filter(([key]) =>
        [
          'trials',
          'calls',
          'localPassed',
          'jevPassed',
          'elapsedMs',
          'inputTokens',
          'estimatedCostUsd',
          'errors',
          'model',
          'baselineAllCalls',
          'regressions',
        ].includes(key),
      ),
    )
  : null;
const output = `${JSON.stringify({ date: data.date, environment: data.environment, agentTrials: identities.size, comparisons, discovery }, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (
    JSON.stringify(JSON.parse(await readFile(target, 'utf8'))) !==
    JSON.stringify(JSON.parse(output))
  )
    throw new Error(
      'Benchmark summary is stale. Run pnpm evaluate:website after updating the public measurements.',
    );
} else await writeFile(target, output);
