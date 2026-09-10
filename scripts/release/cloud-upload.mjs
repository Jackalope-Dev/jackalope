import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, root, sha256 } from './catalog.mjs';
import { validateCloudFiles } from './cloud-artifacts.mjs';
import { application } from './crabnebula-config.mjs';

const releaseId = (value) => typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
export function parseDraftId(output) {
  const trimmed = output.trim();
  if (releaseId(trimmed)) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (releaseId(parsed.id)) return parsed.id;
  } catch {}
  throw new Error(
    'Draft response was not recognized; inspect Cloud before retrying. No assets uploaded.',
  );
}

export async function uploadCandidate(
  directory,
  { run, verifyPublisher, key, enabled, publicKey },
) {
  if (enabled !== 'true' || !key)
    throw new Error('Configure CN_API_KEY and CLOUD_DRAFT_UPLOAD_ENABLED before uploading');
  const { receipt, installer, signature, config } = await validateCloudFiles(directory, {
    requireCandidate: true,
  });
  if (!publicKey || config.plugins.updater.pubkey !== publicKey)
    throw new Error('Candidate updater key does not match the configured release key');
  await verifyPublisher(resolve(directory, installer));
  const checkpointPath = resolve(directory, 'cloud-draft.json');
  const receiptHash = sha256(await readFile(resolve(directory, 'receipt.json')));
  let checkpoint;
  try {
    checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const save = () => writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  if (
    checkpoint &&
    (checkpoint.receiptHash !== receiptHash || checkpoint.application !== application)
  )
    throw new Error('Draft checkpoint belongs to another candidate');
  if (!checkpoint) {
    const existing = JSON.parse(
      await run([
        'release',
        'list',
        application,
        '--channel',
        receipt.channel,
        '--format',
        'json',
        '--limit',
        '100',
      ]),
    );
    if (!Array.isArray(existing))
      throw new Error('Release listing was not recognized; nothing uploaded');
    if (existing.some((release) => compare(release.version, receipt.version) > 0))
      throw new Error('A newer release already exists in this channel; use a higher version');
    if (existing.some((release) => release.version === receipt.version))
      throw new Error(
        'A release for this version/channel already exists; reconcile its draft instead of creating another',
      );
    checkpoint = { application, receiptHash, status: 'creating', published: false };
    await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { flag: 'wx' });
    const output = await run([
      'release',
      'draft',
      application,
      receipt.version,
      '--channel',
      receipt.channel,
      '--notes-file',
      resolve(directory, 'notes.md'),
    ]);
    checkpoint.releaseId = parseDraftId(output);
    checkpoint.status = 'created';
    await save();
  }
  if (!releaseId(checkpoint.releaseId))
    throw new Error(
      'Previous draft creation is uncertain. Reconcile its ID in Cloud before retrying.',
    );
  if (checkpoint.status === 'uploaded') return checkpoint;
  if (checkpoint.status !== 'created')
    throw new Error('Previous upload is uncertain. Inspect the Cloud draft before retrying.');
  checkpoint.status = 'uploading';
  await save();
  await run([
    'release',
    'upload',
    application,
    checkpoint.releaseId,
    '--channel',
    receipt.channel,
    '--file',
    resolve(directory, installer),
    '--signature',
    resolve(directory, signature),
    '--public-platform',
    'nsis-x86_64',
    '--update-platform',
    'windows-x86_64',
  ]);
  const remote = JSON.parse(
    await run(['release', 'show', application, checkpoint.releaseId, '--channel', receipt.channel]),
  );
  if (
    remote.id !== checkpoint.releaseId ||
    remote.status !== 'Draft' ||
    remote.version !== receipt.version ||
    remote.channel !== receipt.channel ||
    !Array.isArray(remote.assets) ||
    remote.assets.length !== 1 ||
    remote.assets[0].filename !== installer ||
    remote.assets[0].updatePlatform !== 'windows-x86_64' ||
    remote.assets[0].publicPlatform !== 'nsis-x86_64' ||
    remote.assets[0].signature !== (await readFile(resolve(directory, signature), 'utf8')).trim()
  )
    throw new Error('Uploaded draft metadata does not match the candidate; nothing published');
  checkpoint.status = 'uploaded';
  await save();
  return checkpoint;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? '');
  if (!process.argv[2]) throw new Error('Pass the candidate directory');
  const cli = process.env.CN_CLI ?? resolve(root, 'output/release-tools/cn.exe');
  const checkpoint = await uploadCandidate(directory, {
    key: process.env.CN_API_KEY,
    enabled: process.env.CLOUD_DRAFT_UPLOAD_ENABLED,
    publicKey: process.env.TAURI_UPDATER_PUBLIC_KEY,
    verifyPublisher: (file) =>
      execFileSync(
        'pwsh',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          resolve(root, 'scripts/release/azure-sign.ps1'),
          '-VerifyOnly',
          file,
        ],
        { stdio: 'pipe', timeout: 120000 },
      ),
    run: (args) => {
      try {
        return execFileSync(cli, [...args, '--no-quality-reports'], {
          encoding: 'utf8',
          timeout: 600000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });
      } catch {
        throw new Error(
          `CrabNebula ${args[1]} failed; inspect the saved checkpoint and Cloud before retrying`,
        );
      }
    },
  });
  console.log(`Candidate uploaded to draft ${checkpoint.releaseId}. No release published.`);
}
