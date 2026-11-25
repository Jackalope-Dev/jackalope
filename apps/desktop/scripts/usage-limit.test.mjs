import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countdown,
  limitHeadline,
  observedLimits,
  resetTime,
  usageLimitOf,
} from '../src/lib/usage-limit.ts';

const now = new Date(2026, 10, 24, 14, 0, 0).getTime();
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const seconds = (ms) => Math.floor(ms / 1000);

const failed = (overrides = {}) => ({
  id: 'run-1',
  agent: 'claude',
  account: 'Work',
  accountBinding: { adapter: 'claude', profileId: 'work', directory: '/p/work', label: 'Work' },
  status: 'failed',
  startedAt: new Date(now - 3_600_000).toISOString(),
  endedAt: new Date(now - 60_000).toISOString(),
  error: "You've hit your limit · resets 3:40pm",
  failureKind: 'quota_exhausted',
  quotaFailure: {
    modelOnly: false,
    message: "You've hit your limit · resets 3:40pm",
    resetsAt: seconds(at(24, 15, 40)),
  },
  ...overrides,
});

test('a failed attempt stopped by a provider limit reports its kind, reset and account', () => {
  const limit = usageLimitOf(failed());
  assert.equal(limit.kind, 'usage');
  assert.equal(limit.resetsAt, at(24, 15, 40));
  assert.equal(limit.account, 'Work');
  assert.equal(limit.profileId, 'work');
  assert.equal(limit.message, "You've hit your limit · resets 3:40pm");
  assert.equal(usageLimitOf(failed({ failureKind: 'rate_limited' })).kind, 'rate');
  assert.equal(usageLimitOf(failed({ failureKind: 'billing' })).kind, 'billing');
  assert.equal(usageLimitOf(failed({ failureKind: 'authentication' })), null);
  assert.equal(usageLimitOf(failed({ status: 'running' })), null);
  assert.equal(usageLimitOf(failed({ quotaFailure: null })).resetsAt, null);
});

test('headlines match the native notification wording', () => {
  const time = (ms) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  assert.equal(
    limitHeadline({ kind: 'usage', resetsAt: at(24, 15, 40) }, now),
    `Usage limit — resets ${time(at(24, 15, 40))}`,
  );
  assert.equal(
    limitHeadline({ kind: 'rate', resetsAt: at(25, 9, 5) }, now),
    `Rate limit — resets tomorrow ${time(at(25, 9, 5))}`,
  );
  assert.equal(
    limitHeadline({ kind: 'usage', resetsAt: null }, now),
    'Usage limit — reset time not reported',
  );
  assert.equal(
    limitHeadline({ kind: 'billing', resetsAt: null }, now),
    'Billing limit — add credit or switch account',
  );
  assert.match(resetTime(at(28, 9), now), /^\S+ /);
});

test('countdowns shorten as the reset approaches', () => {
  assert.equal(countdown(now + 2 * 3_600_000 + 5 * 60_000, now), '2h 05m');
  assert.equal(countdown(now + 4 * 60_000 + 9_000, now), '4m 09s');
  assert.equal(countdown(now + 12_000, now), '12s');
  assert.equal(countdown(now + 3 * 86_400_000 + 3_600_000, now), '3d 1h');
  assert.equal(countdown(now - 1, now), 'now');
});

test('accounts stay limited until their reset, and unreported limits until later work', () => {
  const limited = observedLimits([failed()], now);
  assert.equal(limited.length, 1);
  assert.equal(limited[0].account, 'Work');
  assert.deepEqual(observedLimits([failed()], at(24, 15, 41)), []);

  const unreported = failed({ quotaFailure: { modelOnly: false, message: 'limit' } });
  assert.equal(observedLimits([unreported], now).length, 1);
  const later = {
    ...failed({ id: 'run-2', status: 'review', failureKind: null, quotaFailure: null }),
    startedAt: new Date(now - 1_000).toISOString(),
  };
  assert.deepEqual(observedLimits([unreported, later], now), []);
  assert.deepEqual(observedLimits([unreported], now + 13 * 3_600_000), []);

  assert.deepEqual(observedLimits([failed({ failureKind: 'billing' })], now), []);

  const handedOff = failed({
    id: 'run-3',
    status: 'review',
    failureKind: null,
    quotaFailure: null,
    routing: {
      decisions: [],
      handoffs: [
        {
          agent: 'codex',
          model: null,
          binding: { adapter: 'codex', profileId: null, directory: '/p/codex', label: 'Codex' },
          sessionId: null,
          result: '',
          usage: {},
          failure: { modelOnly: false, message: 'usage limit', resetsAt: seconds(at(24, 18)) },
          recordedAt: new Date(now - 120_000).toISOString(),
        },
      ],
    },
  });
  const handoff = observedLimits([handedOff], now);
  assert.equal(handoff.length, 1);
  assert.equal(handoff[0].agent, 'codex');
  assert.equal(handoff[0].resetsAt, at(24, 18));
});
