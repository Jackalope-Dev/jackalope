import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { randomToken, tokenHash } from '../src/access/crypto';
import { pruneAccess } from '../src/access/service';
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
    'access_device_links',
    'access_devices',
    'access_sessions',
    'access_invites',
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
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token
          ? browser
            ? { cookie: `__Host-jackalope=${token}` }
            : { authorization: `Bearer ${token}` }
          : {}),
        ...(browser ? { origin: 'https://jackalope.dev' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    bindings,
  );
}
async function start() {
  const secret = randomToken();
  const response = await call('/v1/desktop/start', 'POST', { challenge: await tokenHash(secret) });
  expect(response.status).toBe(201);
  const data = await response.json<{ verification: string; userCode: string; expiresAt: number }>();
  return { ...data, secret };
}
async function approve(session: string, verification: string) {
  return call('/v1/access/desktop/approve', 'POST', { verification }, session, true);
}
const preferences = {
  version: 1,
  accentHex: '#6366f1',
  isDark: true,
  appearance: 'automatic',
  atmosphere: 12,
  harmony: 'single',
  mascotReactions: true,
  notifications: 'all',
  osNotifications: true,
};
async function connectedDevice(owner: Awaited<ReturnType<typeof member>>) {
  const flow = await start();
  await approve(owner.session, flow.verification);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.secret)).status).toBe(200);
  return flow.secret;
}
async function enableSync(secret: string) {
  expect(
    (await call('/v1/desktop/settings/consent', 'POST', { enabled: true }, secret)).status,
  ).toBe(200);
}
it('sync requires per-device consent and isolates accounts with strict versioned payloads', async () => {
  const secret = await connectedDevice(await member());
  const other = await connectedDevice(await member());
  expect((await call('/v1/desktop/settings')).status).toBe(401);
  expect((await call('/v1/desktop/settings', 'GET', undefined, secret)).status).toBe(403);
  await enableSync(secret);
  expect(await (await call('/v1/desktop/settings', 'GET', undefined, secret)).json()).toEqual({
    revision: 0,
    settings: null,
  });
  for (const settings of [
    { ...preferences, email: 'private@example.invalid' },
    { ...preferences, apiKey: 'secret' },
    { ...preferences, path: '/private/repo' },
    { ...preferences, version: 2 },
    { ...preferences, atmosphere: 65 },
  ]) {
    expect(
      (await call('/v1/desktop/settings', 'PUT', { revision: 0, settings }, secret)).status,
    ).toBe(400);
  }
  expect(
    (await call('/v1/desktop/settings', 'PUT', { revision: 0, settings: preferences }, secret))
      .status,
  ).toBe(200);
  await enableSync(other);
  expect(await (await call('/v1/desktop/settings', 'GET', undefined, other)).json()).toEqual({
    revision: 0,
    settings: null,
  });
  expect((await call('/v1/desktop/settings', 'GET', undefined, secret, true)).status).toBe(403);
});
it('sync rejects stale concurrent writes without silently replacing settings', async () => {
  const owner = await member();
  const a = await connectedDevice(owner);
  const b = await connectedDevice(owner);
  await enableSync(a);
  await enableSync(b);
  const writes = await Promise.all(
    [a, b].map((secret, index) =>
      call(
        '/v1/desktop/settings',
        'PUT',
        {
          revision: 0,
          settings: { ...preferences, atmosphere: index + 1 },
        },
        secret,
      ),
    ),
  );
  expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await call('/v1/desktop/settings', 'PUT', { revision: 1, settings: preferences }, a)).status,
  ).toBe(200);
  expect(
    (
      await call(
        '/v1/desktop/settings',
        'PUT',
        { revision: 1, settings: { ...preferences, atmosphere: 60 } },
        b,
      )
    ).status,
  ).toBe(409);
  expect(await (await call('/v1/desktop/settings', 'GET', undefined, b)).json()).toEqual({
    revision: 2,
    settings: preferences,
  });
});
it('deletion removes the copy, stops every device and prevents stale uploads from recreating it', async () => {
  const owner = await member();
  const a = await connectedDevice(owner);
  const b = await connectedDevice(owner);
  await enableSync(a);
  await enableSync(b);
  await call('/v1/desktop/settings', 'PUT', { revision: 0, settings: preferences }, a);
  expect((await call('/v1/desktop/settings', 'DELETE', undefined, a)).status).toBe(200);
  expect((await call('/v1/desktop/settings', 'DELETE', undefined, a)).status).toBe(200);
  for (const secret of [a, b]) {
    expect((await call('/v1/desktop/settings', 'GET', undefined, secret)).status).toBe(403);
    expect(
      (await call('/v1/desktop/settings', 'PUT', { revision: 0, settings: preferences }, secret))
        .status,
    ).toBe(403);
    expect((await call('/v1/desktop/me', 'GET', undefined, secret)).status).toBe(200);
  }
  expect(
    await env.DB.prepare('SELECT member_id FROM access_settings WHERE member_id=?')
      .bind(owner.id)
      .first(),
  ).toBeNull();
  await enableSync(b);
  expect(
    (await call('/v1/desktop/settings', 'PUT', { revision: 0, settings: preferences }, b)).status,
  ).toBe(200);
});
it('default-on connections honor account deletion until the user explicitly enables sync', async () => {
  const owner = await member();
  const first = await connectedDevice(owner);
  expect(await (await call('/v1/desktop/settings/consent', 'POST', { enabled: true, automatic: true }, first)).json()).toEqual({ enabled: true });
  await call('/v1/desktop/settings', 'DELETE', undefined, first);
  const replacement = await connectedDevice(owner);
  expect(await (await call('/v1/desktop/settings/consent', 'POST', { enabled: true, automatic: true }, replacement)).json()).toEqual({ enabled: false });
  expect((await call('/v1/desktop/settings', 'GET', undefined, replacement)).status).toBe(403);
  await enableSync(replacement);
  expect((await call('/v1/desktop/settings', 'PUT', { revision: 0, settings: preferences }, replacement)).status).toBe(200);
});
it('turning sync off preserves the saved copy; deleting the member cascades to that copy', async () => {
  const owner = await member();
  const secret = await connectedDevice(owner);
  await enableSync(secret);
  await call('/v1/desktop/settings', 'PUT', { revision: 0, settings: preferences }, secret);
  await call('/v1/desktop/settings/consent', 'POST', { enabled: false }, secret);
  expect((await call('/v1/desktop/settings', 'GET', undefined, secret)).status).toBe(403);
  expect(
    await env.DB.prepare('SELECT revision FROM access_settings WHERE member_id=?')
      .bind(owner.id)
      .first(),
  ).toEqual({ revision: 1 });
  await env.DB.prepare('DELETE FROM access_sessions WHERE member_id=?').bind(owner.id).run();
  await env.DB.prepare('DELETE FROM access_members WHERE id=?').bind(owner.id).run();
  expect(
    await env.DB.prepare('SELECT revision FROM access_settings WHERE member_id=?')
      .bind(owner.id)
      .first(),
  ).toBeNull();
});
it('verified waitlist pairing reports waiting without issuing device or sync access', async () => {
  const owner = await member();
  await env.DB.prepare(
    "UPDATE access_members SET status='waiting',waitlist_verified_at=? WHERE id=?",
  )
    .bind(Date.now(), owner.id)
    .run();
  const session = randomToken();
  await env.DB.prepare(
    'INSERT INTO access_waitlist_sessions(hash,member_id,expires_at) VALUES(?,?,?)',
  )
    .bind(await tokenHash(session), owner.id, Date.now() + 60000)
    .run();
  const flow = await start();
  const response = await worker.fetch(
    new Request('https://api.jackalope.dev/v1/access/waitlist/desktop/approve', {
      method: 'POST',
      headers: {
        origin: 'https://jackalope.dev',
        'content-type': 'application/json',
        cookie: `__Host-jackalope-waitlist=${session}`,
      },
      body: JSON.stringify({ verification: flow.verification }),
    }),
    bindings,
  );
  expect(response.status).toBe(200);
  const poll = await call('/v1/desktop/exchange', 'POST', undefined, flow.secret);
  expect(poll.status).toBe(202);
  expect(await poll.json()).toEqual({ status: 'waiting' });
  expect((await call('/v1/desktop/me', 'GET', undefined, flow.secret)).status).toBe(401);
  expect((await call('/v1/desktop/settings', 'GET', undefined, flow.secret)).status).toBe(401);
  expect(
    (await call('/v1/desktop/settings/consent', 'POST', { enabled: true }, flow.secret)).status,
  ).toBe(401);
});
it('requires browser approval and native proof; retrying a lost exchange response creates one revocable device', async () => {
  const owner = await member();
  const flow = await start();
  expect((await call('/v1/desktop/me', 'GET', undefined, flow.secret)).status).toBe(401);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.verification)).status).toBe(
    410,
  );
  const preview = await call(
    '/v1/access/desktop/preview',
    'POST',
    { verification: flow.verification },
    owner.session,
    true,
  );
  expect((await preview.json<{ userCode: string }>()).userCode).toBe(flow.userCode);
  expect((await approve(owner.session, flow.verification)).status).toBe(200);
  expect((await approve(owner.session, flow.verification)).status).toBe(410);
  const responses = await Promise.all([
    call('/v1/desktop/exchange', 'POST', undefined, flow.secret),
    call('/v1/desktop/exchange', 'POST', undefined, flow.secret),
  ]);
  expect(responses.some((response) => response.status === 200)).toBe(true);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.secret)).status).toBe(200);
  expect(
    (await env.DB.prepare('SELECT count(*) AS n FROM access_devices').first<{ n: number }>())?.n,
  ).toBe(1);
  expect(
    await env.DB.prepare('SELECT first_desktop_at FROM access_members WHERE id=?')
      .bind(owner.id)
      .first(),
  ).toEqual({ first_desktop_at: expect.any(Number) });
  const list = await call('/v1/access/devices', 'GET', undefined, owner.session, true);
  const devices = await list.json<{ id: string }[]>();
  expect(devices).toHaveLength(1);
  expect(JSON.stringify(devices)).not.toContain(flow.secret);
  expect((await call('/v1/access/me', 'GET', undefined, flow.secret)).status).toBe(401);
  expect(
    (await call('/v1/access/desktop/revoke', 'POST', { id: devices[0].id }, owner.session, true))
      .status,
  ).toBe(200);
  expect((await call('/v1/desktop/me', 'GET', undefined, flow.secret)).status).toBe(401);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.secret)).status).toBe(410);
});
it('bounds polling, expires requests and prevents canceled approvals', async () => {
  const owner = await member();
  const flow = await start();
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.secret)).status).toBe(202);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.secret)).status).toBe(429);
  expect((await call('/v1/desktop/session', 'DELETE', undefined, flow.secret)).status).toBe(200);
  expect((await approve(owner.session, flow.verification)).status).toBe(410);
  const expired = await start();
  await env.DB.prepare('UPDATE access_device_links SET expires_at=0').run();
  expect((await approve(owner.session, expired.verification)).status).toBe(410);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, expired.secret)).status).toBe(410);
  await pruneAccess(bindings);
  expect(
    (await env.DB.prepare('SELECT count(*) AS n FROM access_device_links').first<{ n: number }>())
      ?.n,
  ).toBe(0);
});
it('requires a same-origin approved browser session and rejects browser access to native credentials', async () => {
  const owner = await member();
  const flow = await start();
  expect(
    (
      await call(
        '/v1/access/desktop/approve',
        'POST',
        { verification: flow.verification },
        undefined,
        true,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await call(
        '/v1/access/desktop/approve',
        'POST',
        { verification: flow.verification },
        owner.session,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        '/v1/desktop/start',
        'POST',
        { challenge: await tokenHash(randomToken()) },
        undefined,
        true,
      )
    ).status,
  ).toBe(403);
  expect(
    (await call('/v1/access/desktop/approve', 'GET', undefined, owner.session, true)).status,
  ).toBe(404);
  await env.DB.prepare("UPDATE access_members SET status='waiting' WHERE id=?")
    .bind(owner.id)
    .run();
  expect((await approve(owner.session, flow.verification)).status).toBe(401);
});
it('membership revocation destroys pending and active devices even if membership is restored', async () => {
  const owner = await member();
  const flow = await start();
  await approve(owner.session, flow.verification);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.secret)).status).toBe(200);
  await env.DB.prepare("UPDATE access_members SET status='revoked' WHERE id=?")
    .bind(owner.id)
    .run();
  await env.DB.prepare("UPDATE access_members SET status='approved' WHERE id=?")
    .bind(owner.id)
    .run();
  expect((await call('/v1/desktop/me', 'GET', undefined, flow.secret)).status).toBe(401);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.secret)).status).toBe(410);
});
it('a different member cannot revoke a device and native disconnect is idempotent', async () => {
  const owner = await member();
  const stranger = await member();
  const flow = await start();
  await approve(owner.session, flow.verification);
  const response = await call('/v1/desktop/exchange', 'POST', undefined, flow.secret);
  const device = await response.json<{ id: string }>();
  await call('/v1/access/desktop/revoke', 'POST', { id: device.id }, stranger.session, true);
  expect((await call('/v1/desktop/me', 'GET', undefined, flow.secret)).status).toBe(200);
  expect((await call('/v1/desktop/session', 'DELETE', undefined, flow.secret)).status).toBe(200);
  expect((await call('/v1/desktop/session', 'DELETE', undefined, flow.secret)).status).toBe(200);
  expect((await call('/v1/desktop/me', 'GET', undefined, flow.secret)).status).toBe(401);
});
it('returns bounded invitation progress to the connected desktop without exposing device secrets', async () => {
  const owner = await member();
  const flow = await start();
  await approve(owner.session, flow.verification);
  expect((await call('/v1/desktop/exchange', 'POST', undefined, flow.secret)).status).toBe(200);
  const invitedId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO access_members(id,email,status,created_at,approved_at,verified_at,source,invited_by,share_code) VALUES(?,?,'approved',?,?,?,'invitation',?,?)",
    ).bind(invitedId, 'friend@example.invalid', now, now, now, owner.id, randomToken()),
    env.DB.prepare(
      "INSERT INTO access_invites(id,owner_id,email,status,created_at,expires_at,accepted_at,last_sent) VALUES(?,?,?,'accepted',?,?,?,?)",
    ).bind(crypto.randomUUID(), owner.id, 'friend@example.invalid', now, now + 60000, now, now),
  ]);
  const accepted = await call('/v1/desktop/referrals', 'GET', undefined, flow.secret);
  expect(await accepted.json()).toMatchObject({
    limit: 5,
    remaining: 4,
    accepted: 1,
    downloaded: 0,
    connected: 0,
    shareUrl: expect.stringContaining('/access/?invite='),
    invites: [
      {
        email: 'friend@example.invalid',
        status: 'accepted',
        downloaded_at: null,
        connected_at: null,
      },
    ],
  });
  const invitedSecret = randomToken();
  await env.DB.prepare(
    'INSERT INTO access_devices(id,hash,member_id,created_at,expires_at) VALUES(?,?,?,?,?)',
  )
    .bind(crypto.randomUUID(), await tokenHash(invitedSecret), invitedId, now, now + 60000)
    .run();
  await env.DB.prepare(
    'UPDATE access_members SET first_download_at=?,first_desktop_at=? WHERE id=?',
  )
    .bind(now - 1, now, invitedId)
    .run();
  const connected = await call('/v1/desktop/referrals', 'GET', undefined, flow.secret);
  const body = await connected.json<{
    downloaded: number;
    connected: number;
    invites: { downloaded_at: number | null; connected_at: number | null }[];
  }>();
  expect(body.downloaded).toBe(1);
  expect(body.connected).toBe(1);
  expect(body.invites[0].downloaded_at).toBe(now - 1);
  expect(body.invites[0].connected_at).toBe(now);
  expect(JSON.stringify(body)).not.toContain(invitedSecret);
  expect((await call('/v1/desktop/referrals')).status).toBe(401);
});
