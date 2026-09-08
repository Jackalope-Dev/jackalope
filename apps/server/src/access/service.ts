import { z } from 'zod';
import { ServiceError as AccessError } from '../errors';
import { randomToken, tokenHash } from './crypto';
import { mailStatements, waitlistMailStatement } from './mail';

export { ServiceError as AccessError } from '../errors';
export const emailSchema = z.string().trim().toLowerCase().max(254).email();
export const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export interface Member {
  id: string;
  email: string;
  status: 'waiting' | 'approved' | 'revoked';
  share_code: string;
  invite_limit: number;
  verified_at: number | null;
}
const day = 86400000;
export function memberInsert(
  env: Env,
  email: string,
  source: string,
  newsletter = false,
  now = Date.now(),
  id = crypto.randomUUID(),
) {
  return env.DB.prepare(
    'INSERT INTO access_members(id,email,created_at,source,share_code,newsletter) VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET newsletter=max(newsletter,excluded.newsletter)',
  ).bind(id, email, now, source, randomToken(), Number(newsletter));
}
export async function register(env: Env, email: string, newsletter: boolean, source: string) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    memberInsert(env, email, source, newsletter, now, id),
    await waitlistMailStatement(env, email, id, now),
  ]);
}
const cooldown =
  "NOT EXISTS(SELECT 1 FROM access_mail WHERE email=? AND kind!='waitlist' AND created_at>?) AND (SELECT count(*) FROM access_mail WHERE email=? AND kind!='waitlist' AND created_at>?)<10";
