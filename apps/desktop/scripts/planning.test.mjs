import assert from 'node:assert/strict';
import test from 'node:test';
import { isCronExpression, planningDraft, scheduleProject } from '../src/lib/planning.ts';
import { VETTED_SKILLS } from '../src/lib/skills/catalog.ts';
import { assemblePrompt } from '../src/lib/skills/context-assembler.ts';

test('prepared ideas restore editable guidelines without nesting prompts or losing custom instructions', () => {
  const skill = VETTED_SKILLS[0];
  const rawPrompt = 'Improve keyboard navigation';
  const refinedPrompt = assemblePrompt({ rawPrompt, selectedSkillIds: [skill.id], executionMode: 'isolated' }).assembledPrompt;
  const draft = planningDraft({ rawPrompt, refinedPrompt, assignedAgent: 'codex', clarifications: [{ question: 'Active Skill Guidelines', answer: skill.name }] });
  assert.equal(draft.prompt, rawPrompt);
  assert.deepEqual(draft.skills, [skill.id]);
  assert.equal(assemblePrompt({ rawPrompt: draft.prompt, selectedSkillIds: draft.skills, executionMode: 'isolated' }).assembledPrompt, refinedPrompt);
  const current = assemblePrompt({ rawPrompt: draft.prompt, selectedSkillIds: draft.skills, executionMode: 'current' }).assembledPrompt;
  assert.equal(current.includes('Execute all changes in an isolated git worktree'), false);
  const custom = planningDraft({ rawPrompt, refinedPrompt: 'Keep these hand-written requirements.', assignedAgent: 'Unassigned', clarifications: [{ question: 'Git Execution Mode', answer: 'Active working checkout' }] });
  assert.equal(custom.prompt, 'Keep these hand-written requirements.');
  assert.equal(custom.agent, '');
  assert.equal(custom.isolated, false);
});

test('schedule timing validates field bounds, lists, ranges, and steps', () => {
  for (const value of ['0 9 * * 1-5', '*/15 9-17 * * 1,3,5', '59 23 31 12 7', '0 0 1 */2 *'])
    assert.equal(isCronExpression(value), true, value);
  for (const value of ['', '0 9 * *', '60 9 * * *', '0 24 * * *', '0 0 0 * *', '0 0 * 13 *', '0 0 * * 8', '*/0 * * * *', '*/61 * * * *', '0 9 * * 5-1', '0, 9 * * *', '0 9 * * MON'])
    assert.equal(isCronExpression(value), false, value);
});

test('schedule resolves its saved project without falling back when unavailable', () => {
  const projects = [{ id: 'active', name: 'Active checkout' }, { id: 'target', name: 'Scheduled project' }];
  assert.equal(scheduleProject({ targetProjectId: 'target' }, projects), projects[1]);
  assert.equal(scheduleProject({ targetProjectId: 'removed' }, projects), undefined);
  assert.equal(scheduleProject({ targetProjectId: '' }, projects), undefined);
});

test('rapidly created ideas and plans remain distinct through edits, deletion and hydration', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.window = { localStorage: globalThis.localStorage };
  const { useTaskStore: tasks } = await import('../src/stores/taskStore.ts');
  const { useScheduleStore: schedules } = await import('../src/stores/scheduleStore.ts');
  const plan = { name: 'Review changes', description: 'Keep this note', targetProjectId: 'target', cronExpression: '0 9 * * *', assignedAgentProvider: 'codex', prompt: 'Check coverage', enabled: false };
  for (let index = 0; index < 20; index++) {
    schedules.getState().addSchedule(plan);
    tasks.getState().addTask({ projectId: 'target', title: plan.name, rawPrompt: plan.prompt, status: 'backlog' });
  }
  assert.equal(new Set(schedules.getState().schedules.map(item => item.id)).size, 20);
  assert.equal(new Set(tasks.getState().tasks.map(item => item.id)).size, 20);
  const id = schedules.getState().schedules[0].id;
  schedules.getState().updateSchedule(id, { name: 'Updated review', targetProjectId: 'other' });
  const saved = values.get('jackalope-schedules');
  schedules.setState({ schedules: [] });
  values.set('jackalope-schedules', saved);
  await schedules.persist.rehydrate();
  assert.equal(schedules.getState().schedules[0].name, 'Updated review');
  assert.equal(schedules.getState().schedules[0].targetProjectId, 'other');
  assert.equal(schedules.getState().schedules[0].enabled, false);
  assert.equal(schedules.getState().schedules[0].description, 'Keep this note');
  schedules.getState().deleteSchedule(id);
  assert.equal(schedules.getState().schedules.length, 19);
  assert.equal(tasks.getState().tasks.length, 20);
});
