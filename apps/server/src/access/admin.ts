import { z } from 'zod';
import { accessAdminPage } from './admin-page';
import { MANAGED_TAGS } from './audience';
import {
  broadcastEmail,
  broadcastSchema,
  changelogEntries,
  createBroadcastDraft,
} from './broadcast';
import { randomToken } from './crypto';
import { waitlistInsights } from './insights';
import { accessEmail } from './mail';
import { checkMailDelivery } from './mail-status';
import type { Mail } from './mail-templates';
import { markAudienceStale } from './newsletter';
import { installerKey, storeUrl } from './routes';
import { AccessError, approve, requestLink } from './service';
import { waitlistRankSql } from './waitlist';

function mailConfigured(env: Env) {
  return !!(env.ACCESS_SECRET?.length >= 32 && env.SEQUENZY_API_KEY && env.ACCESS_EMAIL_FROM);
}
export async function accessReadiness(env: Env) {
  if (storeUrl(env))
    return {
      enabled: env.EARLY_ACCESS_ENABLED === 'true',
      mailConfigured: mailConfigured(env),
      download: 'available',
      version: null,
      distribution: 'store',
    };
  const key = installerKey(env);
  let download: 'available' | 'missing' | 'unconfigured' | 'unknown' = key
    ? 'unknown'
    : 'unconfigured';
  let version: string | null = null;
  if (key) {
    try {
      const object = await env.RELEASES.head(key);
      download = object && object.size > 0 ? 'available' : 'missing';
      if (download === 'available') version = key.split('/')[1];
    } catch {}
  }
  return {
    enabled: env.EARLY_ACCESS_ENABLED === 'true',
    mailConfigured: mailConfigured(env),
    download,
    version,
  };
}

