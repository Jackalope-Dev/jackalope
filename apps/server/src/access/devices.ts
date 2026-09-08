import { z } from 'zod';
import { randomToken, tokenHash } from './crypto';
import { memberFeedback } from './feedback';
import { AccessError, invitations, type Member, tokenSchema } from './service';

const lifetime = 90 * 86400000;
export async function deviceMember(env: Env, hash: string, now = Date.now()) {
  return env.DB.prepare(
    "SELECT d.id,d.expires_at AS expiresAt,m.id AS memberId,m.email FROM access_devices d JOIN access_members m ON m.id=d.member_id WHERE d.hash=? AND d.expires_at>? AND m.status='approved' AND m.verified_at IS NOT NULL",
  )
    .bind(hash, now)
    .first<{ id: string; expiresAt: number; memberId: string; email: string }>();
}

function publicDevice(member: NonNullable<Awaited<ReturnType<typeof deviceMember>>>) {
  return { id: member.id, expiresAt: member.expiresAt, email: member.email };
}
export async function deviceRoutes(
  request: Request,
  env: Env,
  readJson: (request: Request) => Promise<unknown>,
  limit: (creating: boolean) => Promise<void>,
) {
  const json = (data: unknown, status = 200) =>
    Response.json(data, {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...(status === 429 ? { 'retry-after': '5' } : {}),
      },
    });
  try {
    if (env.EARLY_ACCESS_ENABLED !== 'true') throw new AccessError(503, 'access_not_available');
    if (request.headers.has('origin')) throw new AccessError(403, 'browser_origin_not_allowed');
    const url = new URL(request.url);
    if (url.search) throw new AccessError(400, 'query_not_allowed');
    const start = request.method === 'POST' && url.pathname === '/v1/desktop/start';
    await limit(start);
    const now = Date.now();
    if (start) {
      const { challenge } = z
        .strictObject({ challenge: tokenSchema })
        .parse(await readJson(request));
      const verification = randomToken();
      const userCode = randomToken().slice(0, 8).toUpperCase();
      const expiresAt = now + 10 * 60000;
      await env.DB.prepare(
        'INSERT INTO access_device_links(hash,verification_hash,user_code,created_at,expires_at) VALUES(?,?,?,?,?)',
      )
        .bind(challenge, await tokenHash(verification), userCode, now, expiresAt)
        .run();
      return json({ verification, userCode, expiresAt }, 201);
    }
    const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) throw new AccessError(401, 'device_sign_in_required');
    const hash = await tokenHash(token);
    if (request.method === 'POST' && url.pathname === '/v1/desktop/feedback') {
      const member = await deviceMember(env, hash, now);
      if (!member) throw new AccessError(401, 'device_sign_in_required');
      return json(await memberFeedback(env, member.memberId, await readJson(request), now));
    }
    if (request.method === 'DELETE' && url.pathname === '/v1/desktop/session') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM access_devices WHERE hash=?').bind(hash),
        env.DB.prepare('DELETE FROM access_device_links WHERE hash=?').bind(hash),
      ]);
      return json({ success: true });
    }
    if (request.method === 'GET' && url.pathname === '/v1/desktop/me') {
      const member = await deviceMember(env, hash, now);
      if (!member) throw new AccessError(401, 'device_sign_in_required');
      return json({ ...publicDevice(member), status: 'approved' });
    }
    if (request.method === 'GET' && url.pathname === '/v1/desktop/referrals') {
      const device = await deviceMember(env, hash, now);
      if (!device) throw new AccessError(401, 'device_sign_in_required');
      const member = await env.DB.prepare('SELECT * FROM access_members WHERE id=?')
        .bind(device.memberId)
        .first<Member>();
      if (!member) throw new AccessError(401, 'device_sign_in_required');
      return json(await invitations(env, member, now));
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/desktop/exchange')
      throw new AccessError(404, 'not_found');
    // The native client keeps this secret, so a lost exchange response can be retried safely.
    const existing = await deviceMember(env, hash, now);
    if (existing) return json({ ...publicDevice(existing), status: 'approved' });
    const link = await env.DB.prepare(
      'SELECT member_id,polled_at FROM access_device_links WHERE hash=? AND expires_at>? AND used_at IS NULL',
    )
      .bind(hash, now)
      .first<{ member_id: string | null; polled_at: number }>();
    if (!link) throw new AccessError(410, 'device_link_expired');
    if (link.polled_at > now - 5000) throw new AccessError(429, 'slow_down');
    const claimed = await env.DB.prepare(
      'UPDATE access_device_links SET polled_at=? WHERE hash=? AND polled_at<=? AND expires_at>? AND used_at IS NULL',
    )
      .bind(now, hash, now - 5000, now)
      .run();
    if (claimed.meta.changes !== 1) throw new AccessError(429, 'slow_down');
    if (!link.member_id) return json({ status: 'pending' }, 202);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO access_devices(id,hash,member_id,created_at,expires_at) SELECT ?,l.hash,l.member_id,?,? FROM access_device_links l JOIN access_members m ON m.id=l.member_id WHERE l.hash=? AND l.used_at IS NULL AND l.expires_at>? AND m.status='approved' AND m.verified_at IS NOT NULL ON CONFLICT(hash) DO NOTHING",
      ).bind(crypto.randomUUID(), now, now + lifetime, hash, now),
      env.DB.prepare(
        'UPDATE access_device_links SET used_at=? WHERE hash=? AND EXISTS(SELECT 1 FROM access_devices WHERE hash=?)',
      ).bind(now, hash, hash),
      env.DB.prepare(
        'UPDATE access_members SET first_desktop_at=coalesce(first_desktop_at,?) WHERE id=(SELECT member_id FROM access_devices WHERE hash=?)',
      ).bind(now, hash),
    ]);
    const connected = await deviceMember(env, hash, now);
    if (!connected) throw new AccessError(410, 'device_link_expired');
    return json({ ...publicDevice(connected), status: 'approved' });
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    if (error instanceof Error && error.message.includes('device_capacity'))
      return json({ error: 'device_limit' }, 409);
    return json({ error: 'access_unavailable' }, 503);
  }
}

