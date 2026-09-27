// Fails when app code references a color token that no theme defines, or uses a
// fixed Tailwind palette color instead of a theme token. Undefined custom
// properties render as nothing, and fixed palette shades only suit one theme.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sources = ['apps/desktop/src', 'packages/ui/src', 'packages/brand/src'];
const extensions = /\.(css|ts|tsx)$/;
const palette =
  /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

function files(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path);
    return extensions.test(entry.name) ? [path] : [];
  });
}

const all = sources.flatMap(files).map((path) => ({
  path,
  text: readFileSync(join(root, path), 'utf8'),
}));
const defined = new Set();
for (const { text } of all) {
  for (const [, name] of text.matchAll(/(--color-[\w-]+)\s*:/g)) defined.add(name);
  for (const [, name] of text.matchAll(/['"`](--color-[\w-]+)['"`]/g)) defined.add(name);
}

const problems = [];
for (const { path, text } of all) {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const where = `${relative(root, join(root, path))}:${index + 1}`;
    for (const [, name] of line.matchAll(/var\((--color-[\w-]+)/g))
      if (!defined.has(name)) problems.push(`${where} uses undefined ${name}`);
    if (path.endsWith('.tsx'))
      for (const [match] of line.matchAll(palette))
        problems.push(`${where} uses fixed palette color ${match}; use a theme token`);
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} color token problem(s).`);
  process.exit(1);
}
console.log(`Color tokens: ${defined.size} defined, all references resolve.`);
