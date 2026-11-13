import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSchedule, upcomingRuns } from '../src/lib/schedule-when.ts';

const iso = (dates) => dates.map((date) => date.toISOString());

test('schedules read in plain language, and anything else stays custom', () => {
  assert.match(describeSchedule('0 9 * * 1-5'), /^Every weekday at 9:00/);
  assert.match(describeSchedule('30 18 * * *'), /^Every day at 6:30/);
  assert.match(describeSchedule('0 9 * * 1'), /^Every Monday at 9:00/);
  assert.equal(describeSchedule('15 * * * *'), 'Every hour at :15');
  assert.equal(describeSchedule('5 */6 * * *'), 'Every 6 hours at :05, from midnight');
  assert.equal(describeSchedule('0 9 1 * *'), 'Custom schedule · 0 9 1 * *');
});

test('weekday runs skip the weekend in the schedule timezone', () => {
  // Friday 2026-11-13 10:00 UTC, which is 03:00 in Denver: today's 09:00 is still ahead.
  const after = new Date('2026-11-13T10:00:00Z');
  assert.deepEqual(iso(upcomingRuns('0 9 * * 1-5', 'America/Denver', after)), [
    '2026-11-13T16:00:00.000Z',
    '2026-11-16T16:00:00.000Z',
    '2026-11-17T16:00:00.000Z',
  ]);
});

test('weekly and hourly schedules follow the clock', () => {
  const after = new Date('2026-11-13T10:00:00Z');
  assert.deepEqual(iso(upcomingRuns('30 8 * * 1', 'UTC', after, 2)), [
    '2026-11-16T08:30:00.000Z',
    '2026-11-23T08:30:00.000Z',
  ]);
  assert.deepEqual(iso(upcomingRuns('5 */6 * * *', 'UTC', after)), [
    '2026-11-13T12:05:00.000Z',
    '2026-11-13T18:05:00.000Z',
    '2026-11-14T00:05:00.000Z',
  ]);
});

test('a run in a daylight-saving gap is skipped, and custom schedules have no preview', () => {
  // 2:30 AM does not exist in New York on 2026-03-08.
  const after = new Date('2026-03-07T12:00:00Z');
  const runs = upcomingRuns('30 2 * * *', 'America/New_York', after);
  assert.equal(runs.length, 3);
  assert.ok(runs.every((run) => run.toISOString() !== '2026-03-08T07:30:00.000Z'));
  assert.deepEqual(upcomingRuns('0 9 1 * *', 'UTC', after), []);
  assert.equal(upcomingRuns('0 9 * * 1-5', 'Not/AZone', after).length, 3);
});
