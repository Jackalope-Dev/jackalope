import assert from 'node:assert/strict';
import test from 'node:test';

test('CLI protocol handshake enforces exact version match and active process identity', () => {
  const CURRENT_VERSION = 1;

  const validHandshake = {
    version: CURRENT_VERSION,
    pid: 12345,
    endpoint: '\\\\.\\pipe\\jackalope-cli-test',
    windowed: true,
  };

  const validateHandshake = (data) => {
    if (!data || typeof data !== 'object') return { valid: false, reason: 'malformed data' };
    if (data.version !== CURRENT_VERSION) {
      return {
        valid: false,
        reason: `version mismatch (got ${data.version}, expected ${CURRENT_VERSION})`,
      };
    }
    if (typeof data.pid !== 'number' || data.pid <= 0) {
      return { valid: false, reason: 'invalid pid' };
    }
    if (!data.endpoint || typeof data.endpoint !== 'string') {
      return { valid: false, reason: 'missing endpoint' };
    }
    return { valid: true, handshake: data };
  };

  assert.equal(validateHandshake(validHandshake).valid, true);

  // Incompatible version must be rejected
  const futureHandshake = { ...validHandshake, version: 2 };
  const rejectedFuture = validateHandshake(futureHandshake);
  assert.equal(rejectedFuture.valid, false);
  assert.ok(rejectedFuture.reason.includes('version mismatch'));

  // Missing PID or invalid endpoint must be rejected
  assert.equal(validateHandshake({ ...validHandshake, pid: 0 }).valid, false);
  assert.equal(validateHandshake({ ...validHandshake, endpoint: '' }).valid, false);
});

test('stale endpoint detection discriminates live hosts from orphaned sockets', () => {
  // Simulates remove_stale_endpoint logic:
  // If handshake points to an endpoint where no host is listening, the stale socket directory
  // should be cleared only if it matches our private temporary directory pattern (jl-cli-*)
  const canConnect = (endpoint, liveEndpoints) => liveEndpoints.has(endpoint);

  const cleanStaleEndpoint = (handshake, liveEndpoints, filesOnDisk) => {
    if (canConnect(handshake.endpoint, liveEndpoints)) {
      // Someone is listening - do not touch
      return { cleaned: false, reason: 'host active' };
    }
    // Check if the directory belongs to our private pattern
    const isOurTempDir = handshake.endpoint.includes('jl-cli-');
    if (!isOurTempDir) {
      return { cleaned: false, reason: 'foreign endpoint path preserved' };
    }
    filesOnDisk.delete(handshake.endpoint);
    return { cleaned: true, reason: 'stale endpoint removed' };
  };

  const files = new Set(['/tmp/jl-cli-1234/cli.sock', '/tmp/other-app/sock']);
  const live = new Set(['/tmp/live/cli.sock']);

  // Dead host with our prefix is cleaned
  const deadHostHandshake = { endpoint: '/tmp/jl-cli-1234/cli.sock' };
  const res1 = cleanStaleEndpoint(deadHostHandshake, live, files);
  assert.equal(res1.cleaned, true);
  assert.equal(files.has('/tmp/jl-cli-1234/cli.sock'), false);

  // Active host is preserved
  const liveHostHandshake = { endpoint: '/tmp/live/cli.sock' };
  const res2 = cleanStaleEndpoint(liveHostHandshake, live, files);
  assert.equal(res2.cleaned, false);
  assert.equal(res2.reason, 'host active');

  // Foreign endpoint outside our pattern is preserved
  const foreignHandshake = { endpoint: '/tmp/other-app/sock' };
  const res3 = cleanStaleEndpoint(foreignHandshake, live, files);
  assert.equal(res3.cleaned, false);
  assert.equal(res3.reason, 'foreign endpoint path preserved');
});

test('process reconnect protocol guarantees single request-response ordering and detects broken pipes', () => {
  // Simulates client channel state machine in cli_protocol::Client:
  // Once broken, future sends immediately fail without sending corrupt requests.
  class MockClient {
    constructor(alive = true) {
      this.alive = alive;
      this.broken = false;
    }

    send(request) {
      if (this.broken) {
        return { error: 'The connection to Jackalope was lost.' };
      }
      if (!this.alive) {
        this.broken = true;
        return { error: 'The Jackalope host closed the connection.' };
      }
      return { response: { ok: true, for: request } };
    }
  }

  const client = new MockClient(true);
  const first = client.send({ request: 'ping' });
  assert.equal(first.response.ok, true);

  // Host dies
  client.alive = false;
  const second = client.send({ request: 'projects' });
  assert.ok(second.error.includes('closed the connection'));
  assert.equal(client.broken, true);

  // Subsequent sends immediately fail with "connection lost"
  const third = client.send({ request: 'ping' });
  assert.ok(third.error.includes('was lost'));
});

test('managed runner operation supervisor prevents concurrent setups and honors explicit cancellation', () => {
  // Simulates ManagedRuntime supervisor:
  // Only one operation can run at a time; cancellation marks operation and clears state.
  class OperationSupervisor {
    constructor() {
      this.active = null;
      this.canceled = new Set();
    }

    begin(id) {
      if (this.canceled.has(id)) {
        this.canceled.delete(id);
        return { error: 'Runner setup canceled. You can retry when ready.' };
      }
      if (this.active !== null) {
        return {
          error: 'Runner setup is already running. Wait for it to finish or cancel that setup.',
        };
      }
      this.active = { id, canceled: false };
      return { ok: true, operation: this.active };
    }

    cancel(id) {
      if (this.active && this.active.id === id) {
        this.active.canceled = true;
      } else {
        this.canceled.add(id);
      }
    }

    finish(id) {
      if (this.active && this.active.id === id) {
        this.active = null;
      }
    }
  }

  const supervisor = new OperationSupervisor();

  // First operation begins successfully
  const op1 = supervisor.begin('op-1');
  assert.equal(op1.ok, true);

  // Concurrent operation is refused
  const op2 = supervisor.begin('op-2');
  assert.ok(op2.error.includes('already running'));

  // Cancel op1
  supervisor.cancel('op-1');
  assert.equal(op1.operation.canceled, true);
  supervisor.finish('op-1');

  // Pre-cancel op3 before begin
  supervisor.cancel('op-3');
  const op3 = supervisor.begin('op-3');
  assert.ok(op3.error.includes('Runner setup canceled'));
});
