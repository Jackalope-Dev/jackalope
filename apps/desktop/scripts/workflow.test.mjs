import assert from 'node:assert/strict';
import test from 'node:test';
import { agentProvider, taskAgents } from '../src/lib/agent-provider.ts';
import { taskNotices } from '../src/lib/companion-tasks.ts';
import { waitForStoppedAttempt } from '../src/lib/continue-task.ts';
import { planningDraft } from '../src/lib/planning.ts';
import { returnToProject } from '../src/lib/project-return.ts';
import { collectWork, collectWorkspaceWork, workPresence } from '../src/lib/task-collection.ts';
import {
  latestAttempt,
  mergeDestination,
  safeResultLink,
  taskDecision,
  taskNextAction,
} from '../src/lib/task-workflow.ts';
import { usageEntries } from '../src/lib/usage-entries.ts';

const run = {
  id: 'run',
  taskId: 'task',
  projectId: 'a',
  prompt: 'Original intent',
  startedAt: '2026-09-01',
  status: 'review',
  sessionId: 'session',
};

test('failed or missing checks take priority over review and integration actions', () => {
  const finished = { ...run, workspace: '/repo/task', projectPath: '/repo', status: 'reviewed' };
  assert.equal(taskDecision({ ...finished, verificationError: 'Check failed' }).section, 'changes');
  assert.equal(
    taskDecision({ ...finished, verification: { result: { success: false }, tree: 'tree' } }).tone,
    'warning',
  );
  assert.equal(
    taskDecision({ ...finished, verification: { result: { success: true }, tree: null } }).tone,
    'warning',
  );
  assert.equal(taskDecision(finished, false, 'pnpm test').section, 'verify');
  assert.equal(taskDecision(finished).section, 'integrate');
  assert.equal(taskDecision(finished).action, 'Merge into your project');
  assert.equal(taskDecision({ ...finished, targetBranch: 'main' }).action, 'Merge into main');
  assert.equal(taskDecision({ ...finished, status: 'review' }).action, 'Review and merge');
  assert.equal(mergeDestination({ targetBranch: 'release' }), 'release');
  assert.equal(mergeDestination({ targetBranch: null }, { gitBranch: 'main' }), 'main');
  assert.equal(taskDecision({ ...finished, workspace: '/repo' }).section, 'delivery');
  assert.equal(taskDecision(finished, true).label, 'Changes integrated locally');
  assert.equal(
    taskDecision({ ...finished, persistenceError: 'Disk full' }, true).section,
    'recovery',
  );
});

test('unified work includes live sessions once and respects project scope and archive', () => {
  const session = {
    id: 'live',
    title: 'Live work',
    request: { projectId: 'a' },
    updatedAt: '2026-09-02',
    messages: [],
    batches: [{ runId: 'live-run' }],
    closed: false,
    paused: false,
  };
  const liveRun = {
    ...run,
    id: 'live-run',
    taskId: 'live-task',
    liveSessionId: 'live',
    status: 'running',
    prompts: [{ status: 'pending' }],
  };
  const items = collectWorkspaceWork('a', [], [run, liveRun], [session]);
  assert.equal(items.length, 2);
  assert.equal(items[0].session.id, 'live');
  assert.equal(items[0].stage, 'attention');
  assert.equal(collectWorkspaceWork('b', [], [run, liveRun], [session]).length, 0);
  assert.equal(collectWorkspaceWork('a', [], [run, liveRun], [session], [], true).length, 0);
});

test('global work prioritizes decisions, review, running work and saved projectless ideas', () => {
  const items = collectWork(
    null,
    [
      {
        id: 'idea',
        title: 'Unassigned',
        projectId: '',
        status: 'backlog',
        updatedAt: '2026-09-04',
      },
    ],
    [
      run,
      {
        ...run,
        id: 'waiting',
        taskId: 'waiting',
        projectId: 'b',
        status: 'running',
        prompts: [{ status: 'pending' }],
      },
      { ...run, id: 'working', taskId: 'working', status: 'running' },
    ],
  );
  assert.deepEqual(
    items.map((item) => item.stage),
    ['attention', 'review', 'working', 'ideas'],
  );
  assert.equal(collectWork('', [items.at(-1).idea], [run]).length, 1);
  assert.equal(collectWork(null, [], [run], ['run'])[0].stage, 'finished');
  assert.equal(
    collectWork(null, [], [{ ...run, persistenceError: 'Disk full' }], ['run'])[0].stage,
    'attention',
  );
});