export async function accessAdmin(
  request: Request,
  env: Env,
  readJson: (request: Request) => Promise<unknown>,
) {
  const url = new URL(request.url);
  const headers = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  };
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  if (request.method === 'GET' && url.pathname === '/admin/access') {
    const nonce = crypto.randomUUID();
    return new Response(accessAdminPage(nonce), {
      headers: {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    });
  }
  if (request.method === 'GET' && url.pathname === '/admin/access/email-preview') {
    const kind = url.searchParams.get('kind');
    const mail: Mail =
      kind === 'feedback_request'
        ? { to: 'preview@example.invalid', kind: 'feedback_request', token: 'preview-only' }
        : kind === 'waitlist'
          ? { to: 'preview@example.invalid', kind: 'waitlist', token: 'preview-only' }
          : kind === 'referral' ||
              kind === 'passes_ready' ||
              kind === 'pass_claimed' ||
              kind === 'pass_expired'
            ? { to: 'preview@example.invalid', kind, total: 5 }
            : {
                to: 'preview@example.invalid',
                kind: kind === 'invite' ? 'invite' : kind === 'login' ? 'login' : 'welcome',
                token: 'preview-only',
              };
    return new Response(accessEmail(mail, env.ACCESS_WEB_ORIGIN).body, {
      headers: {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; img-src https://jackalope.dev; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  }
  if (request.method === 'GET' && url.pathname === '/admin/access/broadcast-preview') {
    const draft = broadcastSchema.safeParse({
      subject: url.searchParams.get('subject') ?? '',
      preview: url.searchParams.get('preview') ?? '',
      headline: url.searchParams.get('headline') ?? '',
      intro: url.searchParams.get('intro') ?? '',
      outro: url.searchParams.get('outro') ?? '',
      entries: url.searchParams.getAll('entry'),
      extras: url.searchParams.getAll('extra').map((value) => {
        const [title, ...body] = value.split('\n');
        return { title: title ?? '', body: body.join('\n') };
      }),
      action: url.searchParams.get('actionUrl')
        ? {
            label: url.searchParams.get('actionLabel') ?? 'Read more',
            url: url.searchParams.get('actionUrl') ?? '',
          }
        : null,
      tag: url.searchParams.get('tag') ?? '',
    });
    if (!draft.success)
      return new Response('This preview link is incomplete. Compose the note again.', {
        status: 400,
        headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
      });
    const entries = await changelogEntries(env).catch(() => []);
    return new Response(broadcastEmail(draft.data, entries, env.ACCESS_WEB_ORIGIN).html, {
      headers: {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; img-src https://jackalope.dev; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  }
  try {
    if (request.method === 'GET' && url.pathname === '/admin/api/access/broadcast') {
      const audience = await env.DB.prepare(
        "SELECT count(*) AS total FROM access_members WHERE newsletter=1 AND newsletter_confirmed_at IS NOT NULL AND status!='revoked' AND sequenzy_state IS NOT NULL",
      ).first<{ total: number }>();
      return json({
        configured: !!(env.SEQUENZY_API_KEY && env.ACCESS_AUDIENCE_LIST && env.ACCESS_EMAIL_FROM),
        synced: audience?.total ?? 0,
        tags: MANAGED_TAGS,
        entries: await changelogEntries(env),
      });
    }
    if (request.method === 'POST' && url.pathname === '/admin/api/access/broadcast') {
      if (!env.SEQUENZY_API_KEY || !env.ACCESS_AUDIENCE_LIST || !env.ACCESS_EMAIL_FROM)
        return json({ error: 'access_not_configured' }, 409);
      const draft = broadcastSchema.parse(await readJson(request));
      const entries = await changelogEntries(env);
      return json(await createBroadcastDraft(env, draft, entries));
    }
    if (request.method === 'GET' && url.pathname === '/admin/api/access/insights')
      return json(await waitlistInsights(env));
    if (request.method === 'GET' && url.pathname === '/admin/api/access/readiness')
      return json(await accessReadiness(env));
    if (request.method === 'GET' && url.pathname === '/admin/api/access/member') {
      const id = z.uuid().parse(url.searchParams.get('id'));
      const member = await env.DB.prepare(
        `SELECT id,email,status,created_at,approved_at,verified_at,source,newsletter,newsletter_confirmed_at,newsletter_synced_at,newsletter_attempts,invite_limit,preferences,campaign,referral_count,waitlist_verified_at,(SELECT count(*) FROM access_members r WHERE r.waitlist_referrer_id=access_members.id AND r.waitlist_verified_at IS NULL AND r.status!='revoked') AS pending_referrals FROM access_members WHERE id=?`,
      )
        .bind(id)
        .first<{ email: string }>();
      if (!member) return json({ error: 'member_not_found' }, 404);
      const [mail, devices, invites, feedback] = await Promise.all([
        env.DB.prepare(
          'SELECT id,kind,state,created_at,attempts,next_at,provider_send_id IS NOT NULL AS can_check,delivery_status,delivery_checked_at FROM access_mail WHERE email=? ORDER BY created_at DESC,rowid DESC LIMIT 10',
        )
          .bind(member.email)
          .all(),
        env.DB.prepare(
          'SELECT created_at,expires_at FROM access_devices WHERE member_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 10',
        )
          .bind(id, Date.now())
          .all(),
        env.DB.prepare(
          "SELECT status,count(*) AS count FROM access_invites WHERE owner_id=? AND (status='accepted' OR (status='pending' AND expires_at>?)) GROUP BY status",
        )
          .bind(id, Date.now())
          .all(),
        env.DB.prepare(
          'SELECT enabled,prompts_enabled,consent_at,first_active_at,last_active_day,active_days,json_array_length(results) AS opened_results,prompt_count,next_prompt_at,completed_at,email_id IS NOT NULL AS email_requested FROM access_feedback WHERE member_id=?',
        )
          .bind(id)
          .first(),
      ]);
      return json({
        member,
        mail: mail.results,
        devices: devices.results,
        invites: invites.results,
        feedback,
      });
    }
    if (request.method === 'GET' && url.pathname === '/admin/api/access') {
      const status = url.searchParams.get('status') ?? 'waiting';
      const sort = z
        .enum(['priority', 'newest', 'referrals'])
        .parse(url.searchParams.get('sort') ?? (status === 'waiting' ? 'priority' : 'newest'));
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(200000)
        .parse(url.searchParams.get('offset') ?? 0);
      const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
      const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
      const platform = z
        .enum(['all', 'macos', 'windows', 'linux'])
        .parse(url.searchParams.get('platform') ?? 'all');
      const stage = z
        .enum(['all', 'not-signed-in', 'not-connected', 'connected', 'email-failed'])
        .parse(url.searchParams.get('stage') ?? 'all');
      if (
        !['waiting', 'approved', 'revoked', 'all'].includes(status) ||
        !Number.isSafeInteger(before) ||
        before < 0 ||
        query.length > 254
      )
        return json({ error: 'invalid_filter' }, 400);
      const members = await env.DB.prepare(
        `WITH ranked AS (${waitlistRankSql}) SELECT m.rowid AS cursor,w.position,m.referral_count,m.waitlist_verified_at,(SELECT count(*) FROM access_members r WHERE r.waitlist_referrer_id=m.id AND r.waitlist_verified_at IS NULL AND r.status!='revoked') AS pending_referrals,m.id,m.email,m.status,m.created_at,m.approved_at,m.verified_at,m.invite_limit,m.preferences,m.first_desktop_at,(SELECT count(*) FROM access_devices WHERE member_id=m.id AND expires_at>?) AS devices,(SELECT count(*) FROM access_invites WHERE owner_id=m.id AND status='accepted') AS accepted,a.kind AS mail_kind,a.state AS mail_state,a.attempts AS mail_attempts,a.next_at AS mail_next_at,a.created_at AS mail_created_at,a.delivery_status FROM access_members m LEFT JOIN ranked w ON w.id=m.id LEFT JOIN access_mail a ON a.rowid=(SELECT rowid FROM access_mail WHERE email=m.email ORDER BY created_at DESC,rowid DESC LIMIT 1) WHERE (?='all' OR m.status=?) AND m.rowid<? AND instr(m.email,?)>0 AND (?='all' OR EXISTS(SELECT 1 FROM json_each(m.preferences,'$.platforms') WHERE value=?)) AND (?='all' OR (?='not-signed-in' AND m.status='approved' AND m.verified_at IS NULL) OR (?='not-connected' AND m.status='approved' AND m.verified_at IS NOT NULL AND m.first_desktop_at IS NULL) OR (?='connected' AND m.first_desktop_at IS NOT NULL) OR (?='email-failed' AND (a.state='failed' OR a.delivery_status IN ('bounced','failed','complained')))) ORDER BY CASE WHEN ?='priority' THEN coalesce(w.position,200001) WHEN ?='referrals' THEN -m.referral_count ELSE -m.rowid END,m.created_at,m.id LIMIT 51 OFFSET ?`,
      )
        .bind(
          Date.now(),
          status,
          status,
          before,
          query,
          platform,
          platform,
          stage,
          stage,
          stage,
          stage,
          stage,
          sort,
          sort,
          offset,
        )
        .all();
      const counts = await env.DB.prepare(
        'SELECT status,count(*) AS count FROM access_members GROUP BY status',
      ).all();
      return json({
        members: members.results.slice(0, 50),
        hasMore: members.results.length > 50,
        counts: counts.results,
        enabled: env.EARLY_ACCESS_ENABLED === 'true',
      });
    }
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== url.origin)
        return json({ error: 'origin_required' }, 403);
      if (url.pathname === '/admin/api/access/delivery') {
        const { id } = z.strictObject({ id: z.uuid() }).parse(await readJson(request));
        return json(await checkMailDelivery(env, id));
      }
      if (url.pathname === '/admin/api/access') {
        const { id, action, allowWithoutDownload } = z
          .strictObject({
            id: z.uuid(),
            action: z.enum(['approve', 'resend', 'revoke', 'restore']),
            allowWithoutDownload: z.boolean().default(false),
          })
          .parse(await readJson(request));
        const member = await env.DB.prepare('SELECT email,status FROM access_members WHERE id=?')
          .bind(id)
          .first<{ email: string; status: string }>();
        if (!member) return json({ error: 'member_not_found' }, 404);
        const expected = {
          approve: 'waiting',
          resend: 'approved',
          revoke: 'approved',
          restore: 'revoked',
        }[action];
        if (member.status !== expected && !(action === 'revoke' && member.status === 'waiting'))
          return json({ error: 'member_changed' }, 409);
        if (action === 'approve' || action === 'resend') {
          if (env.EARLY_ACCESS_ENABLED !== 'true' || !mailConfigured(env))
            return json({ error: 'access_not_configured' }, 503);
          if (
            action === 'approve' &&
            !allowWithoutDownload &&
            (await accessReadiness(env)).download !== 'available'
          )
            return json({ error: 'download_not_ready' }, 409);
          const queued =
            action === 'approve' ? await approve(env, id) : await requestLink(env, member.email);
          return json({ success: true, mailQueued: !!queued });
        }
        if (action === 'restore')
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE access_members SET status='waiting',approved_at=NULL,verified_at=NULL,share_code=? WHERE id=? AND status='revoked'",
            ).bind(randomToken(), id),
            markAudienceStale(env, id),
          ]);
        else
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE access_members SET status='revoked' WHERE id=? AND status IN ('approved','waiting')",
            ).bind(id),
            env.DB.prepare('DELETE FROM access_sessions WHERE member_id=?').bind(id),
            env.DB.prepare('DELETE FROM access_waitlist_sessions WHERE member_id=?').bind(id),
            env.DB.prepare('DELETE FROM access_waitlist_tokens WHERE member_id=?').bind(id),
            env.DB.prepare(
              'UPDATE access_growth_events SET queued_at=? WHERE member_id=? AND queued_at IS NULL',
            ).bind(Date.now(), id),
            env.DB.prepare('DELETE FROM access_tokens WHERE email=?').bind(member.email),
            env.DB.prepare(
              "UPDATE access_invites SET status='revoked' WHERE (owner_id=? OR email=?) AND status='pending'",
            ).bind(id, member.email),
            markAudienceStale(env, id),
          ]);
        return json({ success: true });
      }
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    if (error instanceof Error && error.message === 'changelog_unavailable')
      return json({ error: 'changelog_unavailable' }, 503);
    return json({ error: 'access_unavailable' }, 503);
  }
}
