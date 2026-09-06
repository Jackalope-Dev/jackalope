import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { prune, retentionDays, saveFeedback, saveTelemetry } from '../src/storage';

const allow: RateLimit = { limit: async () => ({ success: true }) };
function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    IP_LIMITER: allow,
    FEEDBACK_LIMITER: allow,
    GLOBAL_LIMITER: allow,
    ...overrides,
  };
}
function event() {
  return {
    id: crypto.randomUUID(),
    appVersion: '0.1.0',
    os: 'windows' as const,
    name: 'app_opened' as const,
  };
}
function telemetry() {
  return { schemaVersion: 1 as const, installId: crypto.randomUUID(), events: [event()] };
}
function feedback() {
  return {
    schemaVersion: 1 as const,
    id: crypto.randomUUID(),
    appVersion: '0.1.0',
    os: 'windows' as const,
    message: 'An explicit test report',
  };
}
async function request(
  path: string,
  body?: unknown,
  options: RequestInit = {},
  bindings = testEnv(),
) {
  return worker.fetch(
    new Request(`https://service.example${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      ...options,
    }),
    bindings,
  );
}
async function count(table: 'events' | 'feedback') {
  return (await env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>())
    ?.count;
}
beforeAll(async () => {
  const migrations = (env as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[] })
    .TEST_MIGRATIONS;
  await applyD1Migrations(env.DB, migrations);
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM feedback'),
    env.DB.prepare(
      "UPDATE quotas SET max_rows=CASE name WHEN 'events' THEN 1000000 ELSE 10000 END",
    ),
  ]);
});

describe('ingestion contract and privacy', () => {
  it('persists acknowledged events without request headers or raw IPs', async () => {
    const input = telemetry();
    const response = await request('/v1/telemetry', input, {
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.7',
        authorization: 'secret',
      },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
    const row = await env.DB.prepare('SELECT * FROM events').first<{
      payload: string;
      expires_at: number;
      received_at: number;
    }>();
    if (!row) throw new Error('Expected persisted event');
    expect(JSON.parse(row.payload)).toEqual(input.events[0]);
    expect(row.expires_at - row.received_at).toBe(30 * 86400000);
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
    expect(JSON.stringify(row)).not.toContain('secret');
  });
  it.each([
    [
      'unknown top-level field',
      (data: ReturnType<typeof telemetry>) => ({ ...data, path: 'private' }),
    ],
    [
      'unknown event field',
      (data: ReturnType<typeof telemetry>) => ({
        ...data,
        events: [{ ...event(), prompt: 'private' }],
      }),
    ],
    [
      'arbitrary error text',
      (data: ReturnType<typeof telemetry>) => ({
        ...data,
        events: [{ ...event(), name: 'app_error', code: 'private' }],
      }),
    ],
    ['unsupported schema', (data: ReturnType<typeof telemetry>) => ({ ...data, schemaVersion: 2 })],
    [
      'too many events',
      (data: ReturnType<typeof telemetry>) => ({
        ...data,
        events: Array.from({ length: 51 }, event),
      }),
    ],
    [
      'non-anonymous ID',
      (data: ReturnType<typeof telemetry>) => ({ ...data, installId: 'user@example.com' }),
    ],
  ])('rejects %s atomically', async (_name, change) => {
    expect((await request('/v1/telemetry', change(telemetry()))).status).toBe(400);
    expect(await count('events')).toBe(0);
  });
  it('accepts every allowlisted event and bounded feedback diagnostics', async () => {
    const input = telemetry();
    const events = [
      event(),
      { ...event(), name: 'task_state', state: 'reviewed' },
      { ...event(), name: 'feature_used', feature: 'codebase' },
      { ...event(), name: 'app_error', code: 'update_failed' },
    ];
    expect((await request('/v1/telemetry', { ...input, events })).status).toBe(202);
    expect(await count('events')).toBe(4);
    const report = {
      ...feedback(),
      diagnostics: { attempts: 3, reviewed: 1, failed: 1, historySaveFailures: 0 },
    };
    expect((await request('/v1/feedback', report)).status).toBe(202);
    const stored = await env.DB.prepare('SELECT payload FROM feedback').first<{
      payload: string;
    }>();
    if (!stored) throw new Error('Expected persisted feedback');
    expect(JSON.parse(stored.payload)).toEqual(report);
    expect(stored.payload).not.toContain('installId');
    expect(
      (
        await request('/v1/feedback', {
          ...report,
          diagnostics: { ...report.diagnostics, logs: 'private' },
        })
      ).status,
    ).toBe(400);
  });
  it.each(['', '   ', 'x'.repeat(8001)])(
    'rejects invalid feedback message length/whitespace',
    async (message) => {
      expect((await request('/v1/feedback', { ...feedback(), message })).status).toBe(400);
    },
  );
  it('deduplicates retries, rejects changed IDs, and rolls back an entire conflicting batch', async () => {
    const input = telemetry();
    expect((await request('/v1/telemetry', input)).status).toBe(202);
    expect((await request('/v1/telemetry', input)).status).toBe(202);
    expect(await count('events')).toBe(1);
    const conflict = { ...input, events: [event(), { ...input.events[0], appVersion: '0.2.0' }] };
    expect((await request('/v1/telemetry', conflict)).status).toBe(409);
    expect(await count('events')).toBe(1);
    const report = feedback();
    expect((await request('/v1/feedback', report)).status).toBe(202);
    expect((await request('/v1/feedback', report)).status).toBe(202);
    expect((await request('/v1/feedback', { ...report, message: 'Changed report' })).status).toBe(
      409,
    );
    expect(await count('feedback')).toBe(1);
  });
});

describe('resource and retention controls', () => {
  it('lets an operator shorten expiry without allowing stored payload edits', async () => {
    const input = telemetry();
    await saveTelemetry(testEnv(), input);
    await env.DB.prepare('UPDATE events SET expires_at=0 WHERE id=?')
      .bind(input.events[0].id)
      .run();
    await expect(env.DB.prepare("UPDATE events SET payload='changed'").run()).rejects.toThrow(
      'id_conflict',
    );
    expect(await prune(testEnv())).toEqual({ events: 1, feedback: 0 });
  });
  it('continues retention across multiple bounded batches with correct trigger counts', async () => {
    await env.DB.prepare(
      "WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<5001) INSERT INTO events(install_id,id,received_at,expires_at,hash,payload) SELECT 'local-fixture',cast(n AS TEXT),0,0,'fixture','{}' FROM sequence",
    ).run();
    expect(await prune(testEnv())).toEqual({ events: 5001, feedback: 0 });
    expect(await count('events')).toBe(0);
    expect(
      await env.DB.prepare("SELECT retained FROM quotas WHERE name='events'").first('retained'),
    ).toBe(0);
  });
  it('returns and logs only a safe code when storage fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const bindings = testEnv({
        DB: new Proxy(env.DB, {
          get(target, property, receiver) {
            if (property === 'prepare')
              return () => {
                throw new Error('private connection details');
              };
            return Reflect.get(target, property, receiver);
          },
        }),
      });
      const response = await request('/v1/telemetry', telemetry(), {}, bindings);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'service_unavailable' });
      expect(log).toHaveBeenCalledWith('{"event":"service_error","code":"service_unavailable"}');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally {
      log.mockRestore();
    }
  });
  it('enforces the row cap across concurrent writes without blocking duplicate retries', async () => {
    await env.DB.prepare("UPDATE quotas SET max_rows=1 WHERE name='events'").run();
    const inputs = [telemetry(), telemetry()];
    const responses = await Promise.all(inputs.map((input) => request('/v1/telemetry', input)));
    expect(responses.map((response) => response.status).sort()).toEqual([202, 503]);
    const accepted = inputs[responses.findIndex((response) => response.status === 202)];
    expect((await request('/v1/telemetry', accepted)).status).toBe(202);
    expect(await count('events')).toBe(1);
    expect(
      await env.DB.prepare("SELECT retained FROM quotas WHERE name='events'").first('retained'),
    ).toBe(1);
  });
  it('rolls back an over-capacity batch and bounds feedback separately', async () => {
    await env.DB.prepare('UPDATE quotas SET max_rows=1').run();
    expect(
      (await request('/v1/telemetry', { ...telemetry(), events: [event(), event()] })).status,
    ).toBe(503);
    expect(await count('events')).toBe(0);
    expect((await request('/v1/feedback', feedback())).status).toBe(202);
    expect((await request('/v1/feedback', feedback())).status).toBe(503);
    expect(await count('feedback')).toBe(1);
  });
  it('expires each data class at its configured deadline and releases quota', async () => {
    const now = Date.now();
    await saveTelemetry(testEnv(), telemetry(), now);
    await saveFeedback(testEnv(), feedback(), now);
    expect(await prune(testEnv(), now + 30 * 86400000 - 1)).toEqual({ events: 0, feedback: 0 });
    expect(await prune(testEnv(), now + 30 * 86400000)).toEqual({ events: 1, feedback: 0 });
    expect(await prune(testEnv(), now + 90 * 86400000)).toEqual({ events: 0, feedback: 1 });
    expect(await env.DB.prepare('SELECT sum(retained) AS count FROM quotas').first('count')).toBe(
      0,
    );
    for (const value of ['0', '366', '1.5', 'NaN']) expect(() => retentionDays(value)).toThrow();
  });
  it.each(['IP_LIMITER', 'FEEDBACK_LIMITER', 'GLOBAL_LIMITER'] as const)(
    'returns retry guidance when %s rejects',
    async (binding) => {
      const response = await request(
        '/v1/feedback',
        feedback(),
        {},
        testEnv({ [binding]: { limit: async () => ({ success: false }) } }),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('60');
      expect(await count('feedback')).toBe(0);
    },
  );
  it('uses a keyed hash for rate limits and requires edge identity outside local mode', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    expect(
      (
        await request(
          '/v1/telemetry',
          telemetry(),
          { headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' } },
          testEnv({ IP_LIMITER: { limit } }),
        )
      ).status,
    ).toBe(202);
    expect(limit.mock.calls[0]).toEqual([{ key: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(
      (await request('/v1/telemetry', telemetry(), {}, testEnv({ ENVIRONMENT: 'production' })))
        .status,
    ).toBe(403);
  });
  it('fails closed on missing configuration and paused ingestion', async () => {
    for (const bindings of [
      testEnv({ RATE_SECRET: '' }),
      testEnv({ INGESTION_ENABLED: 'false' }),
    ]) {
      expect((await request('/v1/telemetry', telemetry(), {}, bindings)).status).toBe(503);
      expect((await request('/healthz', undefined, {}, bindings)).status).toBe(200);
    }
    expect((await request('/readyz')).status).toBe(200);
    expect((await request('/readyz', undefined, {}, testEnv({ RATE_SECRET: '' }))).status).toBe(
      503,
    );
  });
});

describe('HTTP boundary and release hosting', () => {
  it('rejects browser origins, query data, unsupported methods and content types', async () => {
    expect(
      (
        await request('/v1/telemetry', telemetry(), {
          headers: { 'content-type': 'application/json', origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    expect((await request('/v1/telemetry?prompt=private', telemetry())).status).toBe(400);
    expect((await request('/v1/telemetry')).status).toBe(405);
    expect(
      (await request('/v1/telemetry', telemetry(), { headers: { 'content-type': 'text/plain' } }))
        .status,
    ).toBe(415);
    expect(
      (
        await request('/v1/telemetry', telemetry(), {
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        })
      ).status,
    ).toBe(415);
    expect((await request('/admin')).status).toBe(404);
  });
  it('bounds actual streamed bytes, rejects malformed JSON and invalid UTF-8', async () => {
    expect((await request('/v1/feedback', {}, { body: 'x'.repeat(32769) })).status).toBe(413);
    expect((await request('/v1/feedback', {}, { body: '{' })).status).toBe(400);
    expect((await request('/v1/feedback', {}, { body: new Uint8Array([0xff]) })).status).toBe(400);
  });
  it('serves only allowed R2 objects while ingestion is paused, with HEAD and cache validation', async () => {
    const manifest = '{"version":"0.1.0"}';
    await env.RELEASES.put('stable/latest.json', manifest);
    await env.RELEASES.put('private.txt', 'secret');
    await env.RELEASES.put('releases/v0.1.0/Jackalope_0.1.0_x64-setup.exe', 'installer-test');
    const bindings = testEnv({ INGESTION_ENABLED: 'false' });
    const response = await request('/updates/stable/latest.json', undefined, {}, bindings);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(manifest);
    expect(response.headers.get('cache-control')).toContain('max-age=60');
    const head = await request('/updates/stable/latest.json', undefined, { method: 'HEAD' });
    expect(await head.text()).toBe('');
    expect(head.headers.get('content-length')).toBe(String(manifest.length));
    expect(
      (
        await request('/updates/stable/latest.json', undefined, {
          headers: { 'if-none-match': response.headers.get('etag') ?? '' },
        })
      ).status,
    ).toBe(304);
    const artifact = await request('/updates/releases/v0.1.0/Jackalope_0.1.0_x64-setup.exe');
    expect(new TextDecoder().decode(await artifact.arrayBuffer())).toBe('installer-test');
    expect(artifact.headers.get('cache-control')).toContain('immutable');
    expect((await request('/updates/private.txt')).status).toBe(404);
    expect((await request('/updates/releases/v9.9.9/checksums.json')).status).toBe(404);
    expect((await request('/updates/stable/latest.json', {})).status).toBe(405);
  });
});
