import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../apps/website/src/changelog.json', import.meta.url));
const allowedStatuses = new Set(['Website', 'In development', 'Released']);

function fail(message) {
  console.error(`Changelog: ${message}`);
  process.exit(1);
}

function validate(entries) {
  if (!Array.isArray(entries) || entries.length === 0) fail('expected at least one entry.');
  const ids = new Set();
  let previousDate = '9999-12-31';
  for (const [index, entry] of entries.entries()) {
    const location = `entry ${index + 1}`;
    if (!entry || typeof entry !== 'object') fail(`${location} must be an object.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) fail(`${location} has an invalid id.`);
    if (ids.has(entry.id)) fail(`${location} repeats id ${entry.id}.`);
    ids.add(entry.id);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      Number.isNaN(Date.parse(`${entry.date}T00:00:00Z`))
    )
      fail(`${location} has an invalid date.`);
    if (entry.date > previousDate) fail('entries must be newest first.');
    previousDate = entry.date;
    if (!allowedStatuses.has(entry.status)) fail(`${location} has an unsupported status.`);
    for (const key of ['title', 'description']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) fail(`${location} needs ${key}.`);
    }
    if (entry.note !== undefined && (typeof entry.note !== 'string' || !entry.note.trim()))
      fail(`${location} has an invalid note.`);
    if (
      !Array.isArray(entry.items) ||
      entry.items.length === 0 ||
      entry.items.some((item) => typeof item !== 'string' || !item.trim())
    )
      fail(`${location} needs at least one item.`);
    if (JSON.stringify(entry).includes('—')) fail(`${location} contains an em dash.`);
  }
}

function options(args) {
  const result = { item: [] };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    const value = args[index + 1];
    if (!key || value === undefined || args[index]?.startsWith('--') !== true)
      fail('use --key value arguments.');
    if (key === 'item') result.item.push(value);
    else result[key] = value;
  }
  return result;
}

const entries = JSON.parse(await readFile(file, 'utf8'));
const command = process.argv[2] ?? 'check';

if (command === 'check') {
  validate(entries);
  console.log(`Changelog: ${entries.length} entries passed.`);
} else if (command === 'add') {
  const values = options(process.argv.slice(3));
  const title = values.title?.trim();
  const id = (
    values.id ??
    title
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') ??
    ''
  ).trim();
  const entry = {
    id,
    date: values.date ?? new Date().toISOString().slice(0, 10),
    status: values.status ?? 'In development',
    title,
    description: values.description?.trim(),
    items: values.item.map((item) => item.trim()),
    note: values.note?.trim(),
  };
  const next = [entry, ...entries];
  validate(next);
  const formatted = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve('@biomejs/biome/bin/biome')),
      'format',
      `--stdin-file-path=${file}`,
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      input: `${JSON.stringify(next, null, 2)}\n`,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (formatted.error || formatted.status !== 0 || !formatted.stdout)
    fail(formatted.error?.message || formatted.stderr || 'could not format the new entry.');
  await writeFile(file, formatted.stdout);
  console.log(`Changelog: added ${entry.id}. The website will publish it on its next build.`);
} else {
  fail('expected check or add.');
}
