import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] ?? 'https://jackalope.dev');
const pages = [
  '/',
  '/tour/',
  '/blog/',
  '/changelog/',
  '/privacy/',
  '/blog/room-for-the-work/',
  '/blog/from-brief-to-review/',
];

for (const path of pages) {
  const url = new URL(path, origin);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /<h1[\s>]/, `${path} must be prerendered`);
  assert.ok(html.includes(`href="${url.href}"`), `${path} canonical URL`);
  assert.match(html, /application\/ld\+json/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}

for (const path of [
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/llms-full.txt',
  '/feed.xml',
  '/site.webmanifest',
  '/favicon.svg',
]) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, path);
  assert.doesNotMatch(response.headers.get('content-type'), /text\/html/);
}

const redirect = await fetch(new URL('/blog', origin), { redirect: 'manual' });
assert.ok([301, 307, 308].includes(redirect.status));
assert.equal(new URL(redirect.headers.get('location'), origin).pathname, '/blog/');
const missing = await fetch(new URL('/deployment-check-missing-page', origin));
assert.equal(missing.status, 404);
assert.match(await missing.text(), /noindex/);
console.log(
  'Verified seven prerendered routes, discovery assets, canonical redirect, headers and real 404.',
);
