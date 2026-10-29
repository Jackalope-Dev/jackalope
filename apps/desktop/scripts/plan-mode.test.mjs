import assert from 'node:assert/strict';
import test from 'node:test';
import { managedTaskWork } from '../src/lib/managed-task.ts';
import {
  approvalVerification,
  criterionCoverage,
  interviewOptions,
  manualPlan,
  shapeChoices,
  stateTone,
  taskWaves,
} from '../src/lib/plan-mode.ts';

const tasks = [
  { key: 'api', dependsOn: [], covers: ['AC-1'], status: '' },
  { key: 'ui', dependsOn: ['api'], covers: ['AC-2'], status: '' },
  { key: 'docs', dependsOn: [], covers: [], status: '' },
  { key: 'e2e', dependsOn: ['ui', 'docs'], covers: ['AC-1', 'AC-2'], status: '' },
];

test('tasks group into dependency waves', () => {
  assert.deepEqual(taskWaves(tasks), [['api', 'docs'], ['ui'], ['e2e']]);
  // A cycle cannot hang the page; the rest land in a final wave.
  assert.deepEqual(
    taskWaves([
      { key: 'a', dependsOn: ['b'] },
      { key: 'b', dependsOn: ['a'] },
    ]),
    [['a', 'b']],
  );
});

test('criteria list the tasks that cover them', () => {
  const coverage = criterionCoverage({
    tasks,
    criteria: [
      { id: 'AC-1', verify: 'test', check: 'pnpm test', text: 'Works' },
      { id: 'AC-3', verify: 'manual', check: '', text: 'Looks right' },
    ],
  });
  assert.deepEqual(coverage[0].tasks, ['api', 'e2e']);
  assert.deepEqual(coverage[1].tasks, []);
});

test('shapes explain why one is unavailable', () => {
  const document = { tasks };
  const offline = shapeChoices({ swarmConnected: false, document });
  assert.equal(
    offline.find((choice) => choice.shape === 'swarm').unavailable.includes('swarm'),
    true,
  );
  assert.equal(offline.find((choice) => choice.shape === 'subtasks').unavailable, undefined);
  const lastTask = shapeChoices({
    swarmConnected: true,
    document: { tasks: tasks.map((task, i) => ({ ...task, status: i ? 'done' : '' })) },
  });
  assert.match(lastTask.find((choice) => choice.shape === 'subtasks').unavailable, /one task/);
  assert.equal(lastTask.find((choice) => choice.shape === 'single').unavailable, undefined);
});

test('the recommended option leads and stop options come last', () => {
  const { choices, stops } = interviewOptions({
    options: ['Tabs', 'Comma', 'Use your recommendations for the rest', 'Done, draft the plan'],
    recommended: 'Comma',
  });
  assert.deepEqual(choices, ['Comma', 'Tabs']);
  assert.deepEqual(stops, ['Use your recommendations for the rest', 'Done, draft the plan']);
  assert.deepEqual(interviewOptions({ options: ['A'] }).choices, ['A']);
});

test('states map to tones with failures distinct from success', () => {
  assert.equal(stateTone('check-passed'), 'success');
  assert.equal(stateTone('human-accepted'), 'success');
  assert.equal(stateTone('check-failed'), 'danger');
  assert.equal(stateTone('agent-claimed'), 'accent');
  assert.equal(stateTone('unassessed'), 'muted');
});

test('plan-started managed tasks do not report a missing planner attempt', () => {
  const queue = { items: [], managedTasks: [], enabledProjects: [], mergedRunIds: [] };
  const base = {
    id: 'parent',
    title: 'Plan',
    plannerRunId: 'never-ran',
    runIds: [],
    createdAt: 'now',
    started: true,
    request: { projectId: 'project', agent: 'codex' },
  };
  assert.deepEqual(managedTaskWork(base, queue, []).missingAttempts, ['never-ran']);
  assert.deepEqual(
    managedTaskWork({ ...base, plan: { planId: 'p', revision: 1 } }, queue, []).missingAttempts,
    [],
  );
});

test('written plans keep task order, map dependencies to positions and drop blank outcomes', () => {
  const plan = manualPlan(' Add CSV export ', [
    {
      key: 'a1',
      title: ' Serialize ',
      prompt: 'Follow src/json.ts',
      scopes: ['src/csv.ts', ' '],
      dependsOn: [],
      contextSelection: { outcomes: ['Quotes are escaped', ' '] },
    },
    { key: 'b2', title: 'Button', prompt: '', scopes: ['src/ui'], dependsOn: ['a1', 'gone'] },
  ]);
  assert.equal(plan.goal, 'Add CSV export');
  assert.deepEqual(plan.tasks[0], {
    title: 'Serialize',
    instructions: 'Follow src/json.ts',
    scopes: ['src/csv.ts'],
    dependsOn: [],
    outcomes: ['Quotes are escaped'],
  });
  assert.deepEqual(plan.tasks[1].dependsOn, [0]);
  assert.deepEqual(plan.tasks[1].outcomes, []);
});

test('approval checks with the project, then the plan criteria, then review only', () => {
  assert.deepEqual(approvalVerification({ criteriaCheck: 'pnpm test csv' }, ' pnpm verify '), {
    source: 'project',
    command: 'pnpm verify',
  });
  assert.deepEqual(approvalVerification({ criteriaCheck: 'pnpm test csv' }, ''), {
    source: 'criteria',
    command: 'pnpm test csv',
  });
  assert.deepEqual(approvalVerification({ criteriaCheck: null }, undefined), {
    source: 'review',
    command: null,
  });
});
