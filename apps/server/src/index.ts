import { feedbackSchema, telemetrySchema } from './contracts';
import { prune, saveFeedback, saveTelemetry } from './storage';

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
async function readJson(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
  )
    throw new ApiError(415, 'json_required');
  if (request.headers.has('content-encoding')) throw new ApiError(415, 'encoding_not_supported');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 32768))
    throw new ApiError(413, 'payload_too_large');
  if (!request.body) throw new ApiError(400, 'invalid_request');
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
          if (size > 32768) throw new ApiError(413, 'payload_too_large');
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
          throw new ApiError(400, 'invalid_request');
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ApiError(408, 'request_timeout')), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
async function limit(request: Request, env: Env, feedback: boolean) {
  if (!env.RATE_SECRET || env.RATE_SECRET.length < 32)
    throw new ApiError(503, 'service_not_configured');
  if (!(await env.GLOBAL_LIMITER.limit({ key: 'ingestion' })).success)
    throw new ApiError(429, 'rate_limited');
  const address = request.headers.get('cf-connecting-ip');
  if (!address && env.ENVIRONMENT !== 'local') throw new ApiError(403, 'edge_identity_required');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.RATE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const hash = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${Math.floor(Date.now() / 86400000)}:${address ?? 'local'}`),
  );
  const peer = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  if (
    !(await env.IP_LIMITER.limit({ key: peer })).success ||
    (feedback && !(await env.FEEDBACK_LIMITER.limit({ key: peer })).success)
  )
    throw new ApiError(429, 'rate_limited');
}
async function release(request: Request, env: Env, path: string): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) throw new ApiError(405, 'method_not_allowed');
  let key = path.slice('/updates/'.length);
  const mutable = !key.startsWith('releases/');
  const alias = /^(stable|beta)\/(releases\.json|feed\.xml)$/.exec(key);
  if (alias) {
    const pointer = await env.RELEASES.get(`${alias[1]}/latest.json`);
    if (!pointer) throw new ApiError(404, 'not_found');
    if (pointer.size > 65536) {
      await pointer.body.cancel();
      throw new ApiError(503, 'invalid_release');
    }
    const metadata = await pointer.json<{ catalog?: string }>();
    const match = /^releases\/(beta\/)?v(\d+\.\d+\.\d+)\/catalog\.json$/.exec(
      metadata.catalog ?? '',
    );
    if (!match || Boolean(match[1]) !== (alias[1] === 'beta'))
      throw new ApiError(503, 'invalid_release');
    key =
      alias[2] === 'releases.json'
        ? (metadata.catalog as string)
        : (metadata.catalog as string).replace('catalog.json', 'feed.xml');
  }
  if (
    !/^(?:(?:stable|beta)\/latest\.json|releases\/(?:beta\/)?v(\d+\.\d+\.\d+)\/(?:Jackalope_\1_x64(?:-setup\.exe|_en-US\.msi)(?:\.sig)?|checksums\.json|latest\.json|catalog\.json|feed\.xml))$/.test(
      key,
    )
  )
    throw new ApiError(404, 'not_found');
  const object = await env.RELEASES.get(key);
  if (!object) throw new ApiError(404, 'not_found');
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
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.search) throw new ApiError(400, 'query_not_allowed');
      if (url.pathname.startsWith('/updates/')) return await release(request, env, url.pathname);
      if (request.method === 'GET' && url.pathname === '/healthz') return json({ status: 'ok' });
      if (request.method === 'GET' && url.pathname === '/readyz') {
        const data = await env.DB.prepare('SELECT count(*) AS count FROM quotas').first<{
          count: number;
        }>();
        if (data?.count !== 2 || env.RATE_SECRET?.length < 32 || !env.RATE_SECRET)
          throw new ApiError(503, 'service_not_configured');
        return json({
          status: 'ready',
          schemaVersion: 1,
          ingestionEnabled: env.INGESTION_ENABLED === 'true',
        });
      }
      if (!['/v1/telemetry', '/v1/feedback'].includes(url.pathname))
        throw new ApiError(404, 'not_found');
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
      if (env.INGESTION_ENABLED !== 'true') throw new ApiError(503, 'ingestion_disabled');
      if (request.headers.has('origin')) throw new ApiError(403, 'browser_origin_not_allowed');
      await limit(request, env, url.pathname === '/v1/feedback');
      const body = await readJson(request);
      if (url.pathname === '/v1/telemetry') {
        const parsed = telemetrySchema.safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'invalid_request');
        return json(await saveTelemetry(env, parsed.data), 202);
      }
      const parsed = feedbackSchema.safeParse(body);
      if (!parsed.success) throw new ApiError(400, 'invalid_request');
      return json(await saveFeedback(env, parsed.data), 202);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      const code =
        error instanceof ApiError
          ? error.code
          : detail.includes('id_conflict')
            ? 'id_conflict'
            : detail.includes('storage_capacity')
              ? 'storage_capacity'
              : 'service_unavailable';
      const status = error instanceof ApiError ? error.status : code === 'id_conflict' ? 409 : 503;
      if (status >= 500 && !(error instanceof ApiError))
        console.log(JSON.stringify({ event: 'service_error', code }));
      const response = json({ error: code }, status);
      if (
        new URL(request.url).pathname.startsWith('/updates/') &&
        ['GET', 'HEAD'].includes(request.method)
      )
        response.headers.set('access-control-allow-origin', '*');
      if (status === 429 || status === 503)
        response.headers.set('retry-after', status === 429 ? '60' : '300');
      return response;
    }
  },
  async scheduled(_controller, env) {
    try {
      console.log(JSON.stringify({ event: 'retention_complete', ...(await prune(env)) }));
    } catch {
      console.log(JSON.stringify({ event: 'retention_failed' }));
      throw new Error('retention_failed');
    }
  },
} satisfies ExportedHandler<Env>;
