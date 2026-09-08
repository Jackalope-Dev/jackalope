import { z } from 'zod';
import { feedbackStatements } from '../storage';
import { randomToken, seal, tokenHash } from './crypto';
import { AccessError, tokenSchema } from './service';

const day = 86400000;
type Campaign = {
  member_id: string;
  enabled: number;
  prompts_enabled: number;
  first_active_at: number | null;
  last_active_day: string | null;
  active_days: number;
  results: string;
  next_prompt_at: number;
  prompt_id: string | null;
  prompt_count: number;
  completed_at: number | null;
  email_id: string | null;
};
const eligibleSql = `completed_at IS NULL AND (enabled=0 OR (active_days=2 AND json_array_length(results)=2))`;
export const feedbackAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('status') }),
  z.strictObject({
    action: z.literal('preferences'),
    enabled: z.boolean(),
    promptsEnabled: z.boolean(),
    defer: z.boolean().default(false),
    promptCount: z.number().int().min(0).max(2).default(0),
    nextPromptAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  }),
  z.strictObject({ action: z.literal('activity'), result: tokenSchema.optional() }),
  z.strictObject({ action: z.literal('claim'), id: z.uuid() }),
  z.strictObject({ action: z.literal('later'), id: z.uuid() }),
  z.strictObject({ action: z.literal('stop') }),
  z.strictObject({ action: z.literal('completed') }),
]);
async function campaign(env: Env, member: string) {
  return env.DB.prepare('SELECT * FROM access_feedback WHERE member_id=?')
    .bind(member)
    .first<Campaign>();
}
function view(row: Campaign | null, now: number, claimed = false) {
  return {
    linked: !!row,
    enabled: row?.enabled === 1,
    promptsEnabled: row?.prompts_enabled !== 0,
    completed: row?.completed_at != null,
    nextPromptAt: row?.next_prompt_at ?? 0,
    promptCount: row?.prompt_count ?? 0,
    eligible:
      !row ||
      (row.prompts_enabled === 1 &&
        row.completed_at === null &&
        (row.enabled === 0 || (row.active_days === 2 && JSON.parse(row.results).length === 2)) &&
        row.next_prompt_at <= now &&
        row.prompt_count < 2),
    claimed,
  };
}
export async function memberFeedback(env: Env, member: string, input: unknown, now = Date.now()) {
  const action = feedbackAction.parse(input);
  if (action.action === 'stop' || action.action === 'completed') {
    await env.DB.prepare('INSERT OR IGNORE INTO access_feedback(member_id,updated_at) VALUES(?,?)')
      .bind(member, now)
      .run();
  }
  if (action.action === 'preferences') {
    await env.DB.prepare(`INSERT INTO access_feedback(member_id,enabled,prompts_enabled,consent_at,next_prompt_at,updated_at,prompt_count) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(member_id) DO UPDATE SET enabled=excluded.enabled,prompts_enabled=excluded.prompts_enabled,
      consent_at=CASE WHEN excluded.enabled=1 AND access_feedback.enabled=0 THEN excluded.consent_at ELSE access_feedback.consent_at END,
      next_prompt_at=max(access_feedback.next_prompt_at,excluded.next_prompt_at),prompt_count=max(access_feedback.prompt_count,excluded.prompt_count),updated_at=excluded.updated_at`)
      .bind(
        member,
        Number(action.enabled),
        Number(action.promptsEnabled),
        action.enabled ? now : null,
        Math.max(action.defer ? now + 7 * day : 0, Math.min(action.nextPromptAt, now + 14 * day)),
        now,
        action.promptCount,
      )
      .run();
  } else if (action.action === 'activity') {
    const today = new Date(now).toISOString().slice(0, 10);
    await env.DB.prepare(`UPDATE access_feedback SET first_active_at=coalesce(first_active_at,?),
      active_days=min(2,active_days+CASE WHEN last_active_day IS NULL OR last_active_day<? THEN 1 ELSE 0 END),
      last_active_day=?,results=CASE WHEN ? IS NOT NULL AND json_array_length(results)<2 AND NOT EXISTS(SELECT 1 FROM json_each(results) WHERE value=?) THEN json_insert(results,'$[#]',?) ELSE results END,updated_at=?
      WHERE member_id=? AND enabled=1 AND completed_at IS NULL`)
      .bind(
        now,
        today,
        today,
        action.result ?? null,
        action.result ?? null,
        action.result ?? null,
        now,
        member,
      )
      .run();
  } else if (action.action === 'claim') {
    const claimed =
      await env.DB.prepare(`UPDATE access_feedback SET prompt_id=?,prompt_count=prompt_count+1,next_prompt_at=?,updated_at=?
      WHERE member_id=? AND ${eligibleSql} AND prompts_enabled=1 AND prompt_count<2 AND next_prompt_at<=? RETURNING member_id`)
        .bind(action.id, now + 7 * day, now, member, now)
        .first();
    // Only the request that wins the claim displays a prompt; a lost response stays quiet.
    return view(await campaign(env, member), now, !!claimed);
  } else if (action.action === 'later') {
    await env.DB.prepare(
      'UPDATE access_feedback SET next_prompt_at=max(next_prompt_at,?),updated_at=? WHERE member_id=? AND prompt_id=?',
    )
      .bind(now + 14 * day, now, member, action.id)
      .run();
    await env.DB.prepare(
      "UPDATE access_mail SET next_at=max(next_at,?) WHERE state!='queued' AND id=(SELECT email_id FROM access_feedback WHERE member_id=? AND prompt_id=?)",
    )
      .bind(now + 14 * day, member, action.id)
      .run();
  } else if (action.action === 'stop' || action.action === 'completed') {
    await env.DB.prepare(
      `UPDATE access_feedback SET enabled=0,prompts_enabled=0,completed_at=CASE WHEN ?='completed' THEN coalesce(completed_at,?) ELSE completed_at END,updated_at=? WHERE member_id=?`,
    )
      .bind(action.action, now, now, member)
      .run();
  }
  if (
    action.action === 'stop' ||
    action.action === 'completed' ||
    (action.action === 'preferences' && !action.enabled)
  ) {
    await env.DB.prepare(
      "DELETE FROM access_mail WHERE kind='feedback_request' AND state!='queued' AND id=(SELECT email_id FROM access_feedback WHERE member_id=?)",
    )
      .bind(member)
      .run();
  }
  return view(await campaign(env, member), now);
}

