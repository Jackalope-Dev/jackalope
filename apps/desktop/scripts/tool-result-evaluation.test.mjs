import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { toolResultCases } from '../../../scripts/evaluation/tool-result-cases.mjs';

test('tool response oracles require exact source data and reject unrelated edits', () => {
  for (const fixture of toolResultCases) {
    const parent = mkdtempSync(path.join(tmpdir(), 'jackalope-tool-oracle-'));
    const root = path.join(parent, 'repo');
    const git = (args) => {
      const result = spawnSync('git', args, { cwd: parent, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    };
    git(['init', root]);
    for (const [name, text] of Object.entries(fixture.files))
      writeFileSync(path.join(root, name), text);
    git(['-C', root, 'add', '.']);
    git([
      '-C',
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Fixture',
    ]);
    const oracle = path.join(parent, 'oracle.cjs');
    writeFileSync(oracle, fixture.oracle);
    const check = () =>
      spawnSync(process.execPath, [oracle, root], { encoding: 'utf8', windowsHide: true });
    assert.notEqual(check().status, 0);
    writeFileSync(
      path.join(root, 'result.json'),
      JSON.stringify(Object.values(fixture.toolFixture.report)[0]),
    );
    assert.equal(check().status, 0, check().stderr);
    writeFileSync(path.join(root, 'README.md'), 'Unrelated edit');
    assert.notEqual(check().status, 0);
  }
});
