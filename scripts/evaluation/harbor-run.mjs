import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assemblePrompt } from '../../apps/desktop/src/lib/skills/context-assembler.ts';
import { resolveTaskGuidelines } from '../../apps/desktop/src/lib/skills/task-context.ts';
import { effortPrompt } from '../../apps/desktop/src/lib/task-effort.ts';
import { aggregateAttempts, reconcileProviderUsage } from './attempts.mjs';
import { experimentEnvironment } from './experiments.mjs';
import { prepareProviderMeter } from './provider-meter.mjs';

export function externalSpec(input) {
  if (
    !['direct', 'jackalope'].includes(input.variant) ||
    !['codex', 'claude', 'opencode', 'antigravity'].includes(input.agent) ||
    typeof input.model !== 'string' ||
    !input.model.trim() ||
    typeof input.instruction !== 'string' ||
    !input.instruction.trim() ||
    typeof input.workspace !== 'string' ||
    !path.isAbsolute(input.workspace) ||
    input.workspace === path.parse(input.workspace).root ||
    !Number.isInteger(input.seconds) ||
    input.seconds < 30 ||
    input.seconds > 1800 ||
    !Number.isInteger(input.tokens) ||
    input.tokens < 1000 ||
    input.tokens > 10_000_000
  )
    throw new Error('Invalid external benchmark configuration.');
  if (input.jevQuestions && input.variant !== 'jackalope')
    throw new Error('Jev assistance is available only in the Jackalope arm.');
  return {
    id: input.id,
    externalWorkspace: input.workspace,
    variant: input.variant === 'direct' ? 'direct' : 'after',
    agent: input.agent,
    model: input.model,
    rawPrompt: input.instruction,
    prompt:
      input.variant === 'direct'
        ? input.instruction
        : [
            assemblePrompt({
              rawPrompt: input.instruction,
              selectedSkillIds: resolveTaskGuidelines(input.instruction, undefined),
              executionMode: 'current',
            }).assembledPrompt,
            effortPrompt('balanced'),
          ].join('\n\n'),
    effort: 'balanced',
    seconds: input.seconds,
    tokens: input.tokens,
    learningMode: 'local',
  };
}

export async function runExternal(inputPath, output, binary) {
  if (!binary || !path.isAbsolute(binary))
    throw new Error('Supply an absolute native test binary.');
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const spec = externalSpec(input);
  await mkdir(output, { recursive: true });
  const specPath = path.join(output, 'request.json');
  await writeFile(specPath, JSON.stringify(spec), { flag: 'wx', mode: 0o600 });
  const meter =
    input.providerMeter === 'deepseek'
      ? await prepareProviderMeter(path.join(output, 'provider-profile'), spec.model)
      : null;
  let execution;
  let provider = null;
  const began = performance.now();
  try {
    execution = await new Promise((resolve, reject) => {
      const env = {
        ...(meter?.env ?? process.env),
        ...experimentEnvironment({}),
        JACKALOPE_QUALITY_SPEC: specPath,
        JACKALOPE_EXTERNAL_WORKSPACE: spec.externalWorkspace,
        JACKALOPE_JEV_QUESTIONS: input.jevQuestions ? 'on' : 'off',
        RUST_TEST_THREADS: '1',
      };
      if (!input.jevQuestions) delete env.JACKALOPE_JEV_TEST_KEY;
      const child = spawn(
        binary,
        [
          'commands::coordination::quality_trial::installed_quality_trial',
          '--ignored',
          '--exact',
          '--nocapture',
        ],
        { env, cwd: spec.externalWorkspace, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout = (stdout + chunk).slice(-200_000);
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-32_000);
      });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
  } finally {
    if (meter) provider = await meter.close();
  }
  const elapsedMs = performance.now() - began;
  await writeFile(path.join(output, 'native.log'), `${execution.stdout}\n${execution.stderr}`);
  const receiptPath = /Quality receipt: ([^\r\n]+)/.exec(execution.stdout)?.[1];
  let receipt = null;
  if (receiptPath) {
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    await copyFile(receiptPath, path.join(output, 'native-receipt.json'));
    if (spec.variant === 'direct') {
      await copyFile(
        path.join(path.dirname(spec.externalWorkspace), 'direct.jsonl'),
        path.join(output, 'trajectory.jsonl'),
      ).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    if (input.agent === 'opencode' && receipt.run?.sessionId) {
      const exported = await promisify(execFile)('opencode', ['export', receipt.run.sessionId], {
        env: meter?.env ?? process.env,
        cwd: spec.externalWorkspace,
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      JSON.parse(exported.stdout);
      await writeFile(path.join(output, 'session.json'), exported.stdout, { mode: 0o600 });
    }
  }
  const accounting = aggregateAttempts(receipt);
  const reconciled = reconcileProviderUsage(accounting, provider);
  const report = {
    version: 1,
    variant: input.variant,
    agent: input.agent,
    model: input.model,
    elapsedMs,
    nativeElapsedMs: receipt?.elapsedMs ?? null,
    processCode: execution.code,
    signal: execution.signal,
    launchError: receipt?.launchError ?? null,
    status: receipt?.run?.status ?? null,
    budgetStopped: receipt?.budgetStopped ?? null,
    provider,
    usage: reconciled.nativeComplete ? reconciled.usage : accounting.usage,
    accountingComplete: reconciled.nativeComplete,
    helperCostUsd: accounting.helperCostUsd,
    efficiency: accounting.efficiency,
    accepted: null,
    limitations:
      'External verifier owns grading. First attempt in a fresh container, current-directory execution through production runtime. No UI assessment, managed plan, worktree merge, human acceptance or correction-time measurement. Reported token budgets are delayed, not billing caps.',
  };
  await writeFile(path.join(output, 'jackalope-result.json'), JSON.stringify(report, null, 2));
  if (execution.code !== 0 || !receipt)
    throw new Error('Native evaluation failed; inspect native.log.');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runExternal(process.argv[2], process.argv[3], process.env.JACKALOPE_QUALITY_BINARY);
}
