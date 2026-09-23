import assert from 'node:assert/strict';
import test from 'node:test';
import { operationCounts, taskCounts } from '../../server/admin/metrics.ts';
import { observeOperation, telemetryOperation } from '../src/lib/operation-telemetry.ts';
import { createTaskTelemetry } from '../src/lib/task-telemetry.ts';

test('operation reporting preserves results and errors and excludes arguments and polling', async () => {
  const events = [];
  const track = (event) => events.push(event);
  const secret = { prompt: 'private prompt', path: '/private/repo', error: 'private failure' };
  assert.equal(
    telemetryOperation('live_session_action', { action: 'pause', ...secret }),
    'live_session_pause',
  );
  assert.equal(telemetryOperation('live_session_action', { action: '/private/path' }), null);
  for (const command of [
    'task_changes',
    'live_session_snapshot',
    'app_telemetry',
    'app_submit_feedback',
  ]) {
    await observeOperation(telemetryOperation(command, secret), async () => secret, track);
  }
  assert.equal(events.length, 0);
  assert.equal(await observeOperation('task_start', async () => secret, track), secret);
  await assert.rejects(
    observeOperation(
      'task_start',
      async () => {
        throw secret;
      },
      track,
    ),
    (error) => error === secret,
  );
  assert.deepEqual(events, [
    { name: 'operation_result', operation: 'task_start', outcome: 'accepted' },
    { name: 'operation_result', operation: 'task_start', outcome: 'failed' },
    { name: 'app_error', code: 'operation_failed', operation: 'task_start' },
  ]);
  assert.equal(
    await observeOperation(
      'task_start',
      async () => secret,
      () => {
        throw Error('reporter');
      },
    ),
    secret,
  );
});

test('native acknowledgements with failed checks, blocked merges and incomplete cleanup stay distinct', async () => {
  for (const [operation, result, expected] of [
    ['task_verify', { result: { success: false } }, 'failed'],
    ['task_verify', { result: { success: true } }, 'accepted'],
    ['mcp_probe_server', { ok: false, error: 'secret' }, 'failed'],
    ['integration_prepare', { status: 'conflict' }, 'blocked'],
    ['integration_apply', { status: 'applied', cleanupResults: [{ removed: false }] }, 'partial'],
    ['integration_apply', { status: 'applied', cleanupResults: [{ removed: true }] }, 'accepted'],
    ['task_respond_prompt', false, 'blocked'],
    ['task_import_recovery', null, 'canceled'],
  ]) {
    const events = [];
    await observeOperation(
      operation,
      async () => result,
      (event) => events.push(event),
    );
    assert.equal(events[0].outcome, expected, operation);
  }
});

const run = (fields = {}) => ({
  id: 'local-only-run',
  startedAt: new Date(2000).toISOString(),
  status: 'running',
  agent: 'codex',
  liveSessionId: null,
  persistenceError: null,
  ...fields,
});
test('history load, restored history and reloaded snapshots do not invent task starts', () => {
  const events = [];
  const observe = createTaskTelemetry((event) => events.push(event), 1000);
  const old = run({
    startedAt: new Date(0).toISOString(),
    status: 'failed',
    persistenceError: 'private',
  });
  observe([old], true);
  observe([], true);
  observe([old], true);
  assert.deepEqual(events, []);
  const current = run({ id: 'new', status: 'review', liveSessionId: 'private-session' });
  observe([old, current], true);
  observe([old, { ...current }], true);
  assert.deepEqual(events, [
    { name: 'task_state', state: 'starting', agent: 'codex', workflow: 'chat' },
    { name: 'task_state', state: 'review', agent: 'codex', workflow: 'chat' },
  ]);
});

test('opt-in does not replay prior work and unknown agent labels never leave the client', () => {
  const events = [];
  const observe = createTaskTelemetry((event) => events.push(event), 1000);
  const current = run({ agent: '/private/custom-agent' });
  observe([current], false);
  observe([current], true);
  assert.deepEqual(events, []);
  observe([{ ...current, status: 'stopped' }], true);
  assert.deepEqual(events, [
    { name: 'task_state', state: 'stopped', agent: 'other', workflow: 'task' },
  ]);
});

test('each failed verification is counted once and history errors remain content-free', () => {
  const events = [];
  const observe = createTaskTelemetry((event) => events.push(event), 1000);
  observe([run()], false);
  const check = (checkedAt) =>
    run({
      persistenceError: 'private path',
      checkpointError: 'private git output',
      verification: { checkedAt, result: { success: false } },
    });
  observe([check('first')], true);
  observe([check('first')], true);
  observe([check('second')], true);
  assert.deepEqual(
    events.map((event) => event.code),
    ['history_save_failed', 'checkpoint_failed', 'verification_failed', 'verification_failed'],
  );
  assert.ok(events.every((event) => Object.keys(event).length === 2));
});

test('dashboard preserves legacy unknowns and separates operation outcomes', () => {
  const metrics = [
    { name: 'task_state', dimension: 'starting', count: 7 },
    { name: 'task_state', dimension: 'review|codex|chat', count: 2 },
    { name: 'operation_result', dimension: 'task_verify|accepted', count: 3 },
    { name: 'operation_result', dimension: 'task_verify|failed', count: 1 },
    { name: 'operation_result', dimension: 'task_verify|accepted', count: 2 },
  ];
  assert.deepEqual(taskCounts(metrics), [
    { state: 'starting', agent: 'unknown', workflow: 'unknown', count: 7 },
    { state: 'review', agent: 'codex', workflow: 'chat', count: 2 },
  ]);
  assert.deepEqual(operationCounts(metrics), [
    { operation: 'task_verify', accepted: 5, failed: 1, blocked: 0, partial: 0, canceled: 0 },
  ]);
});
