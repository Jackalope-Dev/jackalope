import assert from 'node:assert/strict';
import test from 'node:test';
import { countBucket, metricDimension } from '@jackalope/contracts/telemetry';
import { errorKind } from '../src/lib/error-kind.ts';
import { trackSettingChanges } from '../src/lib/setting-telemetry.ts';
import { createTelemetry } from '../src/lib/telemetry.ts';

// Built at runtime so the repository's secret scan ignores it.
const secret = `/Users/me/private-repo/.env ${['sk', 'live', 'x1y2'].join('-')}`;

test('errors are reported as a broad kind, never their message', () => {
  const cases = [
    [new TypeError(`Cannot read ${secret}`), 'type'],
    [Object.assign(new Error(secret), { code: 'ENOENT' }), 'not_found'],
    [new Error(`permission denied ${secret}`), 'permission'],
    [new Error(`Failed to fetch ${secret}`), 'network'],
    [Object.assign(new Error('x'), { name: 'AbortError' }), 'aborted'],
    [new Error('request timed out'), 'timeout'],
    [{ prompt: secret }, 'other'],
    [secret, 'other'],
    [undefined, 'other'],
  ];
  for (const [reason, kind] of cases) assert.equal(errorKind(reason), kind);
  assert.equal(
    metricDimension({ name: 'app_error', code: 'ui_error', kind: 'network' }),
    'ui_error|||network',
  );
  assert.equal(metricDimension({ name: 'app_error', code: 'ui_error' }), 'ui_error');
});

test('preference changes count listed names only, never values or unlisted settings', () => {
  const events = [];
  trackSettingChanges(
    { interfaceZoom: 1, dictationEndpoint: '', branchPrefix: 'a/', terminalShell: 'zsh' },
    {
      interfaceZoom: 1.2,
      dictationEndpoint: 'http://127.0.0.1:8000/private',
      branchPrefix: 'secret/',
      terminalShell: 'zsh',
    },
    (event) => events.push(event),
  );
  assert.deepEqual(events, [{ name: 'setting_changed', setting: 'interface_zoom' }]);
});

test('work counts carry the attachment count bucket, never the files', () => {
  assert.deepEqual([0, 1, 2, 9].map(countBucket), ['0', '1', '2_plus', '2_plus']);
  assert.equal(
    metricDimension({
      name: 'work_sent',
      shape: 'conversation',
      agent: 'claude',
      attachments: '2_plus',
      window: true,
    }),
    'conversation|claude|2_plus|window',
  );
});

test('the local log shows each report and whether it left; nothing is logged while off', async () => {
  let fail = false;
  const sent = [];
  const client = createTelemetry(async (events) => {
    if (fail) throw Error('offline');
    sent.push(...events);
  });
  client.track({ name: 'action_used', action: 'read_aloud' });
  assert.equal(client.recent().length, 0);
  client.configure(true, false);
  client.track({ name: 'action_used', action: 'read_aloud' });
  client.track({ name: 'app_error', code: 'ui_error', kind: 'type' });
  assert.deepEqual(
    client.recent().map((entry) => [entry.event.name, entry.status]),
    [['action_used', 'queued']],
  );
  await client.flush();
  assert.equal(client.recent()[0].status, 'sent');
  assert.equal(sent.length, 1);
  fail = true;
  client.track({ name: 'setting_changed', setting: 'interface_zoom' });
  for (let attempt = 0; attempt < 3; attempt++) await client.flush();
  assert.equal(client.recent().at(-1).status, 'dropped');
  client.track({ name: 'action_used', action: 'bot_created' });
  client.configure(false, false);
  assert.equal(client.recent().at(-1).status, 'dropped');
  client.stop();
});
