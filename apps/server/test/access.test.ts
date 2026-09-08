import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { unseal } from '../src/access/crypto';
import { waitlistInsights } from '../src/access/insights';
import {
  type AccessMail,
  accessEmail,
  deliverAccessMail,
  type WaitlistMail,
} from '../src/access/mail';
import { syncNewsletter } from '../src/access/newsletter';
import {
  acceptToken,
  approve,
  changeInvite,
  invitations,
  inviteEmails,
  type Member,
  memberInsert,
  register,
  requestLink,
} from '../src/access/service';
import { adminRoutes } from '../src/admin';
import worker from '../src/index';

const bindings: Env = {
  ...env,
  EARLY_ACCESS_ENABLED: 'true',
  ACCESS_SECRET: 'test-secret-'.repeat(4),
  SEQUENZY_API_KEY: 'test-provider-key',
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
  ACCESS_EMAIL_FROM: 'Jackalope <hello@hello.jackalope.dev>',
  ACCESS_EMAIL_REPLY_TO: 'contact@jackalope.dev',
  ACCESS_INSTALLER_KEY: '',
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
  bindings.ACCESS_STORE_URL = '';
  for (const table of [
    'access_sessions',
    'access_tokens',
    'access_invites',
    'access_mail',
    'access_members',
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
});
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture');
  return value;
}
async function member(email: string) {
  await memberInsert(bindings, email, 'fixture').run();
  return required(
    await env.DB.prepare('SELECT * FROM access_members WHERE email=?').bind(email).first<Member>(),
  );
}
async function mail(email: string) {
  const row = await env.DB.prepare(
    "SELECT payload FROM access_mail WHERE email=? AND kind!='waitlist' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email)
    .first<{ payload: string }>();
  expect(row).not.toBeNull();
  return unseal<AccessMail>(required(row).payload, bindings.ACCESS_SECRET);
}
async function admitted(email: string) {
  const person = await member(email);
  await approve(bindings, person.id);
  const session = await acceptToken(bindings, (await mail(email)).token);
  return {
    person: required(
      await env.DB.prepare('SELECT * FROM access_members WHERE id=?')
        .bind(person.id)
        .first<Member>(),
    ),
    session,
  };
}
async function request(
  path: string,
  body?: unknown,
  cookie?: string,
  origin = 'https://jackalope.dev',
) {
  return worker.fetch(
    new Request(`https://api.jackalope.dev/v1/access/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        ...(cookie ? { cookie: `__Host-jackalope=${cookie}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    bindings,
  );
}
it('normalizes waitlist emails, keeps approval private and makes approval idempotent', async () => {
  expect(
    (await request('waitlist', { email: ' PERSON@example.com ', newsletter: true })).status,
  ).toBe(202);
  const person = required(await env.DB.prepare('SELECT * FROM access_members').first<Member>());
  expect(person.email).toBe('person@example.com');
  expect(person.status).toBe('waiting');
  expect((await request('me')).status).toBe(401);
  await Promise.all([approve(bindings, person.id), approve(bindings, person.id)]);
  expect(
    (await env.DB.prepare('SELECT count(*) AS n FROM access_mail').first<{ n: number }>())?.n,
  ).toBe(2);
  const token = (await mail(person.email)).token;
  const response = await request('accept', { token });
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  expect((await request('accept', { token })).status).toBe(410);
});
it('saves optional multi-select insights once without granting access or allowing email-based overwrite', async () => {
  const campaign = { source: 'dev', medium: 'article', campaign: 'launch', landing: '/compare/' };
  const signup = await (
    await request('waitlist', { email: 'insights@example.com', campaign })
  ).json<{ surveyToken: string }>();
  const preferences = {
    platforms: ['macos', 'linux', 'linux'],
    agents: ['codex', 'claude'],
    priorities: ['review'],
  };
  expect(
    await (await request('preferences', { token: signup.surveyToken, preferences })).json(),
  ).toEqual({ success: true });
  const saved = await env.DB.prepare(
    'SELECT status,preferences,campaign,survey_hash FROM access_members',
  ).first<{ status: string; preferences: string; campaign: string; survey_hash: string | null }>();
  expect(saved?.status).toBe('waiting');
  expect(JSON.parse(required(saved).preferences).platforms).toEqual(['macos', 'linux']);
  expect(JSON.parse(required(saved).campaign)).toEqual(campaign);
  expect(saved?.survey_hash).toBeNull();
  const duplicate = await (await request('waitlist', { email: 'insights@example.com' })).json<{
    surveyToken: string;
  }>();
  expect(
    await (
      await request('preferences', {
        token: duplicate.surveyToken,
        preferences: { ...preferences, agents: ['other'] },
      })
    ).json(),
  ).toEqual({ success: true });
  expect(
    await (await request('preferences', { token: signup.surveyToken, preferences })).json(),
  ).toEqual({ success: true });
  expect(
    (
      await request('preferences', {
        token: signup.surveyToken,
        preferences: { ...preferences, platforms: ['invalid'] },
      })
    ).status,
  ).toBe(400);
  const insights = await waitlistInsights(bindings);
  expect(insights.platforms).toEqual([
    { label: 'linux', count: 1 },
    { label: 'macos', count: 1 },
  ]);
  expect(insights.sources).toEqual([{ label: 'dev', count: 1 }]);
  expect(insights.totals).toMatchObject({ requested: 1, responded: 1, approved: 0 });
});
it('expires survey capabilities and never creates a member for the honeypot', async () => {
  const preferences = { platforms: ['windows'], agents: [], priorities: [] };
  const signup = await (await request('waitlist', { email: 'expired@example.com' })).json<{
    surveyToken: string;
  }>();
  await env.DB.prepare('UPDATE access_members SET survey_expires_at=0').run();
  expect(
    await (await request('preferences', { token: signup.surveyToken, preferences })).json(),
  ).toMatchObject({ success: true });
  const trapped = await (
    await request('waitlist', { email: 'bot@example.com', website: 'spam' })
  ).json<{ surveyToken: string }>();
  expect(trapped.surveyToken).toHaveLength(64);
  expect(
    await (await request('preferences', { token: trapped.surveyToken, preferences })).json(),
  ).toMatchObject({ success: true });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM access_members').first()).toEqual({
    n: 1,
  });
  expect(
    (
      await request('waitlist', {
        email: 'bad@example.com',
        campaign: { landing: '/', source: '<script>' },
      })
    ).status,
  ).toBe(400);
});
it('confirms a new signup once under contention, without issuing access or requiring newsletter consent', async () => {
  await Promise.all(
    Array.from({ length: 5 }, () => register(bindings, 'signup@example.com', false, 'popup')),
  );
  const rows = await env.DB.prepare('SELECT kind,payload FROM access_mail').all<{
    kind: string;
    payload: string;
  }>();
  expect(rows.results).toHaveLength(1);
  expect(rows.results[0].kind).toBe('waitlist');
  const message = await unseal<WaitlistMail>(rows.results[0].payload, bindings.ACCESS_SECRET);
  expect(message).toEqual({ kind: 'waitlist', to: 'signup@example.com' });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM access_tokens').first()).toEqual({ n: 0 });
  expect(await env.DB.prepare('SELECT status,newsletter FROM access_members').first()).toEqual({
    status: 'waiting',
    newsletter: 0,
  });
  const content = accessEmail(message, bindings.ACCESS_WEB_ORIGIN);
  expect(content.subject).toBe('You’re on the Jackalope waitlist');
  expect(content.body).toContain('Your signup is confirmed');
  expect(content.body).toContain('https://jackalope.dev/tour/');
  expect(content.body).not.toContain('#token=');
  expect(content.text).toContain('We’ll email you as early-access places open.');
  await env.DB.prepare('DELETE FROM access_mail').run();
  await register(bindings, message.to, true, 'inline');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM access_mail').first()).toEqual({ n: 0 });
  expect(await env.DB.prepare('SELECT newsletter FROM access_members').first()).toEqual({
    newsletter: 1,
  });
});
it('retries confirmation failures and preserves one queue claim across competing deliveries', async () => {
  await register(bindings, 'signup@example.com', false, 'inline');
  await deliverAccessMail(
    bindings,
    (async () => new Response(null, { status: 503 })) as typeof fetch,
  );
  expect(await env.DB.prepare('SELECT state,attempts FROM access_mail').first()).toEqual({
    state: 'failed',
    attempts: 1,
  });
  let sends = 0;
  const send = (async (_url, init) => {
    sends++;
    const payload = JSON.parse(String(init?.body));
    expect(payload.subject).toBe('You’re on the Jackalope waitlist');
    expect(payload.body).not.toContain('#token=');
    return Response.json({ success: true, jobId: 'fixture-confirmation' });
  }) as typeof fetch;
  await Promise.all([
    deliverAccessMail(bindings, send, Date.now() + 3600000),
    deliverAccessMail(bindings, send, Date.now() + 3600000),
  ]);
  expect(sends).toBe(1);
  expect(await env.DB.prepare('SELECT state,payload FROM access_mail').first()).toEqual({
    state: 'queued',
    payload: '',
  });
});
it('rolls back a signup if its confirmation cannot be durably queued', async () => {
  await env.DB.exec(
    "CREATE TRIGGER fail_confirmation BEFORE INSERT ON access_mail BEGIN SELECT RAISE(ABORT,'fixture_queue_failure'); END",
  );
  try {
    await expect(register(bindings, 'signup@example.com', false, 'popup')).rejects.toThrow();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM access_members').first()).toEqual({
      n: 0,
    });
  } finally {
    await env.DB.exec('DROP TRIGGER fail_confirmation');
  }
});
it('does not queue confirmations for honeypots or existing approved and revoked members', async () => {
  expect((await request('waitlist', { email: 'bot@example.com', website: 'bot' })).status).toBe(
    202,
  );
  const existing = await member('existing@example.com');
  for (const status of ['approved', 'revoked']) {
    await env.DB.prepare('UPDATE access_members SET status=? WHERE id=?')
      .bind(status, existing.id)
      .run();
    await register(bindings, existing.email, false, 'popup');
  }
  expect(await env.DB.prepare('SELECT count(*) AS n FROM access_mail').first()).toEqual({ n: 0 });
});
it('allows exactly five competing shared acceptances and retains the sixth token for retry', async () => {
  const { person } = await admitted('owner@example.com');
  const emails = Array.from({ length: 6 }, (_, i) => `friend${i}@example.com`);
  for (const email of emails) await requestLink(bindings, email, person.share_code);
  const tokens = await Promise.all(emails.map(async (email) => (await mail(email)).token));
  const results = await Promise.all(tokens.map((token) => request('accept', { token })));
  expect(results.filter((r) => r.status === 200)).toHaveLength(5);
  expect(results.filter((r) => r.status === 409)).toHaveLength(1);
  expect((await invitations(bindings, person)).remaining).toBe(0);
  expect(
    (
      await env.DB.prepare(
        "SELECT count(*) AS n FROM access_members WHERE invited_by=? AND status='approved' AND invite_limit=5",
      )
        .bind(person.id)
        .first<{ n: number }>()
    )?.n,
  ).toBe(5);
  const lost = tokens[results.findIndex((r) => r.status === 409)];
  expect((await request('accept', { token: lost })).status).toBe(409);
});
it('reserves email invitations, rolls back over-capacity batches, releases revoked reservations and attributes acceptance once', async () => {
  const { person } = await admitted('owner@example.com');
  await inviteEmails(bindings, person, [
    'a@example.com',
    'b@example.com',
    'c@example.com',
    'd@example.com',
  ]);
  await expect(
    inviteEmails(bindings, person, ['e@example.com', 'f@example.com']),
  ).rejects.toMatchObject({ code: 'invitation_full' });
  expect(
    await env.DB.prepare('SELECT id FROM access_members WHERE email=?')
      .bind('e@example.com')
      .first(),
  ).toBeNull();
  const before = await invitations(bindings, person);
  expect(before.remaining).toBe(1);
  await inviteEmails(bindings, person, ['a@example.com']);
  expect((await invitations(bindings, person)).remaining).toBe(1);
  const invite = required(before.invites.find((i) => i.email === 'a@example.com'));
  await changeInvite(bindings, person, invite.id, 'revoke');
  await expect(acceptToken(bindings, (await mail('a@example.com')).token)).rejects.toMatchObject({
    code: 'link_expired',
  });
  expect((await invitations(bindings, person)).remaining).toBe(2);
  await acceptToken(bindings, (await mail('b@example.com')).token);
  expect((await invitations(bindings, person)).remaining).toBe(2);
  expect(
    (await invitations(bindings, person)).invites.find((i) => i.email === 'b@example.com')?.status,
  ).toBe('accepted');
});
it('rejects expired links, revoked owners and replay while retaining approved sessions until revoked', async () => {
  const { person, session } = await admitted('owner@example.com');
  await inviteEmails(bindings, person, ['friend@example.com']);
  await env.DB.prepare("UPDATE access_members SET status='revoked' WHERE id=?")
    .bind(person.id)
    .run();
  expect((await request('me', undefined, session)).status).toBe(401);
  expect(
    (await request('accept', { token: (await mail('friend@example.com')).token })).status,
  ).toBe(410);
  const waiting = await member('waiting@example.com');
  await approve(bindings, waiting.id);
  await env.DB.prepare('UPDATE access_tokens SET expires_at=1 WHERE email=?')
    .bind(waiting.email)
    .run();
  expect((await request('accept', { token: (await mail(waiting.email)).token })).status).toBe(410);
});
it('requires the exact site origin, gives generic sign-in responses, and protects private installer objects', async () => {
  expect((await request('link', { email: 'unknown@example.com' })).status).toBe(202);
  expect(
    (await request('waitlist', { email: 'unknown@example.com' }, undefined, 'https://evil.example'))
      .status,
  ).toBe(403);
  const { session } = await admitted('owner@example.com');
  bindings.ACCESS_INSTALLER_KEY = 'early-access/v0.1.0/Jackalope-setup.exe';
  await env.RELEASES.put(bindings.ACCESS_INSTALLER_KEY, 'test installer fixture');
  expect((await request('download')).status).toBe(401);
  const download = await request('download', undefined, session);
  expect(download.status).toBe(200);
  expect(download.headers.get('cache-control')).toBe('no-store');
  expect(new TextDecoder().decode(await download.arrayBuffer())).toBe('test installer fixture');
  expect(
    await env.DB.prepare(
      "SELECT first_download_at FROM access_members WHERE email='owner@example.com'",
    ).first(),
  ).toEqual({ first_download_at: expect.any(Number) });
  const publicResponse = await worker.fetch(
    new Request(`https://api.jackalope.dev/updates/${bindings.ACCESS_INSTALLER_KEY}`),
    bindings,
  );
  expect(publicResponse.status).toBe(404);
  await request('logout', {}, session);
  expect((await request('me', undefined, session)).status).toBe(401);
  await env.RELEASES.delete(bindings.ACCESS_INSTALLER_KEY);
  bindings.ACCESS_INSTALLER_KEY = '';
});
it('offers an approved member a Store link without a private installer and still rejects signed-out users', async () => {
  const { session } = await admitted('store-owner@example.com');
  bindings.ACCESS_STORE_URL = 'https://apps.microsoft.com/detail/9NBLGGH4R315';
  expect((await request('download')).status).toBe(401);
  expect(await (await request('me', undefined, session)).json()).toMatchObject({
    download: { kind: 'store' },
  });
  const response = await request('download', undefined, session);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(bindings.ACCESS_STORE_URL);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(
    await env.DB.prepare(
      "SELECT first_download_at FROM access_members WHERE email='store-owner@example.com'",
    ).first(),
  ).toEqual({ first_download_at: expect.any(Number) });
  for (const url of [
    'https://apps.microsoft.com.evil.example/detail/9NBLGGH4R315',
    'https://evil.example/',
    'javascript:alert(1)',
  ]) {
    bindings.ACCESS_STORE_URL = url;
    expect((await request('download', undefined, session)).status).toBe(404);
  }
});
it('queues branded transactional mail once with encrypted tokens and retries provider failures', async () => {
  const person = await member('person@example.com');
  await approve(bindings, person.id);
  const message = await mail(person.email);
  const row = await env.DB.prepare('SELECT payload FROM access_mail').first<{ payload: string }>();
  expect(row?.payload).not.toContain(message.token);
  const rendered = accessEmail(message, bindings.ACCESS_WEB_ORIGIN);
  expect(rendered.body).toContain('/access/#token=');
  expect(rendered.body).toContain('Jackalope Digital LLC');
  let sends = 0;
  const send = (async () => {
    sends++;
    return Response.json({ success: true, jobId: 'fixture-job' });
  }) as typeof fetch;
  await Promise.all([deliverAccessMail(bindings, send), deliverAccessMail(bindings, send)]);
  expect(sends).toBe(1);
  expect(await env.DB.prepare('SELECT state,payload FROM access_mail').first()).toMatchObject({
    state: 'queued',
    payload: '',
  });
  const other = await member('other@example.com');
  await approve(bindings, other.id);
  await deliverAccessMail(
    bindings,
    (async () => new Response(null, { status: 503 })) as typeof fetch,
  );
  expect(
    await env.DB.prepare('SELECT state FROM access_mail WHERE email=?').bind(other.email).first(),
  ).toMatchObject({ state: 'failed' });
  await deliverAccessMail(bindings, send, Date.now() + 3600000);
  expect(
    await env.DB.prepare('SELECT state FROM access_mail WHERE email=?').bind(other.email).first(),
  ).toMatchObject({ state: 'queued' });
});

