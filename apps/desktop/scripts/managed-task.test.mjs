import assert from 'node:assert/strict';
import test from 'node:test';
import { countedTaskDecisions } from '../src/lib/decision-usage.ts';
import { managedTaskProgress, managedTaskWork } from '../src/lib/managed-task.ts';
import { projectTaskPresence, returnToProject } from '../src/lib/project-return.ts';
import { collectWorkspaceWork, selectedManagedTask } from '../src/lib/task-collection.ts';
import { assessmentKey } from '../src/lib/task-strategy.ts';

const task = {
  id: 'parent',
  title: 'Complete feature',
  plannerRunId: 'plan',
  runIds: ['plan', 'old', 'new'],
  createdAt: '2026-09-16',
  started: true,
  request: { projectId: 'project', agent: 'codex' },
};
const queue = {
  managedTasks: [task],
  items: [{ id: 'step', featureId: 'parent', runId: 'new', dependencies: [] }],
  enabledProjects: ['managed:parent'],
  mergedRunIds: [],
};
const runs = [
  {
    id: 'plan',
    taskId: 'plan',
    status: 'review',
    startedAt: '2026-09-16T00:00:00Z',
    projectId: 'project',
  },
  {
    id: 'old',
    taskId: 'old',
    status: 'failed',
    startedAt: '2026-09-16T00:01:00Z',
    projectId: 'project',
  },
  {
    id: 'new',
    taskId: 'new',
    status: 'running',
    startedAt: '2026-09-16T00:02:00Z',
    projectId: 'project',
  },
];

test('saved ideas join the parent without duplicate rows or manufactured attempts', () => {
  const idea = {
    id: 'idea',
    projectId: 'project',
    title: 'Saved intent',
    runId: 'parent',
    status: 'backlog',
    createdAt: '2026-09-16',
    updatedAt: '2026-09-16',
  };
  const items = collectWorkspaceWork('project', [idea], runs, [], [], false, queue);
  assert.equal(items.length, 1);
  assert.equal(items[0].idea, idea);
  assert.equal(items[0].managed, task);
  assert.equal(items[0].run.id, 'new');
  const unavailable = collectWorkspaceWork('project', [idea], [], [], [], false, {
    ...queue,
    managedTasks: [],
  });
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].idea, idea);
  const crossProject = { ...idea, id: 'other-idea', projectId: 'other' };
  assert.equal(
    collectWorkspaceWork(null, [idea, crossProject], runs, [], [], false, queue).length,
    2,
  );
});

test('explicit run and project selection cannot be masked by a previous parent', () => {
  assert.equal(selectedManagedTask(queue, runs, 'parent', null), task);
  assert.equal(selectedManagedTask(queue, runs, 'parent', 'old'), task);
  assert.equal(selectedManagedTask(queue, runs, 'parent', 'new'), task);
  assert.equal(selectedManagedTask(queue, runs, 'parent', 'unrelated'), undefined);
  assert.equal(selectedManagedTask(queue, runs, 'parent', null, 'other'), undefined);
  assert.equal(selectedManagedTask(queue, runs, null, 'new'), task);
  assert.equal(selectedManagedTask(queue, runs, null, 'plan'), task);
  assert.equal(selectedManagedTask(queue, runs, null, 'old'), task);
  assert.equal(selectedManagedTask(queue, runs, null, 'new', 'other'), undefined);
  assert.equal(selectedManagedTask(queue, runs, null, 'unrelated'), undefined);
  assert.equal(selectedManagedTask(queue, [], 'parent', 'new'), task);
});

test('retries remain in one parent and usage history without duplicate inbox rows', () => {
  const work = managedTaskWork(task, queue, runs);
  assert.deepEqual(
    work.work.map((r) => r.id),
    ['plan', 'old', 'new'],
  );
  assert.equal(work.failed, false);
  const items = collectWorkspaceWork('project', [], runs, [], [], false, queue);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'managed:parent');
  assert.equal(items[0].stage, 'working');
});

test('a completed worker does not hide a managed task blocker in its list badge', () => {
  const completed = [
    runs[0],
    { ...runs[2], status: 'review', verification: { tree: 'tree', result: { success: true } } },
  ];
  const blocked = { ...queue, managedTasks: [{ ...task, error: 'The target branch changed.' }] };
  const item = collectWorkspaceWork('project', [], completed, [], [], false, blocked)[0];
  assert.equal(item.stage, 'attention');
  assert.equal(item.statusLabel, 'Needs attention');
  const ready = collectWorkspaceWork('project', [], completed, [], [], false, queue)[0];
  assert.equal(ready.stage, 'review');
  assert.equal(ready.statusLabel, 'Ready to review');
});