export async function queueFeedbackMail(env: Env, now = Date.now()) {
  if (env.INGESTION_ENABLED !== 'true') return;
  const rows =
    await env.DB.prepare(`SELECT f.member_id,m.email FROM access_feedback f JOIN access_members m ON m.id=f.member_id
    WHERE f.enabled=1 AND f.completed_at IS NULL AND f.email_id IS NULL AND f.active_days=2 AND json_array_length(f.results)=2
    AND f.first_active_at<=? AND f.next_prompt_at<=? AND f.last_active_day>=? AND m.status='approved' AND m.verified_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM access_mail a WHERE a.email=m.email AND a.delivery_status IN ('bounced','complained','suppressed'))
    ORDER BY f.first_active_at LIMIT 20`)
      .bind(now - 3 * day, now, new Date(now - 7 * day).toISOString().slice(0, 10))
      .all<{ member_id: string; email: string }>();
  for (const row of rows.results) {
    const id = crypto.randomUUID();
    const token = randomToken();
    const payload = await seal(
      { to: row.email, kind: 'feedback_request', token },
      env.ACCESS_SECRET,
    );
    await env.DB.batch([
      env.DB.prepare(`UPDATE access_feedback SET email_id=?,token_hash=?,token_expires_at=?,next_prompt_at=?,updated_at=?
        WHERE member_id=? AND enabled=1 AND ${eligibleSql} AND email_id IS NULL AND next_prompt_at<=?`).bind(
        id,
        await tokenHash(token),
        now + 90 * day,
        now + 7 * day,
        now,
        row.member_id,
        now,
      ),
      env.DB.prepare(`INSERT INTO access_mail(id,email,kind,payload,created_at) SELECT ?,?,'feedback_request',?,?
        WHERE EXISTS(SELECT 1 FROM access_feedback WHERE member_id=? AND email_id=?)`).bind(
        id,
        row.email,
        payload,
        now,
        row.member_id,
        id,
      ),
    ]);
  }
}

export async function pruneFeedbackInvitations(env: Env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE access_feedback SET token_hash=NULL,token_expires_at=NULL WHERE token_expires_at<=?',
    ).bind(now),
    env.DB.prepare(
      "UPDATE access_feedback SET enabled=0,consent_at=NULL,first_active_at=NULL,last_active_day=NULL,active_days=0,results='[]' WHERE last_active_day<?",
    ).bind(new Date(now - 90 * day).toISOString().slice(0, 10)),
  ]);
}

export async function feedbackMailAllowed(env: Env, id: string, now = Date.now()) {
  return !!(await env.DB.prepare(`SELECT 1 FROM access_feedback f JOIN access_members m ON m.id=f.member_id
    WHERE f.email_id=? AND f.enabled=1 AND f.completed_at IS NULL AND m.status='approved' AND m.verified_at IS NOT NULL
    AND f.token_expires_at>? AND NOT EXISTS(SELECT 1 FROM access_mail a WHERE a.email=m.email AND a.delivery_status IN ('bounced','complained','suppressed'))`)
    .bind(id, now)
    .first());
}

const responseAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('status'), token: tokenSchema }),
  z.strictObject({ action: z.literal('unsubscribe'), token: tokenSchema }),
  z.strictObject({
    action: z.literal('submit'),
    token: tokenSchema,
    id: z.uuid({ version: 'v4' }),
    message: z.string().trim().min(1).max(8000),
  }),
]);
export async function feedbackResponse(env: Env, input: unknown, now = Date.now()) {
  const action = responseAction.parse(input);
  const row = await env.DB.prepare(
    `SELECT f.* FROM access_feedback f JOIN access_members m ON m.id=f.member_id WHERE f.token_hash=? AND f.token_expires_at>? AND m.status='approved'`,
  )
    .bind(await tokenHash(action.token), now)
    .first<Campaign>();
  if (!row) throw new AccessError(410, 'feedback_link_expired');
  if (action.action === 'unsubscribe') {
    await memberFeedback(
      env,
      row.member_id,
      { action: 'preferences', enabled: false, promptsEnabled: row.prompts_enabled === 1 },
      now,
    );
    return { completed: row.completed_at !== null, unsubscribed: true };
  }
  if (action.action === 'submit' && row.completed_at === null) {
    if (env.INGESTION_ENABLED !== 'true') throw new AccessError(503, 'feedback_unavailable');
    await env.DB.batch([
      ...(await feedbackStatements(
        env,
        { schemaVersion: 2, id: action.id, kind: 'idea', message: action.message, source: 'email' },
        now,
      )),
      env.DB.prepare(
        'UPDATE access_feedback SET completed_at=?,enabled=0,prompts_enabled=0,updated_at=? WHERE member_id=?',
      ).bind(now, now, row.member_id),
    ]);
  }
  return {
    completed: action.action === 'submit' || row.completed_at !== null,
    unsubscribed: row.enabled === 0,
  };
}