it('keeps newsletter consent and retries independent of signup confirmation mail', async () => {
  bindings.ACCESS_NEWSLETTER_FORM = 'fixtureform12345678901234';
  await register(bindings, 'no@example.com', false, 'inline');
  await register(bindings, 'yes@example.com', true, 'popup');
  let calls = 0;
  const send = (async (url, init) => {
    const request = new Request(url, init);
    expect(request.redirect).toBe('manual');
    calls++;
    expect(String(init?.body)).toContain('yes%40example.com');
    return Response.json({ success: true, optIn: { required: true } });
  }) as typeof fetch;
  await syncNewsletter(bindings, (async () => new Response(null, { status: 503 })) as typeof fetch);
  expect(
    await env.DB.prepare('SELECT newsletter_synced_at FROM access_members WHERE email=?')
      .bind('yes@example.com')
      .first(),
  ).toEqual({ newsletter_synced_at: null });
  await Promise.all([
    syncNewsletter(bindings, send, Date.now() + 3600000),
    syncNewsletter(bindings, send, Date.now() + 3600000),
  ]);
  expect(calls).toBe(1);
  expect(
    await env.DB.prepare('SELECT newsletter_synced_at FROM access_members WHERE email=?')
      .bind('yes@example.com')
      .first(),
  ).toEqual({ newsletter_synced_at: expect.any(Number) });
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM access_mail WHERE kind='waitlist'").first(),
  ).toEqual({ n: 2 });
  expect(
    await env.DB.prepare('SELECT newsletter_attempts FROM access_members WHERE email=?')
      .bind('no@example.com')
      .first(),
  ).toEqual({ newsletter_attempts: 0 });
  bindings.ACCESS_NEWSLETTER_FORM = '';
});