test('latest attempt follows timestamps and current questions override generic working status', () => {
  const newer = { ...run, id: 'new', startedAt: '2026-09-02' };
  assert.equal(latestAttempt([newer, run], run.taskId).id, 'new');
  const offset = { ...run, id: 'offset', startedAt: '2026-09-06T18:42:16-06:00' };
  const utc = { ...run, id: 'utc', startedAt: '2026-09-07T00:41:16Z' };
  assert.equal(latestAttempt([utc, offset], run.taskId).id, 'offset');
  assert.equal(collectWork(null, [], [utc, offset])[0].run.id, 'offset');
  assert.equal(
    taskNextAction({ ...run, status: 'running', prompts: [{ status: 'pending' }] }),
    'Answer question',
  );
  assert.equal(taskNextAction({ ...run, status: 'running', finishing: true }), 'View checks');
});

test('work presence names agents, waiting state and the next action', () => {
  assert.equal(agentProvider('my-bot', 'claude'), 'claude');
  assert.equal(agentProvider('kimi-code'), 'kimi');
  assert.deepEqual(
    taskAgents({
      agent: 'claude',
      routing: { handoffs: [{ agent: 'codex' }, { agent: 'claude' }] },
    }),
    ['claude', 'codex'],
  );
  const presence = workPresence({
    id: 't',
    title: 'Fix search',
    stage: 'working',
    date: '2026-09-11',
    run: { ...run, agent: 'claude', status: 'running', prompts: [{ status: 'pending' }] },
  });
  assert.deepEqual(presence.agents, ['claude']);
  assert.equal(presence.state, 'waiting');
  assert.equal(presence.action, 'Answer question');
  assert.equal(
    workPresence({
      id: 'idea',
      title: 'Saved idea',
      stage: 'ideas',
      date: '2026-09-11',
      idea: { assignedAgent: 'grok' },
    }).agents[0],
    'grok',
  );
});

test('archived work stays grouped with its saved idea and resumes with a new attempt', () => {
  const original = { ...run, id: 'task', status: 'failed' };
  const archived = { ...run, archivedAt: '2026-09-02', startedAt: '2026-09-02' };
  const idea = { id: 'idea', runId: 'task', title: 'Saved title', projectId: 'a' };
  assert.equal(collectWork(null, [idea], [original, archived]).length, 0);
  const items = collectWork(null, [idea], [original, archived], [], true);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Saved title');
  assert.equal(items[0].run.id, archived.id);
  assert.equal(collectWork(null, [idea], [archived], [], true)[0].title, 'Saved title');
  const resumed = { ...run, id: 'resumed', startedAt: '2026-09-03', status: 'running' };
  assert.equal(collectWork(null, [idea], [original, archived, resumed])[0].run.id, 'resumed');
  assert.equal(collectWork(null, [idea], [original, archived, resumed], [], true).length, 0);
  const saved = { ...idea, runId: undefined, archivedAt: '2026-09-02' };
  assert.equal(collectWork(null, [saved], []).length, 0);
  assert.equal(collectWork(null, [saved], [], [], true)[0].idea.id, 'idea');
});

test('cleanup checks every attempt and keeps unfinished ownership visible', () => {
  const finished = { ...run, id: 'new', status: 'reviewed', startedAt: '2026-09-02' };
  for (const previous of [
    { ...run, status: 'interrupted' },
    { ...run, status: 'running' },
    { ...run, persistenceError: 'Disk full' },
    { ...run, liveSessionId: 'session' },
    { ...run, finishing: true },
  ]) {
    assert.ok(collectWork(null, [], [previous, finished])[0].archiveBlocked);
  }
  assert.equal(collectWork(null, [], [run, finished])[0].archiveBlocked, undefined);
});

