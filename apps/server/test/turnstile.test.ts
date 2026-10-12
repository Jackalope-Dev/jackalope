import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { SIGNUP_ACTION, verifyTurnstile } from '../src/access/turnstile';

const configured = {
  ...env,
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
  TURNSTILE_SECRET: 'fixture-secret',
};
const reply = (body: unknown, status = 200) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch;
const valid = { success: true, action: SIGNUP_ACTION, hostname: 'jackalope.dev' };

it('leaves signup unchanged until a secret is configured', async () => {
  const unused = (async () => {
    throw new Error('Siteverify should not be called');
  }) as unknown as typeof fetch;
  await expect(
    verifyTurnstile({ ...env, TURNSTILE_SECRET: '' }, undefined, null, SIGNUP_ACTION, unused),
  ).resolves.toBeUndefined();
});

it('accepts a token Siteverify confirms for this action and website', async () => {
  let sent = '';
  const fetcher = (async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return Response.json(valid);
  }) as unknown as typeof fetch;
  await verifyTurnstile(configured, 'token', '203.0.113.9', SIGNUP_ACTION, fetcher);
  expect(new URLSearchParams(sent).get('remoteip')).toBe('203.0.113.9');
  expect(new URLSearchParams(sent).get('response')).toBe('token');
});

it('fails closed on missing tokens, bad replies and mismatched claims', async () => {
  const rejects = (token: string | undefined, fetcher: typeof fetch) =>
    expect(verifyTurnstile(configured, token, null, SIGNUP_ACTION, fetcher)).rejects.toMatchObject({
      status: 403,
      code: 'verification_failed',
    });
  await rejects(undefined, reply(valid));
  await rejects('x'.repeat(2049), reply(valid));
  await rejects('token', reply({ ...valid, success: false }));
  await rejects('token', reply({ ...valid, action: 'login' }));
  await rejects('token', reply({ ...valid, hostname: 'localhost' }));
  await rejects('token', reply(valid, 500));
  await rejects('token', (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch);
});
