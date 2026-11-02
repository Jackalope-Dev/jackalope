import assert from 'node:assert/strict';
import test from 'node:test';
import { swarmMap } from '../src/lib/swarm-map.ts';

const now = Date.parse('2026-11-02T12:00:00Z');
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const passed = { command: 'pnpm test', checkedAt: at(1), tree: 'tree', result: { success: true } };

const run = (id, overrides = {}) => ({
  id,
  taskId: `task-${id}`,
  projectId: 'p',
  prompt: `Build ${id}`,
  agent: 'claude',
  status: 'running',
  startedAt: at(30),
  endedAt: null,
  ...overrides,
});
const queue = (overrides = {}) => ({
  items: [],
  managedTasks: [],
  messages: [],
  enabledProjects: [],
  concurrency: 3,
  bridgeUrl: null,
  bridgeError: null,
  mergedRunIds: [],
  ...overrides,
});
const phases = (model) => Object.fromEntries(model.agents.map((a) => [a.id, a.phase]));

test('each task shows its latest attempt in the stage it has reached', () => {
  const model = swarmMap({
    projectId: 'p',
    now,
    queue: queue({ mergedRunIds: ['merged'] }),
    runs: [
      run('working'),
      run('checking', { finishing: true }),
      run('asking', { prompts: [{ id: 'q', status: 'pending', question: 'Which color?' }] }),
      run('ready', { status: 'review', endedAt: at(5), verification: passed }),
      run('red', {
        status: 'review',
        endedAt: at(5),
        verification: { ...passed, result: { success: false } },
      }),
      run('merged', { status: 'reviewed', endedAt: at(2), verification: passed }),
      run('old-try', { taskId: 'task-working', status: 'failed', startedAt: at(90) }),
      run('elsewhere', { projectId: 'other' }),
      run('archived', { archivedAt: at(1) }),
      run('stale', { status: 'failed', startedAt: at(3000), endedAt: at(2900) }),
    ],
  });
  assert.deepEqual(phases(model), {
    working: 'working',
    checking: 'checking',
    asking: 'attention',
    ready: 'ready',
    red: 'attention',
    merged: 'merged',
  });
  assert.equal(model.agents.find((a) => a.id === 'asking').detail, 'Asks: Which color?');
  assert.deepEqual(model.counts, {
    queued: 0,
    working: 1,
    checking: 1,
    ready: 1,
    attention: 2,
    merged: 1,
  });
});

test('queued planned work joins the map with its plan and planned scope', () => {
  const model = swarmMap({
    projectId: 'p',
    now,
    runs: [run('a')],
    queue: queue({
      managedTasks: [{ id: 'f', title: 'New marketing site' }],
      items: [
        {
          id: 'i1',
          projectId: 'p',
          featureId: 'f',
          title: 'Hero',
          agent: 'codex',
          scopes: ['src/hero/**'],
          dependencies: [],
          runId: null,
          error: null,
          canceled: false,
        },
        {
          id: 'i2',
          projectId: 'p',
          featureId: 'f',
          title: 'Started',
          agent: 'claude',
          scopes: [],
          dependencies: [],
          runId: 'a',
          error: null,
          canceled: false,
        },
        {
          id: 'i3',
          projectId: 'p',
          title: 'Canceled',
          agent: 'claude',
          scopes: [],
          dependencies: [],
          runId: null,
          error: null,
          canceled: true,
        },
      ],
    }),
  });
  const queued = model.agents.find((a) => a.id === 'item:i1');
  assert.equal(queued.phase, 'queued');
  assert.equal(queued.plan, 'New marketing site');
  assert.deepEqual(queued.files, ['src/hero/**']);
  assert.equal(model.agents.find((a) => a.id === 'a').plan, 'New marketing site');
  assert.equal(model.agents.length, 2);
});

test('shared files and conflicts connect the agents involved', () => {
  const file = (path) => ({ path, base: 'x', head: 'y' });
  const model = swarmMap({
    projectId: 'p',
    now,
    runs: [run('a'), run('b'), run('c')],
    queue: queue(),
    forks: [
      {
        fork: 'fa',
        attemptId: 'a',
        title: 'Header',
        files: [file('app.css'), file('nav.tsx')],
        truncated: false,
        error: null,
      },
      {
        fork: 'fb',
        attemptId: 'b',
        files: [file('app.css'), file('nav.tsx')],
        truncated: false,
        error: null,
      },
      { fork: 'fc', attemptId: 'c', files: [file('app.css')], truncated: true, error: null },
    ],
    conflicts: [{ forks: ['fa', 'fb'], path: 'nav.tsx', kind: 'overlapping-lines' }],
  });
  assert.equal(model.agents.find((a) => a.id === 'a').title, 'Header');
  assert.deepEqual(model.hotFiles, [
    { path: 'nav.tsx', agents: ['a', 'b'], conflicted: true },
    { path: 'app.css', agents: ['a', 'b', 'c'], conflicted: false },
  ]);
  assert.deepEqual(model.links, [{ from: 'a', to: 'b', path: 'nav.tsx' }]);
  assert.equal(model.agents.find((a) => a.id === 'c').conflicts, 0);
  assert.equal(model.agents.find((a) => a.id === 'b').conflicts, 1);
});

test('results the autonomy policy held wait for a person with its reason', () => {
  const model = swarmMap({
    projectId: 'p',
    now,
    runs: [run('final', { status: 'review', endedAt: at(1), verification: passed })],
    queue: queue({
      managedTasks: [
        {
          id: 'f',
          title: 'Plan',
          delivery: { held: 'Touches .github/workflows/ci.yml. Held for review.', appliedAt: null },
        },
      ],
      items: [
        {
          id: 'i',
          projectId: 'p',
          featureId: 'f',
          title: 'Final',
          agent: 'claude',
          scopes: [],
          dependencies: [],
          runId: 'final',
          error: null,
          canceled: false,
        },
      ],
    }),
  });
  const [agent] = model.agents;
  assert.equal(agent.phase, 'attention');
  assert.match(agent.detail, /Held for review/);
});
