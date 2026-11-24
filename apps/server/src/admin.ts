import { isPlatform, isReleaseChannel, SEMVER } from '@jackalope/contracts/platform';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { accessAdmin } from './access/admin';
import { adminBetaRequests, resolveBetaRequest } from './access/beta';
import { adminPage } from './admin-page';
import { ServiceError } from './errors';
import {
  ADMIN_HEADERS,
  adminCsp,
  errorResponse,
  json as respondJson,
  SERVICE_ERRORS,
} from './respond';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function remoteKeys(issuer: string) {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 });
    if (keySets.size >= 2) keySets.clear();
    keySets.set(issuer, keys);
  }
  return keys;
}
export async function authorizeAdmin(request: Request, env: Env, keys?: JWTVerifyGetKey) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (
    !token ||
    token.length > 16384 ||
    !env.ADMIN_EMAIL ||
    !env.ACCESS_AUD ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER)
  )
    return false;
  try {
    const { payload } = await jwtVerify(token, keys ?? remoteKeys(env.ACCESS_ISSUER), {
      issuer: env.ACCESS_ISSUER,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    return (
      typeof payload.email === 'string' &&
      payload.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()
    );
  } catch {
    return false;
  }
}
const json = (value: unknown, status = 200) => respondJson(value, status, ADMIN_HEADERS);
export async function admin(
  request: Request,
  env: Env,
  readJson: (request: Request) => Promise<unknown>,
) {
  if (!(await authorizeAdmin(request, env))) return json({ error: 'admin_access_required' }, 403);
  return adminRoutes(request, env, readJson);
}
export async function adminRoutes(
  request: Request,
  env: Env,
  readJson: (request: Request) => Promise<unknown>,
) {
  const url = new URL(request.url);
  if (
    url.pathname === '/admin/access' ||
    url.pathname.startsWith('/admin/access/') ||
    url.pathname === '/admin/api/access' ||
    url.pathname.startsWith('/admin/api/access/')
  )
    return accessAdmin(request, env, readJson);
  try {
    return await consoleRoutes(request, url, env, readJson);
  } catch (error) {
    return errorResponse(error, { ...SERVICE_ERRORS, headers: ADMIN_HEADERS });
  }
}
async function consoleRoutes(
  request: Request,
  url: URL,
  env: Env,
  readJson: (request: Request) => Promise<unknown>,
) {
  if (request.method === 'GET' && url.pathname === '/admin') {
    const nonce = crypto.randomUUID();
    return new Response(adminPage(nonce), {
      headers: {
        ...ADMIN_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': adminCsp(nonce),
      },
    });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/overview') {
    const days = Number(url.searchParams.get('days') ?? 7);
    const channel = url.searchParams.get('channel') ?? 'all';
    const version = url.searchParams.get('version') ?? '';
    const os = url.searchParams.get('os') ?? 'all';
    if (
      ![7, 30].includes(days) ||
      !(channel === 'all' || isReleaseChannel(channel)) ||
      !(os === 'all' || isPlatform(os)) ||
      !(version === '' || SEMVER.test(version)) ||
      version.length > 32
    )
      throw new ServiceError(400, 'invalid_filter');
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const metrics = await env.DB.prepare(
      "SELECT day,version,channel,os,name,dimension,count FROM metrics WHERE day>=? AND (?='all' OR channel=?) AND (?='' OR version=?) AND (?='all' OR os=?) ORDER BY day DESC,version LIMIT 10001",
    )
      .bind(since, channel, channel, version, version, os, os)
      .all();
    const versions = await env.DB.prepare(
      'SELECT DISTINCT version FROM metrics ORDER BY version DESC LIMIT 100',
    ).all();
    return json({
      metrics: metrics.results.slice(0, 10000),
      truncated: metrics.results.length > 10000,
      versions: versions.results,
      ingestionEnabled: env.INGESTION_ENABLED === 'true',
      emailEnabled: env.FEEDBACK_EMAIL_ENABLED === 'true',
      retentionDays: env.TELEMETRY_DAYS,
      coverage:
        'Best-effort event counts from participating installations, not unique users, retention, or all crashes. Views are visits; accepted operations are native acknowledgements, not proof of completed agent work. Failed checks and rejected operations are not necessarily app defects. Error categories require separate consent. Public ingestion cannot prove authentic clients.',
    });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/summary') {
    const [people, feedback, mail] = await Promise.all([
      env.DB.prepare(
        "SELECT count(*) AS total,coalesce(sum(status='waiting'),0) AS waiting,coalesce(sum(status='approved'),0) AS approved,coalesce(sum(status='approved' AND verified_at IS NULL),0) AS notSignedIn,coalesce(sum(status='approved' AND verified_at IS NOT NULL AND first_desktop_at IS NULL),0) AS notConnected,coalesce(sum(status='approved' AND first_desktop_at IS NOT NULL),0) AS connected FROM access_members WHERE status!='revoked'",
      ).first(),
      env.DB.prepare(
        'SELECT status,count(*) AS count FROM feedback WHERE expires_at>? GROUP BY status',
      )
        .bind(Date.now())
        .all(),
      env.DB.prepare(
        "SELECT count(*) AS needsAttention FROM access_members m JOIN access_mail a ON a.rowid=(SELECT rowid FROM access_mail WHERE email=m.email ORDER BY created_at DESC,rowid DESC LIMIT 1) WHERE a.state='failed' OR a.delivery_status IN ('bounced','failed','complained')",
      ).first(),
    ]);
    return json({ people, feedback: feedback.results, mail });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/feedback') {
    const status = url.searchParams.get('status') ?? 'new';
    const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
    if (
      !['new', 'reviewing', 'planned', 'closed', 'all'].includes(status) ||
      !Number.isSafeInteger(before) ||
      before < 0
    )
      throw new ServiceError(400, 'invalid_filter');
    const rows = await env.DB.prepare(
      "SELECT rowid AS cursor,id,received_at,payload,status,email_state,email_attempts FROM feedback WHERE expires_at>? AND rowid<? AND (?='all' OR status=?) ORDER BY rowid DESC LIMIT 50",
    )
      .bind(Date.now(), before, status, status)
      .all();
    return json({ reports: rows.results });
  }
  if (request.method === 'POST' && url.pathname === '/admin/api/feedback') {
    if (request.headers.get('origin') !== url.origin)
      throw new ServiceError(403, 'origin_required');
    const body = await readJson(request);
    if (
      !body ||
      typeof body !== 'object' ||
      !('id' in body) ||
      !('status' in body) ||
      typeof body.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(body.id) ||
      typeof body.status !== 'string' ||
      !['new', 'reviewing', 'planned', 'closed'].includes(body.status)
    )
      throw new ServiceError(400, 'invalid_request');
    const result = await env.DB.prepare('UPDATE feedback SET status=? WHERE id=? AND expires_at>?')
      .bind(body.status, body.id, Date.now())
      .run();
    return json({ updated: result.meta.changes === 1 });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/beta') {
    const status = url.searchParams.get('status') ?? 'pending';
    if (!['pending', 'done', 'declined', 'withdrawn', 'all'].includes(status))
      throw new ServiceError(400, 'invalid_filter');
    return json(await adminBetaRequests(env, status));
  }
  if (request.method === 'POST' && url.pathname === '/admin/api/beta') {
    if (request.headers.get('origin') !== url.origin)
      throw new ServiceError(403, 'origin_required');
    const body = await readJson(request);
    if (
      !body ||
      typeof body !== 'object' ||
      !('id' in body) ||
      !('status' in body) ||
      typeof body.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(body.id) ||
      (body.status !== 'done' && body.status !== 'declined')
    )
      throw new ServiceError(400, 'invalid_request');
    return json(await resolveBetaRequest(env, body.id, body.status));
  }
  throw new ServiceError(404, 'not_found');
}
