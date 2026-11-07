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
const { builtinAgents, getAgentMetadata } = await import('../src/lib/agent-catalog.ts');
const { agentAdapter, agentName } = await import('../src/lib/agents.ts');
const { useAgentConfigStore } = await import('../src/stores/agentConfigStore.ts');

test('install and sign-in commands come from the catalog entries', () => {
  assert.equal(
    getAgentMetadata('claude')?.installCommand,
    'npm install -g @anthropic-ai/claude-code',
  );
  assert.equal(getAgentMetadata('claude')?.loginCommand, 'claude auth login');
  assert.equal(getAgentMetadata('antigravity')?.loginCommand, 'agy');
  assert.equal(getAgentMetadata('antigravity')?.installCommand, '');
  assert.equal(getAgentMetadata('acp')?.defaultBinary, '');
  assert.equal(getAgentMetadata('acp')?.loginCommand, '');
  assert.equal(builtinAgents.at(-1)?.id, 'acp');
});

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
  assert.equal(agentAdapter('review-bot'), 'claude');
  assert.equal(agentName('review-bot'), 'Review bot');
  assert.equal(agentAdapter('kimi'), 'kimi');
  assert.equal(agentName('kimi'), 'Kimi Code');
  assert.equal(agentName('unknown'), 'unknown');
});
