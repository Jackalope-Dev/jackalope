import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { impactReport } from './impact-report.mjs';

export function publicImpact(comparison, options) {
  const { id, title, detail, labels, ...reportOptions } = options;
  if (!/^[a-z0-9-]+$/.test(id) || !title?.trim() || !detail?.trim() || !labels)
    throw new Error('Public experiments require an ID, title, detail and variant labels.');
  const report = impactReport(comparison, reportOptions);
  const variants = [report.baseline, report.candidate];
  const trials = comparison.trials.filter((row) => variants.includes(row.variant));
  return {
    id,
    title,
    detail,
    labels,
    report,
    configuration: {
      agent: comparison.agent,
      model: comparison.model,
      cliVersion: comparison.cliVersion,
      models: comparison.plan.models ?? null,
      experiments: comparison.plan.experiments ?? null,
      efforts: comparison.efforts,
      speeds: comparison.speeds,
      seconds: comparison.seconds,
      tokens: comparison.tokens,
      repeat: comparison.plan.repeat,
      orderSeed: comparison.plan.orderSeed ?? null,
      suiteSha256: comparison.plan.suiteSha256 ?? null,
      frozenPromptBaselineRevision: trials.some((row) => row.variant === 'before')
        ? comparison.baselineRevision
        : null,
      executableHashes: comparison.executableHashes,
      pricing: reportOptions.pricing ?? null,
      protocol: reportOptions.protocol ?? null,
      interruptedAttempts: comparison.interruptions?.length ?? 0,
      activeTrialRecorded: !!comparison.activeTrial,
      stoppedEarly: !!comparison.stopReason,
    },
    trialMeasurements: trials.map((row) => ({
      trialId: createHash('sha256')
        .update(
          row.receipt ?? `${report.sourceSha256}:${row.case}:${row.variant}:${row.repetition}`,
        )
        .digest('hex'),
      case: row.case,
      variant: row.variant,
      repetition: row.repetition,
      model: row.model ?? comparison.model,
      split: row.split,
      category: row.category,
      oraclePassed: row.oraclePassed,
      behavioralOraclePassed: row.behavioralOraclePassed,
      budgetStopped: row.budgetStopped,
      budgetExceeded: row.budgetExceeded ?? row.budgetStopped,
      processExit: row.processExit,
      processTimeout: row.processTimeout,
      status: row.status,
      errorRecorded: !!row.error || !!row.launchError,
      elapsedMs: row.elapsedMs,
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      cacheWrite: row.cacheWrite,
      totalTokens: row.totalTokens,
      agentUsage: row.agentUsage ?? null,
      helperUsage: row.helperUsage ?? null,
      helperCostUsd: row.helperCostUsd ?? null,
      helperAccountingComplete: row.helperAccountingComplete ?? false,
      promptBytes: row.promptBytes,
      attempts: row.attempts,
      toolCalls: row.efficiency?.toolCalls ?? null,
      verificationCalls: row.efficiency?.verificationCalls ?? null,
      verificationReuses: row.efficiency?.verificationReuses ?? null,
      fixtureToolCalls: row.fixtureToolCalls ?? null,
      source: row.source
        ? {
            repository: row.source.repository,
            revision: row.source.revision,
            path: row.source.path,
            sha256: row.source.sha256,
            kind: row.source.kind,
            family: row.source.family,
          }
        : null,
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, options] = process.argv.slice(2);
  if (!input || !output || !options)
    throw new Error('Usage: impact-export.mjs comparison.json public-experiment.json options.json');
  const data = publicImpact(
    JSON.parse(await readFile(input, 'utf8')),
    JSON.parse(await readFile(options, 'utf8')),
  );
  await writeFile(output, `${JSON.stringify(data, null, 2)}\n`);
  console.log(JSON.stringify({ output, publication: data.report.publication }));
}
