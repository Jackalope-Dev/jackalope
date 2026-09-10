import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WindowGrant,
  validBounds,
} from '../src-tauri/resources/gnome-extension/desktop-control@jackalope.dev/guard.js';

const bounds = { x: -100, y: 40, width: 600, height: 400 };
const window = { handle: 'shell-instance:42', pid: 123, started: '456', class: 'fixture', bounds };
function active() {
  const grant = new WindowGrant(window, 'secret', ':1.42', 100);
  grant.resume(bounds, 110);
  return {
    grant,
    request: { window: { ...window }, token: 'secret', epoch: grant.epoch, bounds: { ...bounds } },
  };
}

test('only the indicator renews a live grant; expired or reversed clocks cannot revive it', () => {
  const { grant } = active();
  assert.throws(() => grant.heartbeat(':1.99', 200), /indicator/);
  grant.heartbeat(':1.42', 3000);
  assert.throws(() => grant.heartbeat(':1.42', 2999), /expired/);
  assert.throws(() => grant.heartbeat(':1.42', 6001), /expired/);
  grant.pause('human input');
  assert.throws(() => grant.resume(bounds, 6001), /expired/);
});

test('a paused or canceled grant rejects work; Resume invalidates earlier snapshots', () => {
  const { grant, request } = active();
  grant.check(request, window, true, false, 120);
  grant.pause('human input');
  assert.throws(() => grant.check(request, window, true, false, 130), /paused/);
  grant.resume(bounds, 140);
  assert.throws(() => grant.check(request, window, true, false, 150), /grant changed/);
  request.epoch = grant.epoch;
  grant.check(request, window, true, false, 160);
  grant.cancel('Escape');
  grant.pause('later input');
  assert.equal(grant.status, 'canceled');
  assert.throws(() => grant.resume(bounds, 170), /cannot resume/);
});

test('identity, secret, focus, held input and both coordinate snapshots fail closed', () => {
  for (const key of ['handle', 'pid', 'started', 'class']) {
    const { grant, request } = active();
    assert.throws(
      () => grant.check(request, { ...window, [key]: 'other' }, true, false, 120),
      /identity/,
    );
    request.window[key] = 'other';
    assert.throws(() => grant.check(request, window, true, false, 120), /identity/);
  }
  const { grant, request } = active();
  assert.throws(
    () => grant.check({ ...request, token: 'other' }, window, true, false, 120),
    /grant changed/,
  );
  assert.throws(() => grant.check(request, window, false, false, 120), /lost focus/);
  assert.throws(() => grant.check(request, window, true, true, 120), /Release/);
  assert.throws(
    () => grant.check(request, { ...window, bounds: { ...bounds, x: 0 } }, true, false, 120),
    /moved/,
  );
  assert.throws(
    () => grant.check({ ...request, bounds: { ...bounds, width: 599 } }, window, true, false, 120),
    /fresh snapshot/,
  );
  assert.throws(() => grant.check(request, window, true, false, 3101), /expired/);
});

test('bounds support negative monitor origins but reject malformed and oversized surfaces', () => {
  assert.equal(validBounds(bounds), true);
  for (const change of [
    { width: 0 },
    { height: -1 },
    { x: NaN },
    { y: 1.5 },
    { width: 20000001 },
    { x: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.equal(validBounds({ ...bounds, ...change }), false);
  }
  const { grant } = active();
  grant.pause('resize');
  assert.throws(() => grant.resume({ ...bounds, width: 0 }, 200), /bounds/);
});
