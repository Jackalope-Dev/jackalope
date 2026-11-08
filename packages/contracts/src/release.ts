import { httpsUrl, type Platform, type ReleaseChannel, SEMVER } from './platform.ts';

/**
 * Where desktop releases are built, named and downloaded from. The release
 * scripts, the access service and the website all read this module.
 */

/** CrabNebula Cloud targets, as `{os}-{arch}` in Tauri updater terms. */
export const CLOUD_TARGETS = {
  'windows-x86_64': { platform: 'windows', arch: 'x86_64', cdnPlatform: 'nsis-x86_64' },
  'darwin-aarch64': {
    platform: 'macos',
    arch: 'aarch64',
    cdnPlatform: 'dmg-aarch64',
    label: 'Apple silicon',
  },
  'darwin-x86_64': { platform: 'macos', arch: 'x86_64', cdnPlatform: 'dmg-x86_64', label: 'Intel' },
  'linux-x86_64': {
    platform: 'linux',
    arch: 'x86_64',
    cdnPlatform: 'appimage-x86_64',
    label: 'x64 AppImage',
  },
} as const satisfies Record<
  string,
  { platform: Platform; arch: string; cdnPlatform: string; label?: string }
>;
export type CloudTarget = keyof typeof CLOUD_TARGETS;
export const cloudTargets = Object.keys(CLOUD_TARGETS) as CloudTarget[];

export function isCloudTarget(value: unknown): value is CloudTarget {
  return Object.hasOwn(CLOUD_TARGETS, value as string);
}

/**
 * macOS and Linux builds served from the release CDN, keyed by the id the
 * website and `/v1/access/download/{id}/{channel}` use. Windows ships through
 * Microsoft Store instead.
 */
export const RELEASE_DOWNLOADS = {
  'macos-aarch64': CLOUD_TARGETS['darwin-aarch64'],
  'macos-x86_64': CLOUD_TARGETS['darwin-x86_64'],
  'linux-x86_64': CLOUD_TARGETS['linux-x86_64'],
} as const;
export type ReleaseDownload = keyof typeof RELEASE_DOWNLOADS;
export const releaseDownloads = Object.keys(RELEASE_DOWNLOADS) as ReleaseDownload[];

export function releaseDownloadsFor(platform: Platform): ReleaseDownload[] {
  return releaseDownloads.filter((id) => RELEASE_DOWNLOADS[id].platform === platform);
}

export const CLOUD_APPLICATION = 'jackalope-digital/jackalope';
export const CLOUD_ORIGIN = 'https://cdn.crabnebula.app';

/** The latest public build of `id` on `channel`. */
export function cloudDownloadUrl(id: ReleaseDownload, channel: ReleaseChannel) {
  return `${CLOUD_ORIGIN}/download/${CLOUD_APPLICATION}/latest/platform/${RELEASE_DOWNLOADS[id].cdnPlatform}?channel=${channel}`;
}

/** The Tauri updater endpoint for `channel`; Tauri fills the `{{...}}` fields. */
export function cloudUpdateEndpoint(channel: ReleaseChannel) {
  return `${CLOUD_ORIGIN}/update/${CLOUD_APPLICATION}/{{target}}-{{arch}}/{{current_version}}?channel=${channel}`;
}

/** The update manifest Cloud serves to `target` running `current`. */
export function cloudUpdateUrl(target: string, channel: ReleaseChannel, current = '0.0.0') {
  return `${CLOUD_ORIGIN}/update/${CLOUD_APPLICATION}/${target}/${current}?channel=${channel}`;
}

export function windowsInstallerName(version: string, product = 'Jackalope') {
  return `${product}_${version}_x64-setup.exe`;
}
export function windowsMsiName(version: string, product = 'Jackalope') {
  return `${product}_${version}_x64_en-US.msi`;
}

/**
 * The R2 folder of one release. Its files are immutable; `{channel}/latest.json`
 * points at the current one.
 */
export function releasePrefix(version: string, channel: ReleaseChannel) {
  if (!SEMVER.test(version) || version.length > 32)
    throw new Error('Version must be major.minor.patch');
  return `releases/${channel === 'beta' ? 'beta/' : ''}v${version}`;
}

/** Keys `/updates/` may serve: the channel pointers and each release's known files. */
export const RELEASE_KEY =
  /^(?:(?:stable|beta)\/latest\.json|releases\/(?:beta\/)?v(\d+\.\d+\.\d+)\/(?:Jackalope_\1_x64(?:-setup\.exe|_en-US\.msi)(?:\.sig)?|checksums\.json|latest\.json|catalog\.json|feed\.xml))$/;
/** A release catalog key, capturing the beta folder and the version. */
export const CATALOG_KEY = /^releases\/(beta\/)?v(\d+\.\d+\.\d+)\/catalog\.json$/;

/** One entry of a release's `catalog.json`, newest first. */
export interface PublishedRelease {
  version: string;
  /** ISO timestamp of the release date. */
  date: string;
  notes: string;
}

export const MICROSOFT_STORE_PRODUCT_ID = '9NM89QFJQ244';
export const MICROSOFT_STORE_URL = `https://apps.microsoft.com/detail/${MICROSOFT_STORE_PRODUCT_ID}`;

/**
 * `value` when it is a Microsoft Store product link, else null. Store share
 * links carry locale query parameters, so a query string is allowed.
 */
export function microsoftStoreUrl(value: string | undefined): string | null {
  const url = value ? httpsUrl(value, { query: true }) : null;
  if (!url || url.port) return null;
  const path =
    url.hostname === 'apps.microsoft.com'
      ? /^\/detail\/[a-z0-9]{12}\/?$/i
      : url.hostname === 'www.microsoft.com'
        ? /^\/store\/apps\/[a-z0-9]{12}\/?$/i
        : null;
  return path?.test(url.pathname) ? url.href : null;
}
