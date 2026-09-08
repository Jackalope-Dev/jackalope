import assert from 'node:assert/strict';
import test from 'node:test';
import { routeTaskToBestAgent } from '../src/lib/agent-routing.ts';

const mockRunners = [
  { id: 'codex', name: 'Codex', available: true, signedIn: true, detail: 'Installed' },
  { id: 'claude', name: 'Claude Code', available: true, signedIn: true, detail: 'Installed' },
  { id: 'grok', name: 'Grok', available: true, signedIn: true, detail: 'Installed' },
  { id: 'opencode', name: 'OpenCode', available: true, signedIn: true, detail: 'Installed' },
  { id: 'gemini', name: 'Gemini CLI', available: true, signedIn: true, detail: 'Installed' },
  { id: 'aider', name: 'Aider', available: true, signedIn: true, detail: 'Installed' },
  { id: 'goose', name: 'Goose', available: true, signedIn: true, detail: 'Installed' },
];

test('routeTaskToBestAgent routes frontend/UI tasks to Claude', () => {
  const result = routeTaskToBestAgent({
    prompt:
      'Build an accessible modal dialog component using React, Tailwind CSS, and theme tokens',
    availableRunners: mockRunners,
  });

  assert.equal(result.agentId, 'claude');
  assert.ok(result.confidence > 0.5);
  assert.ok(
    result.matchedStrengths.includes('frontend') ||
      result.matchedStrengths.includes('react') ||
      result.matchedStrengths.includes('css'),
  );
  assert.ok(result.rationale.includes('Claude') || result.rationale.includes('frontend'));
});

test('routeTaskToBestAgent routes backend and systems tasks to Codex', () => {
  const result = routeTaskToBestAgent({
    prompt: 'Implement high-performance Python data streaming backend with SQL database queries',
    availableRunners: mockRunners,
  });

  assert.equal(result.agentId, 'codex');
  assert.ok(result.confidence > 0.5);
  assert.ok(
    result.matchedStrengths.includes('backend') ||
      result.matchedStrengths.includes('python') ||
      result.matchedStrengths.includes('systems'),
  );
});

test('routeTaskToBestAgent routes testing and verification tasks to Grok', () => {
  const result = routeTaskToBestAgent({
    prompt:
      'Write deep automated test suite and verify edge-case coverage and algorithm correctness',
    availableRunners: mockRunners,
  });

  assert.equal(result.agentId, 'grok');
  assert.ok(result.confidence > 0.5);
  assert.ok(
    result.matchedStrengths.includes('verification') ||
      result.matchedStrengths.includes('testing') ||
      result.matchedStrengths.includes('reasoning'),
  );
});

test('routeTaskToBestAgent respects available runners and does not select unavailable agents', () => {
  // Only Codex and Grok are available (Claude is absent)
  const limitedRunners = [
    { id: 'codex', name: 'Codex', available: true, signedIn: true, detail: 'Installed' },
    { id: 'grok', name: 'Grok', available: true, signedIn: true, detail: 'Installed' },
  ];

  const result = routeTaskToBestAgent({
    prompt: 'Build an accessible UI component using React and CSS',
    availableRunners: limitedRunners,
  });

  assert.ok(result.agentId === 'codex' || result.agentId === 'grok');
  assert.notEqual(result.agentId, 'claude');
});

test('routeTaskToBestAgent falls back to preferred runner when prompt is neutral', () => {
  const result = routeTaskToBestAgent({
    prompt: 'Hello world',
    availableRunners: mockRunners,
    preferredRunner: 'opencode',
  });

  assert.equal(result.agentId, 'opencode');
});
