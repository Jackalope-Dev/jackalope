import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { externalSpec } from '../../../scripts/evaluation/harbor-run.mjs';

const input = {
  id: 'upstream-task',
  variant: 'direct',
  agent: 'opencode',
  model: 'deepseek/deepseek-v4-flash',
  instruction: 'Fix the documented bug.\nPreserve unrelated behavior.\n',
  workspace: path.join(tmpdir(), 'prepared-repository'),
  seconds: 600,
  tokens: 2_000_000,
};

test('external comparison preserves the original native task and uses production Jackalope guidance', () => {
  const direct = externalSpec(input);
  const jackalope = externalSpec({ ...input, variant: 'jackalope' });
  assert.equal(direct.prompt, input.instruction);
  assert.equal(jackalope.rawPrompt, direct.rawPrompt);
  assert.ok(jackalope.prompt.includes(input.instruction.trim()));
  assert.equal(jackalope.externalWorkspace, direct.externalWorkspace);
  assert.equal(jackalope.model, direct.model);
  assert.equal(jackalope.effort, direct.effort);
  assert.equal(jackalope.seconds, direct.seconds);
  assert.equal(jackalope.tokens, direct.tokens);
  assert.equal(direct.permissionPolicy, 'reject');
  assert.equal(jackalope.permissionPolicy, direct.permissionPolicy);
  assert.equal(jackalope.learningMode, 'local');
  assert.equal(jackalope.oracle, undefined);
  assert.equal(jackalope.files, undefined);
  assert.ok(!jackalope.prompt.includes('isolated git worktree'));
});

test('external comparisons reject unbounded or unmatched execution settings', () => {
  for (const changes of [
    { variant: 'unknown' },
    { agent: 'unsupported' },
    { model: '' },
    { workspace: '.' },
    { workspace: path.parse(input.workspace).root },
    { seconds: 0 },
    { seconds: 1801 },
    { tokens: Infinity },
    { tokens: 10_000_001 },
    { instruction: '' },
    { jevQuestions: true },
    { experiments: { 'native-tools': 'bounded' } },
    { variant: 'jackalope', experiments: { 'native-tools': 'unknown' } },
    { variant: 'jackalope', experiments: { unknown: 'on' } },
  ])
    assert.throws(() => externalSpec({ ...input, ...changes }));
  assert.doesNotThrow(() => externalSpec({ ...input, variant: 'jackalope', jevQuestions: true }));
  assert.doesNotThrow(() =>
    externalSpec({
      ...input,
      variant: 'jackalope',
      experiments: { 'native-tools': 'output', 'provider-effort': 'low' },
    }),
  );
});
