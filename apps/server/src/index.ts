import { CATALOG_KEY, RELEASE_KEY } from '@jackalope/contracts/release';
import { deviceRoutes } from './access/devices';
import { pruneFeedbackInvitations } from './access/feedback';
import { deliverAccessMail } from './access/mail';
import { syncNewsletter } from './access/newsletter';
import { accessRoutes } from './access/routes';
import { pruneAccess } from './access/service';
import { admin } from './admin';
import { feedbackSchema, telemetrySchema } from './contracts';
import { ServiceError } from './errors';
import { deliverFeedback } from './feedback-mail';
import { lopebase, lopebasePath } from './lopebase';
import { limit } from './rate-limit';
import { API_HEADERS, errorResponse, json, SERVICE_ERRORS } from './respond';
import { prune, saveFeedback, saveTelemetry } from './storage';

/** Rows the ingestion migrations create; storage guards need every one. */
const REQUIRED_QUOTAS = ['events', 'feedback', 'telemetry_receipts', 'metrics'];

async function readJson(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
  )
    throw new ServiceError(415, 'json_required');
  if (request.headers.has('content-encoding'))
    throw new ServiceError(415, 'encoding_not_supported');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 32768))
    throw new ServiceError(413, 'payload_too_large');
  if (!request.body) throw new ServiceError(400, 'invalid_request');
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 32768) throw new ServiceError(413, 'payload_too_large');
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        try {
          return JSON.parse(
            new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
          );
        } catch {
          throw new ServiceError(400, 'invalid_request');
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ServiceError(408, 'request_timeout')), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
async function release(request: Request, env: Env, path: string): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) throw new ServiceError(405, 'method_not_allowed');
  let key = path.slice('/updates/'.length);
  const mutable = !key.startsWith('releases/');
  const alias = /^(stable|beta)\/(releases\.json|feed\.xml)$/.exec(key);
  if (alias) {
    const pointer = await env.RELEASES.get(`${alias[1]}/latest.json`);
    if (!pointer) throw new ServiceError(404, 'not_found');
    if (pointer.size > 65536) {
      await pointer.body.cancel();
      throw new ServiceError(503, 'invalid_release');
    }
    const metadata = await pointer.json<{ catalog?: string }>();
    const match = CATALOG_KEY.exec(metadata.catalog ?? '');
    if (!match || Boolean(match[1]) !== (alias[1] === 'beta'))
      throw new ServiceError(503, 'invalid_release');
    key =
      alias[2] === 'releases.json'
        ? (metadata.catalog as string)
        : (metadata.catalog as string).replace('catalog.json', 'feed.xml');
  }
  if (!RELEASE_KEY.test(key)) throw new ServiceError(404, 'not_found');
  const object = await env.RELEASES.get(key);
  if (!object) throw new ServiceError(404, 'not_found');
  const headers = new Headers({
    etag: object.httpEtag,
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'cache-control': mutable
      ? 'public, max-age=60, must-revalidate'
      : 'public, max-age=31536000, immutable',
    'content-length': String(object.size),
    'content-type': key.endsWith('.xml')
      ? 'application/rss+xml; charset=utf-8'
      : key.endsWith('.json')
        ? 'application/json'
        : key.endsWith('.sig')
          ? 'text/plain'
          : 'application/octet-stream',
  });
  if (request.headers.get('if-none-match') === object.httpEtag) {
    await object.body.cancel();
    headers.delete('content-length');
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'HEAD') {
    await object.body.cancel();
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}
export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/v1/desktop/'))
        return await deviceRoutes(request, env, readJson, (group) => limit(request, env, group));
      if (url.pathname.startsWith('/v1/access/'))
        return await accessRoutes(
          request,
          env,
          readJson,
          (group) => limit(request, env, group),
          ctx,
        );
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        const response = await admin(request, env, readJson);
        if (response.ok && request.method === 'POST' && ctx) ctx.waitUntil(deliverAccessMail(env));
        return response;
      }
      if (url.pathname === lopebasePath || url.pathname.startsWith(`${lopebasePath}/`)) {
        const adapter = lopebase(env);
        if (!adapter) throw new ServiceError(404, 'not_found');
        return await adapter.handle(request);
      }
      if (url.search) throw new ServiceError(400, 'query_not_allowed');
      if (url.pathname.startsWith('/updates/')) return await release(request, env, url.pathname);
      if (request.method === 'GET' && url.pathname === '/healthz') return json({ status: 'ok' });
      if (request.method === 'GET' && url.pathname === '/readyz') {
        const quotas = await env.DB.prepare('SELECT name FROM quotas').all<{ name: string }>();
        const names = new Set(quotas.results.map((row) => row.name));
        if (
          !REQUIRED_QUOTAS.every((name) => names.has(name)) ||
          env.RATE_SECRET?.length < 32 ||
          !env.RATE_SECRET
        )
          throw new ServiceError(503, 'service_not_configured');
        return json({
          status: 'ready',
          schemaVersion: 2,
          ingestionEnabled: env.INGESTION_ENABLED === 'true',
        });
      }
      if (['/v1/telemetry', '/v1/feedback'].includes(url.pathname))
        throw new ServiceError(410, 'client_upgrade_required');
      if (!['/v2/telemetry', '/v2/feedback'].includes(url.pathname))
        throw new ServiceError(404, 'not_found');
      if (request.method !== 'POST') throw new ServiceError(405, 'method_not_allowed');
      if (env.INGESTION_ENABLED !== 'true') throw new ServiceError(503, 'ingestion_disabled');
      if (request.headers.has('origin')) throw new ServiceError(403, 'browser_origin_not_allowed');
      await limit(request, env, url.pathname === '/v2/feedback' ? 'feedback' : 'telemetry');
      const body = await readJson(request);
      if (url.pathname === '/v2/telemetry') {
        const parsed = telemetrySchema.safeParse(body);
        if (!parsed.success) throw new ServiceError(400, 'invalid_request');
        return json(await saveTelemetry(env, parsed.data), 202);
      }
      const parsed = feedbackSchema.safeParse(body);
      if (!parsed.success) throw new ServiceError(400, 'invalid_request');
      const result = await saveFeedback(env, parsed.data);
      if (ctx) ctx.waitUntil(deliverFeedback(env).catch(() => undefined));
      return json(result, 202);
    } catch (error) {
      const { pathname } = new URL(request.url);
      return errorResponse(error, {
        headers:
          pathname.startsWith('/updates/') && ['GET', 'HEAD'].includes(request.method)
            ? { ...API_HEADERS, 'access-control-allow-origin': '*' }
            : API_HEADERS,
        ...SERVICE_ERRORS,
      });
    }
  },
  async scheduled(_controller, env) {
    try {
      if (env.EARLY_ACCESS_ENABLED === 'true') {
        await Promise.all([deliverAccessMail(env), syncNewsletter(env)]);
        await pruneAccess(env);
        await pruneFeedbackInvitations(env);
      }
      await deliverFeedback(env);
      console.log(JSON.stringify({ event: 'retention_complete', ...(await prune(env)) }));
    } catch {
      console.log(JSON.stringify({ event: 'retention_failed' }));
      throw new Error('retention_failed');
    }
  },
} satisfies ExportedHandler<Env>;
