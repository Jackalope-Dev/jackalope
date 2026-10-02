/** Constant-time comparison so response timing does not reveal the token. */
export async function authorized(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get('Authorization') ?? '';
  // Browsers cannot set headers on WebSockets, so the token may arrive as a subprotocol.
  const protocol = (request.headers.get('Sec-WebSocket-Protocol') ?? '')
    .split(',')
    .map((value) => value.trim())
    .find((value) => value.startsWith('swarm.'));
  const presented = header.startsWith('Bearer ') ? header.slice(7) : (protocol?.slice(6) ?? '');
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
