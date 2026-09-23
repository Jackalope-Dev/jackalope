import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { accessAdmin } from '../src/access/admin';
import { unseal } from '../src/access/crypto';
import { queueGrowthMail } from '../src/access/growth-mail';
import { type AccessMail, accessEmail, type WaitlistMail } from '../src/access/mail';
import {
  acceptToken,
  approve,
  invitations,
  inviteEmails,
  type Member,
  register,
  requestLink,
} from '../src/access/service';
import {
  acceptWaitlistToken,
  requestWaitlistLink,
  waitlistCookie,
  waitlistRankSql,
  waitlistStatus,
} from '../src/access/waitlist';
import worker from '../src/index';

const bindings: Env = {
  ...env,
  EARLY_ACCESS_ENABLED: 'true',
  ACCESS_SECRET: 'fixture-secret-'.repeat(4),
  SEQUENZY_API_KEY: 'fixture-provider',
  ACCESS_EMAIL_FROM: 'fixture@example.invalid',
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
  ACCESS_INSTALLER_KEY: '',
  ACCESS_STORE_URL: '',
  GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  IP_LIMITER: { limit: async () => ({ success: true }) },
  FEEDBACK_LIMITER: { limit: async () => ({ success: true }) },
};
beforeAll(async () =>
  applyD1Migrations(
    env.DB,
    (env as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS,
  ),
);
beforeEach(async () => {
  for (const table of [
    'access_invites',
    'access_sessions',
    'access_tokens',
    'access_mail',
    'access_members',
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
});
async function person(email: string) {
  const m = await env.DB.prepare('SELECT * FROM access_members WHERE email=?')
    .bind(email)
    .first<Member>();
  if (!m) throw Error('Missing fixture');
  return m;
}
async function signup(email: string, referral?: string) {
  await register(bindings, email, false, 'inline', undefined, referral);
  return person(email);
}
async function mailToken(email: string, kind = 'waitlist') {
  const row = await env.DB.prepare(
    'SELECT payload FROM access_mail WHERE email=? AND kind=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
  )
    .bind(email, kind)
    .first<{ payload: string }>();
  if (!row) throw Error('Missing mail');
  const mail = await unseal<WaitlistMail | AccessMail>(row.payload, bindings.ACCESS_SECRET);
  if (!mail.token) throw Error('Missing token');
  return mail.token;
}
async function verified(email: string, referral?: string) {
  const m = await signup(email, referral);
  const session = await acceptWaitlistToken(bindings, await mailToken(email));
  return { m, session };
}
function browser(session: string) {
  return new Request('https://api.jackalope.dev/v1/access/waitlist/me', {
    headers: { cookie: waitlistCookie(session) },
  });
}
async function publicCall(path: string, body?: unknown, session?: string) {
  return worker.fetch(
    new Request(`https://api.jackalope.dev/v1/access/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: bindings.ACCESS_WEB_ORIGIN,
        'content-type': 'application/json',
        ...(session ? { cookie: waitlistCookie(session) } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    bindings,
  );
}
function admin(path: string, body?: unknown) {
  return accessAdmin(
    new Request(`https://api.jackalope.dev/admin/api/access${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { origin: 'https://api.jackalope.dev' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    bindings,
    (r) => r.json(),
  );
}

it('verifies once under contention, gives only a private waitlist session, and blocks member privileges', async () => {
  const m = await signup('reader@example.com');
  const raw = await mailToken(m.email);
  const outcomes = await Promise.allSettled([
    acceptWaitlistToken(bindings, raw),
    acceptWaitlistToken(bindings, raw),
  ]);
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const success = outcomes.find((x) => x.status === 'fulfilled');
  if (success?.status !== 'fulfilled') throw Error('Missing session');
  const status = await waitlistStatus(browser(success.value), bindings);
  expect(status).toMatchObject({ status: 'waiting', position: 1, referrals: 0 });
  expect(status.shareUrl).toContain('/?ref=');
  expect(status.shareUrl).not.toContain('invite=');
  for (const path of ['me', 'download', 'devices'])
    expect((await publicCall(path, undefined, success.value)).status).toBe(401);
  expect(
    (await publicCall('invites', { emails: ['friend@example.com'] }, success.value)).status,
  ).toBe(401);
  expect((await publicCall('desktop/approve', { code: 'fixture' }, success.value)).status).toBe(
    401,
  );
  expect((await publicCall('accept', { token: raw })).status).toBe(410);
});

it('credits unlimited verified new signups, never clicks, duplicate registrations, or self-referrals', async () => {
  const { m, session } = await verified('owner@example.com');
  await signup('owner@example.com', m.share_code);
  for (let i = 0; i < 7; i++) await verified(`friend${i}@example.com`, m.share_code);
  await signup('pending@example.com', m.share_code);
  await Promise.all(
    Array.from({ length: 4 }, () =>
      register(bindings, 'friend0@example.com', false, 'inline', undefined, m.share_code),
    ),
  );
  expect(await waitlistStatus(browser(session), bindings)).toMatchObject({
    referrals: 7,
    pending: 1,
    priorityDays: 7,
  });
  expect((await invitations(bindings, await person(m.email))).remaining).toBe(5);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM access_invites').first()).toEqual({
    n: 0,
  });
});

it('locks attribution to the new signup and ignores unverified referrers and existing emails', async () => {
  const a = await verified('a@example.com');
  const b = await verified('b@example.com');
  await signup('new@example.com', a.m.share_code);
  await signup('new@example.com', b.m.share_code);
  await acceptWaitlistToken(bindings, await mailToken('new@example.com'));
  await signup('old@example.com');
  await signup('old@example.com', b.m.share_code);
  await acceptWaitlistToken(bindings, await mailToken('old@example.com'));
  const unverified = await signup('unverified@example.com');
  await verified('uncredited@example.com', unverified.share_code);
  expect(await waitlistStatus(browser(a.session), bindings)).toMatchObject({ referrals: 1 });
  expect(await waitlistStatus(browser(b.session), bindings)).toMatchObject({ referrals: 0 });
});

it('uses the same deterministic priority in the user page and admin queue, with referral sorting and pagination', async () => {
  const a = await verified('early@example.com');
  const b = await verified('later@example.com');
  await env.DB.prepare('UPDATE access_members SET waitlist_joined_at=? WHERE id=?')
    .bind(Date.now() - 3600000, a.m.id)
    .run();
  expect((await waitlistStatus(browser(b.session), bindings)).position).toBe(2);
  await verified('referred@example.com', b.m.share_code);
  expect((await waitlistStatus(browser(b.session), bindings)).position).toBe(1);
  const data = await (await admin('?status=waiting')).json<{
    members: { id: string; position: number; referral_count: number }[];
  }>();
  expect(data.members[0]).toMatchObject({ id: b.m.id, position: 1, referral_count: 1 });
  const next = await (await admin('?status=waiting&offset=1')).json<{
    members: { id: string }[];
  }>();
  expect(next.members[0].id).toBe(a.m.id);
  const top = await (await admin('?status=all&sort=referrals')).json<{
    members: { id: string }[];
  }>();
  expect(top.members[0].id).toBe(b.m.id);
});

it('revocation removes credit and sessions, deletion removes credit, and restoring cannot revive old tokens', async () => {
  const owner = await verified('owner@example.com');
  const friend = await verified('friend@example.com', owner.m.share_code);
  const oldToken = await mailToken(friend.m.email);
  expect((await admin('', { id: friend.m.id, action: 'revoke' })).status).toBe(200);
  expect(await waitlistStatus(browser(owner.session), bindings)).toMatchObject({ referrals: 0 });
  await expect(waitlistStatus(browser(friend.session), bindings)).rejects.toThrow();
  await admin('', { id: friend.m.id, action: 'restore' });
  await expect(acceptWaitlistToken(bindings, oldToken)).rejects.toThrow();
  expect(await waitlistStatus(browser(owner.session), bindings)).toMatchObject({ referrals: 1 });
  await env.DB.prepare('DELETE FROM access_members WHERE id=?').bind(friend.m.id).run();
  expect(await waitlistStatus(browser(owner.session), bindings)).toMatchObject({ referrals: 0 });
});

it('keeps an old referral link unlimited after approval without spending passes or approving invitees', async () => {
  const owner = await verified('owner@example.com');
  await approve(bindings, owner.m.id);
  await acceptToken(bindings, await mailToken(owner.m.email, 'welcome'));
  await verified('still-waiting@example.com', owner.m.share_code);
  expect((await person('still-waiting@example.com')).status).toBe('waiting');
  expect(await waitlistStatus(browser(owner.session), bindings)).toMatchObject({
    status: 'approved',
    position: null,
    referrals: 1,
  });
  expect((await invitations(bindings, await person(owner.m.email))).remaining).toBe(5);
});

it('expires and throttles private status links without revealing whether an email exists', async () => {
  const p = await signup('reader@example.com');
  const initial = await mailToken(p.email);
  expect((await publicCall('waitlist/link', { email: p.email })).status).toBe(202);
  expect((await publicCall('waitlist/link', { email: 'unknown@example.com' })).status).toBe(202);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM access_waitlist_tokens').first()).toEqual({
    n: 1,
  });
  await expect(acceptWaitlistToken(bindings, initial, Date.now() + 8 * 86400000)).rejects.toThrow();
  await requestWaitlistLink(bindings, p.email, Date.now() + 61000);
  const fresh = await mailToken(p.email);
  await expect(acceptWaitlistToken(bindings, fresh, Date.now() + 32 * 60000)).rejects.toThrow();
  expect((await publicCall('waitlist/link', { email: p.email, website: 'bot' })).status).toBe(202);
});

