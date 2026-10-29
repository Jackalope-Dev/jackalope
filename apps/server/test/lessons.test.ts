import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { randomToken, tokenHash } from '../src/access/crypto';
import worker from '../src/index';

const bindings: Env = {
  ...env,
  EARLY_ACCESS_ENABLED: 'true',
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
  ACCESS_SECRET: 'fixture-only-'.repeat(4),
  SEQUENZY_API_KEY: 'fixture-provider',
  ACCESS_EMAIL_FROM: 'fixture@example.invalid',
  GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  IP_LIMITER: { limit: async () => ({ success: true }) },
  FEEDBACK_LIMITER: { limit: async () => ({ success: true }) },
};
beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  for (const name of [
    'access_lessons',
    'access_lesson_records',
    'access_device_links',
    'access_devices',
    'access_sessions',
    'access_members',
  ])
    await env.DB.prepare(`DELETE FROM ${name}`).run();
});

async function member() {
  const id = crypto.randomUUID();
  const session = randomToken();
  await env.DB.prepare(
    "INSERT INTO access_members(id,email,status,created_at,verified_at,source,share_code) VALUES(?,?,'approved',?,?,'fixture',?)",
  )
    .bind(id, `${id}@example.invalid`, Date.now(), Date.now(), randomToken())
    .run();
  await env.DB.prepare('INSERT INTO access_sessions(hash,member_id,expires_at) VALUES(?,?,?)')
    .bind(await tokenHash(session), id, Date.now() + 60000)
    .run();
  return { id, session };
}
function call(path: string, method = 'GET', body?: unknown, token?: string, browser = false) {
  return worker.fetch(
    new Request(`https://api.jackalope.dev${path}`, {
      method,
      headers: {
        'x-jackalope-waitlist': '1',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(browser ? { origin: 'https://jackalope.dev' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    bindings,
  );
}
async function device(owner: Awaited<ReturnType<typeof member>>, consent = true) {
  const secret = randomToken();
  const started = await call('/v1/desktop/start', 'POST', { challenge: await tokenHash(secret) });
  const { verification } = await started.json<{ verification: string }>();
  await worker.fetch(
    new Request('https://api.jackalope.dev/v1/access/desktop/approve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `__Host-jackalope=${owner.session}`,
        origin: 'https://jackalope.dev',
      },
      body: JSON.stringify({ verification }),
    }),
    bindings,
  );
  expect((await call('/v1/desktop/exchange', 'POST', undefined, secret)).status).toBe(200);
  if (consent)
    expect(
      (await call('/v1/desktop/settings/consent', 'POST', { enabled: true }, secret)).status,
    ).toBe(200);
  return secret;
}

const project = 'a'.repeat(64);
function lesson(overrides: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    project,
    revision: 1,
    updatedAt: 1000,
    deleted: false,
    lesson: {
      title: 'User preference',
      content: 'Previously requested by the user: Always run pnpm verify.',
      keywords: ['pnpm', 'verify'],
      enabled: true,
      kind: 'preference',
      status: 'probation',
      statement: 'Always run pnpm verify.',
      origin: 'reflection',
      bornAt: '2026-10-01T00:00:00+00:00',
      archivedReason: null,
      managed: true,
      distinct: false,
      ...body,
    },
    ...overrides,
  };
}
function history(entryId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    entryId,
    project,
    at: '2026-10-01T00:00:00+00:00',
    action: 'born',
    reason: 'Learned a preference.',
    revision: 1,
    origin: 'reflection',
    title: 'User preference',
    ...overrides,
  };
}
async function pull(secret: string, cursor = 0, epoch = 0) {
  const response = await call('/v1/desktop/lessons/pull', 'POST', { epoch, cursor }, secret);
  expect(response.status).toBe(200);
  return response.json<{
    epoch: number;
    cursor: number;
    more: boolean;
    lessons: ReturnType<typeof lesson>[];
    records: ReturnType<typeof history>[];
  }>();
}
function push(secret: string, body: Record<string, unknown>) {
  return call(
    '/v1/desktop/lessons/push',
    'POST',
    { epoch: 1, records: [], lessons: [], ...body },
    secret,
  );
}

it('requires settings sync consent and keeps each account separate', async () => {
  const owner = await member();
  const a = await device(owner);
  const withoutConsent = await device(owner, false);
  const stranger = await device(await member());
  expect((await call('/v1/desktop/lessons/pull', 'POST', { epoch: 0, cursor: 0 })).status).toBe(
    401,
  );
  expect(
    (await call('/v1/desktop/lessons/pull', 'POST', { epoch: 0, cursor: 0 }, withoutConsent))
      .status,
  ).toBe(403);
  expect((await call('/v1/desktop/lessons/pull', 'GET', undefined, a)).status).toBe(404);
  const item = lesson();
  expect((await push(a, { lessons: [item], records: [history(item.id)] })).status).toBe(200);
  expect((await push(withoutConsent, { lessons: [lesson()] })).status).toBe(403);
  const page = await pull(a);
  expect(page).toMatchObject({ epoch: 1, more: false });
  expect(page.lessons).toEqual([item]);
  expect(page.records).toHaveLength(1);
  const other = await pull(stranger);
  expect(other.lessons).toEqual([]);
  expect(other.records).toEqual([]);
});

it('accepts only allowlisted lesson fields within size limits', async () => {
  const secret = await device(await member());
  const credential = ['AKIA', 'ABCDEFGHIJKLMNOP'].concat().join('');
  for (const invalid of [
    lesson({ projectPath: '/private/repo' }),
    lesson({}, { evidence: ['Task 1: secret'] }),
    lesson({}, { deliveries: 3 }),
    lesson({}, { recentRuns: ['run'] }),
    lesson({}, { content: 'x'.repeat(801) }),
    lesson({}, { title: 'two\nlines' }),
    lesson({}, { keywords: Array.from({ length: 11 }, (_, i) => `word${i}`) }),
    lesson({}, { status: 'pinned' }),
    lesson({}, { content: `Use ${credential} for uploads.` }),
    lesson({ project: 'not-a-project' }),
    lesson({ deleted: true }),
    lesson({ revision: 0 }),
  ]) {
    expect((await push(secret, { lessons: [invalid] })).status).toBe(400);
  }
  const item = lesson();
  expect((await push(secret, { lessons: Array.from({ length: 26 }, () => lesson()) })).status).toBe(
    400,
  );
  expect(
    (await push(secret, { lessons: [item], records: [history(item.id, { evidence: ['x'] })] }))
      .status,
  ).toBe(400);
  expect((await push(secret, { lessons: [item, item] })).status).toBe(400);
  const oversized = await call(
    '/v1/desktop/lessons/push',
    'POST',
    { epoch: 1, lessons: [], records: [], padding: 'x'.repeat(40000) },
    secret,
  );
  expect(oversized.status).toBe(413);
});

it('merges by revision with last writer wins and syncs tombstones as deletions', async () => {
  const owner = await member();
  const a = await device(owner);
  const b = await device(owner);
  const item = lesson();
  await push(a, { lessons: [item] });
  const newer = lesson({ id: item.id, revision: 2, updatedAt: 2000 }, { status: 'active' });
  const stale = lesson({ id: item.id, revision: 2, updatedAt: 1500 }, { status: 'archived' });
  const accepted = await (await push(b, { lessons: [newer] })).json();
  expect(accepted).toEqual({ lessons: [{ id: item.id, revision: 2, updatedAt: 2000 }] });
  const rejected = await (await push(a, { lessons: [stale] })).json();
  expect(rejected).toEqual({ lessons: [{ id: item.id, revision: 2, updatedAt: 2000 }] });
  const first = await pull(a);
  expect(first.lessons).toEqual([newer]);
  const removed = { id: item.id, project, revision: 3, updatedAt: 3000, deleted: true };
  await push(a, { lessons: [removed] });
  const later = await pull(b, first.cursor, first.epoch);
  expect(later.lessons).toEqual([removed]);
  const unchanged = await pull(b, later.cursor, later.epoch);
  expect(unchanged.lessons).toEqual([]);
  expect(unchanged.cursor).toBe(later.cursor);
});

it('deduplicates history by record id and pages without skipping changes', async () => {
  const secret = await device(await member());
  const items = Array.from({ length: 25 }, () => lesson());
  await push(secret, { lessons: items });
  await push(secret, { lessons: items.slice(0, 20).map((item) => ({ ...item, revision: 2 })) });
  const records = items.map((item) => history(item.id));
  await push(secret, { records });
  await push(secret, { records });
  const seen = new Map<string, number>();
  let cursor = 0;
  let records_ = 0;
  for (let page = 0; page < 10; page += 1) {
    const result = await pull(secret, cursor, 1);
    for (const item of result.lessons) seen.set(item.id, item.revision);
    records_ += result.records.length;
    cursor = result.cursor;
    if (!result.more) break;
  }
  expect(seen.size).toBe(25);
  expect([...seen.values()].filter((revision) => revision === 2)).toHaveLength(20);
  expect(records_).toBe(25);
});

it('deleting synced lessons starts a new epoch that stops stale devices', async () => {
  const owner = await member();
  const a = await device(owner);
  const b = await device(owner);
  await push(a, { lessons: [lesson()] });
  expect((await call('/v1/desktop/lessons', 'DELETE', undefined, b)).status).toBe(200);
  const stale = await call('/v1/desktop/lessons/pull', 'POST', { epoch: 1, cursor: 0 }, a);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: 'lessons_reset' });
  expect((await push(a, { lessons: [lesson()] })).status).toBe(409);
  const fresh = await pull(a);
  expect(fresh).toMatchObject({ epoch: 2, lessons: [] });
  expect(
    (
      await call(
        '/v1/desktop/lessons/push',
        'POST',
        { epoch: 2, lessons: [lesson()], records: [] },
        a,
      )
    ).status,
  ).toBe(200);
  // Deleting synced settings removes synced lessons too.
  expect((await call('/v1/desktop/settings', 'DELETE', undefined, a)).status).toBe(200);
  expect(
    await env.DB.prepare('SELECT count(*) AS total FROM access_lessons WHERE member_id=?')
      .bind(owner.id)
      .first('total'),
  ).toBe(0);
});

it('bounds the lessons an account can store', async () => {
  const owner = await member();
  const secret = await device(owner);
  await env.DB.prepare(
    'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1999) INSERT INTO access_lessons(member_id,id,project,revision,updated_at,deleted,body,seq) SELECT ?,lower(hex(randomblob(16))),?,1,0,1,NULL,i FROM n',
  )
    .bind(owner.id, project)
    .run();
  const full = await push(secret, { lessons: [lesson(), lesson()] });
  expect(full.status).toBe(413);
  expect(await full.json()).toEqual({ error: 'lessons_full' });
  expect((await push(secret, { lessons: [lesson()] })).status).toBe(200);
});
