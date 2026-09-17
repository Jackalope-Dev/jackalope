import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const measured = (n) => Number.isFinite(n) && n >= 0;
const sum = (values) =>
  values.length && values.every(measured) ? values.reduce((a, b) => a + b, 0) : null;
const reduction = (a, b) => (a > 0 && measured(b) ? 100 * (1 - b / a) : null);
const familyOf = (row) => row.source?.family ?? row.category ?? row.case;
const quantile = (values, p) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * values.length) - 1)]
    : null;

function wilson(successes, count) {
  if (!count) return [0, 1];
  const z = 1.96,
    p = successes / count,
    d = 1 + (z * z) / count;
  const center = (p + (z * z) / (2 * count)) / d,
    radius = (z * Math.sqrt((p * (1 - p)) / count + (z * z) / (4 * count * count))) / d;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

export function pricedBounds(row, pricing) {
  if (!pricing) return null;
  if (
    !pricing.source ||
    !pricing.date ||
    ![pricing.input, pricing.cachedInput, pricing.output].every(measured)
  )
    throw new Error(
      'Pricing needs source, date and nonnegative USD per million input/cachedInput/output rates.',
    );
  if (
    ![row.input, row.cacheRead, row.output, row.cacheWrite].every(measured) ||
    row.cacheRead > row.input
  )
    return null;
  if (row.cacheWrite && !measured(pricing.cacheWriteIncremental)) return null;
  const low =
    ((row.input - row.cacheRead) * pricing.input +
      row.cacheRead * pricing.cachedInput +
      row.output * pricing.output +
      row.cacheWrite * (pricing.cacheWriteIncremental ?? 0)) /
    1e6;
  if (
    !pricing.longContextThreshold ||
    row.input <= pricing.longContextThreshold ||
    (measured(row.maxRequestInput) && row.maxRequestInput <= pricing.longContextThreshold)
  )
    return { low, high: low };
  if (![pricing.longInputMultiplier, pricing.longOutputMultiplier].every(measured)) return null;
  const high =
    (((row.input - row.cacheRead) * pricing.input +
      row.cacheRead * pricing.cachedInput +
      row.cacheWrite * (pricing.cacheWriteIncremental ?? 0)) *
      pricing.longInputMultiplier +
      row.output * pricing.output * pricing.longOutputMultiplier) /
    1e6;
  return { low, high };
}

export function pricedUsage(row, pricing) {
  const bounds = pricedBounds(row, pricing);
  return bounds && bounds.low === bounds.high ? bounds.low : null;
}

export function impactReport(
  comparison,
  { baseline = 'control', candidate = 'after', reviews = {}, pricing = {}, protocol = {} } = {},
) {
  if (baseline === candidate) throw new Error('Choose distinct variants.');
  const seen = new Set(),
    receipts = new Set();
  const rows = comparison.trials
    .filter((row) => [baseline, candidate].includes(row.variant))
    .map((row) => {
      const id = `${row.variant}:${row.case}:${row.repetition}`;
      if (seen.has(id) || (row.receipt && receipts.has(row.receipt)))
        throw new Error('Duplicate trial.');
      seen.add(id);
      if (row.receipt) receipts.add(row.receipt);
      const review = reviews[row.receipt];
      if (
        review &&
        (typeof review.accepted !== 'boolean' ||
          ![review.reviewMinutes, review.correctionMinutes].every(
            (value) => value == null || measured(value),
          ) ||
          !review.notes?.trim())
      )
        throw new Error('Invalid independent review.');
      const estimatedCostUsd = pricedUsage(row, pricing[row.model ?? comparison.model]);
      const modelCostBounds = pricedBounds(row, pricing[row.model ?? comparison.model]);
      const helperCostUsd = row.helperCostUsd ?? (protocol.includesHelpers ? null : 0);
      const fallbackCostUsd =
        row.fallbackCostUsd ?? (protocol.includesExternalFallbacks ? null : 0);
      const correctionCostUsd =
        row.correctionCostUsd ?? (protocol.includesExternalCorrections ? null : 0);
      const extraCost = [helperCostUsd, fallbackCostUsd, correctionCostUsd].every(measured)
        ? helperCostUsd + fallbackCostUsd + correctionCostUsd
        : null;
      return {
        ...row,
        accepted: review?.accepted ?? null,
        reviewMinutes: review?.reviewMinutes ?? null,
        correctionMinutes: review?.correctionMinutes ?? null,
        estimatedCostUsd,
        helperCostUsd: helperCostUsd ?? null,
        fallbackCostUsd,
        correctionCostUsd,
        deliveryMs:
          review && [row.elapsedMs, review.reviewMinutes, review.correctionMinutes].every(measured)
            ? row.elapsedMs + 60000 * (review.reviewMinutes + review.correctionMinutes)
            : null,
        costBounds:
          modelCostBounds && extraCost !== null
            ? { low: modelCostBounds.low + extraCost, high: modelCostBounds.high + extraCost }
            : null,
      };
    });
  if (Object.keys(reviews).some((key) => !receipts.has(key)))
    throw new Error('Review does not belong to this comparison.');
  const cases = [...new Set(rows.map((row) => row.case))];
  const humanComplete = rows.length > 0 && rows.every((row) => row.accepted !== null);
  const pairs = (variant) =>
    rows
      .filter((row) => row.variant === variant)
      .map((row) => `${row.case}:${row.repetition}`)
      .sort()
      .join('|');
  const matched = cases.length > 0 && pairs(baseline) === pairs(candidate);
  const complete =
    !comparison.activeTrial &&
    matched &&
    !comparison.interruptions?.length &&
    JSON.stringify([...(comparison.plan?.cases ?? [])].sort()) ===
      JSON.stringify([...cases].sort()) &&
    Number.isInteger(comparison.plan?.repeat) &&
    comparison.plan.repeat > 0 &&
    rows.length === cases.length * comparison.plan.repeat * 2 &&
    rows.every(
      (row) =>
        typeof row.oraclePassed === 'boolean' &&
        row.receipt &&
        measured(row.elapsedMs) &&
        Number.isInteger(row.repetition) &&
        row.repetition >= 1 &&
        row.repetition <= comparison.plan.repeat &&
        [row.input, row.output, row.cacheRead, row.totalTokens].every(measured) &&
        row.cacheRead <= row.input &&
        row.totalTokens === row.input + row.output,
    );
  const summary = (variant) => {
    const selected = rows.filter((row) => row.variant === variant);
    const successes = selected.filter((row) => row.oraclePassed).length,
      accepted = selected.filter((row) => row.accepted === true && row.oraclePassed).length;
    const elapsedMs = sum(selected.map((row) => row.elapsedMs)),
      tokens = sum(selected.map((row) => row.totalTokens));
    const estimatedModelCostUsd = sum(selected.map((row) => row.estimatedCostUsd));
    const deliveryMs = sum(selected.map((row) => row.deliveryMs));
    const reviewed = selected.length > 0 && selected.every((row) => row.accepted !== null);
    const totalCostBounds =
      selected.length > 0 && selected.every((row) => row.costBounds)
        ? {
            low: sum(selected.map((row) => row.costBounds.low)),
            high: sum(selected.map((row) => row.costBounds.high)),
          }
        : null;
    return {
      trials: selected.length,
      successes,
      accepted: reviewed ? accepted : null,
      successRate: selected.length ? successes / selected.length : null,
      totalTokens: tokens,
      elapsedMs,
      tokensPerSuccess: successes && tokens !== null ? tokens / successes : null,
      msPerSuccess: successes && elapsedMs !== null ? elapsedMs / successes : null,
      estimatedModelCostUsd,
      totalCostBoundsUsd: totalCostBounds,
      totalCostPerSuccessBoundsUsd:
        totalCostBounds && successes
          ? { low: totalCostBounds.low / successes, high: totalCostBounds.high / successes }
          : null,
      estimatedModelCostPerSuccess:
        successes && estimatedModelCostUsd !== null ? estimatedModelCostUsd / successes : null,
      reviewMinutes: sum(selected.map((row) => row.reviewMinutes)),
      correctionMinutes: sum(selected.map((row) => row.correctionMinutes)),
      msPerAcceptedResult:
        reviewed && accepted && deliveryMs !== null ? deliveryMs / accepted : null,
      msPerAcceptedExecution:
        reviewed && accepted && elapsedMs !== null ? elapsedMs / accepted : null,
      medianMs: quantile(selected.map((row) => row.elapsedMs).filter(measured), 0.5),
      p95Ms:
        selected.length >= 20 && elapsedMs !== null
          ? quantile(selected.map((row) => row.elapsedMs).filter(measured), 0.95)
          : null,
      toolCalls: sum(
        selected.map((row) =>
          row.efficiency?.toolCalls ? sum([0, ...Object.values(row.efficiency.toolCalls)]) : null,
        ),
      ),
      cachedInputTokens: sum(selected.map((row) => row.cacheRead)),
      uncachedInputTokens: sum(
        selected.map((row) =>
          measured(row.input) && measured(row.cacheRead) && row.cacheRead <= row.input
            ? row.input - row.cacheRead
            : null,
        ),
      ),
    };
  };
  const totals = { [baseline]: summary(baseline), [candidate]: summary(candidate) };
  const families = [...new Set(rows.map(familyOf))];
  const familyPass = (variant) =>
    families.filter((family) =>
      rows
        .filter((row) => row.variant === variant && familyOf(row) === family)
        .every((row) => row.oraclePassed && row.accepted === true),
    ).length;
  const qualityBound =
    rows.length && rows.every((row) => row.accepted !== null)
      ? wilson(familyPass(candidate), families.length)[0] -
        wilson(familyPass(baseline), families.length)[1]
      : null;
  let seed = 73191;
  const intervals = {};
  for (const key of [
    'totalTokens',
    'elapsedMs',
    'acceptedExecutionMs',
    'deliveryMs',
    'conservativeTotalCostUsd',
  ]) {
    const samples = [];
    for (
      let i = 0;
      i < 2000 &&
      matched &&
      families.length >= 3 &&
      (key !== 'acceptedExecutionMs' || humanComplete);
      i++
    ) {
      const selected = [];
      for (let n = 0; n < families.length; n++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const family = families[Math.floor((seed / 4294967296) * families.length)];
        selected.push(...rows.filter((row) => familyOf(row) === family));
      }
      const values = [baseline, candidate].map((variant) => {
        const group = selected.filter((row) => row.variant === variant),
          passed = group.filter(
            (row) =>
              row.oraclePassed &&
              (!['acceptedExecutionMs', 'deliveryMs', 'conservativeTotalCostUsd'].includes(key) ||
                !humanComplete ||
                row.accepted === true),
          ).length;
        const total = sum(
          group.map((row) =>
            key === 'conservativeTotalCostUsd'
              ? row.costBounds?.[variant === baseline ? 'low' : 'high']
              : row[key === 'acceptedExecutionMs' ? 'elapsedMs' : key],
          ),
        );
        return passed && total !== null ? total / passed : null;
      });
      const r = reduction(...values);
      if (r !== null) samples.push(r);
    }
    intervals[key] =
      samples.length === 2000
        ? { low: quantile(samples, 0.025), high: quantile(samples, 0.975) }
        : null;
  }
  const publicationBlockers = [];
  if (!complete) publicationBlockers.push('The planned paired matrix or accounting is incomplete.');
  if (cases.length < 50 || families.length < 20)
    publicationBlockers.push(
      'Require at least 50 distinct tasks and 20 independent source families for the product claim gate.',
    );
  if (
    !rows.every((row) => row.split === 'holdout') ||
    protocol.phase !== 'confirmation' ||
    !protocol.frozenBeforeRun
  )
    publicationBlockers.push('A frozen, held-out confirmation run is required.');
  if (!rows.every((row) => row.accepted !== null))
    publicationBlockers.push(
      'Independent quality acceptance of the original patches is incomplete.',
    );
  if (qualityBound === null || qualityBound < -0.02)
    publicationBlockers.push(
      'Quality uncertainty does not rule out a two-percentage-point regression; this is a reporting tolerance, not a guarantee.',
    );
  if (
    !Object.entries(intervals).some(
      ([key, interval]) =>
        ['acceptedExecutionMs', 'conservativeTotalCostUsd'].includes(key) && interval?.low >= 10,
    )
  )
    publicationBlockers.push(
      'No measured time or conservatively estimated total-cost improvement with a lower confidence bound of at least 10%.',
    );
  if (!protocol.replicated || !protocol.resourceLimits || !protocol.cachePolicy)
    publicationBlockers.push('Replication, resource and cache conditions must be recorded.');
  if (rows.some((row) => row.costBounds === null))
    publicationBlockers.push(
      'Complete model and auxiliary API-equivalent cost bounds are required.',
    );
  publicationBlockers.push(
    ...(rows.some(
      (row) =>
        row.helperCostUsd === null ||
        row.fallbackCostUsd === null ||
        row.correctionCostUsd === null,
    )
      ? ['Helper, fallback or correction costs are incomplete.']
      : []),
  );
  return {
    version: 1,
    baseline,
    candidate,
    matched,
    complete,
    distinctTasks: cases.length,
    independentFamilies: families.length,
    totals,
    reductions: {
      tokensPerSuccess: reduction(
        totals[baseline].tokensPerSuccess,
        totals[candidate].tokensPerSuccess,
      ),
      msPerSuccess: reduction(totals[baseline].msPerSuccess, totals[candidate].msPerSuccess),
      estimatedModelCostPerSuccess: reduction(
        totals[baseline].estimatedModelCostPerSuccess,
        totals[candidate].estimatedModelCostPerSuccess,
      ),
      conservativeTotalCostPerSuccess: reduction(
        totals[baseline].totalCostPerSuccessBoundsUsd?.low,
        totals[candidate].totalCostPerSuccessBoundsUsd?.high,
      ),
    },
    intervals,
    quality: { conservativeFamilySuccessDifferenceLowerBound: qualityBound },
    publication: {
      scope: 'agent-execution',
      eligible: publicationBlockers.length === 0,
      blockers: publicationBlockers,
    },
    sourceSha256: createHash('sha256').update(JSON.stringify(comparison)).digest('hex'),
    limitations:
      'All completed and failed attempts remain in totals. The claim gate concerns agent execution; human review and correction time are optional, separate delivery measurements. Independent acceptance assesses the original patch before corrections. Cost uses explicit API-equivalent prices, not subscription billing or quota. When cumulative usage cannot identify long-context request tiers, costs are bounded and the improvement uses baseline low versus candidate high. Cache-write prices must describe an incremental charge when writes are already in input. No human acceptance is inferred from agent claims or tests. Related seeded defects share one source-family cluster. p95 is omitted below 20 measured trials. This report never authorizes publication.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, options] = process.argv.slice(2);
  if (!input || !output)
    throw new Error('Usage: impact-report.mjs comparison.json report.json [options.json]');
  const report = impactReport(
    JSON.parse(await readFile(input, 'utf8')),
    options ? JSON.parse(await readFile(options, 'utf8')) : {},
  );
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      { output, reductions: report.reductions, publication: report.publication },
      null,
      2,
    ),
  );
}