export async function requestLink(env: Env, email: string, shareCode?: string, now = Date.now()) {
  const member = await env.DB.prepare('SELECT * FROM access_members WHERE email=?')
    .bind(email)
    .first<Member>();
  if (member?.status === 'revoked') return;
  const owner =
    shareCode &&
    (await env.DB.prepare("SELECT id FROM access_members WHERE share_code=? AND status='approved'")
      .bind(shareCode)
      .first<{ id: string }>());
  if (shareCode && !owner && member?.status !== 'approved') return;
  const invite = await env.DB.prepare(
    "SELECT i.id FROM access_invites i JOIN access_members m ON m.id=i.owner_id WHERE i.email=? AND i.status='pending' AND i.expires_at>? AND m.status='approved' AND (? IS NULL OR i.owner_id=?) ORDER BY i.created_at DESC LIMIT 1",
  )
    .bind(email, now, owner ? owner.id : null, owner ? owner.id : null)
    .first<{ id: string }>();
  if (member?.status !== 'approved' && !invite && !owner) return;
  const results = await env.DB.batch([
    memberInsert(env, email, 'invitation', false, now),
    ...(await mailStatements(
      env,
      { to: email, kind: member?.status === 'approved' ? 'login' : 'invite' },
      {
        inviteId: invite?.id,
        shareCode: owner ? shareCode : undefined,
        guard: cooldown,
        guardValues: [email, now - 60000, email, now - day],
        now,
      },
    )),
  ]);
  return results.at(-1)?.meta.changes === 1;
}
export async function approve(env: Env, id: string, now = Date.now()) {
  const member = await env.DB.prepare('SELECT * FROM access_members WHERE id=?')
    .bind(id)
    .first<Member>();
  if (!member) throw new AccessError(404, 'member_not_found');
  if (member.status !== 'waiting') return;
  const guard = "EXISTS(SELECT 1 FROM access_members WHERE id=? AND status='waiting')";
  const results = await env.DB.batch([
    ...(await mailStatements(
      env,
      { to: member.email, kind: 'welcome' },
      { guard, guardValues: [id], now },
    )),
    env.DB.prepare(
      "UPDATE access_members SET status='approved',approved_at=? WHERE id=? AND status='waiting'",
    ).bind(now, id),
    env.DB.prepare(
      "UPDATE access_invites SET status='revoked' WHERE email=? AND status='pending'",
    ).bind(member.email),
  ]);
  return results[1].meta.changes === 1;
}
export async function sessionMember(request: Request, env: Env, now = Date.now()) {
  const cookie = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)__Host-jackalope=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!cookie) return null;
  return env.DB.prepare(
    "SELECT m.* FROM access_members m JOIN access_sessions s ON s.member_id=m.id WHERE s.hash=? AND s.expires_at>? AND m.status='approved' AND m.verified_at IS NOT NULL",
  )
    .bind(await tokenHash(cookie), now)
    .first<Member>();
}
export function sessionCookie(token: string, clear = false) {
  return `__Host-jackalope=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : 30 * 86400}`;
}
export async function logout(request: Request, env: Env) {
  const raw = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)__Host-jackalope=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (raw)
    await env.DB.prepare('DELETE FROM access_sessions WHERE hash=?')
      .bind(await tokenHash(raw))
      .run();
}
export async function acceptToken(env: Env, raw: string, now = Date.now()) {
  const hash = await tokenHash(raw);
  const token = await env.DB.prepare(
    'SELECT email,invite_id,share_code FROM access_tokens WHERE hash=? AND used_at IS NULL AND expires_at>?',
  )
    .bind(hash, now)
    .first<{ email: string; invite_id: string | null; share_code: string | null }>();
  if (!token) throw new AccessError(410, 'link_expired');
  const member = await env.DB.prepare('SELECT * FROM access_members WHERE email=?')
    .bind(token.email)
    .first<Member>();
  if (!member || member.status === 'revoked') throw new AccessError(410, 'link_expired');
  const active =
    'EXISTS(SELECT 1 FROM access_tokens WHERE hash=? AND used_at IS NULL AND expires_at>?)';
  const waiting = "EXISTS(SELECT 1 FROM access_members WHERE email=? AND status='waiting')";
  const statements: D1PreparedStatement[] = [];
  if (member.status === 'waiting') {
    const acceptedId = token.invite_id ?? crypto.randomUUID();
    if (token.invite_id) {
      statements.push(
        env.DB.prepare(
          `UPDATE access_invites SET status='accepted',accepted_at=? WHERE id=? AND email=? AND status='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM access_members WHERE id=owner_id AND status='approved') AND ${active} AND ${waiting}`,
        ).bind(now, token.invite_id, token.email, now, hash, now, token.email),
      );
    } else if (token.share_code) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO access_invites(id,owner_id,email,status,created_at,expires_at,accepted_at,last_sent) SELECT ?,id,?,'accepted',?,?,?,? FROM access_members WHERE share_code=? AND status='approved' AND ${active} AND ${waiting} AND NOT EXISTS(SELECT 1 FROM access_invites WHERE email=? AND status='accepted')`,
        ).bind(
          acceptedId,
          token.email,
          now,
          now + 7 * day,
          now,
          now,
          token.share_code,
          hash,
          now,
          token.email,
          token.email,
        ),
      );
    } else throw new AccessError(410, 'link_expired');
    statements.push(
      env.DB.prepare(
        `UPDATE access_members SET status='approved',approved_at=?,invited_by=(SELECT owner_id FROM access_invites WHERE email=? AND status='accepted') WHERE email=? AND status='waiting' AND EXISTS(SELECT 1 FROM access_invites WHERE email=? AND id=? AND status='accepted' AND accepted_at=?) AND ${active}`,
      ).bind(now, token.email, token.email, token.email, acceptedId, now, hash, now),
    );
  }
  const session = randomToken();
  const sessionHash = await tokenHash(session);
  statements.push(
    env.DB.prepare(
      `UPDATE access_members SET verified_at=coalesce(verified_at,?) WHERE email=? AND status='approved' AND ${active}`,
    ).bind(now, token.email, hash, now),
    env.DB.prepare(
      `UPDATE access_invites SET status='revoked' WHERE email=? AND status='pending' AND EXISTS(SELECT 1 FROM access_members WHERE email=? AND status='approved') AND ${active}`,
    ).bind(token.email, token.email, hash, now),
    env.DB.prepare(
      `INSERT INTO access_sessions(hash,member_id,expires_at) SELECT ?,id,? FROM access_members WHERE email=? AND status='approved' AND verified_at IS NOT NULL AND ${active}`,
    ).bind(sessionHash, now + 30 * day, token.email, hash, now),
    env.DB.prepare(
      'UPDATE access_tokens SET used_at=? WHERE hash=? AND EXISTS(SELECT 1 FROM access_sessions WHERE hash=?)',
    ).bind(now, hash, sessionHash),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes('invite_capacity')) throw new AccessError(409, 'invitation_full');
    if (String(error).includes('invite_rate')) throw new AccessError(429, 'rate_limited');
    throw error;
  }
  if (
    !(await env.DB.prepare('SELECT hash FROM access_sessions WHERE hash=?')
      .bind(sessionHash)
      .first())
  )
    throw new AccessError(410, 'link_expired');
  return session;
}
export async function invitations(env: Env, member: Member, now = Date.now()) {
  const rows = await env.DB.prepare(
    "SELECT i.id,i.email,i.status,i.created_at,i.expires_at,i.accepted_at,i.last_sent,(SELECT invited.first_download_at FROM access_members invited WHERE invited.email=i.email AND invited.invited_by=i.owner_id) AS downloaded_at,(SELECT invited.first_desktop_at FROM access_members invited WHERE invited.email=i.email AND invited.invited_by=i.owner_id) AS connected_at FROM access_invites i WHERE i.owner_id=? AND (i.status='accepted' OR (i.status='pending' AND i.expires_at>?)) ORDER BY i.created_at DESC LIMIT 100",
  )
    .bind(member.id, now)
    .all<{
      id: string;
      email: string;
      status: string;
      expires_at: number;
      accepted_at: number | null;
      downloaded_at: number | null;
      connected_at: number | null;
      last_sent: number;
    }>();
  const used = rows.results.filter((i) => i.status === 'accepted' || i.expires_at > now).length;
  const accepted = rows.results.filter((i) => i.status === 'accepted').length;
  const downloaded = rows.results.filter((i) => i.downloaded_at !== null).length;
  const connected = rows.results.filter((i) => i.connected_at !== null).length;
  return {
    limit: member.invite_limit,
    remaining: Math.max(0, member.invite_limit - used),
    accepted,
    downloaded,
    connected,
    shareUrl: `${env.ACCESS_WEB_ORIGIN}/access/?invite=${member.share_code}`,
    invites: rows.results.map((i) => ({
      ...i,
      status: i.status === 'pending' && i.expires_at <= now ? 'expired' : i.status,
    })),
  };
}
export async function inviteEmails(env: Env, member: Member, emails: string[], now = Date.now()) {
  const statements = [
    env.DB.prepare(
      "UPDATE access_invites SET status='revoked' WHERE owner_id=? AND status='pending' AND expires_at<=?",
    ).bind(member.id, now),
  ];
  for (const email of [...new Set(emails)].filter((email) => email !== member.email)) {
    const id = crypto.randomUUID();
    statements.push(
      memberInsert(env, email, 'invitation', false, now),
      env.DB.prepare(
        "INSERT INTO access_invites(id,owner_id,email,status,created_at,expires_at,last_sent) SELECT ?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM access_members WHERE id=? AND status='approved') AND NOT EXISTS(SELECT 1 FROM access_members WHERE email=? AND status IN ('approved','revoked')) AND NOT EXISTS(SELECT 1 FROM access_invites WHERE owner_id=? AND email=? AND status='pending')",
      ).bind(id, member.id, email, now, now + 7 * day, now, member.id, email, member.id, email),
      ...(await mailStatements(
        env,
        { to: email, kind: 'invite' },
        {
          inviteId: id,
          guard: 'EXISTS(SELECT 1 FROM access_invites WHERE id=?)',
          guardValues: [id],
          now,
        },
      )),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes('invite_capacity')) throw new AccessError(409, 'invitation_full');
    if (String(error).includes('invite_rate')) throw new AccessError(429, 'rate_limited');
    throw error;
  }
}
export async function changeInvite(
  env: Env,
  member: Member,
  id: string,
  action: 'revoke' | 'resend',
  now = Date.now(),
) {
  if (action === 'revoke') {
    await env.DB.prepare(
      "UPDATE access_invites SET status='revoked' WHERE id=? AND owner_id=? AND status='pending'",
    )
      .bind(id, member.id)
      .run();
    return;
  }
  const invite = await env.DB.prepare(
    "SELECT email FROM access_invites WHERE id=? AND owner_id=? AND status='pending' AND expires_at>? AND last_sent<=?",
  )
    .bind(id, member.id, now, now - 60000)
    .first<{ email: string }>();
  if (!invite) throw new AccessError(409, 'invitation_not_resendable');
  const guard =
    "EXISTS(SELECT 1 FROM access_invites WHERE id=? AND owner_id=? AND status='pending' AND expires_at>? AND last_sent<=?)";
  await env.DB.batch([
    ...(await mailStatements(
      env,
      { to: invite.email, kind: 'invite' },
      { inviteId: id, guard, guardValues: [id, member.id, now, now - 60000], now },
    )),
    env.DB.prepare(`UPDATE access_invites SET last_sent=? WHERE id=? AND ${guard}`).bind(
      now,
      id,
      id,
      member.id,
      now,
      now - 60000,
    ),
  ]);
}
export async function pruneAccess(env: Env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM access_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM access_device_links WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM access_devices WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM access_tokens WHERE expires_at<=? OR used_at<?').bind(
      now,
      now - day,
    ),
    env.DB.prepare('DELETE FROM access_mail WHERE created_at<?').bind(now - 30 * day),
    env.DB.prepare("UPDATE access_mail SET payload='' WHERE created_at<?").bind(now - 7 * day),
  ]);
}
