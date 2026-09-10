import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { pages, siteOrigin } from '../src/content.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = resolve(root, 'apps/website/dist');
const reportPath = resolve(root, 'scratch/website-link-audit.json');
const { values } = parseArgs({ options: { origin: { type: 'string', default: siteOrigin } } });
const base = new URL(values.origin);
if (
  !['http:', 'https:'].includes(base.protocol) ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash
)
  throw new Error('Use an HTTP(S) origin without a path, query, or credentials.');
const auditOrigin = base.origin;
const decode = (value) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"');
const plain = (html) =>
  decode(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
const targets = new Map();
for (const page of pages) {
  const html = await readFile(resolve(directory, `${page.path.slice(1)}index.html`), 'utf8');
  const pageUrl = `${auditOrigin}${page.path}`;
  if (!targets.has(pageUrl)) targets.set(pageUrl, []);
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = new URL(decode(match[1]), pageUrl);
    if (url.origin === siteOrigin) {
      url.protocol = base.protocol;
      url.host = base.host;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (!targets.has(url.href)) targets.set(url.href, []);
    targets.get(url.href).push({ page: page.path, label: plain(match[2]) });
  }
  for (const tag of html.matchAll(/<(?:img|video|source|track)\b[^>]*>/g)) {
    for (const attribute of tag[0].matchAll(/\b(?:src|poster)="([^"]+)"/g)) {
      const url = new URL(decode(attribute[1]), pageUrl);
      if (url.origin === siteOrigin) {
        url.protocol = base.protocol;
        url.host = base.host;
      }
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (!targets.has(url.href)) targets.set(url.href, []);
      targets.get(url.href).push({ page: page.path, label: 'Embedded media' });
    }
  }
}

const jobs = [...targets];
const results = [];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (jobs.length) {
      const [href, references] = jobs.shift();
      try {
        const response = await fetch(href, {
          signal: AbortSignal.timeout(25000),
          headers: { 'User-Agent': 'Jackalope-Link-Audit/1.0' },
        });
        const type = response.headers.get('content-type') || '';
        const html = /text|json|xml/.test(type) ? await response.text() : '';
        await response.body?.cancel().catch(() => {});
        const id = decodeURIComponent(new URL(href).hash.slice(1));
        results.push({
          href,
          status: response.status,
          finalUrl: response.url,
          type,
          title: plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
          headings: [...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)].map((match) =>
            plain(match[1]),
          ),
          anchorFound: id ? html.includes(`id="${id}"`) || html.includes(`name="${id}"`) : null,
          references,
        });
      } catch (error) {
        results.push({ href, error: error.message, references });
      }
    }
  }),
);
results.sort((left, right) => left.href.localeCompare(right.href));
const issues = results.filter(
  (result) =>
    result.error || result.status < 200 || result.status >= 400 || result.anchorFound === false,
);
await mkdir(resolve(root, 'scratch'), { recursive: true });
await writeFile(
  reportPath,
  `${JSON.stringify({ checked: new Date().toISOString(), origin: auditOrigin, issues: issues.length, results }, null, 2)}\n`,
);
console.log(`Checked ${results.length} live link targets; ${issues.length} need review.`);
console.log(`Report: ${reportPath}`);
console.log(
  'HTTP status and headings do not establish claim accuracy. Review source content separately.',
);
for (const issue of issues) console.error(`${issue.href}: ${issue.error || issue.status}`);
if (issues.length) process.exitCode = 1;
