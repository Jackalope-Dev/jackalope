import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePrompt } from '../../apps/desktop/src/lib/skills/context-assembler.ts';
import { resolveTaskGuidelines } from '../../apps/desktop/src/lib/skills/task-context.ts';
import { effortPrompt } from '../../apps/desktop/src/lib/task-effort.ts';
import { runUsageBreakdown } from '../../apps/desktop/src/lib/usage-breakdown.ts';
import { aggregateAttempts, reconcileProviderUsage } from './attempts.mjs';
import {
  experimentEnvironment,
  experimentOptions,
  registry,
  registrySha256,
  variantOrder,
} from './experiments.mjs';
import {
  historyExperimentEnvironment,
  historyExperimentIdentity,
  historyExperimentReceipt,
} from './history-experiment.mjs';
import { prepareProviderMeter } from './provider-meter.mjs';
import { qualityCases } from './quality-cases.mjs';
import { qualitySummary } from './quality-metrics.mjs';
import { providerStopReason, requireEvaluationPass } from './readiness.mjs';
import { checkScope } from './scope.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const value = (name, fallback) =>
  args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const suitePath = value('--suite', null);
const cases = suitePath
  ? JSON.parse(await readFile(path.resolve(suitePath), 'utf8')).cases
  : qualityCases;
if (
  !Array.isArray(cases) ||
  !cases.length ||
  cases.length > 1000 ||
  new Set(cases.map((c) => c.id)).size !== cases.length ||
  cases.some(
    (c) =>
      !/^[a-z0-9-]+$/.test(c.id) ||
      !c.prompt ||
      (c.followups !== undefined &&
        (!Array.isArray(c.followups) ||
          c.followups.length > 5 ||
          c.followups.some((prompt) => typeof prompt !== 'string' || !prompt.trim()))) ||
      typeof c.oracle !== 'string' ||
      (c.allowedFiles !== undefined &&
        (!Array.isArray(c.allowedFiles) ||
          c.allowedFiles.some(
            (name) =>
              typeof name !== 'string' ||
              /(^[A-Za-z]:|^[/\\]|(^|[/\\])\.\.?([/\\]|$)|(^|[/\\])\.git([/\\]|$))/.test(name),
          ))) ||
      !c.files ||
      Object.entries(c.files).some(
        ([name, content]) =>
          /(^[A-Za-z]:|^[/\\]|(^|[/\\])\.\.?([/\\]|$)|(^|[/\\])\.git([/\\]|$))/.test(name) ||
          typeof content !== 'string',
      ),
  )
)
  throw new Error(
    'Invalid evaluation suite: provide unique IDs, prompts, oracles and relative fixture files.',
  );
const selected = value(
  '--cases',
  suitePath ? cases.map((c) => c.id).join(',') : 'copy-edit,design-tokens,scheduler-fix',
).split(',');
const variants = value('--variants', 'before,after').split(',');
const compactPrompts = args.includes('--compact-prompts');
const stopOnFailure = args.includes('--stop-on-failure');
const experiments = experimentOptions(args, variants);
const orderSeed = value('--order-seed', null);
for (const variant of variants) {
  if (compactPrompts && variant === 'after') experiments[variant]['context-style'] = 'compact';
  experimentEnvironment(experiments[variant]);
}
const experimental = args.some((arg) =>
  variants.some((variant) =>
    Object.keys(registry.fields).some((name) => arg.startsWith(`--${variant}-${name}=`)),
  ),
);
const requestedEffort = value('--effort', null);
const efforts = Object.fromEntries(
  variants.map((v) => [v, value(`--${v}-effort`, requestedEffort)]),
);
const speeds = Object.fromEntries(
  variants.map((variant) => [
    variant,
    value(`--${variant}-codex-speed`, value('--codex-speed', null)),
  ]),
);
const repeat = Number(value('--repeat', '3'));
const seconds = Number(value('--seconds', '180'));
const tokens = Number(value('--tokens', '250000'));
const model = value('--model', '');
const models = Object.fromEntries(variants.map((v) => [v, value(`--${v}-model`, model)]));
const agent = value('--agent', 'codex');
const providerMeter = value('--provider-meter', null);
if (
  providerMeter !== null &&
  (providerMeter !== 'deepseek' ||
    agent !== 'opencode' ||
    Object.values(models).some((model) => !/^deepseek\/[\w.-]+$/.test(model)))
)
  throw new Error(
    'Provider metering currently supports explicit DeepSeek models through OpenCode only.',
  );
