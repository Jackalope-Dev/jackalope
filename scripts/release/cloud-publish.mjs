import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, root, sha256 } from './catalog.mjs';
import { validateCloudFiles } from './cloud-artifacts.mjs';
import { targets } from './cloud-targets.mjs';
import { parseDraftId } from './cloud-upload.mjs';
import { application } from './crabnebula-config.mjs';
import { waitForSourceChecks } from './source-checks.mjs';

export function releaseTargets(value) {
  const result = JSON.parse(value);
  if (
    !Array.isArray(result) ||
    !result.length ||
    new Set(result).size !== result.length ||
    result.some((target) => !targets.includes(target))
  )
    throw new Error('Select a nonempty set of supported release targets');
  return [...result].sort();
}

export async function collectCandidates(
  directory,
  { expectedTargets, source, channel, publicKey },
) {
  if (!/^[a-f0-9]{40}$/.test(source) || !['beta', 'stable'].includes(channel) || !publicKey)
    throw new Error('Expected source, channel and updater key are required');
  const packages = [];
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(directory, entry.name));
  if (entries.some((entry) => entry.isFile() && entry.name === 'receipt.json'))
    paths.push(resolve(directory));
  for (const path of paths) {
    const candidate = await validateCloudFiles(path, { requireCandidate: true });
    packages.push({ ...candidate, directory: path });
  }
  const found = packages.map(({ receipt }) => receipt.target).sort();
  if (JSON.stringify(found) !== JSON.stringify(releaseTargets(JSON.stringify(expectedTargets))))
    throw new Error('Missing, duplicate or unexpected platform candidates');
  const first = packages[0];
  const notes = await readFile(resolve(first.directory, 'notes.md'), 'utf8');
  const assets = [];
  for (const candidate of packages.sort((a, b) =>
    a.receipt.target.localeCompare(b.receipt.target),
  )) {
    const { receipt, directory: path, config } = candidate;
    if (
      receipt.source !== source ||
      receipt.channel !== channel ||
      receipt.version !== first.receipt.version ||
      config.plugins.updater.pubkey !== publicKey ||
      (await readFile(resolve(path, 'notes.md'), 'utf8')) !== notes
    )
      throw new Error('Candidates disagree on source, channel, version, notes or updater trust');
    for (const asset of candidate.assets) {
      assets.push({
        ...asset,
        path: resolve(path, asset.name),
        sha256: receipt.files[asset.name],
        ...(asset.updatePlatform
          ? {
              signature: (await readFile(resolve(path, `${asset.name}.sig`), 'utf8')).trim(),
              signaturePath: resolve(path, `${asset.name}.sig`),
            }
          : {}),
      });
    }
  }
  const identity = {
    application,
    source,
    channel,
    version: first.receipt.version,
    targets: found,
    publicKey,
    notes,
    assets: assets.map(({ path: _path, signaturePath: _signaturePath, ...asset }) => asset),
  };
  const digest = sha256(Buffer.from(JSON.stringify(identity)));
  return {
    ...identity,
    assets,
    digest,
    remoteNotes: `${notes}\n\n<!-- jackalope-release:${digest} -->`,
  };
}

