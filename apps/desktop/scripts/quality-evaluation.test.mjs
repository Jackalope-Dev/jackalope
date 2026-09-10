import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { qualityCases } from '../../../scripts/evaluation/quality-cases.mjs';
import { qualitySummary } from '../../../scripts/evaluation/quality-metrics.mjs';
import { assemblePrompt } from '../src/lib/skills/context-assembler.ts';
import { resolveTaskGuidelines } from '../src/lib/skills/task-context.ts';
import { effortPrompt } from '../src/lib/task-effort.ts';

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
  const run = (model) =>
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
      ],
      { encoding: 'utf8', windowsHide: true },
    );
  const resumed = run('fixture');
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(readFileSync(comparison, 'utf8'), JSON.stringify(saved));
  const changed = run('different-model');
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /Resume requires/);
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
