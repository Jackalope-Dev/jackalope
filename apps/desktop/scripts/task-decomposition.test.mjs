import assert from 'node:assert/strict';
import test from 'node:test';
import { readFeaturePlan } from '../src/lib/feature-plan.ts';
import {
  generateHeuristicDecomposition,
  multiAgentPlanningPrompt,
} from '../src/lib/task-decomposition.ts';

test('default plan preserves all requirements without invented paths or serial workers', () => {
  const goal = 'Add settings\nPreserve old data.\nNever publish changes.';
  const plan = generateHeuristicDecomposition(goal, []);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].prompt, goal);
  assert.deepEqual(plan[0].scopes, ['.']);
  assert.deepEqual(plan[0].dependsOn, []);
  assert.equal(plan[0].agent, 'auto');
});
test('repository planning permits one task and requires actual paths and the complete objective', () => {
  const goal = 'Build a feature\nKeep every constraint';
  const prompt = multiAgentPlanningPrompt(goal, [
    { id: 'fixture', available: true },
    { id: 'missing', available: false },
  ]);
  assert.ok(prompt.includes(goal));
  assert.ok(prompt.includes('actual repository paths'));
  assert.ok(prompt.includes('independent work in parallel'));
  assert.ok(prompt.includes('fixture'));
  assert.ok(!prompt.includes('missing'));
  assert.equal(
    readFeaturePlan(JSON.stringify(generateHeuristicDecomposition(goal, [])), 'auto').length,
    1,
  );
});