it('queues milestones only once across concurrent drains and never spends the sign-in cooldown', async () => {
  const owner = await verified('owner@example.com');
  for (let i = 0; i < 5; i++) await verified(`r${i}@example.com`, owner.m.share_code);
  await Promise.all([queueGrowthMail(bindings), queueGrowthMail(bindings)]);
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM access_mail WHERE kind='referral'").first(),
  ).toEqual({ n: 2 });
  await env.DB.prepare("DELETE FROM access_mail WHERE kind='referral'").run();
  await queueGrowthMail(bindings);
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM access_mail WHERE kind='referral'").first(),
  ).toEqual({ n: 0 });
  await approve(bindings, owner.m.id);
  expect(await mailToken(owner.m.email, 'welcome')).toMatch(/^[a-f0-9]{64}$/);
});

it('claims a pass atomically, gives the recipient five, and queues both sides of the lifecycle once', async () => {
  const owner = await verified('owner@example.com');
  await approve(bindings, owner.m.id);
  await acceptToken(bindings, await mailToken(owner.m.email, 'welcome'));
  await requestLink(bindings, 'guest@example.com', owner.m.share_code);
  const token = await mailToken('guest@example.com', 'invite');
  await acceptToken(bindings, token);
  await expect(acceptToken(bindings, token)).rejects.toThrow();
  expect((await invitations(bindings, await person(owner.m.email))).remaining).toBe(4);
  expect((await invitations(bindings, await person('guest@example.com'))).remaining).toBe(5);
  await queueGrowthMail(bindings);
  await queueGrowthMail(bindings);
  expect(
    await env.DB.prepare(
      "SELECT kind,count(*) AS n FROM access_mail WHERE kind IN ('pass_claimed','passes_ready') GROUP BY kind ORDER BY kind",
    ).all(),
  ).toMatchObject({
    results: [
      { kind: 'pass_claimed', n: 1 },
      { kind: 'passes_ready', n: 1 },
    ],
  });
});

