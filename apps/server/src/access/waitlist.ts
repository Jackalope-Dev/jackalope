import { ServiceError } from '../errors';
import { randomToken, seal, tokenHash } from './crypto';
import type { WaitlistMail } from './mail';

const day = 86400000;
export const waitlistRankSql = `SELECT m.id,m.waitlist_joined_at AS created_at,m.referral_count,
 row_number() OVER (ORDER BY m.waitlist_joined_at-m.referral_count*86400000,m.waitlist_joined_at,m.id) AS position
 FROM access_members m WHERE m.status='waiting' AND m.waitlist_joined_at IS NOT NULL`;

export async function waitlistMailStatements(
  env: Env,
  email: string,
  memberId: string,
  now = Date.now(),
  fresh = false,
) {
  const token = randomToken();
  const hash = await tokenHash(token);
  const payload = await seal(
    { to: email, kind: 'waitlist', token } satisfies WaitlistMail,
    env.ACCESS_SECRET,
  );
  const guard = `EXISTS(SELECT 1 FROM access_members WHERE id=? AND email=? AND status!='revoked')
    AND NOT EXISTS(SELECT 1 FROM access_mail WHERE email=? AND kind='waitlist' AND created_at>?)
    AND (SELECT count(*) FROM access_mail WHERE email=? AND kind='waitlist' AND created_at>?)<10`;
  const values = [memberId, email, email, now - 60000, email, now - day];
  return [
    env.DB.prepare(
      `INSERT INTO access_waitlist_tokens(hash,member_id,created_at,expires_at) SELECT ?,?,?,? WHERE ${guard}`,
    ).bind(hash, memberId, now, now + (fresh ? 7 * day : 1800000), ...values),
    env.DB.prepare(
      `INSERT INTO access_mail(id,email,kind,payload,created_at) SELECT ?,?,'waitlist',?,? WHERE ${guard}`,
    ).bind(crypto.randomUUID(), email, payload, now, ...values),
  ];
}

export async function requestWaitlistLink(env: Env, email: string, now = Date.now()) {
  const member = await env.DB.prepare(
    "SELECT id FROM access_members WHERE email=? AND status!='revoked' AND (waitlist_joined_at IS NOT NULL OR status='approved')",
  )
    .bind(email)
    .first<{ id: string }>();
  if (member) await env.DB.batch(await waitlistMailStatements(env, email, member.id, now));
}

export async function acceptWaitlistToken(env: Env, raw: string, now = Date.now()) {
  const hash = await tokenHash(raw);
  const session = randomToken();
  const sessionHash = await tokenHash(session);
  const active = `SELECT member_id FROM access_waitlist_tokens WHERE hash=? AND used_at IS NULL AND expires_at>?`;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE access_members SET waitlist_verified_at=coalesce(waitlist_verified_at,?) WHERE id IN (${active}) AND status!='revoked'`,
    ).bind(now, hash, now),
    env.DB.prepare(
      `INSERT INTO access_waitlist_sessions(hash,member_id,expires_at) SELECT ?,id,? FROM access_members WHERE id IN (${active}) AND status!='revoked'`,
    ).bind(sessionHash, now + 30 * day, hash, now),
    env.DB.prepare(
      'UPDATE access_waitlist_tokens SET used_at=? WHERE hash=? AND EXISTS(SELECT 1 FROM access_waitlist_sessions WHERE hash=?)',
    ).bind(now, hash, sessionHash),
  ]);
  if (
    !(await env.DB.prepare('SELECT hash FROM access_waitlist_sessions WHERE hash=?')
      .bind(sessionHash)
      .first())
  )
    throw new ServiceError(410, 'link_expired');
  return session;
}

export function waitlistCookie(token: string, clear = false) {
  return `__Host-jackalope-waitlist=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : 30 * 86400}`;
}
function sessionToken(request: Request) {
  return request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)__Host-jackalope-waitlist=([a-f0-9]{64})(?:;|$)/)?.[1];
}
export async function waitlistLogout(request: Request, env: Env) {
  const raw = sessionToken(request);
  if (raw)
    await env.DB.prepare('DELETE FROM access_waitlist_sessions WHERE hash=?')
      .bind(await tokenHash(raw))
      .run();
}
export async function waitlistStatus(request: Request, env: Env, now = Date.now()) {
  const raw = sessionToken(request);
  if (!raw) throw new ServiceError(401, 'access_sign_in_required');
  const member = await env.DB.prepare(
    `SELECT m.id,m.email,m.status,m.share_code,m.referral_count,m.created_at FROM access_members m JOIN access_waitlist_sessions s ON s.member_id=m.id WHERE s.hash=? AND s.expires_at>? AND m.status!='revoked'`,
  )
    .bind(await tokenHash(raw), now)
    .first<{
      id: string;
      email: string;
      status: string;
      share_code: string;
      referral_count: number;
      created_at: number;
    }>();
  if (!member) throw new ServiceError(401, 'access_sign_in_required');
  const rank =
    member.status === 'waiting'
      ? await env.DB.prepare(`SELECT position FROM (${waitlistRankSql}) WHERE id=?`)
          .bind(member.id)
          .first<{ position: number }>()
      : null;
  const pending = await env.DB.prepare(
    "SELECT count(*) AS count FROM access_members WHERE waitlist_referrer_id=? AND waitlist_verified_at IS NULL AND status!='revoked'",
  )
    .bind(member.id)
    .first<{ count: number }>();
  return {
    email: member.email,
    status: member.status,
    position: rank?.position ?? null,
    referrals: member.referral_count,
    pending: pending?.count ?? 0,
    priorityDays: member.referral_count,
    shareUrl: `${env.ACCESS_WEB_ORIGIN}/?ref=${member.share_code}`,
  };
}
