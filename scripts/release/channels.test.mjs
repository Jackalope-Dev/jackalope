import assert from 'node:assert/strict';
import test from 'node:test';
import { channelConfig } from './channels.mjs';

test('local builds have no community transport; trusted endpoints must match both channels', () => {
  assert.deepEqual(channelConfig('beta'), { channel: 'beta' });
  const endpoints = {
    stableEndpoint: 'https://api.example/updates/stable/latest.json',
    betaEndpoint: 'https://beta.example/updates/beta/latest.json',
  };
  assert.equal(channelConfig('beta', endpoints).channel, 'beta');
  for (const values of [
    { serviceUrl: 'http://api.example' },
    { serviceUrl: 'https://secret@api.example' },
    { serviceUrl: 'https://api.example?secret=x' },
    { accountServiceUrl: 'http://api.example' },
    { accountWebUrl: 'https://example.com/access/' },
    { accountServiceUrl: 'https://secret@api.example' },
    { stableEndpoint: endpoints.betaEndpoint },
    { stableEndpoint: endpoints.stableEndpoint },
  ])
    assert.throws(() => channelConfig('stable', values));
  assert.throws(() => channelConfig('internal'));
});
