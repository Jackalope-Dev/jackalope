import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateHeuristicDecomposition,
  multiAgentPlanningPrompt,
} from '../src/lib/task-decomposition.ts';

const mockRunners = [
  { id: 'codex', name: 'Codex', available: true, signedIn: true, detail: 'Installed' },
  { id: 'claude', name: 'Claude Code', available: true, signedIn: true, detail: 'Installed' },
  { id: 'grok', name: 'Grok', available: true, signedIn: true, detail: 'Installed' },
  { id: 'opencode', name: 'OpenCode', available: true, signedIn: true, detail: 'Installed' },
  { id: 'gemini', name: 'Gemini CLI', available: true, signedIn: true, detail: 'Installed' },
  { id: 'aider', name: 'Aider', available: true, signedIn: true, detail: 'Installed' },
  { id: 'goose', name: 'Goose', available: true, signedIn: true, detail: 'Installed' },
];

test('generateHeuristicDecomposition creates structured stages with dependency chain', () => {
  const goal =
    'Build an interactive account settings dialog with React UI and SQLite database persistence';
  const subtasks = generateHeuristicDecomposition(goal, mockRunners);

  assert.ok(subtasks.length >= 3);

  const keys = subtasks.map((s) => s.key);
  assert.ok(keys.includes('spec-and-contract'));
  assert.ok(keys.includes('implementation-core'));
  assert.ok(keys.includes('ui-integration'));
  assert.ok(keys.includes('verification-and-tests'));

  // Verify dependency ordering
  const spec = subtasks.find((s) => s.key === 'spec-and-contract');
  const core = subtasks.find((s) => s.key === 'implementation-core');
  const ui = subtasks.find((s) => s.key === 'ui-integration');
  const verify = subtasks.find((s) => s.key === 'verification-and-tests');

  assert.deepEqual(spec.dependsOn, []);
  assert.ok(core.dependsOn.includes('spec-and-contract'));
  assert.ok(ui.dependsOn.includes('implementation-core'));
  assert.ok(verify.dependsOn.includes('ui-integration'));

  // Verify agents assigned
  assert.ok(spec.agent);
  assert.ok(core.agent);
  assert.ok(ui.agent);
  assert.ok(verify.agent);
});

test('generateHeuristicDecomposition routes UI subtask to Claude and Core to Codex', () => {
  const goal =
    'Add customer profile management with React frontend components and backend API endpoints';
  const subtasks = generateHeuristicDecomposition(goal, mockRunners);

  const uiSubtask = subtasks.find((s) => s.key === 'ui-integration');
  assert.equal(uiSubtask.agent, 'claude');

  const coreSubtask = subtasks.find((s) => s.key === 'implementation-core');
  assert.equal(coreSubtask.agent, 'codex');
});

test('multiAgentPlanningPrompt formats instructions and available agents list', () => {
  const prompt = multiAgentPlanningPrompt('Build multi-agent task manager', mockRunners);

  assert.ok(prompt.includes('Build multi-agent task manager'));
  assert.ok(prompt.includes('Codex'));
  assert.ok(prompt.includes('Claude Code'));
  assert.ok(prompt.includes('Grok'));
  assert.ok(prompt.includes('tasks'));
});
