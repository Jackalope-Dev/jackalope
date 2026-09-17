import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoveryFiles, pageHtml } from '../../apps/website/src/seo.ts';

const origin = 'https://site.example.test';
const metadata = (path) => {
  const html = pageHtml('<html><head></head><body></body></html>', path, origin);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  return graph['@graph'].find((entry) => entry['@id'] === `${origin}${path}`);
};

test('discovery availability follows each configured platform, including Store without an installer version', () => {
  for (const [env, available, unavailable] of [
    [{}, 'Public downloads are not open yet', 'version'],
    [{ VITE_RELEASE_VERSION: '0.1.0' }, 'Public downloads are not open yet', 'version'],
    [
      {
        VITE_MACOS_DOWNLOAD_URL: 'https://downloads.example.test/app.dmg',
        VITE_RELEASE_VERSION: '0.1.0',
      },
      'macOS version 0.1.0',
      'Windows',
    ],
    [
      {
        VITE_LINUX_DOWNLOAD_URL: 'https://downloads.example.test/app.AppImage',
        VITE_RELEASE_VERSION: '0.1.0',
      },
      'Linux version 0.1.0',
      'Windows',
    ],
    [
      { VITE_WINDOWS_STORE_URL: 'https://apps.microsoft.com/detail/9NM89QFJQ244' },
      'Windows through Microsoft Store',
      'version undefined',
    ],
    [
      {
        VITE_WINDOWS_DOWNLOAD_URL: 'https://downloads.example.test/app.exe',
        VITE_RELEASE_VERSION: '0.1.0',
      },
      'Windows version 0.1.0',
      'macOS version',
    ],
  ]) {
    const files = discoveryFiles(origin, env);
    for (const path of ['llms.txt', 'llms-full.txt']) {
      const availability = files[path].split('## Availability\n\n')[1].split('## Product')[0];
      assert.ok(availability.includes(available), `${path}: ${available}`);
      assert.ok(!availability.includes(unavailable), `${path}: ${unavailable}`);
      assert.ok(availability.includes(`${origin}/download/`));
      assert.ok(!availability.includes('/#download'));
      if (!available.startsWith('Public')) assert.match(availability, /requires waitlist approval/);
    }
  }
});

test('an editorial refresh preserves publication dates and exposes the actual modification date', () => {
  const comparison = metadata('/compare/superset/');
  assert.equal(comparison.datePublished, '2026-09-09');
  assert.equal(comparison.dateModified, '2026-09-17');
  const post = metadata('/blog/from-brief-to-review/');
  assert.equal(post.datePublished, '2026-09-06');
  assert.equal(post.dateModified, '2026-09-17');
  const files = discoveryFiles(origin);
  for (const path of ['/compare/', '/compare/superset/', '/blog/from-brief-to-review/']) {
    assert.ok(
      files['sitemap.xml'].includes(`<loc>${origin}${path}</loc><lastmod>2026-09-17</lastmod>`),
    );
  }
  const item = files['feed.xml']
    .split(`<link>${origin}/blog/from-brief-to-review/</link>`)[1]
    .split('</item>')[0];
  assert.match(item, /06 Sep 2026/);
});
