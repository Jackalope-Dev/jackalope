import { SEMVER } from '../../../packages/contracts/src/platform.ts';
import { releasePrefix, windowsInstallerName } from '../../../packages/contracts/src/release.ts';

export const releaseService = 'https://api.jackalope.dev';

/**
 * The stable release the update service publishes, as the website's download
 * environment. Nothing published yet (404) leaves the website in its prerelease
 * state; anything else unexpected fails, so a build never drops a live download.
 */
export async function readPublicRelease({ fetcher = fetch, bootstrap = false } = {}) {
  const response = await fetcher(`${releaseService}/updates/stable/latest.json`, {
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
    headers: { 'cache-control': 'no-cache' },
  }).catch((error) => {
    if (bootstrap) return new Response(null, { status: 404 });
    throw error;
  });
  if (response.status === 404) return {};
  if (!response.ok)
    throw new Error(
      'Cannot read published release; refusing to remove website download configuration',
    );
  const manifest = await response.json();
  if (!SEMVER.test(manifest.version) || manifest.version.length > 32)
    throw new Error('Version must be major.minor.patch');
  const download = manifest.platforms?.['windows-x86_64-nsis']?.url;
  if (
    download !==
    `${releaseService}/updates/${releasePrefix(manifest.version, 'stable')}/${windowsInstallerName(manifest.version)}`
  )
    throw new Error('Invalid published installer URL');
  return { VITE_RELEASE_VERSION: manifest.version, VITE_WINDOWS_DOWNLOAD_URL: download };
}
