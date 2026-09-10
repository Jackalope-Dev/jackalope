import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { qualityCases } from '../../../scripts/evaluation/quality-cases.mjs';
import { qualitySummary } from '../../../scripts/evaluation/quality-metrics.mjs';

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
    const good = run();
    assert.equal(good.status, 0, `${fixture.id}: ${good.stderr}`);
    writeFileSync(path.join(repo, 'unrequested.txt'), 'Extra work');
    assert.notEqual(run().status, 0, `${fixture.id} should reject scope expansion`);
  }
});
