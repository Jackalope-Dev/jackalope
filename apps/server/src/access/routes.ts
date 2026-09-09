import { z } from 'zod';
import { deliverFeedback } from '../feedback-mail';
import { randomToken } from './crypto';
import { browserDeviceAction } from './devices';
import { feedbackResponse } from './feedback';
import { campaignSchema, preferencesSchema, savePreferences } from './insights';
import { deliverAccessMail } from './mail';
import { syncNewsletter } from './newsletter';
import {
  AccessError,
  acceptToken,
  changeInvite,
  emailSchema,
  invitations,
  inviteEmails,
  logout,
  register,
  requestLink,
  sessionCookie,
  sessionMember,
  tokenSchema,
} from './service';
import {
  acceptWaitlistToken,
  requestWaitlistLink,
  waitingMember,
  waitlistCookie,
  waitlistLogout,
  waitlistStatus,
} from './waitlist';

const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
export function installerKey(env: Env) {
  const key = env.ACCESS_INSTALLER_KEY;
  return /^early-access\/v\d+\.\d+\.\d+\/[a-zA-Z0-9_.-]+\.exe$/.test(key) ? key : null;
}
export function storeUrl(env: Env) {
  try {
    const url = new URL(env.ACCESS_STORE_URL);
    const path =
      url.hostname === 'apps.microsoft.com'
        ? /^\/detail\/[a-z0-9]{12}\/?$/i
        : /^\/store\/apps\/[a-z0-9]{12}\/?$/i;
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      ['apps.microsoft.com', 'www.microsoft.com'].includes(url.hostname) &&
      path.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export async function accessRoutes(
  request: Request,
  env: Env,
  readJson: (request: Request) => Promise<unknown>,
  limit: (mail: boolean) => Promise<void>,
  ctx?: ExecutionContext,
) {
  const origin = request.headers.get('origin');
  const allowed = origin === env.ACCESS_WEB_ORIGIN;
  const cors: Record<string, string> = allowed
    ? {
        'access-control-allow-origin': env.ACCESS_WEB_ORIGIN,
        'access-control-allow-credentials': 'true',
        vary: 'Origin',
      }
    : {};
  const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
    Response.json(data, { status, headers: { ...headers, ...cors, ...extra } });
  try {
    const site = new URL(env.ACCESS_WEB_ORIGIN);
    if (
      site.origin !== env.ACCESS_WEB_ORIGIN ||
      (site.protocol !== 'https:' && env.ENVIRONMENT !== 'local')
    )
      throw new AccessError(503, 'access_not_configured');
    if (origin && !allowed) throw new AccessError(403, 'origin_not_allowed');
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          ...cors,
          'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
        },
      });
    const url = new URL(request.url);
    if (url.search) throw new AccessError(400, 'query_not_allowed');
    if (request.method === 'GET' && url.pathname === '/v1/access/status')
      return json({ enabled: env.EARLY_ACCESS_ENABLED === 'true' });
    if (
      env.EARLY_ACCESS_ENABLED !== 'true' ||
      !env.ACCESS_SECRET ||
      env.ACCESS_SECRET.length < 32 ||
      !env.SEQUENZY_API_KEY ||
      !env.ACCESS_EMAIL_FROM
    )
      throw new AccessError(503, 'access_not_available');
    const path = url.pathname;
    if (request.method === 'POST' && !allowed) throw new AccessError(403, 'origin_required');
    await limit(
      request.method === 'POST' &&
        [
          '/v1/access/waitlist',
          '/v1/access/link',
          '/v1/access/waitlist/link',
          '/v1/access/feedback',
        ].includes(path),
    );
    if (request.method === 'POST' && path === '/v1/access/feedback') {
      const result = await feedbackResponse(env, await readJson(request));
      if (ctx && result.completed) ctx.waitUntil(deliverFeedback(env));
      return json(result);
    }
    if (request.method === 'GET' && path.startsWith('/v1/access/invitation/')) {
      const code = tokenSchema.parse(path.slice('/v1/access/invitation/'.length));
      const owner = await env.DB.prepare(
        "SELECT invite_limit-(SELECT count(*) FROM access_invites WHERE owner_id=m.id AND (status='accepted' OR (status='pending' AND expires_at>?))) AS remaining FROM access_members m WHERE share_code=? AND status='approved'",
      )
        .bind(Date.now(), code)
        .first<{ remaining: number }>();
      return json({ available: !!owner && owner.remaining > 0 });
    }
    if (request.method === 'POST' && path === '/v1/access/waitlist') {
      const body = z
        .strictObject({
          email: emailSchema,
          newsletter: z.boolean().default(false),
          campaign: campaignSchema.optional(),
          referral: tokenSchema.optional(),
          source: z.enum(['inline', 'popup']).default('inline'),
          website: z.string().max(200).default(''),
        })
        .parse(await readJson(request));
      let surveyToken = randomToken();
      if (!body.website) {
        surveyToken = await register(
          env,
          body.email,
          body.newsletter,
          body.source,
          body.campaign,
          body.referral,
        );
        if (ctx) ctx.waitUntil(deliverAccessMail(env));
        if (ctx && body.newsletter) ctx.waitUntil(syncNewsletter(env));
      }
      return json({ success: true, surveyToken }, 202);
    }
    if (request.method === 'GET' && path === '/v1/access/waitlist/me')
      return json(await waitlistStatus(request, env));
    if (request.method === 'POST' && path === '/v1/access/waitlist/link') {
      const body = z
        .strictObject({ email: emailSchema, website: z.string().max(200).default('') })
        .parse(await readJson(request));
      if (!body.website) await requestWaitlistLink(env, body.email);
      if (ctx) ctx.waitUntil(deliverAccessMail(env));
      return json({ success: true }, 202);
    }
    if (request.method === 'POST' && path === '/v1/access/waitlist/accept') {
      const body = z.strictObject({ token: tokenSchema }).parse(await readJson(request));
      const session = await acceptWaitlistToken(env, body.token);
      if (ctx) ctx.waitUntil(deliverAccessMail(env));
      return json({ success: true }, 200, { 'set-cookie': waitlistCookie(session) });
    }
    if (request.method === 'POST' && path === '/v1/access/waitlist/logout') {
      await waitlistLogout(request, env);
      return json({ success: true }, 200, { 'set-cookie': waitlistCookie('', true) });
    }
    if (request.method === 'POST' && path === '/v1/access/preferences') {
      const body = z
        .strictObject({ token: tokenSchema, preferences: preferencesSchema })
        .parse(await readJson(request));
      await savePreferences(env, body.token, body.preferences);
      return json({ success: true }, 202);
    }
    if (request.method === 'POST' && path === '/v1/access/link') {
      const body = z
        .strictObject({
          email: emailSchema,
          invite: tokenSchema.optional(),
          website: z.string().max(200).default(''),
        })
        .parse(await readJson(request));
      if (!body.website) await requestLink(env, body.email, body.invite);
      if (ctx) ctx.waitUntil(deliverAccessMail(env));
      return json({ success: true }, 202);
    }
    if (request.method === 'POST' && path === '/v1/access/accept') {
      const body = z.strictObject({ token: tokenSchema }).parse(await readJson(request));
      return json({ success: true }, 200, {
        'set-cookie': sessionCookie(await acceptToken(env, body.token)),
      });
    }
    if (request.method === 'POST' && path === '/v1/access/logout') {
      await logout(request, env);
      return json({ success: true }, 200, { 'set-cookie': sessionCookie('', true) });
    }
    if (request.method === 'POST' && path.startsWith('/v1/access/waitlist/desktop/')) {
      const waiting = await waitingMember(request, env);
      if (!waiting) throw new AccessError(401, 'access_sign_in_required');
      return json(
        await browserDeviceAction(
          env,
          waiting,
          path.slice('/v1/access/waitlist/desktop/'.length),
          await readJson(request),
          true,
        ),
      );
    }
    const member = await sessionMember(request, env);
    if (!member) throw new AccessError(401, 'access_sign_in_required');
    if (request.method === 'POST' && path.startsWith('/v1/access/desktop/'))
      return json(
        await browserDeviceAction(
          env,
          member,
          path.slice('/v1/access/desktop/'.length),
          await readJson(request),
        ),
      );
    if (request.method === 'GET' && path === '/v1/access/devices')
      return json(
        (
          await env.DB.prepare(
            'SELECT id,created_at AS createdAt,expires_at AS expiresAt FROM access_devices WHERE member_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 10',
          )
            .bind(member.id, Date.now())
            .all()
        ).results,
      );
    if (request.method === 'GET' && path === '/v1/access/me') {
      const store = storeUrl(env);
      const key = installerKey(env);
      const installer = !store && key ? await env.RELEASES.head(key) : null;
      return json({
        email: member.email,
        ...(await invitations(env, member)),
        download: store
          ? { url: `${url.origin}/v1/access/download`, kind: 'store' }
          : installer
            ? { url: `${url.origin}/v1/access/download`, bytes: installer.size }
            : null,
      });
    }
    if (['GET', 'HEAD'].includes(request.method) && path === '/v1/access/download') {
      const store = storeUrl(env);
      if (store) {
        if (request.method === 'GET')
          await env.DB.prepare(
            'UPDATE access_members SET first_download_at=coalesce(first_download_at,?) WHERE id=?',
          )
            .bind(Date.now(), member.id)
            .run();
        return new Response(null, {
          status: 302,
          headers: { ...headers, ...cors, location: store },
        });
      }
      const key = installerKey(env);
      if (!key) throw new AccessError(404, 'download_not_ready');
      const object = await env.RELEASES.get(key);
      if (!object) throw new AccessError(404, 'download_not_ready');
      if (request.method === 'GET')
        await env.DB.prepare(
          'UPDATE access_members SET first_download_at=coalesce(first_download_at,?) WHERE id=?',
        )
          .bind(Date.now(), member.id)
          .run();
      if (request.method === 'HEAD') await object.body.cancel();
      return new Response(request.method === 'HEAD' ? null : object.body, {
        headers: {
          ...headers,
          ...cors,
          'content-type': 'application/octet-stream',
          'content-length': String(object.size),
          'content-disposition': `attachment; filename="${key.split('/').at(-1)}"`,
        },
      });
    }
    if (request.method === 'POST' && path === '/v1/access/invites') {
      const body = z
        .strictObject({ emails: z.array(emailSchema).min(1).max(5) })
        .parse(await readJson(request));
      await inviteEmails(env, member, body.emails);
      if (ctx) ctx.waitUntil(deliverAccessMail(env));
      return json({ success: true, ...(await invitations(env, member)) }, 202);
    }
    if (request.method === 'POST' && path === '/v1/access/invites/change') {
      const body = z
        .strictObject({ id: z.uuid(), action: z.enum(['resend', 'revoke']) })
        .parse(await readJson(request));
      await changeInvite(env, member, body.id, body.action);
      if (ctx && body.action === 'resend') ctx.waitUntil(deliverAccessMail(env));
      return json({ success: true, ...(await invitations(env, member)) });
    }
    throw new AccessError(404, 'not_found');
  } catch (error) {
    const code =
      error instanceof AccessError
        ? error.code
        : error instanceof z.ZodError
          ? 'invalid_request'
          : 'access_unavailable';
    const status =
      error instanceof AccessError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return json({ error: code }, status, status === 429 ? { 'retry-after': '60' } : {});
  }
}
