import assert from 'node:assert/strict';
import test from 'node:test';
import { planningDraft } from '../src/lib/planning.ts';
import { savedPlanDraft } from '../src/lib/schedules.ts';
import { VETTED_SKILLS } from '../src/lib/skills/catalog.ts';
import { assemblePrompt } from '../src/lib/skills/context-assembler.ts';

test('prepared ideas restore editable guidelines without nesting prompts or losing custom instructions', () => {
  const skill = VETTED_SKILLS[0];
  const rawPrompt = 'Improve keyboard navigation';
  const refinedPrompt = assemblePrompt({
    rawPrompt,
    selectedSkillIds: [skill.id],
    executionMode: 'isolated',
  }).assembledPrompt;
  const draft = planningDraft({
    rawPrompt,
    refinedPrompt,
    assignedAgent: 'codex',
    clarifications: [{ question: 'Active Skill Guidelines', answer: skill.name }],
  });
  assert.equal(draft.prompt, rawPrompt);
  assert.deepEqual(draft.skills, [skill.id]);
  assert.equal(
    assemblePrompt({
      rawPrompt: draft.prompt,
      selectedSkillIds: draft.skills,
      executionMode: 'isolated',
    }).assembledPrompt,
    refinedPrompt,
  );
  const current = assemblePrompt({
    rawPrompt: draft.prompt,
    selectedSkillIds: draft.skills,
    executionMode: 'current',
  }).assembledPrompt;
  assert.equal(current.includes('Execute all changes in an isolated git worktree'), false);
  const custom = planningDraft({
    rawPrompt,
    refinedPrompt: 'Keep these hand-written requirements.',
    assignedAgent: 'Unassigned',
    clarifications: [{ question: 'Git Execution Mode', answer: 'Active working checkout' }],
  });
  assert.equal(custom.prompt, 'Keep these hand-written requirements.');
  assert.equal(custom.agent, '');
  assert.equal(custom.isolated, false);
});

test('recovered plans retain intent and project, resolve runners, and never inherit automatic execution', () => {
  const plan = {
    id: 'old',
    name: 'Review changes',
    prompt: 'Check coverage',
    description: 'Keep this note',
    targetProjectId: 'removed-project',
    assignedAgentProvider: 'Claude Code',
    cronExpression: '0 9 * * 1-5',
    enabled: true,
  };
  const draft = savedPlanDraft(plan, 'destination', [{ id: 'claude', name: 'Claude Code' }]);
  assert.equal(draft.enabled, false);
  assert.equal(draft.missed, 'skip');
  assert.equal(draft.request.isolated, true);
  assert.equal(draft.request.projectId, 'removed-project');
  assert.equal(draft.request.projectPath, '');
  assert.equal(draft.request.agent, 'claude');
  assert.equal(draft.rawPrompt, 'Check coverage\n\nKeep this note');
  assert.equal(draft.expression, plan.cronExpression);
  assert.equal(savedPlanDraft(plan, 'destination', []).request.agent, '');
});

test('ideas remain distinct and recovered plans reuse their destination through failed saves and reloads', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = { localStorage: globalThis.localStorage };
  const { useTaskStore: tasks } = await import('../src/stores/taskStore.ts');
  const { useScheduleStore: schedules } = await import('../src/stores/scheduleStore.ts');
  const plan = {
    id: 'saved-plan',
    name: 'Review changes',
    description: 'Keep this note',
    targetProjectId: 'target',
    cronExpression: '0 9 * * *',
    assignedAgentProvider: 'codex',
    prompt: 'Check coverage',
    enabled: true,
  };
  schedules.setState({ schedules: [plan] });
  for (let index = 0; index < 20; index++) {
    tasks.getState().addTask({
      projectId: 'target',
      title: plan.name,
      rawPrompt: plan.prompt,
      status: 'backlog',
    });
  }
  assert.equal(new Set(tasks.getState().tasks.map((item) => item.id)).size, 20);
  const destination = schedules.getState().prepareImport(plan.id);
  assert.match(destination, /^[0-9a-f-]{36}$/);
  assert.equal(schedules.getState().prepareImport(plan.id), destination);
  const saved = values.get('jackalope-schedules');
  schedules.setState({ schedules: [] });
  values.set('jackalope-schedules', saved);
  await schedules.persist.rehydrate();
  assert.deepEqual(schedules.getState().schedules[0], { ...plan, importId: destination });
  assert.equal(schedules.getState().prepareImport(plan.id), destination);
  const write = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error('Storage full');
  };
  assert.throws(() => schedules.getState().prepareImport(plan.id), /Storage full/);
  globalThis.localStorage.setItem = write;
  assert.equal(schedules.getState().schedules[0].id, plan.id);
  schedules.getState().deleteSchedule(plan.id);
  assert.equal(schedules.getState().schedules.length, 0);
  assert.throws(() => schedules.getState().prepareImport(plan.id), /no longer available/);
  assert.equal(tasks.getState().tasks.length, 20);
});

