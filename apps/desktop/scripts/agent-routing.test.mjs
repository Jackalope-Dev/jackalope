import assert from 'node:assert/strict';
import test from 'node:test';
import { routeTaskToBestAgent } from '../src/lib/agent-routing.ts';

const runners = [
  { id: 'codex', name: 'Codex', available: true },
  { id: 'claude', name: 'Claude', available: true },
];
test('multiple candidates defer to native routing regardless of branding or prompt keywords', () => {
  for (const prompt of ['frontend CSS', 'Rust backend', 'testing', 'architecture']) {
    const result = routeTaskToBestAgent({ prompt, availableRunners: runners });
    assert.equal(result.agentId, 'auto');
    assert.equal(result.confidence, 0);
    assert.deepEqual(result.matchedStrengths, []);
  }
});
test('explicit installed preference and sole candidate remain usable', () => {
  assert.equal(
    routeTaskToBestAgent({ prompt: 'x', availableRunners: runners, preferredRunner: 'claude' })
      .agentId,
    'claude',
  );
  assert.equal(
    routeTaskToBestAgent({ prompt: 'x', availableRunners: runners.slice(0, 1) }).agentId,
    'codex',
  );
  assert.equal(
    routeTaskToBestAgent({ prompt: 'x', availableRunners: [], preferredRunner: 'missing' }).agentId,
    'auto',
  );
});
