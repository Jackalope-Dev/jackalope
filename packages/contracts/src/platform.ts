export const PLATFORMS = ['windows', 'macos', 'linux'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const RELEASE_CHANNELS = ['stable', 'beta'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/** A release version: plain major.minor.patch, no prerelease or build suffix. */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isPlatform(value: unknown): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

export function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return RELEASE_CHANNELS.includes(value as ReleaseChannel);
}

/**
 * The URL when `value` is HTTPS without credentials, else null. Each option
 * allows one more part that a plain origin or path link must not carry.
 */
export function httpsUrl(
  value: string,
  { path = true, query = false, fragment = false } = {},
): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if ((!path && url.pathname !== '/') || (!query && url.search) || (!fragment && url.hash))
    return null;
  return url;
}