export async function browserDeviceAction(env: Env, member: Member, action: string, body: unknown) {
  const now = Date.now();
  if (action === 'revoke') {
    const { id } = z.strictObject({ id: z.uuid() }).parse(body);
    await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM access_device_links WHERE hash IN (SELECT hash FROM access_devices WHERE id=? AND member_id=?)',
      ).bind(id, member.id),
      env.DB.prepare('DELETE FROM access_devices WHERE id=? AND member_id=?').bind(id, member.id),
    ]);
    return { success: true };
  }
  const { verification } = z.strictObject({ verification: tokenSchema }).parse(body);
  const hash = await tokenHash(verification);
  if (action === 'preview') {
    const link = await env.DB.prepare(
      'SELECT user_code AS userCode,expires_at AS expiresAt FROM access_device_links WHERE verification_hash=? AND expires_at>? AND member_id IS NULL AND used_at IS NULL',
    )
      .bind(hash, now)
      .first();
    if (!link) throw new AccessError(410, 'device_link_expired');
    return link;
  }
  if (action !== 'approve' && action !== 'deny') throw new AccessError(404, 'not_found');
  const result =
    action === 'deny'
      ? await env.DB.prepare(
          'DELETE FROM access_device_links WHERE verification_hash=? AND member_id IS NULL',
        )
          .bind(hash)
          .run()
      : await env.DB.prepare(
          "UPDATE access_device_links SET member_id=? WHERE verification_hash=? AND expires_at>? AND member_id IS NULL AND used_at IS NULL AND EXISTS(SELECT 1 FROM access_members WHERE id=? AND status='approved' AND verified_at IS NOT NULL)",
        )
          .bind(member.id, hash, now, member.id)
          .run();
  if (result.meta.changes !== 1) throw new AccessError(410, 'device_link_expired');
  return { success: true };
}
