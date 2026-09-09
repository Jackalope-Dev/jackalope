import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScheduleTiming, scheduleTimingExpression } from '../src/lib/schedules.ts';

test('common schedule timing round trips without changing its cadence', () => {
  for (const expression of ['15 6 * * *', '45 23 * * 1-5', '0 0 * * 0', '30 14 * * 6']) {
    const timing = parseScheduleTiming(expression);
    assert.ok(timing);
    assert.equal(scheduleTimingExpression(timing.repeat, timing.time, timing.weekday), expression);
  }
  assert.equal(parseScheduleTiming('0 9 * * 7').weekday, '0');
});

test('complex or invalid saved cron remains custom instead of being rewritten', () => {
  for (const expression of [
    '*/15 * * * *',
    '0 9 1 * *',
    '0 9 * * 1,3,5',
    '0 24 * * *',
    '60 9 * * *',
    '0 0 9 * * *',
  ]) {
    assert.equal(parseScheduleTiming(expression), null);
  }
  for (const [repeat, time, weekday] of [
    ['weekly', '24:00', '1'],
    ['daily', '09:60', '1'],
    ['weekly', '09:00', '9'],
    ['custom', '09:00', '1'],
  ]) {
    assert.equal(scheduleTimingExpression(repeat, time, weekday), null);
  }
});