export async function publishCloud(
  plan,
  { run, readAssetHash, ensureTag, publish = false, acceptedTargets = [], betaTestTargets = [] },
) {
  if (
    publish &&
    JSON.stringify([...acceptedTargets].sort()) !== JSON.stringify(plan.targets) &&
    !(
      plan.channel === 'beta' &&
      JSON.stringify([...betaTestTargets].sort()) === JSON.stringify(plan.targets)
    )
  )
    throw new Error('Installed acceptance must cover exactly the selected release targets');
  const common = [application, '--channel', plan.channel];
  const listing = JSON.parse(
    await run(['release', 'list', ...common, '--format', 'json', '--limit', '100']),
  );
  if (!Array.isArray(listing)) throw new Error('Unrecognized Cloud release listing');
  if (listing.some((item) => compare(item.version, plan.version) > 0))
    throw new Error('A newer channel release exists; never roll the update feed backwards');
  const existing = listing.filter((item) => item.version === plan.version);
  if (existing.length > 1)
    throw new Error('Duplicate remote release versions require operator reconciliation');
  let id = existing[0]?.id;
  if (!id)
    id = parseDraftId(
      await run([
        'release',
        'draft',
        application,
        plan.version,
        '--channel',
        plan.channel,
        '--notes-file',
        plan.notesPath,
      ]),
    );
  const show = async () =>
    JSON.parse(await run(['release', 'show', application, id, '--channel', plan.channel]));
  let remote = await show();
  const validateRelease = () => {
    if (
      remote.id !== id ||
      remote.version !== plan.version ||
      remote.channel !== plan.channel ||
      !['Draft', 'Published'].includes(remote.status) ||
      remote.notes !== plan.remoteNotes ||
      !Array.isArray(remote.assets)
    )
      throw new Error('Remote release identity does not match this source and artifact set');
    const names = remote.assets.map((asset) => asset.filename);
    if (
      new Set(names).size !== names.length ||
      names.some((name) => !plan.assets.some((asset) => asset.name === name))
    )
      throw new Error('Unexpected or duplicate assets in the remote release');
  };
  validateRelease();
  const checkAsset = async (local, remoteAsset) => {
    if (
      (remoteAsset.publicPlatform || undefined) !== local.publicPlatform ||
      (remoteAsset.updatePlatform || undefined) !== local.updatePlatform ||
      (remoteAsset.signature || undefined) !== local.signature ||
      (await readAssetHash(remoteAsset.id)) !== local.sha256
    )
      throw new Error(`Remote artifact does not match candidate: ${local.name}`);
  };
  // Validate every existing asset before resuming any interrupted upload.
  for (const asset of plan.assets) {
    const match = remote.assets.find((item) => item.filename === asset.name);
    if (match) await checkAsset(asset, match);
    else if (remote.status === 'Published') throw new Error('Published release has missing assets');
  }
  for (const asset of plan.assets) {
    if (remote.assets.some((item) => item.filename === asset.name)) continue;
    await run([
      'release',
      'upload',
      application,
      id,
      '--channel',
      plan.channel,
      '--file',
      asset.path,
      ...(asset.publicPlatform ? ['--public-platform', asset.publicPlatform] : []),
      ...(asset.updatePlatform
        ? ['--update-platform', asset.updatePlatform, '--signature', asset.signaturePath]
        : []),
    ]);
  }
  remote = await show();
  validateRelease();
  if (remote.assets.length !== plan.assets.length) throw new Error('Incomplete remote release');
  for (const asset of plan.assets)
    await checkAsset(
      asset,
      remote.assets.find((item) => item.filename === asset.name),
    );
  if (publish) {
    await ensureTag(`${plan.channel}-v${plan.version}`, plan.source);
    if (remote.status !== 'Published')
      await run(['release', 'publish', application, id, '--channel', plan.channel]);
    remote = await show();
    validateRelease();
    if (remote.status !== 'Published')
      throw new Error('Publication not confirmed; inspect Cloud before retrying');
  }
  return { id, status: remote.status, source: plan.source, digest: plan.digest };
}

async function assetHash(id) {
  if (typeof id !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))
    throw new Error('Unrecognized asset ID');
  return downloadHash(`https://cdn.crabnebula.app/asset/${id}`);
}

async function downloadHash(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(600000),
  });
  if (!response.ok || !response.url.startsWith('https://'))
    throw new Error('Cannot verify uploaded asset bytes');
  const hash = createHash('sha256');
  for await (const bytes of response.body) hash.update(bytes);
  return hash.digest('hex');
}

