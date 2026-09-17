import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const measured = (value) => Number.isFinite(value) && value >= 0;
const sum = (rows, key) =>
  rows.length && rows.every((row) => measured(row[key]))
    ? rows.reduce((total, row) => total + row[key], 0)
    : null;
const reduction = (before, after) =>
  before > 0 && measured(after) ? 100 * (1 - after / before) : null;

function interval(groups, baseline, candidate, metric) {
  if (groups.length < 3) return null;
  let seed = 17092026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const samples = [];
  for (let i = 0; i < 2000; i++) {
    let before = 0,
      after = 0;
    for (let j = 0; j < groups.length; j++) {
      const group = groups[Math.floor(random() * groups.length)];
      const a = sum(
        group.filter((row) => row.variant === baseline),
        metric,
      );
      const b = sum(
        group.filter((row) => row.variant === candidate),
        metric,
      );
      if (a === null || b === null) return null;
      before += a;
      after += b;
    }
    const value = reduction(before, after);
    if (value === null) return null;
    samples.push(value);
  }
  samples.sort((a, b) => a - b);
  return {
    low: samples[49],
    high: samples[1949],
    method:
      '95% case-cluster bootstrap, 2000 deterministic resamples; descriptive for this suite only',
  };
}

export function contextReport(comparison, baseline = 'direct', candidate = 'after') {
  if (baseline === candidate) throw new Error('Choose different variants.');
  const all = comparison.trials;
  if (!Array.isArray(all) || !all.length) throw new Error('No trial receipts.');
  const identities = new Set(),
    receipts = new Set();
  for (const row of all) {
    const id = `${row.variant}:${row.case}:${row.repetition}`;
    if (identities.has(id) || (row.receipt && receipts.has(row.receipt)))
      throw new Error('Duplicate trial or receipt.');
    identities.add(id);
    if (row.receipt) receipts.add(row.receipt);
  }
  const rows = all.filter((row) => [baseline, candidate].includes(row.variant));
  const variants = [baseline, candidate];
  const keys = variants.map((variant) =>
    rows
      .filter((row) => row.variant === variant)
      .map((row) => `${row.case}:${row.repetition}`)
      .sort(),
  );
  const caseIds = [...new Set(rows.map((row) => row.case))].sort();
  const groups = caseIds.map((id) => rows.filter((row) => row.case === id));
  const configs = rows.map((row) =>
    JSON.stringify([
      comparison.agent,
      row.model ?? comparison.model,
      row.profileFingerprint,
      row.reasoningEffort,
      row.requestedServiceTier,
    ]),
  );
  const matched =
    keys[0].length > 0 &&
    JSON.stringify(keys[0]) === JSON.stringify(keys[1]) &&
    new Set(configs).size === 1;
  const provenance = Boolean(
    comparison.cliVersion &&
      comparison.model &&
      variants.every((v) => comparison.executableHashes?.[v]) &&
      rows.every((row) => row.receipt && row.profileFingerprint && row.reasoningEffort),
  );
  const complete =
    !comparison.interruptions?.length &&
    rows.every(
      (row) =>
        row.processExit === 0 &&
        !row.processTimeout &&
        row.budgetStopped === false &&
        typeof row.oraclePassed === 'boolean',
    );
  const planned =
    comparison.plan &&
    variants.every((v) => comparison.plan.variants?.includes(v)) &&
    comparison.plan.cases?.length > 0 &&
    Number.isInteger(comparison.plan.repeat) &&
    comparison.plan.repeat > 0 &&
    rows.length === comparison.plan.cases.length * comparison.plan.repeat * 2 &&
    comparison.plan.cases.every((id) =>
      variants.every((v) =>
        Array.from({ length: comparison.plan.repeat }, (_, i) =>
          identities.has(`${v}:${id}:${i + 1}`),
        ).every(Boolean),
      ),
    );
  const validUsage = rows.every(
    (row) =>
      measured(row.input) &&
      measured(row.output) &&
      measured(row.cacheRead) &&
      row.cacheRead <= row.input &&
      row.totalTokens === row.input + row.output,
  );
  const pass = rows.every((row) => row.oraclePassed === true);
  const enough =
    groups.length >= 3 &&
    groups.every((group) =>
      variants.every((v) => group.filter((row) => row.variant === v).length >= 3),
    );
  const totals = Object.fromEntries(
    variants.map((variant) => {
      const selected = rows.filter((row) => row.variant === variant);
      const elapsed = selected
        .filter((r) => measured(r.elapsedMs))
        .map((r) => r.elapsedMs)
        .sort((a, b) => a - b);
      return [
        variant,
        {
          trials: selected.length,
          oraclePassed: selected.filter((row) => row.oraclePassed).length,
          totalTokens: sum(selected, 'totalTokens'),
          inputTokens: sum(selected, 'input'),
          outputTokens: sum(selected, 'output'),
          cachedInputTokens: sum(selected, 'cacheRead'),
          elapsedMs: sum(selected, 'elapsedMs'),
          promptBytes: sum(selected, 'promptBytes'),
          medianElapsedMs:
            elapsed.length === selected.length && elapsed.length
              ? elapsed[Math.floor(elapsed.length / 2)]
              : null,
          measuredTokenTrials: selected.filter((row) => measured(row.totalTokens)).length,
          mcpReceivedBytes: sum(
            selected.map((row) => ({ value: row.mcpUsage?.resultBytesReceived })),
            'value',
          ),
          mcpDeliveredBytes: sum(
            selected.map((row) => ({ value: row.mcpUsage?.resultBytesReturned })),
            'value',
          ),
          expansionReads: sum(
            selected.map((row) => ({ value: row.mcpUsage?.resultReads })),
            'value',
          ),
        },
      ];
    }),
  );
  const blockers = [];
  if (!planned)
    blockers.push('The complete planned case and repetition matrix is not recorded or fulfilled.');
  if (!matched) blockers.push('Cases, repetitions or provider configurations differ.');
  if (!provenance)
    blockers.push('Build, CLI, model, effort, account binding or receipt evidence is missing.');
  if (!complete)
    blockers.push(
      'Incomplete, interrupted or budget-stopped trials prevent a complete comparison.',
    );
  if (!pass) blockers.push('At least one independent oracle failed.');
  if (!validUsage) blockers.push('Token accounting is missing or inconsistent.');
  if (!enough)
    blockers.push(
      'Require at least three cases and three repetitions per case and variant for a limited benchmark claim.',
    );
  const metrics = Object.fromEntries(
    ['totalTokens', 'elapsedMs'].map((metric) => {
      const savings =
        matched && complete ? reduction(totals[baseline][metric], totals[candidate][metric]) : null;
      const confidence = matched && complete ? interval(groups, baseline, candidate, metric) : null;
      return [
        metric,
        {
          reductionPercent: savings,
          interval: confidence,
          eligibleForScopedClaim:
            blockers.length === 0 && confidence !== null && confidence.low > 0,
        },
      ];
    }),
  );
  return {
    version: 1,
    agent: comparison.agent,
    model: comparison.model,
    cliVersion: comparison.cliVersion,
    baseline,
    candidate,
    matched,
    totals,
    metrics,
    toolPayload: {
      reductionPercent: reduction(
        totals[candidate].mcpReceivedBytes,
        totals[candidate].mcpDeliveredBytes,
      ),
      eligibleForScopedClaim:
        blockers.length === 0 &&
        totals[candidate].mcpReceivedBytes > totals[candidate].mcpDeliveredBytes &&
        measured(totals[candidate].mcpDeliveredBytes),
      scope:
        'Serialized MCP result bytes received versus returned inside Jackalope, including expansion reads. Excludes schemas, discovery, prompts, coordination and provider truncation. Not an end-to-end token or cost reduction.',
    },
    blockers,
    cases: caseIds,
    plan: comparison.plan ?? null,
    trialMeasurements: rows.map((row) => ({
      case: row.case,
      variant: row.variant,
      repetition: row.repetition,
      oraclePassed: row.oraclePassed,
      elapsedMs: row.elapsedMs,
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      totalTokens: row.totalTokens,
      promptBytes: row.promptBytes,
      mcpUsage: row.mcpUsage ?? null,
      fixtureToolCalls: row.fixtureToolCalls ?? null,
      observedToolCalls: row.efficiency?.toolCalls
        ? Object.values(row.efficiency.toolCalls).reduce((sum, count) => sum + count, 0)
        : null,
      verificationCalls: row.efficiency?.verificationCalls ?? null,
      verificationReuses: row.efficiency?.verificationReuses ?? null,
    })),
    repetitions: Object.fromEntries(
      caseIds.map((id) => [id, rows.filter((r) => r.case === id && r.variant === baseline).length]),
    ),
    sourceSha256: createHash('sha256').update(JSON.stringify(comparison)).digest('hex'),
    executableHashes: Object.fromEntries(
      variants.map((v) => [v, comparison.executableHashes?.[v] ?? null]),
    ),
    baselineRevision: comparison.baselineRevision ?? null,
    controlPromptsRevision: comparison.controlPromptsRevision ?? null,
    controlPromptsHash: comparison.controlPromptsHash ?? null,
    budgets: {
      secondsPerTrial: comparison.seconds ?? null,
      tokensPerTrial: comparison.tokens ?? null,
    },
    requestedEffort: comparison.efforts,
    requestedSpeed: comparison.speeds,
    quality:
      'Independent authored-fixture oracles only. Human acceptance and correction time are unmeasured; passing does not establish quality equivalence on real projects.',
    measurement:
      'Tokens sum input and output across every retained attempt, including failures. Cached input is included once. Tokens are not dollars or subscription quota. Elapsed time includes native task completion and automatic checks; direct CLI has its own tool inventory. Provider cache state is inherited, not controlled.',
    scope:
      'Local disposable task benchmark. Any eligible claim must name the model, CLI, suite, repetitions, comparator and oracle results. No general speed, cost or quality guarantee.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, baseline = 'direct', candidate = 'after'] = process.argv.slice(2);
  if (!input || !output)
    throw new Error(
      'Usage: pnpm evaluate:context comparison.json public-report.json [baseline] [candidate]',
    );
  const report = contextReport(JSON.parse(await readFile(input, 'utf8')), baseline, candidate);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({ output, metrics: report.metrics, blockers: report.blockers }, null, 2),
  );
}