const controlPromptsPath = value('--control-prompts', null);
const controlPrompts = controlPromptsPath
  ? JSON.parse(await readFile(path.resolve(controlPromptsPath), 'utf8'))
  : null;
if (
  controlPrompts &&
  (!variants.includes('control') ||
    !controlPrompts.revision ||
    controlPrompts.effort !== efforts.control ||
    selected.some(
      (id) =>
        typeof controlPrompts.prompts?.[id] !== 'string' || !controlPrompts.prompts[id].trim(),
    ))
)
  throw new Error(
    'Frozen control prompts require a revision, matching explicit effort and every selected case.',
  );
const controlPromptsHash = controlPrompts
  ? createHash('sha256').update(JSON.stringify(controlPrompts)).digest('hex')
  : null;
const binaries = Object.fromEntries(
  variants.map((v) => [
    v,
    value(
      v === 'before' ? '--before' : v === 'control' ? '--control' : '--after',
      v === 'control' ? value('--after', '') : '',
    ),
  ]),
);
if (
  (suitePath && variants.includes('before')) ||
  variants.length < 1 ||
  variants.length > 4 ||
  new Set(variants).size !== variants.length ||
  (args.includes('--execute') && Object.values(models).some((model) => !model.trim())) ||
  variants.some((v) => !['before', 'control', 'after', 'direct'].includes(v)) ||
  Object.values(efforts).some(
    (e) => e !== null && !['quick', 'balanced', 'thorough'].includes(e),
  ) ||
  Object.values(speeds).some(
    (speed) => speed !== null && (agent !== 'codex' || !['standard', 'fast'].includes(speed)),
  ) ||
  selected.some((id) => !cases.some((c) => c.id === id)) ||
  (variants.includes('direct') &&
    cases.some((c) => selected.includes(c.id) && c.followups?.length)) ||
  !Number.isInteger(repeat) ||
  repeat < 1 ||
  repeat > 10 ||
  !Number.isInteger(seconds) ||
  seconds < 30 ||
  seconds > 1800 ||
  !Number.isInteger(tokens) ||
  tokens < 1000 ||
  tokens > 1000000 ||
  !['codex', 'claude', 'antigravity', 'opencode'].includes(agent)
)
  throw new Error('Invalid quality evaluation options.');