export async function verifyUpdateFeeds(
  plan,
  { fetcher = fetch, readDownloadHash = downloadHash } = {},
) {
  for (const asset of plan.assets.filter((item) => item.updatePlatform)) {
    const response = await fetcher(
      `https://cdn.crabnebula.app/update/${application}/${asset.updatePlatform}/0.0.0?channel=${plan.channel}`,
      { signal: AbortSignal.timeout(30000), redirect: 'error' },
    );
    if (response.status !== 200)
      throw new Error(
        `Update feed not ready for ${asset.updatePlatform}; retry publication verification`,
      );
    const manifest = await response.json();
    const url = new URL(manifest.url);
    if (
      manifest.version !== plan.version ||
      manifest.signature !== asset.signature ||
      url.origin !== 'https://cdn.crabnebula.app' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      (await readDownloadHash(url.href)) !== asset.sha256
    )
      throw new Error(`Published update feed does not match ${asset.updatePlatform}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? '');
  const publishing = process.argv[3] === 'publish';
  if (!process.argv[2] || !['draft', 'publish'].includes(process.argv[3]))
    throw new Error('Usage: cloud-publish.mjs DIRECTORY draft|publish');
  if (
    !process.env.CN_API_KEY ||
    process.env.CLOUD_DRAFT_UPLOAD_ENABLED !== 'true' ||
    (publishing && process.env.CLOUD_PUBLISH_ENABLED !== 'true')
  )
    throw new Error('Cloud upload/publication is disabled or missing credentials');
  const plan = await collectCandidates(directory, {
    expectedTargets: releaseTargets(process.env.CLOUD_RELEASE_TARGETS),
    source: process.env.EXPECTED_SOURCE ?? process.env.GITHUB_SHA,
    channel: process.env.RELEASE_CHANNEL,
    publicKey: process.env.TAURI_UPDATER_PUBLIC_KEY,
  });
  for (const asset of plan.assets.filter((item) => item.publicPlatform === 'nsis-x86_64'))
    execFileSync(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        resolve(root, 'scripts/release/azure-sign.ps1'),
        '-VerifyOnly',
        asset.path,
      ],
      { stdio: 'pipe', timeout: 120000 },
    );
  plan.notesPath = resolve(directory, 'cloud-notes.md');
  await writeFile(plan.notesPath, plan.remoteNotes);
  const gh = (args, options = {}) =>
    execFileSync('gh', args, { encoding: 'utf8', windowsHide: true, ...options });
  if (publishing)
    await waitForSourceChecks(
      () =>
        JSON.parse(
          gh([
            'api',
            `repos/${process.env.GITHUB_REPOSITORY}/commits/${plan.source}/check-runs?per_page=100`,
          ]),
        ).check_runs,
    );
  const result = await publishCloud(plan, {
    publish: publishing,
    acceptedTargets: JSON.parse(process.env.CLOUD_ACCEPTED_TARGETS ?? '[]'),
    betaTestTargets:
      process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
        ? JSON.parse(process.env.CLOUD_BETA_TEST_TARGETS ?? '[]')
        : [],
    readAssetHash: assetHash,
    ensureTag: async (tag, source) => {
      const refs = JSON.parse(
        gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/git/matching-refs/tags/${tag}`]),
      );
      const existing = refs.find((ref) => ref.ref === `refs/tags/${tag}`);
      if (existing) {
        if (existing.object.type !== 'commit' || existing.object.sha !== source)
          throw new Error('Release tag already identifies another source');
      } else
        gh(
          [
            'api',
            `repos/${process.env.GITHUB_REPOSITORY}/git/refs`,
            '--method',
            'POST',
            '--input',
            '-',
          ],
          { input: JSON.stringify({ ref: `refs/tags/${tag}`, sha: source }) },
        );
    },
    run: async (args) => {
      try {
        return execFileSync(
          process.env.CN_CLI ?? resolve(root, 'output/release-tools/cn.exe'),
          [...args, '--no-quality-reports'],
          { encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        );
      } catch {
        throw new Error(
          `Cloud ${args[1]} failed. Preserve the candidates and inspect Cloud; retry only the publication job with the same artifacts.`,
        );
      }
    },
  });
  if (publishing) await verifyUpdateFeeds(plan);
  await writeFile(resolve(directory, 'cloud-release.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${result.status}: ${result.id}`);
}
