import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MICROSOFT_STORE_URL } from '../../../packages/contracts/src/release.ts';
import { changelogReleases } from '../../../scripts/release/changelog-releases.mjs';
import { readPublicRelease } from './public-release.mjs';

// `node scripts/build.mjs` builds the website. With SYNC_PUBLIC_RELEASE=true it
// first points the Windows download at the published stable release.
if (process.env.SYNC_PUBLIC_RELEASE === 'true') {
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
// The Store listing is public, so builds offer it unless the environment overrides it.
process.env.VITE_WINDOWS_STORE_URL ??= MICROSOFT_STORE_URL;
// Changelog release state comes from beta-v* and stable-v* tags. Cloudflare
// builds clone shallowly, so fetch the tags and stop if none can be read.
process.env.JACKALOPE_CHANGELOG_RELEASES = JSON.stringify(
  process.env.CHANGELOG_RELEASES === 'skip'
    ? {}
    : changelogReleases({ fetch: true, required: true }),
);
const website = fileURLToPath(new URL('..', import.meta.url));
const runBin = fileURLToPath(new URL('../../../scripts/run-bin.mjs', import.meta.url));
for (const args of [
  [runBin, 'typescript:tsc', '-b'],
  [runBin, 'vite', 'build'],
  ['scripts/prerender.mjs'],
]) {
  execFileSync(process.execPath, args, { cwd: website, env: process.env, stdio: 'inherit' });
}
