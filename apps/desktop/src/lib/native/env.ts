export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/** Whether `url` opens a macOS System Settings pane. */
export const isSystemSettingsLink = (url: string) => url.startsWith('x-apple.systempreferences:');

/** Opens a URL in the system browser, rejecting when the desktop opener fails. */
export async function openInBrowser(url: string): Promise<void> {
  if (!isTauriEnvironment()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (isSystemSettingsLink(url)) {
    // The opener plugin's scope allows only web links; the native side checks the pane.
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('desktop_control_open_settings_link', { url });
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

/** Shows a file or folder in the system file manager (Finder, Explorer or Files). */
export async function revealInFileManager(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

/** The file manager's name for menu labels. */
export function fileManagerName(platform = globalThis.navigator?.platform ?? ''): string {
  if (/Mac/i.test(platform)) return 'Finder';
  if (/Win/i.test(platform)) return 'Explorer';
  return 'Files';
}
