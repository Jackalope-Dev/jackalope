import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { parsePost } from '../src/blog-markdown.ts';
import { posts } from '../src/content.ts';
import { pageHtml } from '../src/seo.ts';

const origin = 'https://site.example.test';
const website = fileURLToPath(new URL('..', import.meta.url));

/** Reads a post in test/fixtures/blog, parsed the way the build parses content/blog. */
const fixture = (slug, parse = parsePost) => {
  const file = `test/fixtures/blog/${slug}.md`;
  return parse(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
};

/** Parses an inline post, for front matter variations the fixtures do not cover. */
const inline = (slug, lines) =>
  parsePost(
    `content/blog/${slug}.md`,
    [
      '---',
      `title: "Inline ${slug}"`,
      'description: "An inline post."',
      `slug: "${slug}"`,
      'date: 2026-11-01',
      ...lines,
      '---',
      '',
      '## Section',
      '',
      'Body.',
    ].join('\n'),
  );

/** Runs `read` with the post registered in `list`, then removes it. */
function withPost(list, post, read) {
  list.push(post);
  try {
    return read();
  } finally {
    list.splice(list.indexOf(post), 1);
  }
}

function head(post) {
  return withPost(posts, post, () => {
    const html = pageHtml('<html><head></head><body></body></html>', `/blog/${post.slug}/`, origin);
    const meta = (key) =>
      [...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)]
        .filter((match) => match[1] === key)
        .map((match) => match[2].replaceAll('&amp;', '&'));
    const graph = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
    );
    return {
      meta,
      entity: graph['@graph'].find((entry) => entry['@id'] === `${origin}/blog/${post.slug}/`),
    };
  });
}

// The page is TSX, so it renders through Vite's SSR loader as the prerender does.
let vite;
let site;
before(async () => {
  process.env.CHANGELOG_RELEASES ??= 'skip';
  vite = await createServer({
    root: website,
    mode: 'production',
    logLevel: 'silent',
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  site = {
    ...(await vite.ssrLoadModule('/src/entry-server.tsx')),
    ...(await vite.ssrLoadModule('/src/content.ts')),
    ...(await vite.ssrLoadModule('/src/blog-markdown.ts')),
  };
});
after(() => vite?.close());

/** The post page's markup, rendered with the site's own module instances. */
function page(slug) {
  const post = fixture(slug, site.parsePost);
  return withPost(site.posts, post, () => site.render(`/blog/${post.slug}/`));
}
const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

test('front matter carries the cover image, its alt text and its kind', () => {
  assert.deepEqual(fixture('artwork-cover').image, {
    url: 'https://images.example.test/api/content/images/1/artwork-cover.png',
    alt: 'Artwork alt',
    kind: 'artwork',
  });
  const card = fixture('title-card-cover');
  assert.equal(card.image.kind, 'title_card');
  assert.equal(card.image.alt, card.title);

  const untyped = inline('plain', ['image: https://images.example.test/plain.png']);
  assert.equal(untyped.image.url, 'https://images.example.test/plain.png');
  assert.equal(untyped.image.kind, undefined);
  assert.equal(inline('none', []).image, undefined);
});

test('a cover that is not an https URL, or has an unknown kind, fails the build', () => {
  for (const image of [
    'http://images.example.test/a.png',
    '/a.png',
    'javascript:alert(1)',
    '""',
    'https://user:secret@images.example.test/a.png',
  ])
    assert.throws(() => inline('bad', [`image: ${image}`]), /content\/blog\/bad\.md: image/);
  assert.throws(
    () => inline('bad', ['image: https://images.example.test/a.png', 'image_kind: poster']),
    /content\/blog\/bad\.md: image_kind/,
  );
  assert.throws(() => inline('bad', ['image_kind: artwork']), /content\/blog\/bad\.md: image/);
});

test('a title card is the link preview and structured-data image', () => {
  const post = fixture('title-card-cover');
  const { meta, entity } = head(post);
  assert.deepEqual(meta('og:image'), [post.image.url]);
  assert.deepEqual(meta('twitter:image'), [post.image.url]);
  assert.deepEqual(meta('og:image:width'), ['1200']);
  assert.deepEqual(meta('og:image:height'), ['630']);
  assert.deepEqual(meta('og:image:alt'), [post.image.alt]);
  assert.deepEqual(entity.image, {
    '@type': 'ImageObject',
    url: post.image.url,
    width: 1200,
    height: 630,
  });
});

test('an image without a kind is the link preview without a declared size', () => {
  const post = inline('plain', ['image: https://images.example.test/plain.png']);
  const { meta, entity } = head(post);
  assert.deepEqual(meta('og:image'), [post.image.url]);
  assert.deepEqual(meta('og:image:width'), []);
  assert.deepEqual(meta('og:image:height'), []);
  assert.equal(entity.image, post.image.url);
});

test('posts without a cover keep the site social image', () => {
  const home = pageHtml('<html><head></head><body></body></html>', '/', origin);
  const siteImage = home.match(/<meta property="og:image" content="([^"]*)"/)[1];
  assert.equal(new URL(siteImage).origin, origin);
  const { meta, entity } = head(inline('none', []));
  assert.deepEqual(meta('og:image'), [siteImage]);
  assert.deepEqual(meta('twitter:image'), [siteImage]);
  assert.equal(entity.image, siteImage);
});

test('a title card is not shown on the post page', () => {
  const html = page('title-card-cover');
  assert.ok(html.includes('Body.'));
  assert.ok(!html.includes('title-card-cover.png'));
});

test('artwork is shown above the post body with its size and alt text', () => {
  const html = page('artwork-cover');
  const covers = [...html.matchAll(/<img\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes('artwork-cover.png'));
  assert.equal(covers.length, 1);
  const [cover] = covers;
  assert.equal(attribute(cover, 'alt'), 'Artwork alt');
  assert.equal(attribute(cover, 'width'), '1200');
  assert.equal(attribute(cover, 'height'), '630');
  assert.equal(attribute(cover, 'loading'), 'eager');
  assert.equal(attribute(cover, 'decoding'), 'async');
  assert.ok(html.indexOf('artwork-cover.png') < html.indexOf('Body.'));
});
