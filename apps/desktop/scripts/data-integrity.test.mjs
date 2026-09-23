import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeTask } from '../src/lib/task-runtime.ts';
import { createWorktree, getSystemInfo, listWorktrees } from '../src/lib/tauri-bridge.ts';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = { localStorage: globalThis.localStorage };
const realTask = {
  id: 'task-1700000000000',
  projectId: 'jackalope-core',
  title: 'Dynamic Palette OKLCH Color Engine',
  rawPrompt: 'My work',
};
storage.set(
  'jackalope-tasks',
  JSON.stringify({
    version: 0,
    state: {
      tasks: [
        { id: 'task-1', projectId: 'jackalope-core' },
        realTask,
        { id: 'task-1', projectId: 'another-project', title: 'Imported work' },
      ],
    },
  }),
);
storage.set(
  'jackalope-schedules',
  JSON.stringify({
    version: 1,
    state: {
      schedules: [
        { id: 'sched-1' },
        {
          id: 'sched-1700000000000',
          name: 'My schedule',
          prompt: 'Check builds',
          lastRun: { status: 'success', summary: '0 regressions' },
          nextRun: 'Tonight',
        },
      ],
    },
  }),
);
storage.set(
  'jackalope-projects',
  JSON.stringify({
    version: 0,
    state: {
      activeProjectId: 'owned',
      projects: [
        {
          id: 'owned',
          name: 'My project',
          path: '/owned',
          worktrees: [{ path: '.worktrees/feat-auto-prompt', head: '7fa4b12' }],
        },
      ],
    },
  }),
);
const { useProjectStore } = await import('../src/stores/projectStore.ts');
const { useTaskStore } = await import('../src/stores/taskStore.ts');
const { useScheduleStore } = await import('../src/stores/scheduleStore.ts');

test('native operations cannot fabricate worktrees, device details or processes', async () => {
  for (const operation of [
    () => listWorktrees('/repo'),
    () => createWorktree('/repo', '.worktrees/test', 'test'),
    () => getSystemInfo(),
    () => nativeTask('pty_spawn', { program: 'node', args: [], workingDir: '/repo' }),
    () => nativeTask('pty_write', { sessionId: 'missing', data: 'test' }),
    () => nativeTask('pty_kill', { sessionId: 'missing' }),
  ])
    await assert.rejects(operation, /desktop app/);
});

test('old planning fixtures migrate away while real and imported work survives reload', async () => {
  assert.deepEqual(
    useTaskStore.getState().tasks.map((t) => t.id),
    [realTask.id, 'task-1'],
  );
  assert.deepEqual(useTaskStore.getState().tasks[0], realTask);
  await useTaskStore.persist.rehydrate();
  assert.equal(useTaskStore.getState().tasks.length, 2);
  assert.equal(JSON.parse(storage.get('jackalope-tasks')).version, 1);
});

test('schedule migration keeps definitions but drops synthetic execution history', () => {
  const schedules = useScheduleStore.getState().schedules;
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].prompt, 'Check builds');
  assert.equal(schedules[0].lastRun, undefined);
  assert.equal(schedules[0].nextRun, undefined);
});

test('new profiles begin with empty planning and schedule lists', () => {
  assert.deepEqual(useTaskStore.getInitialState().tasks, []);
  assert.deepEqual(useScheduleStore.getInitialState().schedules, []);
});

test('cached worktrees are refreshed from native data and unavailable reads are visible', async () => {
  assert.equal(useProjectStore.getState().projects[0].path, '/owned');
  assert.deepEqual(useProjectStore.getState().projects[0].worktrees, []);
  await useProjectStore.getState().loadWorktreesForActiveProject();
  assert.match(useProjectStore.getState().worktreesError, /desktop app/);
  assert.deepEqual(useProjectStore.getState().projects[0].worktrees, []);
});
