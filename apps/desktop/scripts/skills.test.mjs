import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSkillsFromPrompt, getSkillById, VETTED_SKILLS } from '../src/lib/skills/catalog.ts';
import { assemblePrompt } from '../src/lib/skills/context-assembler.ts';
import { getToolById, VETTED_TOOLS } from '../src/lib/skills/tool-registry.ts';

test('vetted skills catalog contains all core development domains and harness skills', () => {
  assert.equal(VETTED_SKILLS.length, 9);
  const categories = new Set(VETTED_SKILLS.map((s) => s.category));
  assert.ok(categories.has('debugging'));
  assert.ok(categories.has('feature'));
  assert.ok(categories.has('refactor'));
  assert.ok(categories.has('testing'));
  assert.ok(categories.has('security'));
  assert.ok(categories.has('performance'));
  assert.ok(categories.has('git'));
  assert.ok(categories.has('browser'));
});

test('detectSkillsFromPrompt classifies real-world developer intents accurately', () => {
  const debugMatch = detectSkillsFromPrompt('Fix crash when token expires in auth service');
  assert.ok(debugMatch.some((s) => s.id === 'systematic-debugging'));

  const featureMatch = detectSkillsFromPrompt(
    'Create an accessible modal dialog for project settings',
  );
  assert.ok(featureMatch.some((s) => s.id === 'feature-scaffolding'));

  const testMatch = detectSkillsFromPrompt('Write unit tests for the prompt assembler');
  assert.ok(testMatch.some((s) => s.id === 'tdd-verification'));

  const refactorMatch = detectSkillsFromPrompt(
    'Refactor database query helper and remove dead code',
  );
  assert.ok(refactorMatch.some((s) => s.id === 'clean-refactoring'));

  const perfMatch = detectSkillsFromPrompt('Optimize memory footprint and reduce CPU latency');
  assert.ok(perfMatch.some((s) => s.id === 'performance-tuning'));

  const secMatch = detectSkillsFromPrompt('Security audit on auth endpoints to prevent token leak');
  assert.ok(secMatch.some((s) => s.id === 'security-audit'));

  const gitMatch = detectSkillsFromPrompt('Resolve merge conflict in feature branch worktree');
  assert.ok(gitMatch.some((s) => s.id === 'git-coordination'));

  const uiMatch = detectSkillsFromPrompt('Validate UI change and verify component appearance');
  assert.ok(uiMatch.some((s) => s.id === 'ui-validation'));

  const onboardingMatch = detectSkillsFromPrompt(
    'Test onboarding signup flow and registration form',
  );
  assert.ok(onboardingMatch.some((s) => s.id === 'onboarding-flow'));
});

test('detectSkillsFromPrompt handles empty or irrelevant strings gracefully', () => {
  assert.deepEqual(detectSkillsFromPrompt(''), []);
  assert.deepEqual(detectSkillsFromPrompt('   '), []);
  assert.deepEqual(detectSkillsFromPrompt('hello world'), []);
});

test('assemblePrompt preserves raw prompt completely when no supplements are selected', () => {
  const raw = 'Simple raw task with no added bells and whistles';
  const result = assemblePrompt({ rawPrompt: raw });
  assert.equal(result.assembledPrompt, raw);
  assert.equal(result.hasSupplementation, false);
  assert.equal(result.activeSkillCount, 0);
  assert.equal(result.activeToolCount, 0);
});

test('assemblePrompt supplements prompt additively and preserves original prompt', () => {
  const raw = 'Fix auth token race condition';
  const result = assemblePrompt({
    rawPrompt: raw,
    selectedSkillIds: ['systematic-debugging'],
    selectedToolIds: ['filesystem'],
    executionMode: 'isolated',
  });

  assert.ok(result.hasSupplementation);
  assert.equal(result.activeSkillCount, 1);
  assert.equal(result.activeToolCount, 1);
  assert.ok(result.assembledPrompt.includes('### 🎯 Objective\nFix auth token race condition'));
  assert.ok(result.assembledPrompt.includes('### 📐 Guidelines & Quality Constraints'));
  assert.ok(
    result.assembledPrompt.includes(
      'Write a minimal failing reproduction test or script before touching production code.',
    ),
  );
  assert.ok(result.assembledPrompt.includes('isolated git worktree branch'));
  assert.ok(result.assembledPrompt.includes('### 🛠️ Active Tools & Capabilities'));
  assert.ok(result.assembledPrompt.includes('Scoped Filesystem MCP'));
});

test('getToolById and getSkillById retrieve registered definitions', () => {
  assert.ok(VETTED_TOOLS.length >= 5);
  const fsTool = getToolById('filesystem');
  assert.ok(fsTool);
  assert.equal(fsTool.name, 'Scoped Filesystem MCP');

  const debugSkill = getSkillById('systematic-debugging');
  assert.ok(debugSkill);
  assert.equal(debugSkill.shortLabel, 'Debug & Triage');
});
