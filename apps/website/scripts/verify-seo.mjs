import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const decode = (value) =>
  value.replace(
    /&(amp|lt|gt|quot|#39|#x27);/g,
    (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[entity],
  );

export async function verifySeo(directory, pages, origin) {
  const read = (path) => readFile(resolve(directory, path), 'utf8');
  const publicPages = pages.filter((page) => !page.noindex);
  const sitemap = await read('sitemap.xml');
  const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => decode(match[1]));
  assert.deepEqual(
    locations.toSorted(),
    publicPages.map((page) => `${origin}${page.path}`).toSorted(),
    'Sitemap must contain every indexable canonical URL exactly once',
  );
  assert.ok((await read('robots.txt')).includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.equal(new Set(pages.map((page) => page.path)).size, pages.length, 'Duplicate route');
  const titles = new Set();
  const descriptions = new Set();
  const links = new Map();
  const documents = new Map();
  for (const page of [...pages, { path: '/404/', noindex: true }]) {
    const html = await read(page.path === '/404/' ? '404.html' : `${page.path.slice(1)}index.html`);
    const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
    assert.ok(head, `${page.path}: missing head`);
    const single = (pattern, label, decodeHtml = true) => {
      const matches = [...head.matchAll(pattern)];
      assert.equal(matches.length, 1, `${page.path}: expected one ${label}`);
      return decodeHtml ? decode(matches[0][1]) : matches[0][1];
    };
    const title = single(/<title>(.*?)<\/title>/g, 'title');
    const description = single(/<meta name="description" content="([^"]*)"/g, 'description');
    // Editorial budgets, not search-engine limits; shorter relevant copy is welcome.
    assert.ok(
      title.length > 0 && title.length <= 60,
      `${page.path}: title is ${title.length} characters`,
    );
    assert.ok(
      description.length > 0 && description.length <= 160,
      `${page.path}: description is ${description.length} characters`,
    );
    assert.ok(!titles.has(title), `${page.path}: duplicate title`);
    assert.ok(!descriptions.has(description), `${page.path}: duplicate description`);
    titles.add(title);
    descriptions.add(description);
    if (page.title) {
      assert.equal(title, page.title);
      assert.equal(description, page.description);
    }
    assert.equal(
      single(/<link rel="canonical" href="([^"]*)"/g, 'canonical'),
      `${origin}${page.path}`,
    );
    const robots = single(/<meta name="robots" content="([^"]*)"/g, 'robots');
    assert.equal(robots.split(',').includes('noindex'), Boolean(page.noindex), page.path);
    for (const [property, expected] of [
      ['title', title],
      ['description', description],
      ['url', `${origin}${page.path}`],
    ]) {
      assert.equal(
        single(
          new RegExp(`<meta property="og:${property}" content="([^"]*)"`, 'g'),
          `og:${property}`,
        ),
        expected,
      );
    }
    const image = single(/<meta property="og:image" content="([^"]*)"/g, 'social image');
    assert.equal(new URL(image).origin, origin);
    await readFile(resolve(directory, new URL(image).pathname.slice(1)));
    for (const [name, expected] of [
      ['title', title],
      ['description', description],
      ['image', image],
    ]) {
      assert.equal(
        single(
          new RegExp(`<meta name="twitter:${name}" content="([^"]*)"`, 'g'),
          `twitter:${name}`,
        ),
        expected,
      );
    }
    const data = JSON.parse(
      single(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, 'JSON-LD', false),
    );
    assert.equal(data['@context'], 'https://schema.org');
    const entity = data['@graph'].find((entry) => entry['@id'] === `${origin}${page.path}`);
    assert.equal(entity?.description, description, `${page.path}: structured page metadata`);
    const breadcrumbs = data['@graph'].find((entry) => entry['@type'] === 'BreadcrumbList');
    if (breadcrumbs) {
      const items = breadcrumbs.itemListElement;
      assert.equal(
        new Set(items.map((item) => item.item)).size,
        items.length,
        `${page.path}: duplicate breadcrumb`,
      );
      for (const [index, item] of items.entries()) {
        assert.equal(item.position, index + 1);
        assert.ok(
          pages.some((entry) => `${origin}${entry.path}` === item.item),
          `${page.path}: invalid breadcrumb destination`,
        );
      }
    }
    assert.equal(
      [...html.matchAll(/<h1[\s>]/g)].length,
      1,
      `${page.path}: expected one prerendered h1`,
    );
    assert.match(html, /<html lang="en"/);
    const body = html.slice(html.indexOf('<body'));
    for (const tag of body.matchAll(/<(?:img|video|source|track)\b[^>]*>/g)) {
      for (const attribute of tag[0].matchAll(/\b(?:src|poster)="([^"]+)"/g)) {
        const asset = new URL(decode(attribute[1]), `${origin}${page.path}`);
        if (asset.origin !== origin) continue;
        await readFile(resolve(directory, asset.pathname.slice(1))).catch(() => {
          assert.fail(`${page.path}: missing media asset ${asset.pathname}`);
        });
      }
    }
    documents.set(page.path, body);
    links.set(
      page.path,
      [...body.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(
        (match) => new URL(decode(match[1]), `${origin}${page.path}`),
      ),
    );
  }
  for (const [path, targets] of links) {
    for (const target of targets) {
      if (target.origin !== origin) continue;
      if (/\.[a-z0-9]+$/i.test(target.pathname)) {
        await readFile(resolve(directory, target.pathname.slice(1))).catch(() => {
          assert.fail(`${path}: missing linked file ${target.pathname}`);
        });
        continue;
      }
      assert.ok(documents.has(target.pathname), `${path}: unregistered page ${target.pathname}`);
      if (target.hash) {
        const id = decodeURIComponent(target.hash.slice(1));
        assert.ok(
          documents.get(target.pathname).includes(`id="${id}"`),
          `${path}: missing anchor ${target.pathname}${target.hash}`,
        );
      }
    }
  }
  const reachable = new Set(['/']);
  for (const path of reachable) {
    for (const target of links.get(path) || []) {
      if (target.origin === origin && documents.has(target.pathname))
        reachable.add(target.pathname);
    }
  }
  for (const page of publicPages) assert.ok(reachable.has(page.path), `Orphan page: ${page.path}`);
  console.log(
    `SEO verified: ${publicPages.length} sitemap URLs, ${documents.size} rendered pages, metadata, JSON-LD and internal links.`,
  );
}
