import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export function version(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.length > 32)
    throw new Error('Version must be major.minor.patch');
  return value;
}
export function channel(value) {
  if (!['stable', 'beta'].includes(value)) throw new Error('Channel must be stable or beta');
  return value;
}
export function origin(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Use an HTTPS origin without credentials or a path');
  return url.origin;
}
export function compare(a, b) {
  const x = version(a).split('.').map(BigInt);
  const y = version(b).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}
export function prefix(v, c) {
  return `releases/${channel(c) === 'beta' ? 'beta/' : ''}v${version(v)}`;
}
export function parseNotes(text, expectedVersion, publish = false) {
  if (Buffer.byteLength(text) > 24000) throw new Error('Release notes exceed 24 KB');
  const match =
    /^# Jackalope (\d+\.\d+\.\d+)\r?\n\r?\nStatus: (draft|ready)\r?\nDate: (\d{4}-\d{2}-\d{2})\r?\n\r?\n([\s\S]+)$/.exec(
      text,
    );
  if (!match || match[1] !== version(expectedVersion))
    throw new Error('Release notes header/version is invalid');
  const date = new Date(`${match[3]}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== match[3])
    throw new Error('Release date is invalid');
  if (publish && (match[2] !== 'ready' || /\bTODO\b/.test(match[4]) || date > new Date()))
    throw new Error('Review the notes, remove TODOs, and mark Status: ready before publishing');
  return { version: match[1], date: date.toISOString(), notes: match[4].trim() };
}
export async function readNotes(v, publish = false) {
  return parseNotes(await readFile(resolve(root, `releases/${version(v)}.md`), 'utf8'), v, publish);
}
export async function assertVersions(v) {
  version(v);
  for (const path of [
    'package.json',
    'apps/desktop/package.json',
    'apps/desktop/src-tauri/tauri.conf.json',
  ]) {
    if (JSON.parse(await readFile(resolve(root, path), 'utf8')).version !== v)
      throw new Error(`Version mismatch in ${path}`);
  }
  const cargo = await readFile(resolve(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const lock = (
    await readFile(resolve(root, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8')
  ).replaceAll('\r\n', '\n');
  if (
    !cargo.includes(`version = "${v}"`) ||
    !lock.includes(`name = "jackalope-desktop"\nversion = "${v}"`)
  )
    throw new Error('Native package/lock version mismatch');
}
export async function prepare(v) {
  version(v);
  const notesPath = resolve(root, `releases/${v}.md`);
  await mkdir(resolve(root, 'releases'), { recursive: true });
  await writeFile(
    notesPath,
    `# Jackalope ${v}\n\nStatus: draft\nDate: ${new Date().toISOString().slice(0, 10)}\n\n## Highlights\n\n- TODO: describe the improvement for users.\n\n## Improvements\n\n- TODO\n\n## Fixes\n\n- TODO\n\n## Known issues\n\n- TODO\n`,
    { flag: 'wx' },
  );
  for (const path of [
    'package.json',
    'apps/desktop/package.json',
    'apps/desktop/src-tauri/tauri.conf.json',
  ]) {
    const full = resolve(root, path);
    const data = JSON.parse(await readFile(full, 'utf8'));
    data.version = v;
    await writeFile(full, `${JSON.stringify(data, null, 2)}\n`);
  }
  const cargoPath = resolve(root, 'apps/desktop/src-tauri/Cargo.toml');
  await writeFile(
    cargoPath,
    (await readFile(cargoPath, 'utf8')).replace(/^(version = ")[^"]+("\r?$)/m, `$1${v}$2`),
  );
  const lockPath = resolve(root, 'apps/desktop/src-tauri/Cargo.lock');
  await writeFile(
    lockPath,
    (await readFile(lockPath, 'utf8')).replace(
      /(name = "jackalope-desktop"\r?\nversion = ")[^"]+"/,
      `$1${v}"`,
    ),
  );
  console.log(`Prepared ${v}. Edit releases/${v}.md, review the diff, and commit it yourself.`);
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const xml = (text) =>
  text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
  );
export function feed(releases, base, c) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Jackalope ${channel(c)} releases</title><link>https://jackalope.dev/changelog/</link><description>What's new in Jackalope</description>${releases.map((item) => `<item><title>Jackalope ${xml(item.version)}</title><guid>${xml(base)}/updates/${prefix(item.version, c)}/latest.json</guid><pubDate>${new Date(item.date).toUTCString()}</pubDate><description>${xml(item.notes)}</description></item>`).join('')}</channel></rss>`;
}
export function releasePlan({ receipt, notes, previous = [], base, current }) {
  const v = version(receipt.version);
  const c = channel(receipt.channel);
  origin(base);
  if (!receipt.publicSigned || !/^[a-f0-9]{40}$/.test(receipt.source))
    throw new Error('Public publication requires a signed release receipt and source revision');
  if (current && compare(v, current.version) < 0)
    throw new Error(
      'Refusing to move an update feed backwards; use the documented rollback procedure',
    );
  if (previous.length > 100 || !Array.isArray(previous)) throw new Error('Invalid release catalog');
  for (const item of previous) {
    version(item.version);
    if (
      typeof item.notes !== 'string' ||
      item.notes.length > 24000 ||
      !Number.isFinite(Date.parse(item.date))
    )
      throw new Error('Invalid catalog entry');
  }
  const entry = { version: v, date: notes.date, notes: notes.notes };
  const releases = [entry, ...previous.filter((item) => item.version !== v)]
    .sort((a, b) => compare(b.version, a.version))
    .slice(0, 100);
  const manifest = {
    ...receipt.manifest,
    notes: notes.notes,
    pub_date: notes.date,
    catalog: `${prefix(v, c)}/catalog.json`,
  };
  if (manifest.version !== v) throw new Error('Manifest version mismatch');
  return { releases, manifest, feed: feed(releases, base, c), directory: prefix(v, c) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, v] = process.argv.slice(2);
  if (command === 'prepare') await prepare(v);
  else if (command === 'check') {
    await assertVersions(v);
    await readNotes(v, process.env.RELEASE_MODE === 'publish');
    console.log(`Release ${v} validated`);
  } else throw new Error('Usage: node scripts/release/catalog.mjs prepare|check VERSION');
}
