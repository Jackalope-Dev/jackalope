import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makeManifest } from '../update-manifest.mjs';
import { assertVersions, channel, origin, prefix, readNotes, root, sha256 } from './catalog.mjs';

const dir = resolve(root, 'output/release');
const version = JSON.parse(
  await readFile(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
).version;
await assertVersions(version);
const selectedChannel = channel(process.env.RELEASE_CHANNEL);
const notes = await readNotes(version, process.env.RELEASE_MODE === 'publish');
const exe = `Jackalope_${version}_x64-setup.exe`;
const msi = `Jackalope_${version}_x64_en-US.msi`;
const manifest = await makeManifest({
  version,
  baseUrl: `${origin(process.env.UPDATE_BASE_URL)}/updates/${prefix(version, selectedChannel)}`,
  notes: notes.notes,
  nsis: resolve(dir, exe),
  msi: resolve(dir, msi),
});
manifest.pub_date = notes.date;
const hashes = {};
for (const file of [exe, `${exe}.sig`, msi, `${msi}.sig`])
  hashes[file] = sha256(await readFile(resolve(dir, file)));
await writeFile(resolve(dir, 'checksums.json'), `${JSON.stringify(hashes, null, 2)}\n`);
hashes['checksums.json'] = sha256(await readFile(resolve(dir, 'checksums.json')));
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const receipt = {
  version,
  channel: selectedChannel,
  source,
  publicSigned: process.env.RELEASE_MODE === 'publish',
  files: hashes,
  manifest,
};
await writeFile(resolve(dir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
await writeFile(resolve(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(dir, 'notes.md'), notes.notes);
console.log(`Prepared ${Object.keys(hashes).length} verified artifact hashes`);
