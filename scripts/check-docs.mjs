import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { documentationIssues } from './docs-policy.mjs';
import { root } from './lib/paths.mjs';
import { git } from './lib/proc.mjs';

const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0');
const missing = [];
const documents = new Map();
// Website posts are published content, not repository documentation; the website build
// validates them.
const isDocument = (file) => /\.mdx?$/.test(file) && !file.startsWith('apps/website/content/');
for (const file of new Set(files.filter(isDocument))) {
  const source = path.join(root, file);
  if (!existsSync(source)) continue;
  const content = readFileSync(source, 'utf8');
  documents.set(file, content);
  const text = content.replace(/(```|~~~)[\s\S]*?\1/g, '');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(?:[a-z]+:|\/)/i.test(target)) continue;
    if (!existsSync(path.resolve(path.dirname(source), decodeURIComponent(target))))
      missing.push(`${file}: ${target}`);
  }
}
missing.push(...documentationIssues(documents));
if (missing.length) {
  console.error(missing.join('\n'));
  process.exitCode = 1;
} else console.log('Local Markdown links and public documentation policy passed.');
