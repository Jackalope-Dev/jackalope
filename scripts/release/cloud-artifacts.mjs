import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVersions, channel, readNotes, root, sha256, version } from './catalog.mjs';
import { application, cloudConfig } from './crabnebula-config.mjs';

export function validateCloudReceipt(receipt, { requireCandidate = false } = {}) {
  version(receipt.version);
  channel(receipt.channel);
  if (
    receipt.schemaVersion !== 1 ||
    receipt.application !== application ||
    receipt.target !== 'windows-x86_64' ||
    receipt.distribution !== 'nsis'
  )
    throw new Error('Unsupported Cloud receipt');
  if (
    !['candidate', 'rehearsal'].includes(receipt.mode) ||
    !/^[a-f0-9]{40}$/.test(receipt.source) ||
    typeof receipt.sourceDirty !== 'boolean' ||
    receipt.approvalRequired !== true
  )
    throw new Error('Invalid source/access receipt');
  if (
    requireCandidate &&
    (receipt.mode !== 'candidate' || receipt.sourceDirty || receipt.publicSigned !== true)
  )
    throw new Error('Only clean publisher-signed candidates may be uploaded');
  if (receipt.publicSigned !== (receipt.mode === 'candidate'))
    throw new Error('Inconsistent signing receipt');
  const name = receipt.mode === 'candidate' ? 'Jackalope' : 'Jackalope Rehearsal';
  const installer = `${name}_${receipt.version}_x64-setup.exe`;
  const expected = [installer, `${installer}.sig`, 'tauri.cloud.json', 'notes.md'];
  if (
    !receipt.files ||
    Object.keys(receipt.files).length !== expected.length ||
    expected.some((name) => !/^[a-f0-9]{64}$/.test(receipt.files[name]))
  )
    throw new Error('Invalid artifact names or checksums');
  return { installer, signature: `${installer}.sig` };
}

export async function validateCloudFiles(directory, options) {
  const receipt = JSON.parse(await readFile(resolve(directory, 'receipt.json'), 'utf8'));
  const files = validateCloudReceipt(receipt, options);
  for (const [name, hash] of Object.entries(receipt.files)) {
    if (sha256(await readFile(resolve(directory, name))) !== hash)
      throw new Error(`Artifact changed: ${name}`);
  }
  const signature = (await readFile(resolve(directory, files.signature), 'utf8')).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error('Invalid updater signature');
  const config = JSON.parse(await readFile(resolve(directory, 'tauri.cloud.json'), 'utf8'));
  const expected = cloudConfig({
    mode: receipt.mode,
    channel: receipt.channel,
    publicKey: config.plugins?.updater?.pubkey,
    signScript: config.bundle?.windows?.signCommand?.args?.[3],
  });
  if (JSON.stringify(config) !== JSON.stringify(expected))
    throw new Error('Release configuration changed');
  return { receipt, ...files, config };
}

async function main() {
  const command = process.argv[2];
  const directory = resolve(process.env.CLOUD_PACKAGE_DIRECTORY ?? process.argv[3] ?? '');
  if (command === 'check') {
    const result = await validateCloudFiles(directory);
    console.log(
      `Verified ${result.receipt.mode} ${result.receipt.channel} ${result.receipt.version}`,
    );
    return;
  }
  if (!process.env.CLOUD_PACKAGE_DIRECTORY) throw new Error('CLOUD_PACKAGE_DIRECTORY is required');
  const mode = process.env.CLOUD_BUILD_MODE;
  const selectedChannel = channel(process.env.RELEASE_CHANNEL);
  const v = JSON.parse(
    await readFile(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
  ).version;
  await assertVersions(v);
  const notes = await readNotes(v, mode === 'candidate');
  if (command === 'config') {
    const config = cloudConfig({
      mode,
      channel: selectedChannel,
      publicKey: process.env.TAURI_UPDATER_PUBLIC_KEY,
      signScript: resolve(root, 'scripts/release/azure-sign.ps1'),
    });
    await writeFile(
      resolve(directory, 'tauri.cloud.json'),
      `${JSON.stringify(config, null, 2)}\n`,
      { flag: 'wx' },
    );
    await writeFile(resolve(directory, 'notes.md'), notes.notes, { flag: 'wx' });
    return;
  }
  if (command !== 'receipt')
    throw new Error('Usage: cloud-artifacts.mjs config|receipt|check [directory]');
  const name = mode === 'candidate' ? 'Jackalope' : 'Jackalope Rehearsal';
  const installer = `${name}_${v}_x64-setup.exe`;
  const files = {};
  for (const name of [installer, `${installer}.sig`, 'tauri.cloud.json', 'notes.md'])
    files[name] = sha256(await readFile(resolve(directory, name)));
  const receipt = {
    schemaVersion: 1,
    application,
    version: v,
    channel: selectedChannel,
    mode,
    source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    ),
    target: 'windows-x86_64',
    distribution: 'nsis',
    approvalRequired: true,
    publicSigned: mode === 'candidate',
    files,
    nativeBinary: {
      name: basename(process.env.CLOUD_NATIVE_BINARY),
      sha256: sha256(await readFile(process.env.CLOUD_NATIVE_BINARY)),
    },
  };
  validateCloudReceipt(receipt, { requireCandidate: mode === 'candidate' });
  await writeFile(resolve(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  });
  await validateCloudFiles(directory);
  console.log(`Recorded ${mode} ${selectedChannel} ${v} artifact checksums`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
