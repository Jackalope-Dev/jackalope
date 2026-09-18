import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registry, registrySha256 } from '../../../scripts/evaluation/experiments.mjs';
import { qualityCases } from '../../../scripts/evaluation/quality-cases.mjs';
import { qualitySummary } from '../../../scripts/evaluation/quality-metrics.mjs';
import { evaluationReadiness, providerStopReason } from '../../../scripts/evaluation/readiness.mjs';
import { assemblePrompt } from '../src/lib/skills/context-assembler.ts';
import { resolveTaskGuidelines } from '../src/lib/skills/task-context.ts';
import { effortPrompt } from '../src/lib/task-effort.ts';

test('provider quota stops further evaluations without disguising ordinary failures', () => {
  assert.equal(providerStopReason([]), null);
  assert.equal(
    providerStopReason([{ status: 'failed', error: 'check failed', quotaFailure: null }]),
    null,
  );
  assert.match(
    providerStopReason([{ quotaFailure: { modelOnly: false } }, { status: 'review' }]),
    /Remaining trials were not launched/,
  );
});

test('prompt baselines pin effort and selected cases without launching providers', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'jackalope-prompt-baseline-'));
  const filename = path.join(output, 'prompts.json');
  const script = fileURLToPath(new URL('../../../scripts/evaluation/quality.mjs', import.meta.url));
  const invoke = (args) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });
  const saved = invoke([
    '--effort=balanced',
    '--cases=copy-edit',
    `--save-prompts=${filename}`,
    '--revision=fixture-source',
  ]);
  assert.equal(saved.status, 0, saved.stderr);
  const snapshot = JSON.parse(readFileSync(filename, 'utf8'));
  assert.equal(snapshot.effort, 'balanced');
  const experimental = invoke([
    '--effort=balanced',
    '--cases=copy-edit',
    '--after-task-approach=scoped',
    `--save-prompts=${filename}`,
  ]);
  assert.notEqual(experimental.status, 0);
  assert.match(experimental.stderr, /Experimental prompts/);
  assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')), snapshot);
  assert.deepEqual(Object.keys(snapshot.prompts), ['copy-edit']);
  const options = [
    '--variants=control,after',
    '--cases=copy-edit',
    `--control-prompts=${filename}`,
  ];
  assert.equal(invoke([...options, '--effort=balanced']).status, 0);
  assert.notEqual(invoke([...options, '--effort=quick']).status, 0);
  assert.notEqual(
    invoke([
      ...options.filter((arg) => !arg.startsWith('--cases=')),
      '--effort=balanced',
      '--cases=csv-cell',
    ]).status,
    0,
  );
});

