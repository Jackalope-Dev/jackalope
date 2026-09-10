import { readFileSync, writeFileSync } from 'node:fs';
import { guideMarkdown, knowledgeGuides } from '../packages/knowledge/src/index.ts';

const path = new URL('../packages/knowledge/catalog.json', import.meta.url);
const data = `${JSON.stringify(
  knowledgeGuides.map((guide) => ({
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    url: `https://jackalope.dev/knowledge/${guide.slug}/`,
    markdown: guideMarkdown(guide, 'https://jackalope.dev'),
  })),
  null,
  2,
)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== data)
    throw new Error('Run node scripts/knowledge.mjs to refresh bundled help.');
} else writeFileSync(path, data);
