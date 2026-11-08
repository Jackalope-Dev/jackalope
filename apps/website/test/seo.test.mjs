import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonPages } from '../src/comparison-content.ts';
import { posts } from '../src/content.ts';
import { discoveryFiles, pageHtml } from '../src/seo.ts';

const origin = 'https://site.example.test';
const metadata = (path) => {
  const html = pageHtml('<html><head></head><body></body></html>', path, origin);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  return graph['@graph'].find((entry) => entry['@id'] === `${origin}${path}`);
};

test('discovery availability follows each configured platform, including Store without an installer version', () => {
  for (const [env, available, unavailable] of [
    [{}, 'Desktop downloads are available for macOS and Linux', 'Windows'],
    [{ VITE_RELEASE_VERSION: '0.1.0' }, 'available for macOS and Linux', 'version'],
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
      assert.match(availability, /requires waitlist approval/);
    }
  }
});

test('an editorial refresh preserves publication dates and exposes the actual modification date', () => {
  const files = discoveryFiles(origin);
  const lastmod = (path) =>
    files['sitemap.xml'].match(
      new RegExp(`<loc>${origin}${path}</loc>(?:<lastmod>([^<]+)</lastmod>)?`),
    )?.[1];
  for (const { path, comparison } of comparisonPages) {
    const page = metadata(path);
    assert.equal(page.datePublished, comparison.published, path);
    assert.equal(page.dateModified, comparison.reviewed, path);
    assert.equal(lastmod(path), comparison.reviewed, path);
  }
  for (const post of posts) {
    const path = `/blog/${post.slug}/`;
    const page = metadata(path);
    assert.equal(page.datePublished, post.date, path);
    assert.equal(page.dateModified, post.updated ?? post.date, path);
    const item = files['feed.xml'].split(`<link>${origin}${path}</link>`)[1].split('</item>')[0];
    const published = new Date(item.match(/<pubDate>([^<]+)<\/pubDate>/)[1]);
    assert.equal(published.toISOString().slice(0, 10), post.date, path);
  }
});
