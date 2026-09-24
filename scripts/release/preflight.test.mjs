import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyReadiness } from './preflight.mjs';

test('readiness requires an operational service and migrated schema', async () => {
  const reply = (status, schemaVersion) => async () =>
    Response.json({ status, schemaVersion, ingestionEnabled: false });
  await verifyReadiness('https://staging-api.jackalope.dev', reply('ready', 1));
  await verifyReadiness('https://staging-api.jackalope.dev', reply('ready', 2));
  await assert.rejects(verifyReadiness('https://staging-api.jackalope.dev', reply('ready', 3)));
  await assert.rejects(verifyReadiness('https://staging-api.jackalope.dev', reply('ready', 0)));
  await assert.rejects(verifyReadiness('https://staging-api.jackalope.dev', reply('degraded', 1)));
});

test('edge blocks identify the origin and status without exposing response bodies', async () => {
  await assert.rejects(
    verifyReadiness(
      'https://api.jackalope.dev',
      async () =>
        new Response('<html>private challenge</html>', {
          status: 403,
          headers: { 'content-type': 'text/html' },
        }),
    ),
    {
      message:
        'https://api.jackalope.dev: readiness returned HTTP 403 (text/html); check edge rules if the service is healthy locally',
    },
  );
  await assert.rejects(
    verifyReadiness(
      'https://api.jackalope.dev',
      async () => new Response('invalid', { headers: { 'content-type': 'application/json' } }),
    ),
    { message: 'https://api.jackalope.dev: readiness returned invalid JSON' },
  );
});

test('public readiness uses only an unauthenticated GET and refuses redirects', async () => {
  await verifyReadiness('https://api.jackalope.dev', async (url, options) => {
    assert.equal(url, 'https://api.jackalope.dev/readyz');
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(options.headers, undefined);
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({ status: 'ready', schemaVersion: 2 });
  });
});
