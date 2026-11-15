import { ServiceError } from './errors';

/**
 * Rate limit groups. Every request counts against its address; `strict` groups
 * (mail, desktop links, feedback) also use the tighter per-address limiter, and
 * `shared` names the service-wide bucket. Paired desktops poll their session
 * every minute, already bounded per address, so a shared cap on that group
 * would lock every desktop out as installs grow.
 */
const RATE_GROUPS = {
  'desktop-link': { strict: true, shared: 'desktop-link' },
  'desktop-session': { strict: false, shared: null },
  'access-mail': { strict: true, shared: 'access-mail' },
  'access-session': { strict: false, shared: 'access-session' },
  telemetry: { strict: false, shared: 'ingestion' },
  feedback: { strict: true, shared: 'ingestion' },
} as const;
export type RateGroup = keyof typeof RATE_GROUPS;

export async function limit(request: Request, env: Env, group: RateGroup) {
  if (!env.RATE_SECRET || env.RATE_SECRET.length < 32)
    throw new ServiceError(503, 'service_not_configured');
  const address = request.headers.get('cf-connecting-ip');
  if (!address && env.ENVIRONMENT !== 'local')
    throw new ServiceError(403, 'edge_identity_required');
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
  const { strict, shared } = RATE_GROUPS[group];
  if (
    !(await env.IP_LIMITER.limit({ key: peer })).success ||
    (strict && !(await env.FEEDBACK_LIMITER.limit({ key: peer })).success) ||
    (shared && !(await env.GLOBAL_LIMITER.limit({ key: shared })).success)
  )
    throw new ServiceError(429, 'rate_limited');
}