test('combined work links an idea to its latest attempt without duplicating or crossing projects', async () => {
  const { collectWork } = await import('../src/lib/task-collection.ts');
  const idea = {
    id: 'idea',
    projectId: 'a',
    title: 'Short title',
    rawPrompt: 'Original intent',
    status: 'backlog',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    runId: 'first',
  };
  const runs = [
    {
      id: 'first',
      taskId: 'task',
      projectId: 'a',
      prompt: 'Original intent',
      status: 'review',
      startedAt: '2026-09-01',
    },
    {
      id: 'next',
      taskId: 'task',
      projectId: 'a',
      prompt: 'Follow-up',
      status: 'running',
      startedAt: '2026-09-02',
    },
    {
      id: 'foreign',
      taskId: 'other',
      projectId: 'b',
      prompt: 'Private to b',
      status: 'running',
      startedAt: '2026-09-03',
    },
  ];
  const work = collectWork('a', [idea], runs);
  assert.equal(work.length, 1);
  assert.equal(work[0].run.id, 'next');
  assert.equal(work[0].title, 'Short title');
  assert.equal(work[0].stage, 'working');
  assert.equal(collectWork('a', [], runs)[0].title, 'Original intent');
  assert.equal(collectWork('a', [{ ...idea, runId: 'missing' }], runs).length, 2);
  assert.equal(collectWork('a', [{ ...idea, runId: undefined }], runs).length, 2);
});

test('manual planning never claims execution and questions or unsaved results need attention', async () => {
  const { collectWork } = await import('../src/lib/task-collection.ts');
  const idea = {
    id: 'idea',
    projectId: 'a',
    title: 'Intent',
    status: 'in_progress',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  };
  assert.equal(collectWork('a', [idea], [])[0].stage, 'ideas');
  assert.equal(collectWork('a', [{ ...idea, status: 'verification' }], [])[0].stage, 'ideas');
  assert.equal(collectWork('a', [{ ...idea, status: 'done' }], [])[0].stage, 'finished');
  const run = {
    id: 'run',
    taskId: 'task',
    projectId: 'a',
    prompt: 'Work',
    startedAt: '2026-09-02',
  };
  for (const status of ['failed', 'stopped', 'interrupted'])
    assert.equal(collectWork('a', [], [{ ...run, status }])[0].stage, 'attention');
  assert.equal(collectWork('a', [], [{ ...run, status: 'reviewed' }])[0].stage, 'finished');
  assert.equal(collectWork('a', [], [{ ...run, status: 'review' }])[0].stage, 'review');
  assert.equal(
    collectWork('a', [], [{ ...run, status: 'running', prompts: [{ status: 'pending' }] }])[0]
      .stage,
    'attention',
  );
  assert.equal(
    collectWork('a', [], [{ ...run, status: 'reviewed', persistenceError: 'Disk full' }])[0].stage,
    'attention',
  );
});

import { effortFor, effortPrompt, suggestedRunner } from '../src/lib/task-effort.ts';

test('task effort is restored with the idea without nesting guidance in the editable intent', () => {
  const draft = planningDraft({
    rawPrompt: 'Fix the dialog',
    effort: 'thorough',
    model: 'configured-model',
  });
  assert.equal(draft.prompt, 'Fix the dialog');
  assert.equal(draft.effort, 'thorough');
  assert.equal(draft.model, 'configured-model');
  assert.equal(effortFor(undefined).id, 'balanced');
  assert.equal(effortFor('unknown').id, 'balanced');
  assert.match(effortPrompt('quick'), /relevant checks/);
  assert.match(effortPrompt(draft.effort), /separate review pass/);
  assert.notEqual(effortPrompt('quick'), effortPrompt('balanced'));
});

test('automatic agent selection uses an available preference and never leaves the allowed roster', () => {
  const runners = [
    { id: 'preferred', available: false },
    { id: 'default', available: true },
    { id: 'other', available: true },
  ];
  assert.equal(suggestedRunner(runners, 'preferred', 'default').id, 'default');
  assert.equal(suggestedRunner(runners, 'other', 'default').id, 'other');
  assert.equal(suggestedRunner(runners, 'disabled', 'missing').id, 'default');
  assert.equal(suggestedRunner([], 'preferred', 'default'), undefined);
});
