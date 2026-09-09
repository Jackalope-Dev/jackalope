import assert from 'node:assert/strict';
import test from 'node:test';
import { planningDraft } from '../src/lib/planning.ts';
import { VETTED_SKILLS } from '../src/lib/skills/catalog.ts';
import { assemblePrompt } from '../src/lib/skills/context-assembler.ts';
import { resolveTaskGuidelines } from '../src/lib/skills/task-context.ts';

test('automatic context follows the current prompt and project defaults without stale matches', () => {
  const defaults = { taskGuidelines: ['security-audit', 'missing-guideline'] };
  assert.deepEqual(resolveTaskGuidelines('Test onboarding', undefined, defaults), [
    'tdd-verification',
    'security-audit',
    'onboarding-flow',
  ]);
  assert.deepEqual(resolveTaskGuidelines('Explain this repository', undefined, defaults), [
    'security-audit',
  ]);
  assert.deepEqual(resolveTaskGuidelines('Explain this repository', undefined), []);
  assert.deepEqual(resolveTaskGuidelines('Check authentication permissions', undefined), [
    'security-audit',
  ]);
});

test('project opt-out retains required defaults, and manual task choices override both', () => {
  const defaults = { automaticTaskContext: false, taskGuidelines: ['security-audit'] };
  assert.deepEqual(resolveTaskGuidelines('Test onboarding', undefined, defaults), [
    'security-audit',
  ]);
  assert.deepEqual(resolveTaskGuidelines('Test onboarding', [], defaults), []);
  assert.deepEqual(resolveTaskGuidelines('Test onboarding', ['ui-validation'], defaults), [
    'ui-validation',
  ]);
});

test('saved automatic ideas restore the raw prompt and recompute guidance after editing', () => {
  const rawPrompt = 'Test onboarding';
  const selectedSkillIds = resolveTaskGuidelines(rawPrompt, undefined);
  const refinedPrompt = assemblePrompt({
    rawPrompt,
    selectedSkillIds,
    executionMode: 'isolated',
  }).assembledPrompt;
  const draft = planningDraft({
    rawPrompt,
    refinedPrompt,
    clarifications: [
      { question: 'Task guideline selection', answer: 'Automatic' },
      {
        question: 'Active Skill Guidelines',
        answer: VETTED_SKILLS.filter((skill) => selectedSkillIds.includes(skill.id))
          .map((skill) => skill.name)
          .join(', '),
      },
    ],
  });
  assert.equal(draft.prompt, rawPrompt);
  assert.equal(draft.skills, undefined);
  assert.deepEqual(resolveTaskGuidelines('Explain this repository', draft.skills), []);
  assert.ok(refinedPrompt.includes('Check back, cancel, retry, reload and completion behavior'));
  assert.ok(!refinedPrompt.includes('record_validation_step'));
});

test('automatic ideas with no supplements keep automatic mode', () => {
  const draft = planningDraft({
    rawPrompt: 'Explain this repository',
    clarifications: [
      { question: 'Task guideline selection', answer: 'Automatic' },
      { question: 'Git Execution Mode', answer: 'Active working checkout' },
    ],
  });
  assert.equal(draft.skills, undefined);
  assert.equal(draft.isolated, false);
});

test('saved manual and legacy selections stay explicit, including an empty selection', () => {
  for (const mode of ['Manual', undefined]) {
    const rawPrompt = 'Test onboarding';
    const draft = planningDraft({
      rawPrompt,
      refinedPrompt: assemblePrompt({ rawPrompt, executionMode: 'isolated' }).assembledPrompt,
      clarifications: mode ? [{ question: 'Task guideline selection', answer: mode }] : [],
    });
    assert.deepEqual(resolveTaskGuidelines(draft.prompt, draft.skills), []);
  }
  const draft = planningDraft({
    rawPrompt: 'Original request',
    refinedPrompt: 'Previously saved custom instructions and guidelines',
    clarifications: [{ question: 'Task guideline selection', answer: 'Automatic' }],
  });
  assert.equal(draft.prompt, 'Previously saved custom instructions and guidelines');
  assert.deepEqual(draft.skills, []);
});
