import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterScheduleTemplates,
  scheduleTemplateDraft,
  scheduleTemplatePrompt,
  scheduleTemplates,
} from '../src/lib/schedule-templates.ts';

test('every template creates an independent paused native schedule with complete instructions', () => {
  assert.equal(
    new Set(scheduleTemplates.map((template) => template.id)).size,
    scheduleTemplates.length,
  );
  for (const template of scheduleTemplates) {
    const options = {
      id: crypto.randomUUID(),
      timezone: 'America/Denver',
      projectId: 'project',
      agent: 'custom-runner',
    };
    const draft = scheduleTemplateDraft(template, options);
    assert.equal(draft.id, options.id);
    assert.equal(draft.request.id, options.id);
    assert.equal(draft.request.projectId, 'project');
    assert.equal(draft.request.agent, 'custom-runner');
    assert.equal(draft.request.isolated, true);
    assert.equal(draft.enabled, false);
    assert.equal(draft.missed, 'skip');
    assert.equal(draft.monitor, undefined);
    assert.equal(draft.timezone, 'America/Denver');
    assert.equal(draft.expression, template.cadence === 'Weekly' ? '0 9 * * 1' : '0 9 * * 1-5');
    assert.equal(draft.rawPrompt, draft.request.prompt);
    assert.ok(draft.rawPrompt.includes(template.steps));
    assert.ok(draft.rawPrompt.includes(template.outcome));
    assert.ok(draft.rawPrompt.length < 24000);
    assert.doesNotMatch(draft.rawPrompt, /\{\{|\bTODO\s*:/);
    const second = scheduleTemplateDraft(template, { ...options, id: crypto.randomUUID() });
    draft.request.prompt = 'User customization';
    assert.notEqual(second.id, draft.id);
    assert.equal(second.request.prompt, scheduleTemplatePrompt(template));
    assert.equal(second.request.contextSelection, undefined);
  }
});

test('report and change templates carry distinct action boundaries and repeat-run guidance', () => {
  for (const template of scheduleTemplates) {
    const prompt = scheduleTemplatePrompt(template);
    assert.match(prompt, /avoid duplicate findings/);
    assert.match(prompt, /If no actionable work is found/);
    assert.match(prompt, /Never fabricate/);
    if (template.mode === 'Report') assert.match(prompt, /Do not edit project files/);
    else assert.match(prompt, /Do not commit, push, merge, or deploy/);
  }
});

test('template discovery handles combined words, categories, whitespace and empty results', () => {
  assert.equal(filterScheduleTemplates('   ', 'All').length, scheduleTemplates.length);
  assert.ok(
    filterScheduleTemplates(' SECURITY authentication ', 'All').some(
      (item) => item.id === 'security-audit',
    ),
  );
  assert.ok(
    filterScheduleTemplates('keyboard', 'Product quality').every(
      (item) => item.category === 'Product quality',
    ),
  );
  assert.deepEqual(filterScheduleTemplates('no-such-template-123', 'All'), []);
  assert.deepEqual(filterScheduleTemplates('security', 'Missing category'), []);
});
