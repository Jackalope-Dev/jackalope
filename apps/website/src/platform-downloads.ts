export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export interface PlatformDownload {
  id: DesktopPlatform;
  name: string;
  detail: string;
  url: string | null;
  store: boolean;
}

export interface ReleaseBuild {
  id: string;
  label: string;
  channel: 'stable' | 'beta';
  url: string;
}

const releaseCdn =
  'https://cdn.crabnebula.app/download/jackalope-digital/jackalope/latest/platform';
const releasePlatforms = {
  macos: [
    { id: 'macos-aarch64', label: 'Apple silicon', platform: 'dmg-aarch64' },
    { id: 'macos-x86_64', label: 'Intel', platform: 'dmg-x86_64' },
  ],
  linux: [{ id: 'linux-x86_64', label: 'x64 AppImage', platform: 'appimage-x86_64' }],
} as const;

/**
 * Public release CDN builds. Anyone can download them; the desktop account gate, not
 * the link, controls who can use the app. Signed-in members get equivalent links from
 * the access service so first downloads are recorded.
 */
export function publicReleaseBuilds(os: keyof typeof releasePlatforms): ReleaseBuild[] {
  return (['stable', 'beta'] as const).flatMap((channel) =>
    releasePlatforms[os].map(({ id, label, platform }) => ({
      id,
      label,
      channel,
      url: `${releaseCdn}/${platform}?channel=${channel}`,
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
}): DesktopPlatform | null {
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
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error(`${key} must be a public HTTPS URL without credentials.`);
      if (
        storeUrl &&
        !(
          (url.hostname === 'apps.microsoft.com' &&
            /^\/detail\/[A-Z0-9]{12}$/i.test(url.pathname)) ||
          (url.hostname === 'www.microsoft.com' &&
            /^\/store\/apps\/[A-Z0-9]{12}$/i.test(url.pathname))
        )
      )
        throw new Error('VITE_WINDOWS_STORE_URL must be a Microsoft Store product link.');
      if (storeUrl && (url.port || url.search || url.hash))
        throw new Error('VITE_WINDOWS_STORE_URL must be a plain Microsoft Store product link.');
      if (!storeUrl && !env.VITE_RELEASE_VERSION?.trim())
        throw new Error('Set VITE_RELEASE_VERSION when configuring a download.');
    }
    return { ...platform, url: value || null, store: Boolean(storeUrl) };
  });
}
