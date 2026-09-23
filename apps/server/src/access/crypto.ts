const encoder = new TextEncoder();
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}
export async function tokenHash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function encryptionKey(secret: string) {
  if (secret.length < 32) throw new Error('access_not_configured');
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encoder.encode(secret)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function seal(value: unknown, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(encrypted)))}`;
}
export async function unseal<T>(value: string, secret: string): Promise<T> {
  const [iv, ciphertext] = value
    .split('.')
    .map((part) => Uint8Array.from(atob(part), (c) => c.charCodeAt(0)));
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), ciphertext),
    ),
  ) as T;
}
