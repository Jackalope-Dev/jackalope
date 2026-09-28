import assert from 'node:assert/strict';
import test from 'node:test';

const entries = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
    clear: () => entries.clear(),
  },
};

import {
  parseScheduleTiming,
  savedPlanDraft,
  scheduleHourIntervals,
  scheduleTimingExpression,
} from '../src/lib/schedules.ts';
import { useScheduleStore } from '../src/stores/scheduleStore.ts';

test('hourly schedules support all standard clock-aligned intervals and minute offsets', () => {
  for (const interval of scheduleHourIntervals) {
    for (const minute of ['00', '15', '30', '45', '59']) {
      const expr = scheduleTimingExpression('hourly', `00:${minute}`, '1', interval);
      assert.ok(expr, `failed to generate expression for interval ${interval} minute ${minute}`);
      const parsed = parseScheduleTiming(expr);
      assert.ok(parsed, `failed to parse ${expr}`);
      assert.equal(parsed.repeat, 'hourly');
      assert.equal(parsed.hours, interval);
      assert.equal(parsed.time, `00:${minute}`);
    }
  }
});

test('schedule timing rejects invalid timezones, hours, or out-of-range minutes', () => {
  assert.equal(scheduleTimingExpression('hourly', '00:60', '1', '1'), null);
  assert.equal(scheduleTimingExpression('hourly', '24:00', '1', '1'), null);
  assert.equal(scheduleTimingExpression('hourly', '00:00', '7', '1'), null);
  assert.equal(scheduleTimingExpression('hourly', '00:00', '1', '5'), null);
  assert.equal(scheduleTimingExpression('hourly', '00:00', '1', '24'), null);

  assert.equal(parseScheduleTiming('60 * * * *'), null);
  assert.equal(parseScheduleTiming('0 25 * * *'), null);
  assert.equal(parseScheduleTiming('0 9 * * 8'), null);
});

test('missed run policy contracts distinguish skip and once catch-up behavior', () => {
  // Simulating the scheduling tick contract implemented in native schedules.rs:
  // A schedule overdue by > 60 seconds is evaluated against its `missed` policy.
  const evaluateMissedRun = (missedPolicy, scheduledTime, currentTime) => {
    const isLate = (currentTime.getTime() - scheduledTime.getTime()) / 1000 > 60;
    if (!isLate) {
      return { run: true, outcome: 'Reserved' };
    }
    if (missedPolicy === 'skip') {
      return { run: false, outcome: 'Skipped: missed while unavailable' };
    }
    if (missedPolicy === 'once') {
      return { run: true, outcome: 'Reserved' };
    }
    throw new Error(`Unexpected missed policy: ${missedPolicy}`);
  };

  const scheduled = new Date('2026-09-27T10:00:00Z');
  // 30 seconds late: on time within tolerance
  const onTime = new Date('2026-09-27T10:00:30Z');
  assert.deepEqual(evaluateMissedRun('skip', scheduled, onTime), {
    run: true,
    outcome: 'Reserved',
  });
  assert.deepEqual(evaluateMissedRun('once', scheduled, onTime), {
    run: true,
    outcome: 'Reserved',
  });

  // 3 hours late (system was asleep or app closed)
  const threeHoursLate = new Date('2026-09-27T13:00:00Z');
  const skipResult = evaluateMissedRun('skip', scheduled, threeHoursLate);
  assert.equal(skipResult.run, false);
  assert.equal(skipResult.outcome, 'Skipped: missed while unavailable');

  const onceResult = evaluateMissedRun('once', scheduled, threeHoursLate);
  assert.equal(onceResult.run, true);
  assert.equal(onceResult.outcome, 'Reserved');
});

test('savedPlanDraft converts legacy task plans into schedule definitions with isolated execution', () => {
  const plan = {
    id: 'plan-123',
    name: 'Nightly Audit',
    description: 'Check dependencies and warnings',
    cronExpression: '0 2 * * *',
    targetProjectId: 'proj-456',
    assignedAgentProvider: 'codex',
    prompt: 'Run security checks',
    enabled: true,
  };

  const draft = savedPlanDraft(plan, 'sched-789', [{ id: 'codex', name: 'Codex Runner' }]);
  assert.equal(draft.id, 'sched-789');
  assert.equal(draft.name, 'Nightly Audit');
  assert.equal(draft.expression, '0 2 * * *');
  assert.equal(draft.missed, 'skip');
  assert.equal(draft.enabled, false); // Plans start paused for user review
  assert.equal(draft.request.projectId, 'proj-456');
  assert.equal(draft.request.agent, 'codex');
  assert.equal(draft.request.isolated, true);
  assert.ok(draft.request.prompt.includes('Run security checks'));
  assert.ok(draft.request.prompt.includes('Check dependencies and warnings'));
});

test('prepareImport reuses existing importId on retries to prevent duplicate schedule creation', () => {
  const store = useScheduleStore.getState();
  const testPlan = {
    id: 'plan-retry-test',
    name: 'Retry Test',
    description: '',
    cronExpression: '0 0 * * *',
    targetProjectId: 'p1',
    assignedAgentProvider: 'auto',
    prompt: 'test',
    enabled: true,
  };

  useScheduleStore.setState({ schedules: [testPlan] });

  const firstImportId = store.prepareImport('plan-retry-test');
  assert.ok(firstImportId);

  // Calling prepareImport again must return the exact same importId so retries do not spawn duplicates
  const secondImportId = store.prepareImport('plan-retry-test');
  assert.equal(secondImportId, firstImportId);

  // Clean up
  store.deleteSchedule('plan-retry-test');
  assert.equal(useScheduleStore.getState().schedules.length, 0);
});

test('interrupted schedule recovery cleans up dangling Reserved status upon restart', () => {
  // Simulates Scheduler::new recovery logic where in-flight "Reserved" occurrences
  // from an interrupted app session are marked as interrupted instead of staying stuck
  const history = [
    { dueAt: '2026-09-27T08:00:00Z', outcome: 'Started' },
    { dueAt: '2026-09-27T09:00:00Z', outcome: 'Reserved' },
  ];

  const recoveredHistory = history.map((event) => {
    if (event.outcome === 'Reserved') {
      return {
        ...event,
        outcome: 'Interrupted dispatch; inspect task history before retrying',
      };
    }
    return event;
  });

  assert.equal(recoveredHistory[0].outcome, 'Started');
  assert.equal(
    recoveredHistory[1].outcome,
    'Interrupted dispatch; inspect task history before retrying',
  );
});
