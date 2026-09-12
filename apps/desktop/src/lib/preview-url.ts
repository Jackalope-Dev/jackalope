export function previewUrl(port: number, path: string): string | null {
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.length > 2000 ||
    /[\\\p{Cc}]/u.test(path)
  )
    return null;

  try {
    const origin = `http://127.0.0.1:${port}`;
    // Preserve existing percent escapes while encoding literal URL metacharacters.
    const encoded = encodeURI(path).replace(/%25([\da-f]{2})/gi, '%$1');
    const url = new URL(encoded, origin);
    return url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}
