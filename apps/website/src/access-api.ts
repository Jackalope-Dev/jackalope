const configured = import.meta.env.VITE_ACCESS_API?.trim() || '';
export const accessOrigin = configured ? new URL(configured).origin : '';
if (configured && (accessOrigin !== configured || !/^https:\/\//.test(configured))) {
  throw new Error('VITE_ACCESS_API must be an HTTPS origin');
}
export class AccessRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function accessRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!accessOrigin) throw new AccessRequestError(503, 'access_not_available');
  const response = await fetch(`${accessOrigin}/v1/access/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new AccessRequestError(response.status, result.error || 'access_unavailable');
  return result;
}
export function accessMessage(error: unknown) {
  if (error instanceof AccessRequestError) {
    if (error.status === 429) return 'Please wait a minute before trying again.';
    if (error.code === 'invitation_full')
      return 'This invitation has no places available. Request another invitation or join the waitlist.';
    if (error.code === 'link_expired')
      return 'This link has expired or has already been used. Request a fresh link below.';
    if (error.code === 'invitation_not_resendable')
      return 'Please wait a minute before resending. Expired invitations can be sent again as a new invitation.';
    if (error.status === 401)
      return 'Your sign-in has expired. Refresh the page to request a new link.';
    if (error.status === 400) return 'Check the email addresses and try again.';
  }
  return 'Couldn’t connect. Please try again.';
}