it('returns expired email reservations and queues one owner notice without emailing the recipient again', async () => {
  const owner = await verified('owner@example.com');
  await approve(bindings, owner.m.id);
  await acceptToken(bindings, await mailToken(owner.m.email, 'welcome'));
  const m = await person(owner.m.email);
  await inviteEmails(bindings, m, ['guest@example.com']);
  expect((await env.DB.prepare(waitlistRankSql).all()).results).toHaveLength(0);
  await signup('guest@example.com');
  expect((await env.DB.prepare(waitlistRankSql).all()).results).toHaveLength(1);
  await env.DB.prepare('UPDATE access_invites SET expires_at=?')
    .bind(Date.now() - 1000)
    .run();
  expect((await invitations(bindings, m)).remaining).toBe(5);
  await queueGrowthMail(bindings);
  await queueGrowthMail(bindings);
  expect(
    await env.DB.prepare(
      "SELECT email,count(*) AS n FROM access_mail WHERE kind='pass_expired' GROUP BY email",
    ).first(),
  ).toEqual({ email: owner.m.email, n: 1 });
});

it('keeps legacy waitlist payloads renderable and new private links separate from share links', () => {
  expect(
    accessEmail({ kind: 'waitlist', to: 'reader@example.com' }, bindings.ACCESS_WEB_ORIGIN).body,
  ).toContain('/waitlist/');
  for (const kind of ['referral', 'passes_ready', 'pass_claimed', 'pass_expired'] as const) {
    const content = accessEmail(
      { kind, to: 'reader@example.com', total: 5 },
      bindings.ACCESS_WEB_ORIGIN,
    );
    expect(content.text).not.toContain('#token=');
    expect(content.body).toContain('Privacy');
    expect(content.text).toContain('Jackalope Digital LLC');
  }
});

