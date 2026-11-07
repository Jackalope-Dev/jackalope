import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ERROR_CODES,
  FEATURES,
  metricDimension,
  OPERATION_OUTCOMES,
  OPERATIONS,
  operationCounts,
  TASK_STATES,
  TELEMETRY_AGENTS,
  taskCounts,
  WORKFLOWS,
} from '../src/telemetry.ts';

// The native client round-trips this fixture, so covering every value here
// checks the Rust enums against these lists.
const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../apps/desktop/scripts/fixtures/telemetry-events.json', import.meta.url),
    'utf8',
  ),
);

test('the shared fixture uses every contract value', () => {
  for (const [field, values] of [
    ['operation', OPERATIONS],
    ['outcome', OPERATION_OUTCOMES],
    ['feature', FEATURES],
    ['code', ERROR_CODES],
    ['state', TASK_STATES],
    ['agent', TELEMETRY_AGENTS],
    ['workflow', WORKFLOWS],
  ])
    for (const value of values)
      assert.ok(
        fixtures.some((fixture) => fixture[field] === value),
        `${field} ${value} is missing from telemetry-events.json`,
      );
});

test('dimensions encode the grouped fields and decode into report rows', () => {
  const metrics = [
    { name: 'operation_result', operation: 'task_start', outcome: 'failed' },
    { name: 'operation_result', operation: 'task_start', outcome: 'accepted' },
    { name: 'task_state', state: 'starting' },
    { name: 'task_state', state: 'review', agent: 'codex' },
    { name: 'app_error', code: 'ui_error', feature: 'chat' },
    { name: 'feature_used', feature: 'tasks' },
    { name: 'app_opened' },
  ].map((metric) => ({ name: metric.name, dimension: metricDimension(metric), count: 2 }));
  assert.deepEqual(
    metrics.map((metric) => metric.dimension),
    [
      'task_start|failed',
      'task_start|accepted',
      'starting',
      'review|codex|unknown',
      'ui_error||chat',
      'tasks',
      '',
    ],
  );
  assert.deepEqual(operationCounts(metrics), [
    { operation: 'task_start', accepted: 2, failed: 2, blocked: 0, partial: 0, canceled: 0 },
  ]);
  assert.deepEqual(taskCounts(metrics), [
    { state: 'starting', agent: 'unknown', workflow: 'unknown', count: 2 },
    { state: 'review', agent: 'codex', workflow: 'unknown', count: 2 },
  ]);
});
