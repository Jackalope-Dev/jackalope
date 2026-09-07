import assert from 'node:assert/strict';
import test from 'node:test';
import { probeBucket, verifyReadiness } from './preflight.mjs';

function fixture(overrides = {}) {
  const methods = [];
  let stored;
  return {
    methods,
    options: {
      account: 'a'.repeat(32),
      token: 'test-token',
      bucket: 'jackalope-releases-staging',
      request: async (url, { method, body, redirect, headers }) => {
        methods.push(method);
        assert.match(url, /\/objects\/launch-checks\/[a-f0-9-]+\.txt$/);
        assert.equal(redirect, 'error');
        assert.equal(headers.Authorization, 'Bearer test-token');
        if (overrides[method]) return overrides[method](body);
        if (method === 'PUT') stored = body;
        if (method === 'DELETE') stored = undefined;
        return method === 'GET'
          ? new Response(stored, { status: stored ? 200 : 404 })
          : new Response(null, { status: 204 });
      },
    },
  };
}

test('release probe verifies bytes and deletion without touching release paths', async () => {
  const { methods, options } = fixture();
  await probeBucket(options);
  assert.deepEqual(methods, ['PUT', 'GET', 'DELETE', 'GET']);
});

test('uncertain upload still attempts cleanup without leaking request details', async () => {
  const { methods, options } = fixture({
    PUT: () => {
      throw new Error('request containing test-token');
    },
  });
  await assert.rejects(probeBucket(options), /staging: PUT request failed$/);
  assert.deepEqual(methods, ['PUT', 'DELETE', 'GET']);
});

test('corrupt read fails and still removes the probe', async () => {
  let reads = 0;
  const { methods, options } = fixture({
    GET: () => new Response('corrupt', { status: reads++ === 0 ? 200 : 404 }),
  });
  await assert.rejects(probeBucket(options), /content does not match/);
  assert.deepEqual(methods, ['PUT', 'GET', 'DELETE', 'GET']);
});

test('cleanup failure identifies only the disposable object for recovery', async () => {
  const { options } = fixture({ DELETE: () => new Response(null, { status: 403 }) });
  await assert.rejects(
    probeBucket(options),
    /check cleanup of .*\/launch-checks\/.+ before retrying/,
  );
});

test('invalid configuration makes no requests', async () => {
  const { methods, options } = fixture();
  await assert.rejects(probeBucket({ ...options, token: '' }), /Configure/);
  await assert.rejects(probeBucket({ ...options, bucket: 'unrelated' }), /Unexpected/);
  assert.equal(methods.length, 0);
});

test('readiness requires an operational service and migrated schema', async () => {
  const reply = (status, schemaVersion) => async () =>
    Response.json({ status, schemaVersion, ingestionEnabled: false });
  await verifyReadiness('https://staging-api.jackalope.dev', reply('ready', 1));
  await verifyReadiness('https://staging-api.jackalope.dev', reply('ready', 2));
  await assert.rejects(verifyReadiness('https://staging-api.jackalope.dev', reply('ready', 3)));
  await assert.rejects(verifyReadiness('https://staging-api.jackalope.dev', reply('ready', 0)));
  await assert.rejects(verifyReadiness('https://staging-api.jackalope.dev', reply('degraded', 1)));
});
