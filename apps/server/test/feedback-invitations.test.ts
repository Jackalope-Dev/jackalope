import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomToken, tokenHash, unseal } from '../src/access/crypto';
import {
  feedbackMailAllowed,
  feedbackResponse,
  memberFeedback,
  pruneFeedbackInvitations,
  queueFeedbackMail,
} from '../src/access/feedback';
import { deliverAccessMail } from '../src/access/mail';
import { accessEmail, type FeedbackMail } from '../src/access/mail-templates';
import worker from '../src/index';

const day = 86400000;
const start = Date.now();
const bindings: Env = {
  ...env,
  EARLY_ACCESS_ENABLED: 'true',
  INGESTION_ENABLED: 'true',
  ACCESS_SECRET: 'fixture-secret-'.repeat(4),
  SEQUENZY_API_KEY: 'fixture-provider',
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
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
  for (const table of ['access_devices', 'access_mail', 'access_members', 'feedback'])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
});
async function member() {
  const id = crypto.randomUUID();
  const secret = randomToken();
  await env.DB.prepare(
    "INSERT INTO access_members(id,email,status,created_at,approved_at,verified_at,source,share_code) VALUES(?,?,'approved',?,?,?,'fixture',?)",
  )
    .bind(id, `${id}@example.invalid`, start, start, start, randomToken())
    .run();
  await env.DB.prepare(
    'INSERT INTO access_devices(id,hash,member_id,created_at,expires_at) VALUES(?,?,?,?,?)',
  )
    .bind(crypto.randomUUID(), await tokenHash(secret), id, start, start + 90 * day)
    .run();
  return { id, secret };
}
async function qualify(id: string) {
  await memberFeedback(
    bindings,
    id,
    { action: 'preferences', enabled: true, promptsEnabled: true },
    start,
  );
  await memberFeedback(bindings, id, { action: 'activity', result: 'a'.repeat(64) }, start);
  await memberFeedback(bindings, id, { action: 'activity', result: 'b'.repeat(64) }, start + day);
}
async function mail() {
  const row = await env.DB.prepare(
    "SELECT id,payload FROM access_mail WHERE kind='feedback_request'",
  ).first<{ id: string; payload: string }>();
  if (!row) throw Error('Missing feedback mail');
  return { id: row.id, ...(await unseal<FeedbackMail>(row.payload, bindings.ACCESS_SECRET)) };
}
it('does not infer use from approval, connection, anonymous telemetry, or repeated result opens', async () => {
  const owner = await member();
  await memberFeedback(bindings, owner.id, { action: 'activity', result: 'a'.repeat(64) }, start);
  expect(await env.DB.prepare('SELECT * FROM access_feedback').first()).toBeNull();
  await memberFeedback(
    bindings,
    owner.id,
    { action: 'preferences', enabled: true, promptsEnabled: true },
    start,
  );
  for (let i = 0; i < 4; i++)
    await memberFeedback(
      bindings,
      owner.id,
      { action: 'activity', result: 'a'.repeat(64) },
      start + i * day,
    );
  await queueFeedbackMail(bindings, start + 4 * day);
  expect(await env.DB.prepare('SELECT * FROM access_mail').first()).toBeNull();
  const progress = await env.DB.prepare('SELECT active_days,results FROM access_feedback').first<{
    active_days: number;
    results: string;
  }>();
  expect(progress?.active_days).toBe(2);
  expect(JSON.parse(progress?.results ?? '[]')).toEqual(['a'.repeat(64)]);
});
it('requires two days and two distinct results; waits three days and queues one encrypted email across concurrent schedulers', async () => {
  const owner = await member();
  await qualify(owner.id);
  await queueFeedbackMail(bindings, start + 2 * day);
  expect(await env.DB.prepare('SELECT * FROM access_mail').first()).toBeNull();
  await Promise.all([
    queueFeedbackMail(bindings, start + 3 * day),
    queueFeedbackMail(bindings, start + 3 * day),
  ]);
  expect(
    (await env.DB.prepare('SELECT count(*) AS n FROM access_mail').first<{ n: number }>())?.n,
  ).toBe(1);
  const queued = await mail();
  const content = accessEmail(queued, bindings.ACCESS_WEB_ORIGIN);
  expect(content.body).toContain(`/feedback/#token=${queued.token}`);
  expect(content.body).toContain(`/feedback/#unsubscribe=${queued.token}`);
  expect(content.text).toContain('What’s useful');
  const raw = await env.DB.prepare('SELECT token_hash FROM access_feedback').first<{
    token_hash: string;
  }>();
  expect(raw?.token_hash).not.toBe(queued.token);
});
it('shares cooldowns across devices, caps prompts, and honors a 14-day snooze', async () => {
  const owner = await member();
  await qualify(owner.id);
  const id = crypto.randomUUID();
  const responses = await Promise.all([
    memberFeedback(bindings, owner.id, { action: 'claim', id }, start + day),
    memberFeedback(bindings, owner.id, { action: 'claim', id: crypto.randomUUID() }, start + day),
  ]);
  expect(responses.filter((r) => r.claimed)).toHaveLength(1);
  const claimed = await env.DB.prepare('SELECT prompt_id FROM access_feedback').first<{
    prompt_id: string;
  }>();
  await memberFeedback(
    bindings,
    owner.id,
    { action: 'later', id: claimed?.prompt_id },
    start + day,
  );
  await queueFeedbackMail(bindings, start + 3 * day);
  expect(await env.DB.prepare('SELECT * FROM access_mail').first()).toBeNull();
  expect(
    (
      await memberFeedback(
        bindings,
        owner.id,
        { action: 'claim', id: crypto.randomUUID() },
        start + 14 * day,
      )
    ).claimed,
  ).toBe(false);
  expect(
    (
      await memberFeedback(
        bindings,
        owner.id,
        { action: 'claim', id: crypto.randomUUID() },
        start + 15 * day,
      )
    ).claimed,
  ).toBe(true);
  expect(
    (
      await memberFeedback(
        bindings,
        owner.id,
        { action: 'claim', id: crypto.randomUUID() },
        start + 30 * day,
      )
    ).claimed,
  ).toBe(false);
});
it('rechecks opt-outs, revocation, and provider suppression before sending; keeps newsletter/access choices separate', async () => {
  const owner = await member();
  await qualify(owner.id);
  await queueFeedbackMail(bindings, start + 3 * day);
  const queued = await mail();
  expect(await feedbackMailAllowed(bindings, queued.id, start + 3 * day)).toBe(true);
  const unavailable = { ...bindings, INGESTION_ENABLED: 'false' };
  expect(await feedbackMailAllowed(unavailable, queued.id, start + 3 * day)).toBe(false);
  expect(
    (await memberFeedback(unavailable, owner.id, { action: 'status' }, start + 20 * day)).eligible,
  ).toBe(false);
  expect(
    (
      await memberFeedback(
        unavailable,
        owner.id,
        { action: 'claim', id: crypto.randomUUID() },
        start + 20 * day,
      )
    ).claimed,
  ).toBe(false);
  await env.DB.prepare("UPDATE access_members SET status='revoked' WHERE id=?")
    .bind(owner.id)
    .run();
  expect(await feedbackMailAllowed(bindings, queued.id, start + 3 * day)).toBe(false);
  await env.DB.prepare("UPDATE access_members SET status='approved' WHERE id=?")
    .bind(owner.id)
    .run();
  await feedbackResponse(bindings, { action: 'unsubscribe', token: queued.token }, start + 3 * day);
  expect(await feedbackMailAllowed(bindings, queued.id, start + 3 * day)).toBe(false);
  expect(await env.DB.prepare('SELECT * FROM access_mail').first()).toBeNull();
  expect(
    await env.DB.prepare('SELECT status,newsletter FROM access_members').first(),
  ).toMatchObject({ status: 'approved', newsletter: 0 });
});
it('stops both channels after anonymous in-app feedback or a private email response, with idempotent writes', async () => {
  const owner = await member();
  await qualify(owner.id);
  await queueFeedbackMail(bindings, start + 3 * day);
  const queued = await mail();
  const body = {
    action: 'submit',
    token: queued.token,
    id: crypto.randomUUID(),
    message: '<script>keep this as text</script> A simpler review would help.',
  };
  await feedbackResponse(bindings, body, start + 3 * day);
  await feedbackResponse(bindings, body, start + 3 * day);
  const rows = await env.DB.prepare('SELECT payload FROM feedback').all<{ payload: string }>();
  expect(rows.results).toHaveLength(1);
  expect(JSON.parse(rows.results[0].payload)).toEqual({
    schemaVersion: 2,
    id: body.id,
    message: body.message,
    kind: 'idea',
    source: 'email',
  });
  expect(await feedbackMailAllowed(bindings, queued.id, start + 3 * day)).toBe(false);
  expect(
    (await memberFeedback(bindings, owner.id, { action: 'status' }, start + 30 * day)).eligible,
  ).toBe(false);
  const another = await member();
  await qualify(another.id);
  await memberFeedback(bindings, another.id, { action: 'completed' }, start + day);
  await queueFeedbackMail(bindings, start + 3 * day);
  expect(
    (
      await env.DB.prepare('SELECT email_id FROM access_feedback WHERE member_id=?')
        .bind(another.id)
        .first<{ email_id: string | null }>()
    )?.email_id,
  ).toBeNull();
});
it('requires native authentication for milestones and an exact browser origin plus scoped token for replies', async () => {
  const owner = await member();
  const call = (path: string, headers: Record<string, string>, body: unknown) =>
    worker.fetch(
      new Request(`https://api.jackalope.dev${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      bindings,
    );
  expect((await call('/v1/desktop/feedback', {}, { action: 'status' })).status).toBe(401);
  expect(
    (
      await call(
        '/v1/desktop/feedback',
        { authorization: `Bearer ${owner.secret}`, origin: bindings.ACCESS_WEB_ORIGIN },
        { action: 'status' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        '/v1/desktop/feedback',
        { authorization: `Bearer ${owner.secret}` },
        { action: 'activity', prompt: 'private contents' },
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        '/v1/access/feedback',
        { origin: 'https://evil.invalid' },
        { action: 'status', token: randomToken() },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        '/v1/access/feedback',
        { origin: bindings.ACCESS_WEB_ORIGIN },
        { action: 'status', token: randomToken() },
      )
    ).status,
  ).toBe(410);
});
it('uses the same provider idempotency key after an uncertain response, with marketing suppression and tracking disabled', async () => {
  const owner = await member();
  await qualify(owner.id);
  const headers: string[] = [];
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    headers.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
    const body = JSON.parse(String(init?.body));
    expect(body.emailType).toBe('marketing');
    expect(body.trackingSettings).toEqual({ openTracking: false, clickTracking: false });
    if (headers.length === 1) throw Error('Response lost after acceptance');
    return Response.json({ success: true, jobId: 'fixture-job', emailSendId: 'fixture-send' });
  });
  await deliverAccessMail(bindings, send, start + 3 * day);
  await deliverAccessMail(bindings, send, start + 3 * day + 600000);
  await deliverAccessMail(bindings, send, start + 4 * day);
  expect(headers).toHaveLength(2);
  expect(headers[0]).toBe(headers[1]);
  expect(headers[0]).toMatch(/^feedback:/);
});

it('carries local invitation limits and the full snooze into enrollment without uploading local usage', async () => {
  const owner = await member();
  const state = await memberFeedback(
    bindings,
    owner.id,
    {
      action: 'preferences',
      enabled: true,
      promptsEnabled: true,
      promptCount: 2,
      nextPromptAt: start + 14 * day,
    },
    start,
  );
  expect(state.promptCount).toBe(2);
  expect(state.nextPromptAt).toBe(start + 14 * day);
  const row = await env.DB.prepare('SELECT active_days,results FROM access_feedback').first();
  expect(row).toMatchObject({ active_days: 0, results: '[]' });
  await qualify(owner.id);
  await queueFeedbackMail(bindings, start + 3 * day);
  expect(await env.DB.prepare('SELECT * FROM access_mail').first()).toBeNull();
});

it('retains cross-device suppression without email enrollment and expires old activity and response tokens', async () => {
  const owner = await member();
  await memberFeedback(bindings, owner.id, { action: 'stop' }, start);
  expect(await memberFeedback(bindings, owner.id, { action: 'status' }, start + day)).toMatchObject(
    { linked: true, enabled: false, promptsEnabled: false, eligible: false },
  );
  const another = await member();
  await qualify(another.id);
  await queueFeedbackMail(bindings, start + 3 * day);
  const queued = await mail();
  await pruneFeedbackInvitations(bindings, start + 95 * day);
  await expect(
    feedbackResponse(bindings, { action: 'status', token: queued.token }, start + 95 * day),
  ).rejects.toMatchObject({ code: 'feedback_link_expired' });
  const row = await env.DB.prepare(
    'SELECT enabled,active_days,results,email_id,token_hash FROM access_feedback WHERE member_id=?',
  )
    .bind(another.id)
    .first();
  expect(row).toMatchObject({
    enabled: 0,
    active_days: 0,
    results: '[]',
    email_id: queued.id,
    token_hash: null,
  });
});
