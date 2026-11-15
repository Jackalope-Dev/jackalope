import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  },
};
const { agentAdapter } = await import('../src/lib/agent-catalog.ts');
const { agentName, useAgentConfigStore } = await import('../src/stores/agentConfigStore.ts');

test('custom agents resolve to their adapter and their own name', () => {
  useAgentConfigStore.setState({
    customAgents: [
      {
        id: 'review-bot',
        name: 'Review bot',
        command: 'claude',
        adapter: 'claude',
        models: [],
        description: '',
        enabled: true,
        isCustom: true,
      },
    ],
  });
  const { customAgents } = useAgentConfigStore.getState();
  assert.equal(agentAdapter('review-bot', customAgents), 'claude');
  assert.equal(agentName('review-bot'), 'Review bot');
  assert.equal(agentAdapter('kimi', customAgents), 'kimi');
  assert.equal(agentName('kimi'), 'Kimi Code');
  assert.equal(agentName('unknown'), 'unknown');
});
