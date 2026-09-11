import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminRoutes, authorizeAdmin } from '../src/admin';
import { deliverFeedback } from '../src/feedback-mail';
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
    channel: 'stable' as const,
    name: 'app_opened' as const,
  };
}
function telemetry() {
  return { schemaVersion: 2 as const, events: [event()] };
}
function feedback() {
  return {
    schemaVersion: 2 as const,
    id: crypto.randomUUID(),
    appVersion: '0.1.0',
    os: 'windows' as const,
    channel: 'stable' as const,
    kind: 'bug' as const,
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
async function count(table: 'events' | 'telemetry_receipts' | 'metrics' | 'feedback') {
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
    env.DB.prepare('DELETE FROM telemetry_receipts'),
    env.DB.prepare('DELETE FROM metrics'),
    env.DB.prepare('DELETE FROM feedback'),
    env.DB.prepare(
      "UPDATE quotas SET max_rows=CASE name WHEN 'events' THEN 1000000 WHEN 'telemetry_receipts' THEN 1000000 WHEN 'metrics' THEN 100000 ELSE 10000 END",
    ),
  ]);
});

describe('ingestion contract and privacy', () => {
  it('persists acknowledged events without request headers or raw IPs', async () => {
    const input = telemetry();
    const response = await request('/v2/telemetry', input, {
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.7',
        authorization: 'secret',
      },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
    const row = await env.DB.prepare('SELECT * FROM telemetry_receipts').first<{
      id: string;
      hash: string;
      expires_at: number;
    }>();
    if (!row) throw new Error('Expected deduplication receipt');
    expect(Object.keys(row).sort()).toEqual(['expires_at', 'hash', 'id']);
    expect(row.expires_at).toBeGreaterThan(Date.now() + 29 * 86400000);
    expect(await count('events')).toBe(0);
    const metric = await env.DB.prepare('SELECT * FROM metrics').first();
    expect(metric).toMatchObject({
      version: '0.1.0',
      channel: 'stable',
      os: 'windows',
      name: 'app_opened',
      dimension: '',
      count: 1,
    });
    expect(JSON.stringify(metric)).not.toContain(input.events[0].id);
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
    ['unsupported schema', (data: ReturnType<typeof telemetry>) => ({ ...data, schemaVersion: 1 })],
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
    expect((await request('/v2/telemetry', change(telemetry()))).status).toBe(400);
    expect(await count('telemetry_receipts')).toBe(0);
  });
  it('accepts every allowlisted event and bounded feedback diagnostics', async () => {
    const input = telemetry();
    const events = [
      event(),
      { ...event(), name: 'task_state', state: 'reviewed' },
      { ...event(), name: 'feature_used', feature: 'codebase' },
      { ...event(), name: 'app_error', code: 'update_failed' },
    ];
    expect((await request('/v2/telemetry', { ...input, events })).status).toBe(202);
    expect(await count('telemetry_receipts')).toBe(4);
    const report = {
      ...feedback(),
      diagnostics: { attempts: 3, reviewed: 1, failed: 1, historySaveFailures: 0 },
    };
    expect((await request('/v2/feedback', report)).status).toBe(202);
    const stored = await env.DB.prepare('SELECT payload FROM feedback').first<{
      payload: string;
    }>();
    if (!stored) throw new Error('Expected persisted feedback');
    expect(JSON.parse(stored.payload)).toEqual(report);
    expect(stored.payload).not.toContain('installId');
    expect(
      (
        await request('/v2/feedback', {
          ...report,
          diagnostics: { ...report.diagnostics, logs: 'private' },
        })
      ).status,
    ).toBe(400);
  });
  it.each(['', '   ', 'x'.repeat(8001)])(
    'rejects invalid feedback message length/whitespace',
    async (message) => {
      expect((await request('/v2/feedback', { ...feedback(), message })).status).toBe(400);
    },
  );
  it('deduplicates retries, rejects changed IDs, and rolls back an entire conflicting batch', async () => {
    const input = telemetry();
    expect((await request('/v2/telemetry', input)).status).toBe(202);
    expect((await request('/v2/telemetry', input)).status).toBe(202);
    expect(await count('telemetry_receipts')).toBe(1);
    expect(await env.DB.prepare('SELECT sum(count) FROM metrics').first('sum(count)')).toBe(1);
    const conflict = { ...input, events: [event(), { ...input.events[0], appVersion: '0.2.0' }] };
    expect((await request('/v2/telemetry', conflict)).status).toBe(409);
    expect(await count('telemetry_receipts')).toBe(1);
    const report = feedback();
    expect((await request('/v2/feedback', report)).status).toBe(202);
    expect((await request('/v2/feedback', report)).status).toBe(202);
    expect((await request('/v2/feedback', { ...report, message: 'Changed report' })).status).toBe(
      409,
    );
    expect(await count('feedback')).toBe(1);
  });
});

describe('resource and retention controls', () => {
  it('lets an operator shorten expiry without allowing stored payload edits', async () => {
    const input = telemetry();
    await saveTelemetry(testEnv(), input);
    await env.DB.prepare('UPDATE telemetry_receipts SET expires_at=0 WHERE id=?')
      .bind(input.events[0].id)
      .run();
    await expect(
      env.DB.prepare("UPDATE telemetry_receipts SET hash='changed'").run(),
    ).rejects.toThrow('id_conflict');
    expect(await prune(testEnv())).toEqual({ events: 1, feedback: 0 });
  });
  it('continues retention across multiple bounded batches with correct trigger counts', async () => {
    await env.DB.prepare(
      "WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<5001) INSERT INTO events(install_id,id,received_at,expires_at,hash,payload) SELECT 'local-fixture',cast(n AS TEXT),0,0,'fixture','{}' FROM sequence",
    ).run();
    expect(await prune(testEnv())).toEqual({ events: 5001, feedback: 0 });
    expect(await count('telemetry_receipts')).toBe(0);
    expect(
      await env.DB.prepare("SELECT retained FROM quotas WHERE name='events'").first('retained'),
    ).toBe(0);
  }, 15000);
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
      const response = await request('/v2/telemetry', telemetry(), {}, bindings);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'service_unavailable' });
      expect(log).toHaveBeenCalledWith('{"event":"service_error","code":"service_unavailable"}');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally {
      log.mockRestore();
    }
  });
  it('enforces the row cap across concurrent writes without blocking duplicate retries', async () => {
    await env.DB.prepare("UPDATE quotas SET max_rows=1 WHERE name='telemetry_receipts'").run();
    const inputs = [telemetry(), telemetry()];
    const responses = await Promise.all(inputs.map((input) => request('/v2/telemetry', input)));
    expect(responses.map((response) => response.status).sort()).toEqual([202, 503]);
    const accepted = inputs[responses.findIndex((response) => response.status === 202)];
    expect((await request('/v2/telemetry', accepted)).status).toBe(202);
    expect(await count('telemetry_receipts')).toBe(1);
    expect(
      await env.DB.prepare("SELECT retained FROM quotas WHERE name='telemetry_receipts'").first(
        'retained',
      ),
    ).toBe(1);
  });
  it('rolls back an over-capacity batch and bounds feedback separately', async () => {
    await env.DB.prepare('UPDATE quotas SET max_rows=1').run();
    expect(
      (await request('/v2/telemetry', { ...telemetry(), events: [event(), event()] })).status,
    ).toBe(503);
    expect(await count('telemetry_receipts')).toBe(0);
    expect((await request('/v2/feedback', feedback())).status).toBe(202);
    expect((await request('/v2/feedback', feedback())).status).toBe(503);
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
        '/v2/feedback',
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
          '/v2/telemetry',
          telemetry(),
          { headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' } },
          testEnv({ IP_LIMITER: { limit } }),
        )
      ).status,
    ).toBe(202);
    expect(limit.mock.calls[0]).toEqual([{ key: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(
      (await request('/v2/telemetry', telemetry(), {}, testEnv({ ENVIRONMENT: 'production' })))
        .status,
    ).toBe(403);
  });
  it('does not spend shared capacity on rejected callers and separates account traffic from ingestion', async () => {
    const global = vi.fn(async () => ({ success: true }));
    for (const rejected of ['IP_LIMITER', 'FEEDBACK_LIMITER'] as const) {
      const response = await request(
        '/v2/feedback',
        feedback(),
        {},
        testEnv({
          GLOBAL_LIMITER: { limit: global },
          [rejected]: { limit: async () => ({ success: false }) },
        }),
      );
      expect(response.status).toBe(429);
    }
    expect(global).not.toHaveBeenCalled();
    await request('/v2/telemetry', telemetry(), {}, testEnv({ GLOBAL_LIMITER: { limit: global } }));
    await request(
      '/v1/desktop/me',
      undefined,
      {},
      testEnv({ EARLY_ACCESS_ENABLED: 'true', GLOBAL_LIMITER: { limit: global } }),
    );
    expect(global.mock.calls).toEqual([[{ key: 'ingestion' }], [{ key: 'desktop-session' }]]);
  });
  it('fails closed on missing configuration and paused ingestion', async () => {
    for (const bindings of [
      testEnv({ RATE_SECRET: '' }),
      testEnv({ INGESTION_ENABLED: 'false' }),
    ]) {
      expect((await request('/v2/telemetry', telemetry(), {}, bindings)).status).toBe(503);
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
        await request('/v2/telemetry', telemetry(), {
          headers: { 'content-type': 'application/json', origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    expect((await request('/v2/telemetry?prompt=private', telemetry())).status).toBe(400);
    expect((await request('/v2/telemetry')).status).toBe(405);
    expect(
      (await request('/v2/telemetry', telemetry(), { headers: { 'content-type': 'text/plain' } }))
        .status,
    ).toBe(415);
    expect(
      (
        await request('/v2/telemetry', telemetry(), {
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        })
      ).status,
    ).toBe(415);
    expect((await request('/admin')).status).toBe(403);
  });
  it('bounds actual streamed bytes, rejects malformed JSON and invalid UTF-8', async () => {
    expect((await request('/v2/feedback', {}, { body: 'x'.repeat(32769) })).status).toBe(413);
    expect((await request('/v2/feedback', {}, { body: '{' })).status).toBe(400);
    expect((await request('/v2/feedback', {}, { body: new Uint8Array([0xff]) })).status).toBe(400);
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
  it('resolves stable and beta history from the committed manifest pointer', async () => {
    for (const channel of ['stable', 'beta']) {
      const directory = `releases/${channel === 'beta' ? 'beta/' : ''}v0.2.0`;
      await env.RELEASES.put(
        `${channel}/latest.json`,
        JSON.stringify({ version: '0.2.0', catalog: `${directory}/catalog.json` }),
      );
      await env.RELEASES.put(`${directory}/catalog.json`, '[{"version":"0.2.0"}]');
      await env.RELEASES.put(`${directory}/feed.xml`, '<rss/>');
      const history = await request(`/updates/${channel}/releases.json`);
      expect(await history.json()).toEqual([{ version: '0.2.0' }]);
      expect(history.headers.get('cache-control')).toContain('max-age=60');
      expect(history.headers.get('access-control-allow-origin')).toBe('*');
      const rss = await request(`/updates/${channel}/feed.xml`);
      expect(await rss.text()).toBe('<rss/>');
      expect(rss.headers.get('content-type')).toContain('application/rss+xml');
      const immutable = await request(`/updates/${directory}/catalog.json`);
      expect(immutable.headers.get('cache-control')).toContain('immutable');
      await env.RELEASES.put(`${directory}/Jackalope_0.2.0_x64-setup.exe`, 'fixture');
      expect((await request(`/updates/${directory}/Jackalope_0.2.0_x64-setup.exe`)).status).toBe(
        200,
      );
      expect((await request(`/updates/${directory}/Jackalope_0.1.0_x64-setup.exe`)).status).toBe(
        404,
      );
    }
  });
  it('rejects cross-channel, oversized, absent and non-release history pointers', async () => {
    await env.RELEASES.delete('beta/latest.json');
    expect((await request('/updates/beta/releases.json')).status).toBe(404);
    for (const catalog of [
      'private.txt',
      'releases/v0.1.0/catalog.json',
      '../stable/latest.json',
    ]) {
      await env.RELEASES.put('beta/latest.json', JSON.stringify({ catalog }));
      expect((await request('/updates/beta/releases.json')).status).toBe(503);
    }
    await env.RELEASES.put('beta/latest.json', ' '.repeat(65537));
    expect((await request('/updates/beta/feed.xml')).status).toBe(503);
    expect((await request('/updates/stable/feed.xml', {})).status).toBe(405);
    expect((await request('/v2/unknown')).headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('private monitoring and feedback delivery', () => {
  it('retires the identifying v1 API and aggregates channel dimensions without identifiers', async () => {
    expect(
      (
        await request('/v1/telemetry', {
          schemaVersion: 1,
          installId: crypto.randomUUID(),
          events: [event()],
        })
      ).status,
    ).toBe(410);
    const data = telemetry();
    await saveTelemetry(testEnv(), data);
    await saveTelemetry(testEnv(), data);
    await saveTelemetry(testEnv(), { schemaVersion: 2, events: [{ ...event(), channel: 'beta' }] });
    const rows = await env.DB.prepare('SELECT channel,count FROM metrics ORDER BY channel').all();
    expect(rows.results).toEqual([
      { channel: 'beta', count: 1 },
      { channel: 'stable', count: 1 },
    ]);
    expect(await count('events')).toBe(0);
    for (const path of ['/admin', '/admin/api/overview', '/admin/api/feedback']) {
      const response = await request(path, undefined, {
        headers: { 'cf-access-authenticated-user-email': 'owner@example.com' },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('requires a valid Access signature, expiry, audience, issuer and the configured owner', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'fixture';
    const keys = createLocalJWKSet({ keys: [jwk] });
    const bindings = testEnv({
      ADMIN_EMAIL: 'owner@example.com',
      ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
      ACCESS_AUD: 'dashboard',
    });
    const now = Math.floor(Date.now() / 1000);
    const token = async (overrides: Record<string, unknown> = {}) =>
      new SignJWT({
        email: 'owner@example.com',
        sub: 'test-owner',
        iat: now,
        exp: now + 60,
        iss: bindings.ACCESS_ISSUER,
        aud: bindings.ACCESS_AUD,
        ...overrides,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
        .sign(privateKey);
    const check = async (value: string, b = bindings) =>
      authorizeAdmin(
        new Request('https://service.example/admin', {
          headers: { 'cf-access-jwt-assertion': value },
        }),
        b,
        keys,
      );
    const valid = await token();
    expect(await check(valid)).toBe(true);
    for (const claims of [
      { email: 'another@example.com' },
      { exp: now - 1 },
      { aud: 'different' },
      { iss: 'https://other.cloudflareaccess.com' },
      { email: undefined },
    ])
      expect(await check(await token(claims))).toBe(false);
    expect(await check(valid.replace(/.$/, '!'))).toBe(false);
    expect(await check(valid, testEnv({ ADMIN_EMAIL: '' }))).toBe(false);
  });
  it('filters aggregates and triages feedback with same-origin writes and no public exposure', async () => {
    await saveTelemetry(testEnv(), {
      schemaVersion: 2,
      events: [{ ...event(), channel: 'beta' }, event()],
    });
    const report = feedback();
    await saveFeedback(testEnv(), report);
    const call = (path: string, options: RequestInit = {}) =>
      adminRoutes(new Request(`https://service.example${path}`, options), testEnv(), (r) =>
        r.json(),
      );
    const overview = (await (await call('/admin/api/overview?channel=beta&days=7')).json()) as {
      metrics: { channel: string }[];
    };
    expect(overview.metrics).toHaveLength(1);
    expect(overview.metrics[0].channel).toBe('beta');
    expect((await call('/admin/api/overview?channel=private')).status).toBe(400);
    const options = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: report.id, status: 'planned' }),
    };
    expect((await call('/admin/api/feedback', options)).status).toBe(403);
    expect(
      (
        await call('/admin/api/feedback', {
          ...options,
          headers: { ...options.headers, origin: 'https://service.example' },
        })
      ).status,
    ).toBe(200);
    const inbox = (await (await call('/admin/api/feedback?status=planned')).json()) as {
      reports: unknown[];
    };
    expect(inbox.reports).toHaveLength(1);
    const summary = await (await call('/admin/api/summary')).json<{ feedback: unknown[] }>();
    expect(summary.feedback).toContainEqual({ status: 'planned', count: 1 });
    await env.DB.prepare('UPDATE feedback SET expires_at=? WHERE id=?')
      .bind(Date.now() - 1, report.id)
      .run();
    const expired = await (await call('/admin/api/summary')).json<{ feedback: unknown[] }>();
    expect(expired.feedback).toEqual([]);
    for (const path of ['/admin', '/admin/access']) {
      const page = await call(path);
      const html = await page.text();
      const nonce = html.match(/<script nonce="([^"]+)"/)?.[1];
      expect(nonce).toBeTruthy();
      expect(page.headers.get('cache-control')).toBe('no-store');
      const policy = page.headers.get('content-security-policy');
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain(`script-src 'nonce-${nonce}'`);
      expect(policy).toContain(`style-src 'nonce-${nonce}'`);
      expect(policy).toContain("style-src-attr 'unsafe-inline'");
      expect(policy).toContain('font-src data:');
      expect(html).toContain(`<style nonce="${nonce}">`);
      expect(html).toContain(`globalThis.__webpack_nonce__="${nonce}"`);
      expect(html).toContain('<div id="root"></div>');
      expect(html.match(/<\/script>/g)).toHaveLength(1);
      expect(html).not.toContain(report.message);
    }
  });
  it('keeps acknowledged feedback through email failure, retries with a lease, and stops after success', async () => {
    const now = Date.now(),
      report = feedback();
    await saveFeedback(testEnv(), report, now);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('private provider details'))
      .mockResolvedValue({ messageId: 'test' });
    const bindings = testEnv({
      FEEDBACK_EMAIL_ENABLED: 'true',
      FEEDBACK_EMAIL_FROM: 'feedback@example.com',
      FEEDBACK_EMAIL_TO: 'inbox@example.com',
      FEEDBACK_EMAIL: { send } as unknown as SendEmail,
    });
    await deliverFeedback(bindings, now);
    expect(await count('feedback')).toBe(1);
    expect(await env.DB.prepare('SELECT email_state FROM feedback').first('email_state')).toBe(
      'failed',
    );
    await deliverFeedback(bindings, now + 1);
    expect(send).toHaveBeenCalledTimes(1);
    await Promise.all([
      deliverFeedback(bindings, now + 300000),
      deliverFeedback(bindings, now + 300000),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({
      to: 'inbox@example.com',
      from: 'feedback@example.com',
    });
    await deliverFeedback(bindings, now + 600000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare('SELECT email_state FROM feedback').first('email_state')).toBe(
      'sent',
    );
  });
  it('does not mail expired submissions or retry indefinitely', async () => {
    const now = Date.now();
    await saveFeedback(testEnv(), feedback(), now);
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const bindings = testEnv({
      FEEDBACK_EMAIL_ENABLED: 'true',
      FEEDBACK_EMAIL_FROM: 'feedback@example.com',
      FEEDBACK_EMAIL_TO: 'inbox@example.com',
      FEEDBACK_EMAIL: { send } as unknown as SendEmail,
    });
    for (let i = 0; i < 7; i++) await deliverFeedback(bindings, now + i * 86400000);
    expect(send).toHaveBeenCalledTimes(5);
    await saveFeedback(testEnv(), feedback(), now - 91 * 86400000);
    await deliverFeedback(bindings, now + 8 * 86400000);
    expect(send).toHaveBeenCalledTimes(5);
  });
});