const historyIdentity = await historyExperimentIdentity(agent, experiments);
if (!args.includes('--execute')) {
  if (value('--save-prompts', null)) {
    if (experimental)
      throw new Error(
        'Experimental prompts are retained in trial specs; do not export them as a legacy prompt baseline.',
      );
    if (!requestedEffort) throw new Error('Pin --effort when saving a prompt baseline.');
    const prompts = Object.fromEntries(
      selected.map((id) => [
        id,
        [
          assemblePrompt({
            version: compactPrompts ? 3 : 2,
            rawPrompt: cases.find((c) => c.id === id).prompt,
            selectedSkillIds: resolveTaskGuidelines(
              cases.find((c) => c.id === id).prompt,
              undefined,
            ),
            executionMode: 'isolated',
          }).assembledPrompt,
          effortPrompt(requestedEffort, compactPrompts),
        ].join('\n\n'),
      ]),
    );
    await writeFile(
      path.resolve(value('--save-prompts')),
      `${JSON.stringify({ revision: value('--revision', 'working-tree'), effort: requestedEffort, prompts }, null, 2)}\n`,
    );
  }
  console.log(
    JSON.stringify(
      {
        experimentRegistry: { version: registry.version, sha256: registrySha256 },
        cases: selected,
        variants: Object.keys(binaries),
        repeat,
        efforts,
        speeds,
        seconds,
        tokens,
        agent,
        model: model || 'Required for execution',
        controlPromptsHash,
        experiments,
        models,
        orderSeed,
        instructions:
          'Pass --execute --model=<model> --after=<native test executable> --variants=direct,after --effort=balanced for a matched direct-CLI comparison. Legacy before requires --before=<baseline executable>. Trials use installed accounts; reported token limits are not hard spending caps.',
      },
      null,
      2,
    ),
  );
} else {
  if (!model || Object.values(binaries).some((p) => !path.isAbsolute(p)))
    throw new Error('Pin a model and supply absolute before/after native test executable paths.');
  const baseline = JSON.parse(
    await readFile(new URL('./baselines/f0b95b3-prompts.json', import.meta.url), 'utf8'),
  );
  const output = path.resolve(
    value(
      '--output',
      path.join(root, 'scratch/quality-evaluation', new Date().toISOString().replaceAll(':', '-')),
    ),
  );
  await mkdir(output, { recursive: true });
  const executableHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(binaries).map(async ([name, filename]) => [
        name,
        createHash('sha256')
          .update(await readFile(filename))
          .digest('hex'),
      ]),
    ),
  );
  const cliVersion =
    spawnSync(agent === 'antigravity' ? 'agy' : agent, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout?.trim() ?? null;
  const environment = {
    runnerNode: process.version,
    fixtureNode:
      spawnSync('node', ['--version'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() ??
      null,
    platform: process.platform,
    architecture: process.arch,
    osRelease: release(),
  };
  const comparisonPath = path.join(output, 'comparison.json');
  const plan = {
    experimentRegistry: { version: registry.version, sha256: registrySha256 },
    cases: selected,
    variants,
    repeat,
    compactPrompts,
    providerMeter,
    ...(stopOnFailure ? { stopOnFailure: true } : {}),
    ...(experimental ? { experiments } : {}),
    ...(historyIdentity ? { historyCompaction: historyIdentity } : {}),
    ...(orderSeed !== null ? { orderSeed } : {}),
    ...(Object.values(models).some((m) => m !== model) ? { models } : {}),
    suiteSha256: createHash('sha256')
      .update(JSON.stringify(cases.filter((c) => selected.includes(c.id))))
      .digest('hex'),
  };
  let saved = null;
  try {
    saved = JSON.parse(await readFile(comparisonPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (saved && !args.includes('--resume'))
    throw new Error(
      'This output already contains results. Use --resume or choose another directory.',
    );
  if (args.includes('--resume') && !saved) throw new Error('No saved comparison to resume.');
  if (
    saved &&
    (saved.agent !== agent ||
      JSON.stringify(saved.plan) !== JSON.stringify(plan) ||
      saved.baselineRevision !== baseline.revision ||
      saved.model !== model ||
      saved.cliVersion !== cliVersion ||
      (saved.environment && JSON.stringify(saved.environment) !== JSON.stringify(environment)) ||
      saved.seconds !== seconds ||
      saved.tokens !== tokens ||
      (saved.controlPromptsHash ?? null) !== controlPromptsHash ||
      JSON.stringify(saved.speeds ?? Object.fromEntries(variants.map((v) => [v, null]))) !==
        JSON.stringify(speeds) ||
      JSON.stringify(saved.efforts ?? Object.fromEntries(variants.map((v) => [v, null]))) !==
        JSON.stringify(efforts) ||
      Object.keys(saved.executableHashes).join() !== variants.join() ||
      Object.keys(binaries).some((name) => saved.executableHashes[name] !== executableHashes[name]))
  )
    throw new Error('Resume requires the same agent, model, CLI, executable hashes and budgets.');
  const trials = saved?.trials ?? [];
  const interruptions = saved?.interruptions ?? [];
  if (saved?.activeTrial)
    interruptions.push({
      ...saved.activeTrial,
      reason: 'Runner ended before saving a trial receipt; usage is unknown.',
    });
  let activeTrial = null;
  let stopReason = null;
  const stopFile = value('--stop-file', null);
  const checkpoint = async () => {
    const summary = qualitySummary(trials, Object.keys(binaries));
    await writeFile(
      `${comparisonPath}.tmp`,
      `${JSON.stringify({ version: 1, plan, baselineRevision: baseline.revision, controlPromptsHash, controlPromptsRevision: controlPrompts?.revision ?? null, executableHashes, cliVersion, environment: saved && !saved.environment ? null : environment, agent, model, efforts, speeds, seconds, tokens, trials, interruptions, activeTrial, stopReason, summary, limitations: 'Authored disposable tasks, not human acceptance or a direct-GUI comparison. Direct uses the installed CLI with matched model and base permissions, without Jackalope injection. Effort requests are pinned when set; other provider configuration and caching are inherited. Include failures; missing usage remains unknown. Summary covers completed trial receipts; separately retained crash interruptions can leave total experiment usage unknown.' }, null, 2)}\n`,
    );
    await rename(`${comparisonPath}.tmp`, comparisonPath);
  };
  if (!saved || saved.activeTrial) await checkpoint();
  pairs: for (const id of selected)
    for (let repetition = 1; repetition <= repeat; repetition++) {
      if (stopFile) {
        const requested = await access(path.resolve(stopFile)).then(
          () => true,
          (error) => {
            if (error.code !== 'ENOENT') throw error;
            return false;
          },
        );
        if (requested) {
          stopReason =
            'Stop file requested an early end between matched case repetitions. Unrun trials remain missing.';
          await checkpoint();
          break pairs;
        }
      }
      const fixture = cases.find((c) => c.id === id);
      const order = variantOrder(variants, id, repetition, orderSeed);
      for (const variant of order) {
        const completed = trials.some(
          (trial) =>
            trial.case === id && trial.variant === variant && trial.repetition === repetition,
        );
        const prompt =
          variant === 'before'
            ? baseline.prompts[id]
            : variant === 'control' && controlPrompts
              ? controlPrompts.prompts[id]
              : variant === 'direct'
                ? (fixture.directPrompt ??
                  fixture.prompt.replace(
                    'through Jackalope computer_verify',
                    'using your permitted shell',
                  ))
                : [
                    assemblePrompt({
                      version:
                        experiments[variant].workflow === 'final'
                          ? 4
                          : compactPrompts && variant === 'after'
                            ? 3
                            : 2,
                      rawPrompt: fixture.prompt,
                      selectedSkillIds: resolveTaskGuidelines(fixture.prompt, undefined),
                      executionMode: 'isolated',
                    }).assembledPrompt,
                    effortPrompt(
                      efforts[variant] ?? undefined,
                      compactPrompts && variant === 'after',
                      experiments[variant]['task-approach'] === 'scoped',
                    ),
                  ].join('\n\n');
        if (!prompt) throw new Error(`Missing frozen baseline for ${id}`);
        const spec = {
          ...fixture,
          rawPrompt: fixture.prompt,
          prompt,
          variant,
          agent,
          model: models[variant],
          seconds,
          tokens,
          ...(efforts[variant] ? { effort: efforts[variant] } : {}),
          ...(speeds[variant] ? { codexSpeed: speeds[variant] } : {}),
        };
        const specPath = path.join(output, `${id}-${repetition}-${variant}.json`);
        if (saved) {
          try {
            const previous = JSON.parse(await readFile(specPath, 'utf8'));
            const expected =
              previous.rawPrompt === undefined
                ? Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'rawPrompt'))
                : spec;
            if (JSON.stringify(previous) !== JSON.stringify(expected))
              throw new Error(
                `The saved ${id} fixture or prompt changed. Use a new output directory.`,
              );
          } catch (error) {
            if (error.code !== 'ENOENT' || completed) throw error;
          }
        }
        if (completed) continue;
        await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
        const historyReceiptPath = specPath.replace(/\.json$/, '.history.jsonl');
        const historyMode = experiments[variant]['history-compaction'];
        const historyEnv = historyExperimentEnvironment(historyMode, historyReceiptPath);
        if (historyMode !== 'off') await writeFile(historyReceiptPath, '', { mode: 0o600 });
        activeTrial = { case: id, variant, repetition, startedAt: new Date().toISOString() };
        await checkpoint();
        console.log(`Quality: ${id}, ${variant}, repetition ${repetition}`);
        const meter = providerMeter
          ? await prepareProviderMeter(
              path.join(output, `${id}-${repetition}-${variant}-provider`),
              models[variant],
            )
          : null;
        let execution,
          providerAccounting = null;
        try {
          execution = await new Promise((resolve) => {
            const child = spawn(
              binaries[variant],
              [
                'commands::coordination::quality_trial::installed_quality_trial',
                '--ignored',
                '--exact',
                '--nocapture',
              ],
              {
                cwd: root,
                windowsHide: true,
                env: {
                  ...(meter?.env ?? process.env),
                  JACKALOPE_QUALITY_SPEC: specPath,
                  RUST_TEST_THREADS: '1',
                  JACKALOPE_CONTEXT_EXPERIMENT:
                    compactPrompts && variant === 'after' ? 'compact' : 'off',
                  ...experimentEnvironment(experiments[variant]),
                  ...historyEnv,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
              },
            );
            let stdout = '',
              stderr = '',
              timedOut = false;
            const timer = setTimeout(
              () => {
                timedOut = true;
                if (process.platform === 'win32' && child.pid)
                  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                    windowsHide: true,
                    stdio: 'ignore',
                  });
                else child.kill('SIGTERM');
              },
              (seconds + 120) * 1000,
            );
            child.stdout.on('data', (chunk) => {
              stdout = (stdout + chunk).slice(-100000);
            });
            child.stderr.on('data', (chunk) => {
              stderr = (stderr + chunk).slice(-16000);
            });
            child.on('error', (error) => {
              clearTimeout(timer);
              resolve({ error: error.message, stdout, stderr });
            });
            child.on('close', (code) => {
              clearTimeout(timer);
              resolve({ code, timedOut, stdout, stderr });
            });
          });
        } finally {
          if (meter) {
            providerAccounting = await meter.close();
            await writeFile(
              path.join(output, `${id}-${repetition}-${variant}.provider.json`),
              `${JSON.stringify(providerAccounting, null, 2)}\n`,
              { mode: 0o600 },
            );
          }
        }
        await writeFile(
          path.join(output, `${id}-${repetition}-${variant}.log`),
          `${execution.stdout}\n${execution.stderr}`,
        );
        const receipt = /Quality receipt: ([^\r\n]+)/.exec(execution.stdout)?.[1];
        let report = null,
          error = execution.error ?? null;
        try {
          if (receipt) report = JSON.parse(await readFile(receipt, 'utf8'));
        } catch (cause) {
          error = String(cause);
        }
        const run = report?.run;
        const scope = await checkScope(fixture, run?.workspace);
        const accounting = aggregateAttempts(report);
        const {
          runs,
          usage,
          efficiency,
          agentUsage,
          agentReportedCostUsd,
          helperUsages,
          helperUsage,
          helperCostUsd,
          helperAccountingComplete,
        } = accounting;
        const reconciled = reconcileProviderUsage(accounting, providerAccounting);
        const nativeAccountingComplete = agent === 'opencode' ? reconciled.nativeComplete : null;
        const measuredUsage = nativeAccountingComplete ? reconciled.usage : usage;
        const budgetExceeded = report
          ? report.budgetStopped === true ||
            report.elapsedMs >= seconds * 1000 ||
            (measuredUsage !== null && measuredUsage.input + measuredUsage.output >= tokens)
          : null;
        trials.push({
          case: id,
          model: models[variant],
          experiments: experiments[variant],
          experimentRegistry: { version: registry.version, sha256: registrySha256 },
          historyCompaction: await historyExperimentReceipt(historyMode, historyReceiptPath),
          source: fixture.source ?? null,
          variant,
          repetition,
          receipt: receipt ?? null,
          processExit: execution.code ?? null,
          processTimeout: execution.timedOut ?? false,
          error,
          oraclePassed:
            execution.code === 0 &&
            scope.passed !== false &&
            budgetExceeded === false &&
            (!(fixture.toolFixture || fixture.toolFixtures?.length) ||
              report?.fixtureToolCalls > 0) &&
            (variant === 'direct' ||
              !fixture.outcomes?.length ||
              fixture.outcomes.every((_, index) =>
                run?.validationSteps?.some((step) =>
                  step.requirements?.some(
                    (item) => item.requirementId === `requirement-${index}` && item.summary?.trim(),
                  ),
                ),
              )) &&
            run?.status === 'review' &&
            report?.oracle?.success === true,
          behavioralOraclePassed: report?.oracle?.success === true,
          scope,
          budgetStopped: report?.budgetStopped ?? null,
          budgetExceeded,
          profileFingerprint: run?.accountBinding
            ? createHash('sha256')
                .update(
                  JSON.stringify([
                    run.accountBinding.adapter,
                    run.accountBinding.profileId,
                    run.accountBinding.directory,
                  ]),
                )
                .digest('hex')
            : null,
          category: fixture.category ?? fixture.id,
          split: fixture.split ?? 'regression',
          effort: efforts[variant],
          codexSpeed: speeds[variant],
          requestedServiceTier: run?.requestedServiceTier ?? null,
          reasoningEffort: run?.reasoningEffort ?? null,
          efficiency,
          mcpUsage: run?.mcpUsage ?? null,
          fixtureToolCalls: report?.fixtureToolCalls ?? null,
          stages: run?.stages ?? [],
          usageBreakdown: runs.length ? runUsageBreakdown(runs, helperUsages) : null,
          agentUsage,
          agentReportedCostUsd,
          providerAccounting,
          nativeAuxiliaryAccountingComplete: nativeAccountingComplete,
          helperUsage,
          helperCostUsd,
          helperAccountingComplete,
          attempts: runs.length,
          accepted: null,
          status: run?.status ?? null,
          launchError: report?.launchError ?? null,
          quotaFailure: runs.some((run) => run.quotaFailure) || false,
          elapsedMs: report?.elapsedMs ?? null,
          promptBytes: report?.promptBytes ?? null,
          input: measuredUsage?.input ?? null,
          output: measuredUsage?.output ?? null,
          cacheRead: measuredUsage?.cacheRead ?? null,
          cacheWrite: measuredUsage?.cacheWrite ?? null,
          totalTokens: measuredUsage ? measuredUsage.input + measuredUsage.output : null,
          answeredQuestions: run?.prompts?.filter((p) => p.status === 'answered').length ?? 0,
        });
        activeTrial = null;
        stopReason = providerStopReason(runs);
        if (!stopReason && stopOnFailure && !trials.at(-1).oraclePassed)
          stopReason =
            'Stopped after a failed trial as requested. The remaining matrix is incomplete; retain all attempts.';
        await checkpoint();
        console.log(JSON.stringify(trials.at(-1)));
        if (stopReason) break pairs;
      }
    }
  console.log(`Quality comparison: ${path.join(output, 'comparison.json')}`);
  if (args.includes('--require-pass'))
    requireEvaluationPass(
      trials,
      selected.flatMap((id) =>
        variants.flatMap((variant) =>
          Array.from({ length: repeat }, (_, index) => ({
            case: id,
            variant,
            repetition: index + 1,
          })),
        ),
      ),
    );
}