it('retains original ordering for existing members with no referrals', async () => {
  await verified('one@example.com');
  await verified('two@example.com');
  const rows = await env.DB.prepare(waitlistRankSql).all<{
    referral_count: number;
    position: number;
  }>();
  expect(rows.results.map((x) => x.position)).toEqual([1, 2]);
  expect(rows.results.every((x) => x.referral_count === 0)).toBe(true);
});

it('lets a signed-in member answer and revise the waitlist questions', async () => {
  const { session } = await verified('questions@example.com');
  const answers = {
    platforms: ['windows', 'linux'],
    agents: ['codex', 'claude'],
    priorities: ['parallel'],
  };

  // Nothing answered yet, so the page has nothing to prefill.
  expect(await waitlistStatus(browser(session), bindings)).toMatchObject({ preferences: null });

  expect((await publicCall('waitlist/preferences', { preferences: answers }, session)).status).toBe(
    200,
  );
  expect(await waitlistStatus(browser(session), bindings)).toMatchObject({ preferences: answers });

  // Answers are revisable: the signup survey's one-time token is not involved.
  const revised = { ...answers, platforms: ['macos'] };
  expect((await publicCall('waitlist/preferences', { preferences: revised }, session)).status).toBe(
    200,
  );
  expect(await waitlistStatus(browser(session), bindings)).toMatchObject({ preferences: revised });

  // The audience sync is told to re-describe them, so the platform tags follow.
  expect(
    await env.DB.prepare('SELECT newsletter_next_at FROM access_members WHERE email=?')
      .bind('questions@example.com')
      .first(),
  ).toEqual({ newsletter_next_at: 0 });

  // Without a session it is not an anonymous write path.
  expect((await publicCall('waitlist/preferences', { preferences: answers })).status).toBe(401);
  expect(
    (await publicCall('waitlist/preferences', { preferences: { platforms: ['bsd'] } }, session))
      .status,
  ).toBe(400);
});
