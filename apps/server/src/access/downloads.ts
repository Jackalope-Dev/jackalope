import type { ReleaseBuild } from '@jackalope/contracts/access';
import { isReleaseChannel, type ReleaseChannel } from '@jackalope/contracts/platform';
import {
  cloudDownloadUrl,
  microsoftStoreUrl,
  RELEASE_DOWNLOADS,
  type ReleaseDownload,
  releaseDownloadsFor,
} from '@jackalope/contracts/release';
import type { EmailDownload } from './mail-templates';

export function installerKey(env: Env) {
  const key = env.ACCESS_INSTALLER_KEY;
  return /^early-access\/v\d+\.\d+\.\d+\/[a-zA-Z0-9_.-]+\.exe$/.test(key) ? key : null;
}

export function storeUrl(env: Env) {
  return microsoftStoreUrl(env.ACCESS_STORE_URL);
}

function releaseChannels(value: string | undefined): ReleaseChannel[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((channel) => channel.trim())
        .filter(isReleaseChannel),
    ),
  ];
}
/**
 * The CrabNebula release channels macOS members may download, in the order the
 * website offers them; the first is the default.
 */
export function macChannels(env: Env) {
  return releaseChannels(env.ACCESS_MAC_CHANNELS);
}
/** The CrabNebula release channels Linux members may download, ordered like macOS. */
export function linuxChannels(env: Env) {
  return releaseChannels(env.ACCESS_LINUX_CHANNELS);
}
export function downloadChannels(env: Env, id: ReleaseDownload) {
  return RELEASE_DOWNLOADS[id].platform === 'linux' ? linuxChannels(env) : macChannels(env);
}

/** A member's macOS or Linux builds, served through `/v1/access/download/{id}/{channel}`. */
export function memberBuilds(
  env: Env,
  origin: string,
  platform: 'macos' | 'linux',
): ReleaseBuild[] {
  return (platform === 'linux' ? linuxChannels(env) : macChannels(env)).flatMap((channel) =>
    releaseDownloadsFor(platform).map((id) => ({
      id,
      label: RELEASE_DOWNLOADS[id].label,
      channel,
      url: `${origin}/v1/access/download/${id}/${channel}`,
    })),
  );
}

/**
 * Direct stable-channel downloads for approval emails. Installers are public on the
 * release CDN; the desktop account gate, not the link, controls who can run tasks.
 */
export function stableDownloads(env: Env): EmailDownload[] {
  const store = storeUrl(env);
  return [
    ...(store ? [{ label: 'Windows (Microsoft Store)', url: store }] : []),
    ...(macChannels(env).includes('stable')
      ? releaseDownloadsFor('macos').map((id) => ({
          label: `macOS (${RELEASE_DOWNLOADS[id].label})`,
          url: cloudDownloadUrl(id, 'stable'),
        }))
      : []),
    ...(linuxChannels(env).includes('stable')
      ? releaseDownloadsFor('linux').map((id) => ({
          label: 'Linux (AppImage)',
          url: cloudDownloadUrl(id, 'stable'),
        }))
      : []),
  ];
}