test('resuming completed trials launches no workers and rejects changed configuration', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'jackalope-quality-resume-'));
  const executable = path.join(output, 'not-an-agent.exe');
  writeFileSync(executable, 'A completed comparison must never execute this file.');
  const hash = createHash('sha256').update(readFileSync(executable)).digest('hex');
  const baseline = JSON.parse(
    readFileSync(
      new URL('../../../scripts/evaluation/baselines/f0b95b3-prompts.json', import.meta.url),
    ),
  );
  const fixture = qualityCases[0];
  const after = [
    assemblePrompt({
      rawPrompt: fixture.prompt,
      selectedSkillIds: resolveTaskGuidelines(fixture.prompt, undefined),
      executionMode: 'isolated',
    }).assembledPrompt,
    effortPrompt(),
  ].join('\n\n');
  const comparison = path.join(output, 'comparison.json');
  const saved = {
    plan: {
      experimentRegistry: { version: registry.version, sha256: registrySha256 },
      cases: [fixture.id],
      variants: ['before', 'after'],
      repeat: 1,
      compactPrompts: false,
      providerMeter: null,
      suiteSha256: createHash('sha256')
        .update(JSON.stringify([fixture]))
        .digest('hex'),
    },
    baselineRevision: baseline.revision,
    agent: 'codex',
    model: 'fixture',
    seconds: 30,
    tokens: 1000,
    cliVersion:
      spawnSync('codex', ['--version'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() ??
      null,
    executableHashes: { before: hash, after: hash },
    trials: ['before', 'after'].map((variant) => ({
      case: fixture.id,
      variant,
      repetition: 1,
      oraclePassed: false,
      totalTokens: 20,
    })),
  };
  writeFileSync(comparison, JSON.stringify(saved));
  for (const variant of ['before', 'after'])
    writeFileSync(
      path.join(output, `${fixture.id}-1-${variant}.json`),
      JSON.stringify({
        ...fixture,
        prompt: variant === 'before' ? baseline.prompts[fixture.id] : after,
        variant,
        agent: 'codex',
        model: 'fixture',
        seconds: 30,
        tokens: 1000,
      }),
    );
  const run = (model, extra = []) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../../scripts/evaluation/quality.mjs', import.meta.url)),
        '--execute',
        '--resume',
        `--model=${model}`,
        '--cases=copy-edit',
        '--repeat=1',
        '--seconds=30',
        '--tokens=1000',
        `--before=${executable}`,
        `--after=${executable}`,
        `--output=${output}`,
        ...extra,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
  const resumed = run('fixture');
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(readFileSync(comparison, 'utf8'), JSON.stringify(saved));
  const failed = run('fixture', ['--require-pass']);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /oracle did not pass/);
  assert.equal(readFileSync(comparison, 'utf8'), JSON.stringify(saved));
  const passed = {
    ...saved,
    trials: saved.trials.map((trial) => ({
      ...trial,
      receipt: 'retained.json',
      processExit: 0,
      status: 'review',
      budgetStopped: false,
      oraclePassed: true,
    })),
  };
  writeFileSync(comparison, JSON.stringify(passed));
  const accepted = run('fixture', ['--require-pass']);
  assert.equal(accepted.status, 0, accepted.stderr);
  const changed = run('different-model');
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /Resume requires/);
  const stopFile = path.join(output, 'stop');
  writeFileSync(stopFile, 'Stop between matched repetitions.');
  writeFileSync(
    comparison,
    JSON.stringify({
      ...saved,
      trials: [],
      activeTrial: { case: fixture.id, variant: 'after', repetition: 1 },
    }),
  );
  const stopped = run('fixture', [`--stop-file=${stopFile}`]);
  assert.equal(stopped.status, 0, stopped.stderr);
  const interrupted = JSON.parse(readFileSync(comparison, 'utf8'));
  assert.deepEqual(interrupted.trials, []);
  assert.equal(interrupted.activeTrial, null);
  assert.equal(interrupted.interruptions.length, 1);
  assert.match(interrupted.interruptions[0].reason, /usage is unknown/);
  assert.match(interrupted.stopReason, /Unrun trials remain missing/);
});

test('readiness requires every requested trial to complete within budget and pass its oracle', () => {
  const expected = [{ case: 'example', mode: 'staged', repetition: 1 }];
  const passed = {
    ...expected[0],
    receipt: 'receipt.json',
    processExit: 0,
    completed: true,
    budgetStopped: false,
    oraclePassed: true,
  };
  assert.equal(evaluationReadiness([passed], expected).passed, true);
  for (const change of [
    { completed: false },
    { oraclePassed: false },
    { budgetStopped: true },
    { budgetStopped: null },
    { processExit: 1 },
    { processTimeout: true },
    { error: 'unreadable receipt' },
    { launchError: 'provider unavailable' },
    { receipt: null },
  ])
    assert.equal(
      evaluationReadiness([{ ...passed, ...change }], expected).passed,
      false,
      JSON.stringify(change),
    );
  assert.equal(evaluationReadiness([], expected).passed, false);
  assert.equal(evaluationReadiness([passed, passed], expected).passed, false);
  assert.equal(evaluationReadiness([passed], [{ ...expected[0], repetition: 2 }]).passed, false);
  assert.equal(evaluationReadiness([], []).passed, false);
});

test('quality totals include failed attempts and keep missing usage unknown', () => {
  const rows = [
    { variant: 'before', oraclePassed: true, totalTokens: 100 },
    { variant: 'before', oraclePassed: false, totalTokens: 50 },
    { variant: 'after', oraclePassed: true, totalTokens: null },
  ];
  const summary = qualitySummary(rows);
  assert.equal(summary.before.tokensPerOracleSuccess, 150);
  assert.equal(summary.after.totalTokens, null);
  assert.equal(summary.after.usageCoverage, 0);
  assert.equal(qualitySummary([]).before.totalTokens, null);
  assert.equal(
    qualitySummary([{ variant: 'before', oraclePassed: false, totalTokens: 20 }]).before
      .tokensPerOracleSuccess,
    null,
  );
});