it('protects private approval and revocation routes and preserves accepted places after revocation', async () => {
  const person = await member('waiting@example.com');
  for (const path of ['/admin/access', '/admin/api/access', '/admin/access/email-preview']) {
    expect(
      (await worker.fetch(new Request(`https://api.jackalope.dev${path}`), bindings)).status,
    ).toBe(403);
  }
  const call = (body?: unknown, origin?: string) =>
    adminRoutes(
      new Request('https://api.jackalope.dev/admin/api/access', {
        method: body ? 'POST' : 'GET',
        headers: origin ? { origin } : {},
        body: body ? JSON.stringify(body) : undefined,
      }),
      bindings,
      (r) => r.json(),
    );
  expect((await call({ id: person.id, action: 'approve' })).status).toBe(403);
  expect(
    (
      await call(
        { id: person.id, action: 'approve', allowWithoutDownload: true },
        'https://api.jackalope.dev',
      )
    ).status,
  ).toBe(200);
  const session = await acceptToken(bindings, (await mail(person.email)).token);
  const current = required(
    await env.DB.prepare('SELECT * FROM access_members WHERE id=?').bind(person.id).first<Member>(),
  );
  await inviteEmails(bindings, current, ['accepted@example.com', 'reserved@example.com']);
  await acceptToken(bindings, (await mail('accepted@example.com')).token);
  await call({ id: person.id, action: 'revoke' }, 'https://api.jackalope.dev');
  expect((await request('me', undefined, session)).status).toBe(401);
  expect(
    (await request('accept', { token: (await mail('reserved@example.com')).token })).status,
  ).toBe(410);
  expect(
    await env.DB.prepare(
      "SELECT status FROM access_members WHERE email='accepted@example.com'",
    ).first(),
  ).toEqual({ status: 'approved' });
  await call({ id: person.id, action: 'restore' }, 'https://api.jackalope.dev');
  const restored = required(
    await env.DB.prepare('SELECT * FROM access_members WHERE id=?').bind(person.id).first<Member>(),
  );
  expect(restored.share_code).not.toBe(person.share_code);
  expect(restored.status).toBe('waiting');
  expect((await invitations(bindings, restored)).remaining).toBe(4);
});

