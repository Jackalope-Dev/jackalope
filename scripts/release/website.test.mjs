import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublicRelease } from './website.mjs';

const manifest = {
  version: '0.2.0',
  platforms: {
    'windows-x86_64-nsis': {
      url: 'https://api.jackalope.dev/updates/releases/v0.2.0/Jackalope_0.2.0_x64-setup.exe',
    },
  },
};
test('website build uses the exact published installer and preserves prerelease before first publication', async () => {
  assert.deepEqual(await readPublicRelease({ fetcher: async () => Response.json(manifest) }), {
    VITE_RELEASE_VERSION: '0.2.0',
    VITE_WINDOWS_DOWNLOAD_URL: manifest.platforms['windows-x86_64-nsis'].url,
  });
  assert.deepEqual(
    await readPublicRelease({ fetcher: async () => new Response(null, { status: 404 }) }),
    {},
  );
});
test('website synchronization fails closed on outage, invalid metadata or foreign downloads', async () => {
  await assert.rejects(
    readPublicRelease({ fetcher: async () => new Response(null, { status: 503 }) }),
  );
  await assert.rejects(
    readPublicRelease({
      fetcher: async () => {
        throw new Error('offline');
      },
    }),
  );
  assert.deepEqual(
    await readPublicRelease({
      bootstrap: true,
      fetcher: async () => {
        throw new Error('DNS');
      },
    }),
    {},
  );
  for (const data of [
    { version: '0.2.0' },
    { ...manifest, version: '0.2.0\ninjected' },
    {
      ...manifest,
      platforms: { 'windows-x86_64-nsis': { url: 'https://other.example/setup.exe' } },
    },
  ]) {
    await assert.rejects(readPublicRelease({ fetcher: async () => Response.json(data) }));
  }
});
