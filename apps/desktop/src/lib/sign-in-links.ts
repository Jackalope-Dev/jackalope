import type { IBuffer } from '@xterm/xterm';

export function signInUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function isClaudeAuthorizationUrl(value: string): boolean {
  const safe = signInUrl(value);
  if (!safe) return false;
  const url = new URL(safe);
  return (
    ['claude.ai', 'console.anthropic.com', 'platform.claude.com'].includes(url.hostname) &&
    url.port === '' &&
    url.pathname === '/oauth/authorize'
  );
}

export function terminalSignInLinks(buffer: IBuffer): string[] {
  const links = new Set<string>();
  let text = '';
  // Only completed logical lines are safe to open: a poll can split a URL anywhere.
  for (let row = 0; row < buffer.baseY + buffer.cursorY; row++) {
    const wrapped = buffer.getLine(row + 1)?.isWrapped;
    text += buffer.getLine(row)?.translateToString(!wrapped) ?? '';
    if (wrapped) continue;
    for (const match of text.matchAll(/https:\/\/[^\s<>"']+/g)) {
      const url = signInUrl(match[0]);
      if (url) links.add(url);
    }
    text = '';
  }
  return [...links];
}
