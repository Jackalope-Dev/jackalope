import { ServiceError } from '../errors';

/** Signup sends email to the address it is given, so it proves a person submitted it. */
export const SIGNUP_ACTION = 'signup';

/**
 * Checks a Turnstile token with Siteverify when `TURNSTILE_SECRET` is set; an
 * unset secret leaves the endpoint unchanged. A configured check fails closed
 * on a missing token, a network or response failure, the wrong action, or a
 * hostname other than the configured website's.
 */
export async function verifyTurnstile(
  env: Env & { TURNSTILE_SECRET?: string },
  token: string | undefined,
  remoteip: string | null,
  action: string,
  fetcher: typeof fetch = fetch,
) {
  const secret = env.TURNSTILE_SECRET?.trim();
  if (!secret) return;
  const rejected = new ServiceError(403, 'verification_failed');
  if (!token || token.length > 2048) throw rejected;
  let result: { success?: unknown; action?: unknown; hostname?: unknown };
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteip ? { remoteip } : {}),
      }),
    });
    if (!response.ok) throw rejected;
    result = await response.json();
  } catch {
    throw rejected;
  }
  if (
    result.success !== true ||
    result.action !== action ||
    result.hostname !== new URL(env.ACCESS_WEB_ORIGIN).hostname
  )
    throw rejected;
}