test('project overview groups planning, workers and retries under the dispatched request', () => {
  const retry = { ...runs[2], id: 'retry', startedAt: '2026-09-16T00:03:00Z' };
  const ordinary = {
    ...runs[0],
    id: 'ordinary',
    taskId: 'ordinary',
    prompt: 'Plan this complete request using the repository and its instructions',
  };
  const otherProject = { ...ordinary, id: 'outside', taskId: 'outside', projectId: 'outside' };
  const allRuns = [...runs, retry, ordinary, otherProject];
  const items = returnToProject(allRuns, 'project', [], { queue });
  assert.equal(items.length, 2);
  const parent = items.find((item) => item.managed);
  assert.equal(parent.title, 'Complete feature');
  assert.equal(parent.run.id, 'retry');
  assert.equal(items.find((item) => item.run.id === 'ordinary').run, ordinary);
  assert.equal(projectTaskPresence(parent, allRuns, queue).label, 'Working');
  assert.equal(projectTaskPresence(parent, allRuns, queue).state, 'working');
  assert.deepEqual(returnToProject(allRuns, 'empty-project', [], { queue }), []);

  const finishedQueue = { ...queue, mergedRunIds: ['retry'] };
  assert.deepEqual(
    returnToProject(allRuns, 'project', ['retry'], { queue: finishedQueue }).map(
      (item) => item.run.id,
    ),
    ['ordinary'],
  );
});

test('project status follows active workers and pending questions instead of the completed planner', () => {
  const waitingRuns = [runs[0], { ...runs[2], agent: 'claude', prompts: [{ status: 'pending' }] }];
  const parent = returnToProject(waitingRuns, 'project', [], { queue })[0];
  assert.deepEqual(projectTaskPresence(parent, waitingRuns, queue), {
    label: 'Needs input',
    state: 'waiting',
    agents: ['claude'],
  });

  const queued = { ...queue, items: [{ ...queue.items[0], runId: null }] };
  const idle = returnToProject([runs[0]], 'project', [], { queue: queued })[0];
  assert.equal(projectTaskPresence(idle, [runs[0]], queued).label, 'Queued');
  assert.equal(projectTaskPresence(idle, [runs[0]], queued).state, 'idle');
  const paused = { ...queued, enabledProjects: [] };
  assert.equal(projectTaskPresence(idle, [runs[0]], paused).label, 'Paused');
});

test('project overview includes a chat once and excludes saved ideas, archives and finished work', () => {
  const session = {
    id: 'chat',
    title: 'Explore keyboard navigation',
    request: { projectId: 'project' },
    updatedAt: '2026-09-16',
    messages: [],
    batches: [{ runId: 'batch' }],
    closed: false,
    paused: false,
  };
  const chatRun = { ...runs[2], id: 'batch', taskId: 'batch', liveSessionId: 'chat' };
  const archived = { ...runs[0], id: 'archived', taskId: 'archived', archivedAt: '2026-09-16' };
  const merged = { ...runs[0], id: 'merged', taskId: 'merged' };
  const idea = { id: 'idea', projectId: 'project', title: 'Saved for later', status: 'backlog' };
  const allRuns = [chatRun, archived, merged];
  const items = returnToProject(allRuns, 'project', ['merged'], {
    ideas: [idea],
    sessions: [session],
    queue,
  });
  assert.deepEqual(items.map((item) => item.id).sort(), ['managed:parent', 'session:chat']);
  const chat = items.find((item) => item.session);
  assert.equal(chat.title, session.title);
  assert.equal(projectTaskPresence(chat, allRuns, queue).label, 'Working');
  assert.equal(
    returnToProject(allRuns, 'project', ['merged'], {
      ideas: [idea],
      sessions: [{ ...session, closed: true }],
    }).length,
    1,
  );
  const finished = [{ ...chatRun, status: 'reviewed' }, archived, merged];
  assert.deepEqual(
    returnToProject(finished, 'project', ['merged'], {
      ideas: [idea],
      sessions: [{ ...session, closed: true }],
    }),
    [],
  );
});

test('a combined result requires successful current verification and complete children', () => {
  const passed = {
    ...runs[2],
    status: 'review',
    verification: { result: { success: true }, tree: 'verified' },
  };
  assert.equal(managedTaskWork(task, queue, [...runs.slice(0, 2), passed]).ready, true);
  assert.equal(
    managedTaskWork(task, queue, [...runs.slice(0, 2), { ...passed, dependencyInvalidated: true }])
      .ready,
    false,
  );
  assert.equal(managedTaskWork(task, queue, runs.slice(0, 2)).failed, true);
  const waiting = {
    ...queue,
    items: [
      ...queue.items,
      { id: 'last', featureId: 'parent', runId: null, dependencies: ['step'] },
    ],
  };
  assert.equal(managedTaskWork(task, waiting, [...runs.slice(0, 2), passed]).ready, false);
});

