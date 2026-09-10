import {applyD1Migrations} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import {beforeAll, expect, it, vi} from 'vitest';
import {unseal} from '../src/access/crypto';
import type {WaitlistMail} from '../src/access/mail';
import {syncNewsletter} from '../src/access/newsletter';
import {register} from '../src/access/service';
import {acceptWaitlistToken} from '../src/access/waitlist';

const bindings: Env = {...env, EARLY_ACCESS_ENABLED: 'true', ACCESS_SECRET: 'synthetic-consent-secret-'.repeat(3), SEQUENZY_API_KEY: 'synthetic-key', ACCESS_AUDIENCE_LIST: 'synthetic-list'};
beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as Env & {TEST_MIGRATIONS: {name: string; queries: string[]}[]}).TEST_MIGRATIONS);
});
async function latest(email: string) {
  const row = await env.DB.prepare("SELECT payload FROM access_mail WHERE email=? AND kind='waitlist' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(email).first<{payload: string}>();
  if (!row) throw new Error('Missing confirmation fixture');
  const mail = await unseal<WaitlistMail>(row.payload, bindings.ACCESS_SECRET);
  if (!mail.token) throw new Error('Missing token fixture');
  return mail.token;
}
it('binds new consent to its confirmation link and never borrows prior email verification', async () => {
  const email = 'consent@example.invalid';
  await register(bindings, email, false, 'inline');
  const original = await latest(email);
  await env.DB.prepare('UPDATE access_members SET waitlist_verified_at=? WHERE email=?').bind(Date.now(), email).run();
  await env.DB.prepare('UPDATE access_mail SET created_at=created_at-61000 WHERE email=?').bind(email).run();
  await register(bindings, email, true, 'inline');
  const confirmation = await latest(email);
  expect(confirmation).not.toBe(original);
  await acceptWaitlistToken(bindings, original);
  expect(await env.DB.prepare('SELECT newsletter,newsletter_confirmed_at FROM access_members WHERE email=?').bind(email).first()).toEqual({newsletter: 0, newsletter_confirmed_at: null});
  const send = vi.fn();
  await syncNewsletter(bindings, send);
  expect(send).not.toHaveBeenCalled();
  await acceptWaitlistToken(bindings, confirmation);
  expect(await env.DB.prepare('SELECT newsletter,newsletter_confirmed_at FROM access_members WHERE email=?').bind(email).first()).toEqual({newsletter: 1, newsletter_confirmed_at: expect.any(Number)});
  await expect(acceptWaitlistToken(bindings, confirmation)).rejects.toThrow();
  await env.DB.prepare('DELETE FROM access_members WHERE email=?').bind(email).run();
});
it('does not confirm consent using expired tokens or revoked membership', async () => {
  for (const kind of ['expired', 'revoked']) {
    const email = `${kind}@example.invalid`;
    await register(bindings, email, true, 'inline');
    const token = await latest(email);
    if (kind === 'expired') await env.DB.prepare('UPDATE access_waitlist_tokens SET expires_at=0 WHERE member_id=(SELECT id FROM access_members WHERE email=?)').bind(email).run();
    else await env.DB.prepare("UPDATE access_members SET status='revoked' WHERE email=?").bind(email).run();
    await expect(acceptWaitlistToken(bindings, token)).rejects.toThrow();
    expect(await env.DB.prepare('SELECT newsletter_confirmed_at FROM access_members WHERE email=?').bind(email).first()).toEqual({newsletter_confirmed_at: null});
    await env.DB.prepare('DELETE FROM access_members WHERE email=?').bind(email).run();
  }
});
it('removes legacy unconfirmed audience membership without revoking account access', async () => {
  const email = 'legacy@example.invalid';
  await register(bindings, email, true, 'inline');
  await env.DB.prepare("UPDATE access_members SET status='approved',verified_at=?,sequenzy_state='{}' WHERE email=?").bind(Date.now(), email).run();
  const bodies: unknown[] = [];
  await syncNewsletter(bindings, (async (_url, init) => {
    expect(init?.method).toBe('PATCH');
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({success: true});
  }) as typeof fetch);
  expect(bodies).toEqual([{status: 'unsubscribed'}]);
  expect(await env.DB.prepare('SELECT status,newsletter_confirmed_at FROM access_members WHERE email=?').bind(email).first()).toEqual({status: 'approved', newsletter_confirmed_at: null});
});