it('honors the shared link owner over an unrelated email reservation', async () => {
  const a = (await admitted('a@example.com')).person;
  const b = (await admitted('b@example.com')).person;
  await inviteEmails(bindings, a, ['friend@example.com']);
  await requestLink(bindings, 'friend@example.com', b.share_code, Date.now() + 61000);
  await acceptToken(bindings, (await mail('friend@example.com')).token);
  expect((await invitations(bindings, a)).remaining).toBe(5);
  expect((await invitations(bindings, b)).remaining).toBe(4);
  expect(
    await env.DB.prepare(
      "SELECT invited_by FROM access_members WHERE email='friend@example.com'",
    ).first(),
  ).toEqual({ invited_by: b.id });
});

it('bounds provider replies and retries only a finite number of times', async () => {
  const person = await member('person@example.com');
  await approve(bindings, person.id);
  let calls = 0;
  const oversized = (async () => {
    calls++;
    return new Response('x'.repeat(32769));
  }) as typeof fetch;
  for (let i = 0; i < 7; i++)
    await deliverAccessMail(bindings, oversized, Date.now() + i * 3600000);
  expect(calls).toBe(5);
  expect(await env.DB.prepare('SELECT state,attempts FROM access_mail').first()).toEqual({
    state: 'failed',
    attempts: 5,
  });
});

