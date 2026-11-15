import { findAuthor } from './authors.ts';
import {
  type BlogImage,
  type BlogPost,
  type BlogSection,
  blogImageKinds,
  type EditorialCover,
} from './blog-types.ts';

/**
 * Posts LopeBase publishes as `apps/website/content/blog/<slug>.md`: front matter with
 * JSON-quoted title, description, slug and tags, an unquoted YYYY-MM-DD date and
 * optional updated date, an optional one-line JSON faq ([{"q","a"}]), an optional
 * author (a slug from authors.ts, for the byline and author page), an optional cover
 * (image: an https URL, image_alt, image_kind: title_card or artwork), then the Markdown
 * body. A file that does not parse throws, so the build (and the CI gate
 * that auto-merges these posts) fails instead of publishing a broken page.
 */
function readSources(): Record<string, string> {
  try {
    // Vite rewrites this call into the bundled file contents.
    return import.meta.glob<string>('../content/blog/*.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
  } catch {
    // Plain Node (vite.config.ts, site scripts) has no import.meta.glob.
    const fs = process.getBuiltinModule('node:fs');
    const directory = new URL('../content/blog/', import.meta.url);
    if (!fs.existsSync(directory)) return {};
    return Object.fromEntries(
      fs
        .readdirSync(directory)
        .filter((name) => name.endsWith('.md'))
        .map((name) => [
          `../content/blog/${name}`,
          fs.readFileSync(new URL(name, directory), 'utf8'),
        ]),
    );
  }
}

const covers: Pick<EditorialCover, 'kind' | 'tone'>[] = [
  { kind: 'parallel', tone: 'indigo' },
  { kind: 'review', tone: 'mint' },
  { kind: 'context', tone: 'honey' },
  { kind: 'agents', tone: 'rose' },
  { kind: 'quality', tone: 'indigo' },
  { kind: 'map', tone: 'mint' },
  { kind: 'schedule', tone: 'honey' },
  { kind: 'browser', tone: 'rose' },
];

const headingId = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function frontMatter(file: string, source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) throw new Error(`${file}: missing front matter.`);
  const fields: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z_]+):\s*(.*)$/i.exec(line);
    if (!field) continue;
    const value = field[2].trim();
    fields[field[1]] = /^["[]/.test(value) ? JSON.parse(value) : value;
  }
  return { fields, body: source.slice(match[0].length) };
}

function parseImage(file: string, fields: Record<string, unknown>, title: string) {
  const { image, image_alt: alt, image_kind: kind } = fields;
  if (image === undefined) {
    if (kind !== undefined || alt !== undefined)
      throw new Error(`${file}: image_alt and image_kind need an image.`);
    return undefined;
  }
  let url: URL | undefined;
  try {
    url = typeof image === 'string' ? new URL(image) : undefined;
  } catch {}
  if (url?.protocol !== 'https:' || url.username || url.password)
    throw new Error(`${file}: image must be an https URL.`);
  if (alt !== undefined && typeof alt !== 'string')
    throw new Error(`${file}: image_alt must be text.`);
  if (kind !== undefined && !blogImageKinds.includes(kind as never))
    throw new Error(`${file}: image_kind must be ${blogImageKinds.join(' or ')}.`);
  return {
    url: url.href,
    alt: alt?.trim() || title,
    kind: kind as BlogImage['kind'],
  } satisfies BlogImage;
}

export function parsePost(file: string, source: string): BlogPost {
  const { fields, body } = frontMatter(file, source);
  const { title, description, slug, date } = fields;
  const tags = Array.isArray(fields.tags) ? fields.tags.map(String) : [];
  if (typeof title !== 'string' || !title.trim()) throw new Error(`${file}: missing title.`);
  if (typeof description !== 'string' || !description.trim())
    throw new Error(`${file}: missing description.`);
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error(`${file}: slug must be lowercase words joined by hyphens.`);
  if (!file.endsWith(`/${slug}.md`)) throw new Error(`${file}: file name must match its slug.`);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`${file}: date must be YYYY-MM-DD.`);
  const updated = fields.updated;
  if (
    updated !== undefined &&
    (typeof updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(updated))
  )
    throw new Error(`${file}: updated must be YYYY-MM-DD.`);
  const author = fields.author;
  if (author !== undefined && (typeof author !== 'string' || !findAuthor(author)))
    throw new Error(`${file}: author must be a slug from authors.ts.`);
  const faq = (Array.isArray(fields.faq) ? fields.faq : [])
    .map((pair) => ({
      question: String(pair?.q ?? '').trim(),
      answer: String(pair?.a ?? '').trim(),
    }))
    .filter((pair) => pair.question && pair.answer);
  const image = parseImage(file, fields, title);

  // A leading H1 repeats the title, which the page already renders.
  const lines = body.replace(/^\s*#\s+.*\r?\n/, '').split(/\r?\n/);
  const intro: string[] = [];
  const sections: BlogSection[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const sectionTitle = heading[1].replace(/[*_`]/g, '');
      sections.push({
        id: headingId(sectionTitle) || `section-${sections.length + 1}`,
        title: sectionTitle,
        paragraphs: [],
        markdown: '',
      });
    } else if (sections.length) sections[sections.length - 1].markdown += `${line}\n`;
    else intro.push(line);
  }
  for (const section of sections) section.markdown = section.markdown?.trim();
  if (!sections.length) throw new Error(`${file}: body needs at least one ## section.`);

  const words = body.split(/\s+/).filter(Boolean).length;
  const hash = [...slug].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const label = tags[0] && tags[0].length <= 32 ? tags[0] : 'Practical guide';
  return {
    slug,
    title,
    category: 'Practical guides',
    author: typeof author === 'string' ? author : undefined,
    date,
    updated: updated && updated > date ? updated : undefined,
    readingTime: `${Math.max(1, Math.round(words / 230))} min read`,
    description,
    cover: { ...covers[hash % covers.length], label: label[0].toUpperCase() + label.slice(1) },
    image,
    intro: intro.join('\n').trim() || undefined,
    sections,
    faq: faq.length ? faq : undefined,
  };
}

/** Newest first. */
export const markdownPosts: BlogPost[] = Object.entries(readSources())
  .map(([file, source]) => parsePost(file.replaceAll('\\', '/'), source))
  .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