test('quality latency includes failures and reports partial measurements without inventing zeros', () => {
  const summary = qualitySummary([
    {
      variant: 'after',
      oraclePassed: true,
      elapsedMs: 100,
      efficiency: { firstActivityMs: 10, timings: { capacity: { totalMs: 5 } } },
    },
    {
      variant: 'after',
      oraclePassed: false,
      elapsedMs: 300,
      efficiency: { firstActivityMs: 30, timings: { capacity: { totalMs: 15 } } },
    },
    { variant: 'after', oraclePassed: true, elapsedMs: null },
  ]).after;
  assert.deepEqual(summary.elapsedMs, { coverage: 2, total: null, p50: 100, p95: 300 });
  assert.equal(summary.msPerOracleSuccess, null);
  assert.deepEqual(summary.firstActivityMs, { coverage: 2, total: null, p50: 10, p95: 30 });
  assert.deepEqual(summary.timings.capacity, { coverage: 2, total: null, p50: 5, p95: 15 });
  const complete = qualitySummary([
    { variant: 'after', oraclePassed: true, elapsedMs: 100 },
    { variant: 'after', oraclePassed: false, elapsedMs: 300 },
  ]).after;
  assert.equal(complete.msPerOracleSuccess, 400);
  assert.deepEqual(qualitySummary([]).after.elapsedMs, {
    coverage: 0,
    total: null,
    p50: null,
    p95: null,
  });
});

test('quality oracles reject initial defects, accept solutions, and detect unrelated edits', () => {
  for (const fixture of qualityCases) {
    const root = mkdtempSync(path.join(tmpdir(), 'jackalope-quality-oracle-'));
    const repo = path.join(root, 'repo');
    mkdirSync(repo);
    for (const [name, contents] of Object.entries(fixture.files))
      writeFileSync(path.join(repo, name), contents);
    const oracle = path.join(root, 'oracle.cjs');
    writeFileSync(oracle, fixture.oracle);
    const run = () =>
      spawnSync(process.execPath, [oracle, repo], { encoding: 'utf8', windowsHide: true });
    assert.notEqual(run().status, 0, `${fixture.id} should initially fail`);
    if (fixture.id === 'copy-edit')
      writeFileSync(
        path.join(repo, 'README.md'),
        fixture.files['README.md'].replace('recieve', 'receive'),
      );
    if (fixture.id === 'design-tokens')
      writeFileSync(
        path.join(repo, 'button.css'),
        fixture.files['button.css']
          .replace('#2060df', 'var(--action-bg)')
          .replace('#ffffff', 'var(--action-fg)')
          .replace('#174cb3', 'var(--action-border)'),
      );
    if (fixture.id === 'scheduler-fix')
      writeFileSync(
        path.join(repo, 'scheduler.mjs'),
        'export function readyTasks(tasks, completed) { const done = new Set(completed); return tasks.filter(t=>!done.has(t.id)&&t.dependsOn.every(d=>done.has(d))).toSorted((a,b)=>(b.priority??0)-(a.priority??0)).map(t=>t.id); }',
      );
    const solutions = {
      'query-values': 'export const solve=(query,key)=>new URLSearchParams(query).getAll(key);',
      'stable-dedup':
        'export const solve=items=>{const seen=new Set();return items.filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;});};',
      'retry-delay':
        'export const solve=(attempt,base,cap)=>{if(![attempt,base,cap].every(v=>typeof v === "number" && Number.isFinite(v)&&v>=0)||!Number.isInteger(attempt))throw new RangeError();return base===0?0:Math.min(cap,base*2**attempt);};',
      'csv-cell': `export const solve=value=>{const s=String(value);return /[,"\\r\\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};`,
      'group-records':
        'export const solve=records=>{const result=new Map();for(const r of records){if(!result.has(r.group))result.set(r.group,[]);result.get(r.group).push(r);}return result;};',
      'page-window':
        'export const solve=(items,page,size)=>{if(!Number.isSafeInteger(page)||!Number.isSafeInteger(size)||page<=0||size<=0)throw new RangeError();return items.slice((page-1)*size,page*size);};',
    };
    if (solutions[fixture.id]) writeFileSync(path.join(repo, 'index.mjs'), solutions[fixture.id]);
    const good = run();
    assert.equal(good.status, 0, `${fixture.id}: ${good.stderr}`);
    writeFileSync(path.join(repo, 'unrequested.txt'), 'Extra work');
    assert.notEqual(run().status, 0, `${fixture.id} should reject scope expansion`);
  }
});