it('reports delivery failure stages without recording private mail or provider bodies', async () => {
  const person = await member('person@example.com');
  await approve(bindings, person.id);
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await deliverAccessMail(
      bindings,
      (async () => new Response('private provider detail', { status: 403 })) as typeof fetch,
    );
    expect(log.mock.calls).toEqual([
      ['access_mail_delivery_failed', { stage: 'response', providerStatus: 403, attempt: 1 }],
    ]);
    log.mockClear();
    await env.DB.prepare("UPDATE access_mail SET payload='invalid',next_at=0").run();
    await deliverAccessMail(bindings);
    expect(log.mock.calls).toEqual([
      ['access_mail_delivery_failed', { stage: 'decrypt', providerStatus: null, attempt: 2 }],
    ]);
  } finally {
    log.mockRestore();
  }
});

it.each([200, 302])(
  'uses Worker-compatible mail requests and rejects redirects (%s)',
  async (status) => {
    const person = await member('person@example.com');
    await approve(bindings, person.id);
    let transportError: unknown;
    await deliverAccessMail(bindings, (async (input, init) => {
      try {
        const request = new Request(input, init);
        expect(request.method).toBe('POST');
        expect(request.redirect).toBe('manual');
        return Response.json({ success: true, jobId: 'fixture-transport' }, { status });
      } catch (error) {
        transportError = error;
        throw error;
      }
    }) as typeof fetch);
    expect(transportError).toBeUndefined();
    expect(await env.DB.prepare('SELECT state,provider_id FROM access_mail').first()).toEqual({
      state: status === 200 ? 'queued' : 'failed',
      provider_id: status === 200 ? 'fixture-transport' : null,
    });
  },
);
