/** The most a file secret can hold, matching the native limit. An App Store Connect key is about 250 bytes. */
export const FILE_SECRET_MAX_BYTES = 64 * 1024;

/** A file secret's text and the name of the file it came from, if it was picked rather than pasted. */
export interface SecretFileValue {
  text: string;
  fileName: string | null;
}

/** Why `text` cannot be saved as a file secret, or an empty string when it can. */
export function fileSecretError(text: string) {
  if (!text.trim()) return 'Choose a file or paste its contents.';
  if (new TextEncoder().encode(text).length > FILE_SECRET_MAX_BYTES)
    return 'Files are limited to 64 KB.';
  if (text.includes('\0')) return 'Files must be text, such as a .p8 or .pem key.';
  return '';
}

/** A picked file's name as native storage accepts it: letters, digits, dots, dashes and underscores. */
export function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || null;
}

/** The key ID in an App Store Connect key's file name, such as `AuthKey_ABC123XYZ9.p8`. */
export function keyIdFromFileName(name: string | null | undefined) {
  return /^AuthKey_([A-Z0-9]{10})\.p8$/i.exec(name?.trim() ?? '')?.[1]?.toUpperCase() ?? '';
}
