import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, version } from './catalog.mjs';

export async function readPublicRelease({ fetcher = fetch, bootstrap = false } = {}) {
  const base = 'https://api.jackalope.dev';
  const response = await fetcher(`${base}/updates/stable/latest.json`, {
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
  version(manifest.version);
  const download = manifest.platforms?.['windows-x86_64-nsis']?.url;
  if (
    download !==
    `${base}/updates/releases/v${manifest.version}/Jackalope_${manifest.version}_x64-setup.exe`
  )
    throw new Error('Invalid published installer URL');
  return { VITE_RELEASE_VERSION: manifest.version, VITE_WINDOWS_DOWNLOAD_URL: download };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const build = process.argv[2] === 'build';
  if (!build || process.env.SYNC_PUBLIC_RELEASE === 'true') {
    const values = await readPublicRelease({
      bootstrap: process.env.RELEASE_SERVICE_BOOTSTRAP === 'true',
    });
    delete process.env.VITE_RELEASE_VERSION;
    delete process.env.VITE_WINDOWS_DOWNLOAD_URL;
    Object.assign(process.env, values);
    if (process.env.GITHUB_ENV)
      await appendFile(
        process.env.GITHUB_ENV,
        Object.entries({ VITE_RELEASE_VERSION: '', VITE_WINDOWS_DOWNLOAD_URL: '', ...values })
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
      );
    console.log(
      values.VITE_RELEASE_VERSION
        ? `Website uses published release ${values.VITE_RELEASE_VERSION}`
        : 'Website retains its prerelease state',
    );
  }
  if (build) {
    const website = resolve(root, 'apps/website');
    for (const args of [
      ['node_modules/typescript/bin/tsc', '-b'],
      ['node_modules/vite/bin/vite.js', 'build'],
      ['scripts/prerender.mjs'],
    ]) {
      execFileSync(process.execPath, args, { cwd: website, env: process.env, stdio: 'inherit' });
    }
  }
}
