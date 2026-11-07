import { z } from 'zod';
import { ServiceError, triggerError } from './errors';

/** Every JSON API response. */
export const API_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;
/** Responses the website reads with credentials. */
export const ACCESS_HEADERS = { ...API_HEADERS, 'referrer-policy': 'no-referrer' } as const;
/** The private admin console and its API. */
export const ADMIN_HEADERS = { ...ACCESS_HEADERS, 'x-frame-options': 'DENY' } as const;

/** The admin console's policy: only its own nonce-tagged script and style run. */
export function adminCsp(nonce: string) {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; font-src data:; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

export function json(value: unknown, status = 200, headers: Record<string, string> = API_HEADERS) {
  return Response.json(value, { status, headers });
}

interface ErrorOptions {
  headers?: Record<string, string>;
  /** The code for an unexpected failure, reported as 503. */
  fallback?: string;
  /** `retry-after` seconds by status. */
  retryAfter?: Partial<Record<number, string>>;
  /** Log unexpected failures without their detail. */
  log?: boolean;
}

/** The `{ error }` response for anything a route throws. */
export function errorResponse(
  error: unknown,
  { headers = API_HEADERS, fallback = 'service_unavailable', retryAfter = {}, log }: ErrorOptions,
) {
  const known =
    error instanceof ServiceError
      ? error
      : error instanceof z.ZodError
        ? new ServiceError(400, 'invalid_request')
        : triggerError(error);
  const { status, code } = known ?? { status: 503, code: fallback };
  if (log && status >= 500 && !(error instanceof ServiceError))
    console.log(JSON.stringify({ event: 'service_error', code }));
  const retry = retryAfter[status];
  return json({ error: code }, status, retry ? { ...headers, 'retry-after': retry } : headers);
}
