import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { signRequest } from '@lopebase/adapter';
import { conformanceChecks } from '@lopebase/adapter/conformance';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { type LopeBaseEnv, lopebase } from '../src/lopebase';

const secret = 'lbs_fixture_signing_secret_not_a_credential';
const bindings: LopeBaseEnv = { ...env, LOPEBASE_SIGNING_SECRET: secret };
const adapter = lopebase(bindings);
if (!adapter) throw new Error('adapter_not_configured');
const day = 86400000;

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS,
  );
  for (const name of ['access_beta_requests', 'access_devices', 'access_members'])
    await env.DB.prepare(`DELETE FROM ${name}`).run();
  const now = Date.now();
  const members = [
    ['approved', now - 2 * day],
    ['approved', now - 40 * day],
    ['waiting', now - day],
  ] as const;
  for (const [index, [status, created]] of members.entries())
    await env.DB.prepare(
      "INSERT INTO access_members(id,email,status,created_at,source,share_code) VALUES(?,?,?,?,'fixture',?)",
    )
      .bind(
        `00000000-0000-4000-8000-00000000000${index}`,
        `person${index}@example.invalid`,
        status,
        created,
        `share-${index}`,
      )
      .run();
  await env.DB.prepare(
    "INSERT INTO access_devices(id,hash,member_id,created_at,expires_at,name,platform,last_seen_at) VALUES(?,?,?,?,?,'Personal laptop','windows',?)",
  )
    .bind(
      '10000000-0000-4000-8000-000000000000',
      'device-hash',
      '00000000-0000-4000-8000-000000000000',
      now - day,
      now + day,
      now - day,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO access_beta_requests(id,member_id,kind,store_email,created_at) VALUES(?,?,'join','store@example.invalid',?)",
  )
    .bind(crypto.randomUUID(), '00000000-0000-4000-8000-000000000000', now)
    .run();
});

async function signed(path: string) {
  return worker.fetch(
    new Request(`https://api.jackalope.dev${path}`, {
      headers: {
        'lopebase-signature': await signRequest({ secret, method: 'GET', pathAndQuery: path }),
      },
    }),
    bindings,
  );
}

describe('LopeBase conformance', () => {
  for (const check of conformanceChecks({
    adapter: { ...adapter, handle: (request) => worker.fetch(request, bindings) },
    secret,
    sampleResource: 'users',
  }))
    it(check.name, check.run);
});

describe('LopeBase adapter', () => {
  it('is absent until a signing secret is configured', async () => {
    const response = await worker.fetch(
      new Request('https://api.jackalope.dev/api/lopebase/health'),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('counts the dashboard stats in D1', async () => {
    const response = await signed('/api/lopebase/overview');
    expect(response.status).toBe(200);
    const body = await response.json<{
      stats: Record<string, number>;
      attentionItems: unknown[];
    }>();
    expect(body.stats).toEqual({
      users: 2,
      signups_7d: 2,
      active_users_28d: 1,
      waitlist: 1,
      beta_requests_pending: 1,
    });
    expect(body.attentionItems).toHaveLength(1);
  });

  it('pages rows without sending emails, device names or tokens', async () => {
    const first = await signed('/api/lopebase/resources/users?limit=2');
    const page = await first.json<{ rows: { id: string }[]; nextCursor?: string }>();
    expect(page.rows.map((row) => row.id)).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(page.nextCursor).toBeTruthy();
    const second = await signed(
      `/api/lopebase/resources/users?limit=2&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
    );
    const rest = await second.json<{ rows: { id: string }[]; nextCursor?: string }>();
    expect(rest.rows.map((row) => row.id)).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(rest.nextCursor).toBeUndefined();

    const devices = await (await signed('/api/lopebase/resources/devices')).text();
    const all = JSON.stringify(page) + JSON.stringify(rest) + devices;
    for (const hidden of ['@example.invalid', 'share-', 'Personal laptop', 'device-hash'])
      expect(all).not.toContain(hidden);
  });

  it('refuses unsigned reads', async () => {
    const response = await worker.fetch(
      new Request('https://api.jackalope.dev/api/lopebase/resources/users'),
      bindings,
    );
    expect(response.status).toBe(401);
  });
});
