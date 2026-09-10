import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { accessReadiness } from '../src/access/admin';
import { savePreferences } from '../src/access/insights';
import { deliverAccessMail } from '../src/access/mail';
import { checkMailDelivery } from '../src/access/mail-status';
import { approve, memberInsert, register } from '../src/access/service';
import { adminRoutes } from '../src/admin';
import worker from '../src/index';

const bindings: Env = {
  ...env,
  EARLY_ACCESS_ENABLED: 'true',
  ACCESS_SECRET: 'fixture-only-'.repeat(4),
  SEQUENZY_API_KEY: 'fixture-provider',
  ACCESS_EMAIL_FROM: 'fixture@example.invalid',
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
  ACCESS_INSTALLER_KEY: '',
};
beforeAll(async () =>
  applyD1Migrations(
    env.DB,
    (env as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS,
  ),
);
beforeEach(async () => {
  bindings.ACCESS_STORE_URL = '';
  bindings.ACCESS_INSTALLER_KEY = '';
  for (const table of [
    'access_invites',
    'access_sessions',
    'access_tokens',
    'access_mail',
    'access_members',
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
});
async function person(email = 'waiting@example.invalid') {
  const id = crypto.randomUUID();
  await memberInsert(bindings, email, 'fixture', false, Date.now(), id).run();
  return id;
}
function call(
  path = '',
  body?: unknown,
  overrides = bindings,
  origin = 'https://api.jackalope.dev',
) {
  return adminRoutes(
    new Request(`https://api.jackalope.dev/admin/api/access${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { origin },
      body: body ? JSON.stringify(body) : undefined,
    }),
    overrides,
    (r) => r.json(),
  );
}
it('checks the actual private object, distinguishes missing configuration and never claims signature acceptance', async () => {
  expect(await accessReadiness(bindings)).toMatchObject({
    enabled: true,
    mailConfigured: true,
    download: 'unconfigured',
    version: null,
  });
  bindings.ACCESS_INSTALLER_KEY = 'early-access/v0.1.0/fixture.exe';
  expect((await accessReadiness(bindings)).download).toBe('missing');
  await env.RELEASES.put(bindings.ACCESS_INSTALLER_KEY, 'fixture only, not an installer');
  expect(await accessReadiness(bindings)).toMatchObject({
    download: 'available',
    version: 'v0.1.0',
  });
  expect(JSON.stringify(await accessReadiness(bindings))).not.toContain('fixture.exe');
  expect((await accessReadiness({ ...bindings, SEQUENZY_API_KEY: '' })).mailConfigured).toBe(false);
  await env.RELEASES.delete(bindings.ACCESS_INSTALLER_KEY);
});
it('recognizes a configured Store listing and approves without a private installer override', async () => {
  bindings.ACCESS_STORE_URL = 'https://apps.microsoft.com/detail/9NBLGGH4R315';
  expect(await accessReadiness(bindings)).toMatchObject({
    distribution: 'store',
    download: 'available',
    version: null,
  });
  const id = await person();
  expect((await call('', { id, action: 'approve' })).status).toBe(200);
});
it('segments onboarding by self-reported platform and observed milestones, preserving unknown preferences', async () => {
  const token = await register(bindings, 'mac@example.invalid', false, 'inline');
  await savePreferences(bindings, token, {
    platforms: ['macos'],
    agents: ['codex'],
    priorities: ['review'],
  });
  await person('unknown@example.invalid');
  const mac = await env.DB.prepare('SELECT id FROM access_members WHERE email=?')
    .bind('mac@example.invalid')
    .first<{ id: string }>();
  if (!mac) throw new Error('Missing member');
  await approve(bindings, mac.id);
  const response = await (await call('?status=all&platform=macos&stage=not-signed-in')).json<{
    members: { email: string }[];
  }>();
  expect(response.members.map((member) => member.email)).toEqual(['mac@example.invalid']);
  expect(await (await call('?status=all&platform=linux')).json()).toMatchObject({ members: [] });
  await env.DB.prepare('UPDATE access_members SET verified_at=1,first_desktop_at=2 WHERE id=?')
    .bind(mac.id)
    .run();
  expect(await (await call('?status=all&stage=not-connected')).json()).toMatchObject({
    members: [],
  });
  expect(await (await call('?status=all&stage=connected')).json()).toMatchObject({
    members: [{ email: 'mac@example.invalid' }],
  });
  const insights = await (await call('/insights')).json();
  expect(insights).toMatchObject({
    totals: { requested: 2, responded: 1, approved: 1, connected: 1 },
  });
  expect(JSON.stringify(insights)).not.toContain('@');
  expect(
    (
      await worker.fetch(
        new Request('https://api.jackalope.dev/admin/api/access/insights'),
        bindings,
      )
    ).status,
  ).toBe(403);
});
it('requires acknowledgement without a download, reports cooldown truthfully and rejects stale actions', async () => {
  const id = await person();
  expect((await call('', { id, action: 'approve' })).status).toBe(409);
  expect(
    await env.DB.prepare('SELECT status FROM access_members WHERE id=?').bind(id).first(),
  ).toEqual({ status: 'waiting' });
  const approval = await call('', { id, action: 'approve', allowWithoutDownload: true });
  expect(await approval.json()).toEqual({ success: true, mailQueued: true });
  expect((await call('', { id, action: 'approve', allowWithoutDownload: true })).status).toBe(409);
  expect(await (await call('', { id, action: 'resend' })).json()).toEqual({
    success: true,
    mailQueued: false,
  });
  expect((await call('', { id, action: 'restore' })).status).toBe(409);
  const disabled = {
    ...bindings,
    EARLY_ACCESS_ENABLED: 'false',
    ACCESS_SECRET: '',
    SEQUENZY_API_KEY: '',
  };
  expect((await call('', { id, action: 'revoke' }, disabled)).status).toBe(200);
  expect((await call('', { id, action: 'restore' }, disabled)).status).toBe(200);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM access_mail').first()).toEqual({ n: 1 });
});
it('supports everyone/search and stable bounded pagination with actual sign-in and connection facts', async () => {
  for (let i = 0; i < 52; i++) await person(`person${i}@example.invalid`);
  const first = await (await call('?status=all')).json<{
    members: { id: string; cursor: number }[];
    hasMore: boolean;
  }>();
  expect(first.members).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  const second = await (await call(`?status=all&before=${first.members.at(-1)?.cursor}`)).json<{
    members: { id: string }[];
    hasMore: boolean;
  }>();
  expect(second.members).toHaveLength(2);
  expect(second.hasMore).toBe(false);
  expect(new Set([...first.members, ...second.members].map((m) => m.id)).size).toBe(52);
  const result = await (await call('?status=all&query=PERSON51')).json<{
    members: { verified_at: null; devices: number }[];
  }>();
  expect(result.members).toHaveLength(1);
  expect(result.members[0]).toMatchObject({ verified_at: null, devices: 0 });
  for (const query of ['?status=bad', '?before=-1', '?before=1.2', `?query=${'a'.repeat(255)}`])
    expect((await call(query)).status).toBe(400);
});
it('returns bounded email history and no credentials, login URLs or provider bodies', async () => {
  const id = await person();
  await approve(bindings, id);
  for (let i = 0; i < 12; i++)
    await env.DB.prepare(
      "INSERT INTO access_mail(id,email,kind,payload,created_at,provider_id,provider_send_id) VALUES(?,'waiting@example.invalid','login','private-payload',?,'private-job','send_private')",
    )
      .bind(crypto.randomUUID(), Date.now() + i)
      .run();
  const response = await call(`/member?id=${id}`);
  const data = await response.json<{ mail: unknown[] }>();
  expect(data.mail).toHaveLength(10);
  const text = JSON.stringify(data);
  for (const secret of [
    'private-payload',
    'private-job',
    'send_private',
    'share_code',
    'access_tokens',
  ])
    expect(text).not.toContain(secret);
  expect((await call('/member?id=invalid')).status).toBe(400);
  for (const path of ['/readiness', `/member?id=${id}`, '/delivery'])
    expect(
      (
        await worker.fetch(
          new Request(`https://api.jackalope.dev/admin/api/access${path}`),
          bindings,
        )
      ).status,
    ).toBe(403);
  expect((await call('/delivery', { id }, bindings, 'https://other.example')).status).toBe(403);
});
it('records the durable email reference, disables tracking and exposes only checked delivery status', async () => {
  const id = await person();
  await approve(bindings, id);
  let sent: Record<string, unknown> = {};
  const send: typeof fetch = async (input, init) => {
    sent = await new Request(input, init).json();
    return Response.json({ success: true, jobId: 'legacy-job', emailSendId: 'send_fixture' });
  };
  await deliverAccessMail(bindings, send);
  expect(sent.trackingSettings).toEqual({ openTracking: false, clickTracking: false });
  const mail = await env.DB.prepare('SELECT id,provider_send_id,payload FROM access_mail').first<{
    id: string;
    provider_send_id: string;
    payload: string;
  }>();
  if (!mail) throw new Error('Missing email fixture');
  expect(mail).toMatchObject({ provider_send_id: 'send_fixture', payload: '' });
  let checks = 0;
  const lookup: typeof fetch = async (input, init) => {
    checks++;
    expect(String(input)).toBe('https://api.sequenzy.com/api/v1/email-sends/send_fixture');
    expect(init?.redirect).toBe('manual');
    return Response.json({
      success: true,
      emailSend: {
        id: 'send_fixture',
        status: 'delivered',
        emailBody: 'secret token',
        errorMessage: 'private recipient',
      },
      events: [],
    });
  };
  const now = Date.now();
  expect(await checkMailDelivery(bindings, mail.id, lookup, now)).toEqual({
    status: 'delivered',
    checkedAt: now,
  });
  await checkMailDelivery(bindings, mail.id, lookup, now + 1000);
  expect(checks).toBe(1);
  const failed: typeof fetch = async () => new Response('secret-provider-error', { status: 403 });
  await expect(checkMailDelivery(bindings, mail.id, failed, now + 31000)).rejects.toMatchObject({
    code: 'delivery_check_failed',
  });
  expect(
    await env.DB.prepare('SELECT delivery_status,delivery_checked_at FROM access_mail').first(),
  ).toEqual({ delivery_status: 'delivered', delivery_checked_at: now });
  const mismatch: typeof fetch = async () =>
    Response.json({ success: true, emailSend: { id: 'different', status: 'delivered' } });
  await expect(checkMailDelivery(bindings, mail.id, mismatch, now + 31000)).rejects.toMatchObject({
    code: 'delivery_check_failed',
  });
});
