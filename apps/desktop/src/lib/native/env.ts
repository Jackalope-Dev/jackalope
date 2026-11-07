export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/** Opens a URL in the system browser, rejecting when the desktop opener fails. */
export async function openInBrowser(url: string): Promise<void> {
  if (!isTauriEnvironment()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

/** Like openInBrowser, but falls back to a webview window instead of failing. */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await openInBrowser(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
