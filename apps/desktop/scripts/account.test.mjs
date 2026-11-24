import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCOUNT_FEATURES, accountAccess, suggestionDue } from '../src/lib/account.ts';

const status = (state) => ({ state, email: null, userCode: null, expiresAt: null });

test('only an approved account unlocks account features', () => {
  assert.equal(accountAccess(null), 'loading');
  assert.equal(accountAccess(status('connected')), 'approved');
  assert.equal(accountAccess(status('offline')), 'approved');
  for (const state of ['disconnected', 'expired'])
    assert.equal(accountAccess(status(state)), 'none');
  assert.equal(accountAccess(status('pending')), 'pending');
  assert.equal(accountAccess(status('waiting')), 'waitlist');
  assert.equal(accountAccess(status('waiting-offline')), 'waitlist');
  assert.equal(accountAccess(status('unavailable')), 'unavailable');
});

test('every gated feature explains why it needs an account', () => {
  assert.deepEqual(Object.keys(ACCOUNT_FEATURES).sort(), [
    'betaProgram',
    'invitations',
    'lessonSync',
    'memberFeedback',
    'settingsSync',
    'skillSync',
  ]);
  for (const { title, reason } of Object.values(ACCOUNT_FEATURES)) {
    assert.ok(title && reason.endsWith('.'));
    assert.doesNotMatch(reason, /required|must/i);
  }
});

test('the account suggestion waits for a milestone and never repeats', () => {
  const now = 1_000_000;
  const prompts = (suggestion, extra = {}) => ({
    suggestion,
    snoozedUntil: 0,
    shownThisLaunch: false,
    ...extra,
  });
  assert.equal(suggestionDue(prompts('unseen'), false, now), false);
  assert.equal(suggestionDue(prompts('unseen'), true, now), true);
  // Left unanswered, it stays for the launch it appeared in and not after.
  assert.equal(suggestionDue(prompts('shown', { shownThisLaunch: true }), true, now), true);
  assert.equal(suggestionDue(prompts('shown'), true, now), false);
  // "Not now" brings it back once, only after the snooze.
  const snoozed = prompts('snoozed', { snoozedUntil: now + 1 });
  assert.equal(suggestionDue(snoozed, true, now), false);
  assert.equal(suggestionDue(snoozed, true, now + 1), true);
  assert.equal(suggestionDue(prompts('dismissed'), true, now), false);
});
