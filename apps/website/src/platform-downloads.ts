import type { ReleaseBuild } from '@jackalope/contracts/access';
import { httpsUrl, type Platform, RELEASE_CHANNELS } from '@jackalope/contracts/platform';
import {
  cloudDownloadUrl,
  microsoftStoreUrl,
  RELEASE_DOWNLOADS,
  releaseDownloadsFor,
} from '@jackalope/contracts/release';

export interface PlatformDownload {
  id: Platform;
  name: string;
  detail: string;
  url: string | null;
  store: boolean;
}

/**
 * Public release CDN builds. Anyone can download them; the desktop account gate, not
 * the link, controls who can use the app. Signed-in members get equivalent links from
 * the access service so first downloads are recorded.
 */
export function publicReleaseBuilds(os: 'macos' | 'linux'): ReleaseBuild[] {
  return RELEASE_CHANNELS.flatMap((channel) =>
    releaseDownloadsFor(os).map((id) => ({
      id,
      label: RELEASE_DOWNLOADS[id].label,
      channel,
      url: cloudDownloadUrl(id, channel),
    })),
  );
}

export function detectDesktopPlatform({
  platform = '',
  userAgent = '',
  maxTouchPoints = 0,
}: {
  platform?: string;
  userAgent?: string;
  maxTouchPoints?: number;
}): Platform | null {
  if (/Android|iPhone|iPad|iPod|CrOS/i.test(userAgent + platform)) return null;
  if (/Mac/i.test(platform + userAgent) && maxTouchPoints > 1) return null;
  if (/Win/i.test(platform + userAgent)) return 'windows';
  if (/Mac/i.test(platform + userAgent)) return 'macos';
  if (/Linux/i.test(platform + userAgent)) return 'linux';
  return null;
}

export function platformDownloads(env: Record<string, string | undefined>): PlatformDownload[] {
  const definitions = [
    { id: 'windows', name: 'Windows', detail: 'Windows 10 or later · x64' },
    { id: 'macos', name: 'macOS', detail: 'For your Mac' },
    { id: 'linux', name: 'Linux', detail: 'For your Linux desktop' },
  ] as const;
  return definitions.map((platform) => {
    const storeUrl = platform.id === 'windows' ? env.VITE_WINDOWS_STORE_URL?.trim() : '';
    const key = `VITE_${platform.id.toUpperCase()}_DOWNLOAD_URL`;
    const value = storeUrl || env[key]?.trim();
    if (value) {
      if (!httpsUrl(value, { query: true, fragment: true }))
        throw new Error(`${key} must be a public HTTPS URL without credentials.`);
      if (storeUrl && !microsoftStoreUrl(storeUrl))
        throw new Error('VITE_WINDOWS_STORE_URL must be a plain Microsoft Store product link.');
      if (!storeUrl && !env.VITE_RELEASE_VERSION?.trim())
        throw new Error('Set VITE_RELEASE_VERSION when configuring a download.');
    }
    return { ...platform, url: value || null, store: Boolean(storeUrl) };
  });
}
