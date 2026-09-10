import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentationIssues } from './docs-policy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { cwd: root, encoding: 'utf8' },
).split('\0');
const missing = [];
const documents = new Map();
for (const file of new Set(files.filter((file) => /\.mdx?$/.test(file)))) {
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
