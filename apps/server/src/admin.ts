import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { accessAdmin } from './access/admin';
import { adminPage } from './admin-page';

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
const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};
export async function admin(
  request: Request,
  env: Env,
  readJson: (request: Request) => Promise<unknown>,
) {
  if (!(await authorizeAdmin(request, env)))
    return Response.json({ error: 'admin_access_required' }, { status: 403, headers });
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
  if (request.method === 'GET' && url.pathname === '/admin') {
    const nonce = crypto.randomUUID();
    return new Response(adminPage(nonce), {
      headers: {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; font-src data:; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/overview') {
    const days = Number(url.searchParams.get('days') ?? 7);
    const channel = url.searchParams.get('channel') ?? 'all';
    const version = url.searchParams.get('version') ?? '';
    if (
      ![7, 30].includes(days) ||
      !['all', 'stable', 'beta'].includes(channel) ||
      !/^$|^\d+\.\d+\.\d+$/.test(version) ||
      version.length > 32
    )
      return Response.json({ error: 'invalid_filter' }, { status: 400, headers });
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const metrics = await env.DB.prepare(
      "SELECT day,version,channel,os,name,dimension,count FROM metrics WHERE day>=? AND (?='all' OR channel=?) AND (?='' OR version=?) ORDER BY day DESC,version LIMIT 10001",
    )
      .bind(since, channel, channel, version, version)
      .all();
    const versions = await env.DB.prepare(
      'SELECT DISTINCT version FROM metrics ORDER BY version DESC LIMIT 100',
    ).all();
    return Response.json(
      {
        metrics: metrics.results.slice(0, 10000),
        truncated: metrics.results.length > 10000,
        versions: versions.results,
        ingestionEnabled: env.INGESTION_ENABLED === 'true',
        emailEnabled: env.FEEDBACK_EMAIL_ENABLED === 'true',
        retentionDays: env.TELEMETRY_DAYS,
        coverage:
          'Event counts from participating installations, not unique users, retention, or all crashes. Public ingestion is rate-limited but cannot prove authentic clients.',
      },
      { headers },
    );
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
    return Response.json({ people, feedback: feedback.results, mail }, { headers });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/feedback') {
    const status = url.searchParams.get('status') ?? 'new';
    const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
    if (
      !['new', 'reviewing', 'planned', 'closed', 'all'].includes(status) ||
      !Number.isSafeInteger(before) ||
      before < 0
    )
      return Response.json({ error: 'invalid_filter' }, { status: 400, headers });
    const rows = await env.DB.prepare(
      "SELECT rowid AS cursor,id,received_at,payload,status,email_state,email_attempts FROM feedback WHERE expires_at>? AND rowid<? AND (?='all' OR status=?) ORDER BY rowid DESC LIMIT 50",
    )
      .bind(Date.now(), before, status, status)
      .all();
    return Response.json({ reports: rows.results }, { headers });
  }
  if (request.method === 'POST' && url.pathname === '/admin/api/feedback') {
    if (request.headers.get('origin') !== url.origin)
      return Response.json({ error: 'origin_required' }, { status: 403, headers });
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
      return Response.json({ error: 'invalid_request' }, { status: 400, headers });
    const result = await env.DB.prepare('UPDATE feedback SET status=? WHERE id=? AND expires_at>?')
      .bind(body.status, body.id, Date.now())
      .run();
    return Response.json({ updated: result.meta.changes === 1 }, { headers });
  }
  return Response.json({ error: 'not_found' }, { status: 404, headers });
}
