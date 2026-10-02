import { z } from 'zod';
import { ServiceError as AccessError } from '../errors';

// Store package flights are managed by hand in Partner Center, so a request is
// a to-do for the operator rather than an automatic membership change.
export type BetaStatus = 'pending' | 'done' | 'declined' | 'withdrawn';
const fields =
  'id,kind,store_email AS storeEmail,status,app_version AS appVersion,created_at AS createdAt,resolved_at AS resolvedAt';

export async function latestBetaRequest(env: Env, memberId: string) {
  return (
    (await env.DB.prepare(
      `SELECT ${fields} FROM access_beta_requests WHERE member_id=? AND status!='withdrawn' ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    )
      .bind(memberId)
      .first()) ?? null
  );
}

const requestSchema = z.strictObject({
  kind: z.enum(['join', 'leave']),
  storeEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  appVersion: z
    .string()
    .max(64)
    .regex(/^[0-9A-Za-z.+-]+$/)
    .optional(),
});

/** Records a join or leave request, replacing any request still waiting. */
export async function requestBeta(env: Env, memberId: string, body: unknown, now = Date.now()) {
  const request = requestSchema.parse(body);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE access_beta_requests SET status='withdrawn',resolved_at=? WHERE member_id=? AND status='pending'",
    ).bind(now, memberId),
    env.DB.prepare(
      'INSERT INTO access_beta_requests(id,member_id,kind,store_email,app_version,created_at) VALUES(?,?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      memberId,
      request.kind,
      request.storeEmail,
      request.appVersion ?? null,
      now,
    ),
  ]);
  return { request: await latestBetaRequest(env, memberId) };
}

export async function withdrawBeta(env: Env, memberId: string, now = Date.now()) {
  const result = await env.DB.prepare(
    "UPDATE access_beta_requests SET status='withdrawn',resolved_at=? WHERE member_id=? AND status='pending'",
  )
    .bind(now, memberId)
    .run();
  if (result.meta.changes !== 1) throw new AccessError(409, 'no_pending_request');
  return { request: await latestBetaRequest(env, memberId) };
}

export async function adminBetaRequests(env: Env, status: string) {
  const rows = await env.DB.prepare(
    `SELECT r.id,r.kind,r.store_email AS storeEmail,r.status,r.app_version AS appVersion,r.created_at AS createdAt,r.resolved_at AS resolvedAt,m.email FROM access_beta_requests r JOIN access_members m ON m.id=r.member_id WHERE (?='all' OR r.status=?) ORDER BY r.created_at DESC,r.rowid DESC LIMIT 200`,
  )
    .bind(status, status)
    .all();
  return { requests: rows.results };
}

export async function resolveBetaRequest(
  env: Env,
  id: string,
  status: 'done' | 'declined',
  now = Date.now(),
) {
  const result = await env.DB.prepare(
    "UPDATE access_beta_requests SET status=?,resolved_at=? WHERE id=? AND status='pending'",
  )
    .bind(status, now, id)
    .run();
  return { updated: result.meta.changes === 1 };
}