test('archiving clears task reminders without reviving an older attempt', () => {
  const previous = { ...run, status: 'failed' };
  const archived = { ...run, id: 'new', startedAt: '2026-09-02', archivedAt: '2026-09-03' };
  assert.deepEqual(
    taskNotices([previous, archived], () => {}),
    [],
  );
  assert.deepEqual(returnToProject([previous, archived], 'a', []), []);
  assert.equal(taskNotices([previous, { ...archived, archivedAt: null }], () => {}).length, 1);
});

test('stop and send waits for actual termination and refuses interrupted or missing ownership', async () => {
  let reads = 0;
  let waits = 0;
  const finished = await waitForStoppedAttempt(
    'run',
    async () => ({ ...run, status: ++reads < 3 ? 'stopping' : 'stopped' }),
    async () => {
      waits++;
    },
  );
  assert.equal(finished.status, 'stopped');
  assert.equal(waits, 2);
  await assert.rejects(
    waitForStoppedAttempt(
      'run',
      async () => ({ ...run, status: 'interrupted' }),
      async () => {},
    ),
    /ownership/,
  );
  await assert.rejects(
    waitForStoppedAttempt(
      'run',
      async () => undefined,
      async () => {},
    ),
    /unavailable/,
  );
  await assert.rejects(
    waitForStoppedAttempt(
      'run',
      async () => ({ ...run, sessionId: null }),
      async () => {},
    ),
    /resumable/,
  );
  await assert.rejects(
    waitForStoppedAttempt(
      'run',
      async () => ({ ...run, status: 'stopping' }),
      async () => {},
      2,
    ),
    /still stopping/,
  );
});

test('result links allow only explicit web addresses', () => {
  assert.equal(safeResultLink('https://example.com/result'), 'https://example.com/result');
  for (const href of [
    'javascript:alert(1)',
    'file:///private',
    'data:text/html,x',
    '/relative',
    'shell:run',
  ])
    assert.equal(safeResultLink(href), undefined);
});

test('saved ideas preserve an explicitly empty tool scope', () => {
  assert.deepEqual(planningDraft({ rawPrompt: 'Keep this', connectionIds: [] }).connectionIds, []);
  assert.equal(planningDraft({ rawPrompt: 'Keep this' }).connectionIds, undefined);
});

test('saved ideas restore knowledge selection together with connection scope', () => {
  const contextSelection = { workflowId: 'review', excludedMemoryIds: ['old'], memoryOff: true };
  const draft = planningDraft({ rawPrompt: 'Keep this', connectionIds: [], contextSelection });
  assert.deepEqual(draft.connectionIds, []);
  assert.deepEqual(draft.contextSelection, contextSelection);
});

test('routing and interrupted workers retain separate account usage without duplicate decision totals', () => {
  const usage = { reported: true, input: 10, output: 5 };
  const binding = { adapter: 'codex', profileId: 'account-a', label: 'A' };
  const run = {
    id: 'task',
    agent: 'claude',
    account: 'B',
    usage,
    routing: {
      decisions: [{ usage }, { usage }],
      handoffs: [{ agent: 'codex', binding, usage, recordedAt: '2026-09-08' }],
      attempts: [{ agent: 'codex', binding, usage, error: null, recordedAt: '2026-09-08' }],
    },
  };
  const entries = usageEntries([run]);
  assert.equal(entries.length, 3);
  assert.equal(
    entries.reduce((sum, entry) => sum + entry.usage.input + entry.usage.output, 0),
    45,
  );
  assert.equal(
    entries.filter((entry) => entry.accountBinding?.profileId === 'account-a').length,
    2,
  );
  assert.equal(new Set(entries.map((entry) => entry.usageKey)).size, 3);
  assert.equal(usageEntries([{ ...run, routing: undefined }]).length, 1);
  assert.equal(
    usageEntries([
      { ...run, routing: { decisions: [], handoffs: [], attempts: run.routing.attempts } },
    ]).length,
    1,
  );
});
