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
    'access_skill_devices',
    'access_skills',
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
function call(path: string, method = 'GET', body?: unknown, token?: string) {
  return worker.fetch(
    new Request(`https://api.jackalope.dev${path}`, {
      method,
      headers: {
        'x-jackalope-waitlist': '1',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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

const hash = 'b'.repeat(64);
function skill(overrides: Record<string, unknown> = {}) {
  return {
    location: { scope: 'personal', root: 'claude', project: null, name: 'release-notes' },
    description: 'Write release notes in our voice.',
    files: [{ path: 'SKILL.md', content: '---\nname: release-notes\n---\nKeep it short.\n' }],
    hash,
    ...overrides,
  };
}
function push(secret: string, body: Record<string, unknown>) {
  return call(
    '/v1/desktop/skills/push',
    'POST',
    { epoch: 1, id: crypto.randomUUID(), baseRevision: 0, deleted: false, skill: skill(), ...body },
    secret,
  );
}
async function pull(secret: string, cursor = 0, epoch = 0) {
  const response = await call('/v1/desktop/skills/pull', 'POST', { epoch, cursor }, secret);
  expect(response.status).toBe(200);
  return response.json<{
    epoch: number;
    cursor: number;
    more: boolean;
    skills: { id: string; revision: number; deleted: boolean; skill?: ReturnType<typeof skill> }[];
  }>();
}

it('requires settings sync consent and keeps each account separate', async () => {
  const owner = await member();
  const a = await device(owner);
  const withoutConsent = await device(owner, false);
  const stranger = await device(await member());
  expect((await call('/v1/desktop/skills/pull', 'POST', { epoch: 0, cursor: 0 })).status).toBe(401);
  expect(
    (await call('/v1/desktop/skills/pull', 'POST', { epoch: 0, cursor: 0 }, withoutConsent)).status,
  ).toBe(403);
  expect((await call('/v1/desktop/skills/pull', 'GET', undefined, a)).status).toBe(404);
  const id = crypto.randomUUID();
  const stored = await push(a, { id });
  expect(stored.status).toBe(200);
  expect(await stored.json()).toMatchObject({ status: 'stored', revision: 1 });
  expect((await push(withoutConsent, {})).status).toBe(403);
  const page = await pull(a);
  expect(page).toMatchObject({ epoch: 1, more: false });
  expect(page.skills).toEqual([
    expect.objectContaining({ id, revision: 1, deleted: false, skill: skill() }),
  ]);
  expect((await pull(stranger)).skills).toEqual([]);
});

it('accepts only skill text, a location key and safe relative file names', async () => {
  const secret = await device(await member());
  const credential = ['ghp_', 'a'.repeat(30)].join('');
  const files = (path: string, content = 'text') => [
    { path: 'SKILL.md', content: 'body' },
    { path, content },
  ];
  for (const invalid of [
    skill({ folder: '/Users/someone/.claude/skills/release-notes' }),
    skill({
      location: { scope: 'personal', root: 'claude', project: null, name: 'x', path: '/a' },
    }),
    skill({ location: { scope: 'project', root: 'claude', project: null, name: 'x' } }),
    skill({ location: { scope: 'personal', root: 'claude', project: hash, name: 'x' } }),
    skill({ location: { scope: 'personal', root: 'cursor', project: null, name: 'x' } }),
    skill({ location: { scope: 'personal', root: 'claude', project: null, name: '../x' } }),
    skill({ files: files('../escape.md') }),
    skill({ files: files('/etc/passwd') }),
    skill({ files: files('.env') }),
    skill({ files: files('scripts/.hidden') }),
    skill({ files: files('a/b/c/d.md') }),
    skill({ files: [{ path: 'notes.md', content: 'no SKILL.md' }] }),
    skill({ files: [{ path: 'SKILL.md', content: `Use ${credential} to publish.` }] }),
    skill({ files: [{ path: 'SKILL.md', content: 'x', mode: 'executable' }] }),
    skill({ files: Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.md`, content: 'x' })) }),
    skill({
      files: [
        { path: 'SKILL.md', content: 'x'.repeat(12_001) },
        { path: 'more.md', content: 'x'.repeat(12_000) },
      ],
    }),
    skill({ hash: 'not-a-hash' }),
  ]) {
    expect((await push(secret, { skill: invalid })).status).toBe(400);
  }
  expect((await push(secret, { deleted: true, baseRevision: 1 })).status).toBe(400);
  expect((await push(secret, { deleted: true, skill: undefined })).status).toBe(400);
  expect((await push(secret, {})).status).toBe(200);
});

it('refuses a write based on an old revision so devices see a conflict', async () => {
  const owner = await member();
  const a = await device(owner);
  const b = await device(owner);
  const id = crypto.randomUUID();
  await push(a, { id });
  const edited = skill({ description: 'Edited on b.' });
  const fromB = await (await push(b, { id, baseRevision: 1, skill: edited })).json();
  expect(fromB).toMatchObject({ status: 'stored', revision: 2 });
  const stale = await (
    await push(a, { id, baseRevision: 1, skill: skill({ description: 'Edited on a.' }) })
  ).json();
  expect(stale).toEqual({ status: 'conflict', revision: 2 });
  // A second device creating the same id is a conflict too, never an overwrite.
  expect(await (await push(a, { id })).json()).toEqual({ status: 'conflict', revision: 2 });
  const page = await pull(a);
  expect(page.skills[0]).toMatchObject({ revision: 2, skill: edited });
  // Resolving on a: write on top of the revision it now holds.
  expect(await (await push(a, { id, baseRevision: 2 })).json()).toMatchObject({
    status: 'stored',
    revision: 3,
  });
  const later = await pull(b, page.cursor, page.epoch);
  expect(later.skills.map((item) => item.revision)).toEqual([3]);
  const removed = await (
    await push(b, { id, baseRevision: 3, deleted: true, skill: undefined })
  ).json();
  expect(removed).toMatchObject({ status: 'stored', revision: 4 });
  const tombstone = await pull(a, later.cursor, later.epoch);
  expect(tombstone.skills).toEqual([expect.objectContaining({ id, deleted: true, revision: 4 })]);
  expect(tombstone.skills[0].skill).toBeUndefined();
});

it('reports which devices hold each synced skill', async () => {
  const owner = await member();
  const a = await device(owner);
  const b = await device(owner);
  const id = crypto.randomUUID();
  await push(a, { id });
  await push(a, { id, baseRevision: 1 });
  const unknown = crypto.randomUUID();
  const response = await call(
    '/v1/desktop/skills/have',
    'POST',
    {
      epoch: 1,
      have: [
        { id, revision: 1 },
        { id: unknown, revision: 1 },
      ],
    },
    b,
  );
  expect(response.status).toBe(200);
  const view = await response.json<{
    devices: { id: string; here: boolean }[];
    holdings: { skill: string; device: string; revision: number }[];
  }>();
  expect(view.devices).toHaveLength(2);
  const here = view.devices.find((item) => item.here)?.id;
  const there = view.devices.find((item) => !item.here)?.id;
  expect(view.holdings).toEqual(
    expect.arrayContaining([
      { skill: id, device: there, revision: 2 },
      { skill: id, device: here, revision: 1 },
    ]),
  );
  expect(view.holdings.some((item) => item.skill === unknown)).toBe(false);
  // A revision the account never stored is not recorded.
  const ahead = await call(
    '/v1/desktop/skills/have',
    'POST',
    { epoch: 1, have: [{ id, revision: 9 }] },
    b,
  );
  const after = await ahead.json<{ holdings: { device: string }[] }>();
  expect(after.holdings.filter((item) => item.device === here)).toEqual([]);
});

it('deleting synced skills starts a new epoch that stops stale devices', async () => {
  const owner = await member();
  const a = await device(owner);
  const b = await device(owner);
  await push(a, {});
  expect((await call('/v1/desktop/skills', 'DELETE', undefined, b)).status).toBe(200);
  const stale = await call('/v1/desktop/skills/pull', 'POST', { epoch: 1, cursor: 0 }, a);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: 'skills_reset' });
  expect((await push(a, {})).status).toBe(409);
  expect(await pull(a)).toMatchObject({ epoch: 2, skills: [] });
  expect((await push(a, { epoch: 2 })).status).toBe(200);
  // Deleting synced settings removes synced skills too.
  expect((await call('/v1/desktop/settings', 'DELETE', undefined, a)).status).toBe(200);
  expect((await call('/v1/desktop/settings/consent', 'POST', { enabled: true }, a)).status).toBe(
    200,
  );
  expect((await pull(a)).skills).toEqual([]);
});

it('pages changes and bounds the skills an account can store', async () => {
  const owner = await member();
  const secret = await device(owner);
  for (let index = 0; index < 10; index += 1) await push(secret, {});
  const first = await pull(secret);
  expect(first).toMatchObject({ more: true });
  expect(first.skills).toHaveLength(8);
  const second = await pull(secret, first.cursor, first.epoch);
  expect(second).toMatchObject({ more: false });
  expect(second.skills).toHaveLength(2);
  await env.DB.prepare(
    'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<190) INSERT INTO access_skills(member_id,id,revision,updated_at,deleted,body,seq) SELECT ?,lower(hex(randomblob(16))),1,0,1,NULL,100+i FROM n',
  )
    .bind(owner.id)
    .run();
  const full = await push(secret, {});
  expect(full.status).toBe(413);
  expect(await full.json()).toEqual({ error: 'skills_full' });
});
