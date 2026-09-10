export function mcpEndpointError(value: string): string | undefined {
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
    if (!url.username && !url.password && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && local))) return;
  } catch {}
  return 'Use an HTTPS endpoint. HTTP is only allowed on this computer (localhost or a loopback IP), without URL credentials or fragments.';
}
