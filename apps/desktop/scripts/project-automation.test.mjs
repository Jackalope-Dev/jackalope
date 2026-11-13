import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTOMATION_PRESETS,
  automationChanges,
  automationValues,
  automationWrites,
  matchingPreset,
} from '../src/lib/project-automation.ts';

test('an untuned project reads as Balanced, from each setting default', () => {
  assert.equal(matchingPreset(automationValues(undefined, undefined)), 'balanced');
  assert.equal(matchingPreset(automationValues({}, { decide: undefined })), 'balanced');
});

test('each preset round-trips through its stored fields', () => {
  const plan = { questionCap: 3, exportPath: 'docs/plans', decide: undefined };
  for (const preset of Object.keys(AUTOMATION_PRESETS)) {
    const writes = automationWrites(AUTOMATION_PRESETS[preset], plan);
    assert.equal(matchingPreset(automationValues(writes.preferences, writes.plan)), preset);
    assert.equal(writes.plan.questionCap, 3, 'unrelated plan settings are kept');
    assert.equal(writes.plan.exportPath, 'docs/plans');
  }
});

test('one switch away from a preset reads as Custom', () => {
  const values = automationValues({ autoVerify: true }, undefined);
  assert.equal(matchingPreset(values), 'custom');
});

test('changes list only what a preset would change, with labels', () => {
  const from = automationValues(undefined, undefined);
  const changes = automationChanges(from, AUTOMATION_PRESETS['hands-on']);
  assert.deepEqual(
    changes.map((change) => [change.key, change.to]),
    [
      ['autoApprove', false],
      ['automaticSubtasks', false],
      ['learnAutomatically', false],
      ['askBeforeRounds', true],
    ],
  );
  assert.equal(changes[0].label, 'Auto-approve agent requests');
  assert.deepEqual(automationChanges(from, from), []);
});

test('writes keep the plan decision limit and decider', () => {
  const plan = {
    questionCap: 3,
    exportPath: '',
    decide: {
      questions: false,
      rounds: false,
      deviations: false,
      maxAgentDecisions: 25,
      decider: 'claude',
    },
  };
  const { plan: next } = automationWrites(AUTOMATION_PRESETS.autonomous, plan);
  assert.equal(next.decide.maxAgentDecisions, 25);
  assert.equal(next.decide.decider, 'claude');
  assert.equal(next.decide.questions, true);
});