test('archived attempts retain integrated status but leave history and usage incomplete', () => {
  const work = managedTaskWork(task, { ...queue, mergedRunIds: ['new'] }, []);
  assert.equal(work.integrated, true);
  assert.equal(work.status, 'Integrated');
  assert.equal(work.ready, false);
  assert.deepEqual(new Set(work.missingAttempts), new Set(['plan', 'old', 'new']));
});

test('unresolved shared decisions prevent final review even when checks pass', () => {
  const passed = {
    ...runs[2],
    status: 'review',
    verification: { result: { success: true }, tree: 'verified' },
  };
  const agreement = {
    kind: 'interface',
    taskId: 'step',
    participants: ['outside'],
    status: 'rejected',
    resource: 'API response',
  };
  const work = managedTaskWork(task, { ...queue, agreements: [agreement] }, [passed]);
  assert.equal(work.ready, false);
  assert.equal(work.status, 'Needs attention');
  assert.match(managedTaskProgress(task, work).description, /API response/);
  assert.equal(
    managedTaskWork(task, { ...queue, agreements: [{ ...agreement, status: 'reconciled' }] }, [
      passed,
    ]).ready,
    true,
  );
});

test('decision usage counts failed calls once and excludes no-call fallbacks', () => {
  const entry = {
    id: 'attempt',
    projectId: 'project',
    createdAt: '2026-09-16',
    decision: {
      requestedMode: 'jev',
      provider: 'local_rules',
      modelCallAttempted: true,
      usage: { reported: false },
    },
  };
  const records = [
    entry,
    entry,
    { ...entry, id: 'local', decision: { ...entry.decision, modelCallAttempted: false } },
  ];
  assert.deepEqual(
    countedTaskDecisions(records).map((r) => r.id),
    ['attempt'],
  );
  assert.equal(countedTaskDecisions(records, 'other').length, 0);
  assert.equal(countedTaskDecisions(records, undefined, Date.parse('2026-09-17')).length, 0);
});

test('assessment identity ignores request IDs but retains all execution settings', () => {
  const request = {
    id: 'one',
    prompt: 'full constraints',
    agent: 'codex',
    model: 'pinned',
    connectionIds: [],
  };
  assert.equal(
    assessmentKey(request, 'intent'),
    assessmentKey({ ...request, id: 'two' }, 'intent'),
  );
  for (const changed of [
    { model: 'other' },
    { connectionIds: ['new'] },
    { prompt: 'different' },
    { autoVerify: false },
  ])
    assert.notEqual(
      assessmentKey(request, 'intent'),
      assessmentKey({ ...request, ...changed }, 'intent'),
    );
});

test('delivery distinguishes combining and repairs without showing unfinished work as reviewed', () => {
  const parent = {
    ...task,
    delivery: {
      finalItem: 'combined',
      integrationItems: ['combined'],
      repairs: [{ runId: 'repair' }],
    },
  };
  const deliveryQueue = {
    ...queue,
    items: [
      queue.items[0],
      { id: 'combined', featureId: 'parent', runId: 'repair', dependencies: ['step'] },
    ],
  };
  const repair = { ...runs[2], id: 'repair', taskId: 'repair' };
  const work = managedTaskWork(parent, deliveryQueue, [...runs, repair]);
  assert.equal(work.status, 'Fixing checks');
  assert.equal(work.combined.id, 'repair');
  assert.equal(work.ready, false);
  assert.equal(managedTaskProgress(parent, work).stage, 1);
  assert.equal(work.assignments.length, 1);
  const blocked = managedTaskWork(
    { ...parent, error: 'Repair needs a decision.' },
    deliveryQueue,
    runs,
  );
  assert.equal(blocked.failed, true);
});

test('the final result stays stable when intermediate integrations are inserted out of order', () => {
  const parent = {
    ...task,
    delivery: { finalItem: 'final', integrationItems: ['checkpoint', 'final'], repairs: [] },
  };
  const passed = (id) => ({
    ...runs[2],
    id,
    taskId: id,
    status: 'review',
    verification: { result: { success: true }, tree: id },
  });
  const items = ['step', 'final', 'checkpoint'].map((id) => ({
    id,
    featureId: 'parent',
    runId: id,
    dependencies: [],
  }));
  const work = managedTaskWork(parent, { ...queue, items }, [
    ...runs.slice(0, 2),
    ...items.map((item) => passed(item.id)),
  ]);
  assert.equal(work.combined.id, 'final');
  assert.equal(work.ready, true);
  assert.equal(managedTaskProgress(parent, work).stage, 3);
  assert.equal(work.assignments.length, 1);
});
