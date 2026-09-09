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
    '0 */5 * * *',
    '0 */0 * * *',
    '60 */6 * * *',
    '0 1-23/6 * * *',
    '0 */6 * * 1-5',
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

test('hourly presets preserve the selected minute and valid clock-aligned cadence', () => {
  for (const hours of ['1', '2', '3', '4', '6', '8', '12']) {
    const expression = scheduleTimingExpression('hourly', '09:17', '1', hours);
    const timing = parseScheduleTiming(expression);
    assert.equal(timing.repeat, 'hourly');
    assert.equal(timing.hours, hours);
    assert.equal(timing.time, '00:17');
    assert.equal(
      scheduleTimingExpression(timing.repeat, timing.time, timing.weekday, timing.hours),
      expression,
    );
  }
  assert.equal(parseScheduleTiming('0 */1 * * *').hours, '1');
  for (const hours of ['0', '5', '7', '24', '-1', '1.5', '']) {
    assert.equal(scheduleTimingExpression('hourly', '00:00', '1', hours), null);
  }
  assert.equal(scheduleTimingExpression('hourly', '00:60', '1', '6'), null);
});
