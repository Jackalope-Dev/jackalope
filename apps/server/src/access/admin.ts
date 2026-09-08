import { z } from 'zod';
import { accessAdminPage } from './admin-page';
import { randomToken } from './crypto';
import { accessEmail } from './mail';
import { checkMailDelivery } from './mail-status';
import { installerKey, storeUrl } from './routes';
import { AccessError, approve, requestLink } from './service';

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
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    });
  }
  if (request.method === 'GET' && url.pathname === '/admin/access/email-preview') {
    const kind = url.searchParams.get('kind');
    const mail =
      kind === 'waitlist'
        ? { to: 'preview@example.invalid', kind: 'waitlist' as const }
        : {
            to: 'preview@example.invalid',
            kind: kind === 'login' ? ('login' as const) : ('welcome' as const),
            token: 'preview-only-not-a-login-token',
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
  try {
    if (request.method === 'GET' && url.pathname === '/admin/api/access/readiness')
      return json(await accessReadiness(env));
    if (request.method === 'GET' && url.pathname === '/admin/api/access/member') {
      const id = z.uuid().parse(url.searchParams.get('id'));
      const member = await env.DB.prepare(
        'SELECT id,email,status,created_at,approved_at,verified_at,source,newsletter,newsletter_synced_at,newsletter_attempts,invite_limit FROM access_members WHERE id=?',
      )
        .bind(id)
        .first<{ email: string }>();
      if (!member) return json({ error: 'member_not_found' }, 404);
      const [mail, devices, invites] = await Promise.all([
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
      ]);
      return json({
        member,
        mail: mail.results,
        devices: devices.results,
        invites: invites.results,
      });
    }
    if (request.method === 'GET' && url.pathname === '/admin/api/access') {
      const status = url.searchParams.get('status') ?? 'waiting';
      const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
      const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
      if (
        !['waiting', 'approved', 'revoked', 'all'].includes(status) ||
        !Number.isSafeInteger(before) ||
        before < 0 ||
        query.length > 254
      )
        return json({ error: 'invalid_filter' }, 400);
      const members = await env.DB.prepare(
        "SELECT m.rowid AS cursor,m.id,m.email,m.status,m.created_at,m.approved_at,m.verified_at,m.invite_limit,(SELECT count(*) FROM access_devices WHERE member_id=m.id AND expires_at>?) AS devices,(SELECT count(*) FROM access_invites WHERE owner_id=m.id AND status='accepted') AS accepted,a.kind AS mail_kind,a.state AS mail_state,a.attempts AS mail_attempts,a.next_at AS mail_next_at,a.created_at AS mail_created_at,a.delivery_status FROM access_members m LEFT JOIN access_mail a ON a.rowid=(SELECT rowid FROM access_mail WHERE email=m.email ORDER BY created_at DESC,rowid DESC LIMIT 1) WHERE (?='all' OR m.status=?) AND m.rowid<? AND instr(m.email,?)>0 ORDER BY m.rowid DESC LIMIT 51",
      )
        .bind(Date.now(), status, status, before, query)
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
        if (member.status !== expected) return json({ error: 'member_changed' }, 409);
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
          await env.DB.prepare(
            "UPDATE access_members SET status='waiting',approved_at=NULL,verified_at=NULL,share_code=? WHERE id=? AND status='revoked'",
          )
            .bind(randomToken(), id)
            .run();
        else
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE access_members SET status='revoked' WHERE id=? AND status='approved'",
            ).bind(id),
            env.DB.prepare('DELETE FROM access_sessions WHERE member_id=?').bind(id),
            env.DB.prepare('DELETE FROM access_tokens WHERE email=?').bind(member.email),
            env.DB.prepare(
              "UPDATE access_invites SET status='revoked' WHERE (owner_id=? OR email=?) AND status='pending'",
            ).bind(id, member.email),
          ]);
        return json({ success: true });
      }
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    return json({ error: 'access_unavailable' }, 503);
  }
}
