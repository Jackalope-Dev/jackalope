import assert from 'node:assert/strict';
import test from 'node:test';
import { readFeaturePlan } from '../src/lib/feature-plan.ts';
import { nextAction, recoveryHandoff, returnToProject } from '../src/lib/project-return.ts';
import { correctionPrompt, requirementState } from '../src/lib/task-outcomes.ts';

test('acceptance is unknown until a current file snapshot has been inspected', () => {
  const requirement = { id: 'one', title: 'Reset works', checkpoint: false, receipt: null };
  assert.equal(requirementState(requirement, 'tree'), 'Not verified');
  requirement.receipt = {
    accepted: true,
    tree: 'tree',
    note: 'Verified reset',
    evidence: 'manual',
  };
  assert.equal(requirementState(requirement, null), 'Snapshot not checked');
  assert.equal(requirementState(requirement, 'tree'), 'Accepted by you');
  assert.equal(requirementState(requirement, 'changed'), 'Evidence needs refreshing');
  assert.match(correctionPrompt([requirement]), /Reset works.*\n.*Verified reset/);
});

test('feature plan validation preserves outcomes and rejects cycles, missing dependencies and escaping scopes', () => {
  const first = {
    key: 'api',
    title: 'API',
    prompt: 'Implement the API',
    scopes: ['src/api'],
    dependsOn: [],
    outcomes: ['Invalid input rejected'],
  };
  const second = {
    key: 'ui',
    title: 'UI',
    prompt: 'Use the API',
    scopes: ['src/ui'],
    dependsOn: ['api'],
    outcomes: ['Errors shown'],
  };
  const parsed = readFeaturePlan(
    `\`\`\`json\n${JSON.stringify([first, second])}\n\`\`\``,
    'claude',
  );
  assert.equal(parsed[1].agent, 'claude');
  assert.deepEqual(parsed[0].contextSelection.outcomes, ['Invalid input rejected']);
  assert.deepEqual(readFeaturePlan(JSON.stringify(parsed), 'codex')[1].contextSelection.outcomes, [
    'Errors shown',
  ]);
  assert.throws(
    () => readFeaturePlan(JSON.stringify([{ ...first, dependsOn: ['ui'] }, second]), 'claude'),
    /cycle/,
  );
  assert.throws(() => readFeaturePlan(JSON.stringify([second]), 'claude'), /Missing dependency/);
  assert.throws(
    () => readFeaturePlan(JSON.stringify([{ ...first, scopes: ['../secrets'] }]), 'claude'),
    /scopes/,
  );
  assert.throws(() => readFeaturePlan(JSON.stringify([first, first]), 'claude'), /unique/);
});

test('return view selects latest attempts, prioritizes blockers and retains reviewed unintegrated work', () => {
  const run = {
    id: 'old',
    taskId: 'task',
    projectId: 'p',
    status: 'failed',
    startedAt: '2026-09-01',
    workspace: '/worktree',
    projectPath: '/repo',
  };
  const latest = { ...run, id: 'new', status: 'review', startedAt: '2026-09-02' };
  const blocker = { ...run, id: 'blocked', taskId: 'other', status: 'interrupted' };
  const reviewed = { ...run, id: 'reviewed', taskId: 'third', status: 'reviewed' };
  assert.deepEqual(
    returnToProject([run, latest, blocker, reviewed], 'p', []).map((r) => r.id),
    ['blocked', 'new', 'reviewed'],
  );
  assert.deepEqual(returnToProject([run, latest], 'p', ['new']), []);
  assert.match(nextAction(blocker), /ownership/);
  assert.match(nextAction(reviewed), /Integrate/);
});

test('recovery preserves failure, workspace and acceptance without claiming old checks still pass', () => {
  const handoff = recoveryHandoff(
    {
      status: 'failed',
      result: 'Partial work',
      error: 'Check failed',
      workspace: '/saved',
      baseHead: 'abc',
      targetBranch: 'main',
      contract: { requirements: [{ title: 'Retry works' }] },
      verification: { command: 'test', result: { success: true } },
    },
    'Build retry',
    'Fix the failed case',
  );
  assert.match(handoff, /\/saved/);
  assert.match(handoff, /Retry works/);
  assert.match(handoff, /prior snapshot only/);
  assert.match(handoff, /Do not overwrite, delete/);
});
