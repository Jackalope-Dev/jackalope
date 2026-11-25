import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLOUD_TARGETS, MICROSOFT_STORE_URL } from '../../packages/contracts/src/release.ts';
import { compare, root, sha256 } from './catalog.mjs';
import { collectCandidates, releaseTargets } from './cloud-publish.mjs';

/**
 * Mirrors a published stable Cloud release to a public GitHub Release. It
 * attaches the installers that publication contains, as the exact candidate
 * bytes CrabNebula already serves, bound to it by the candidate digest. It
 * never builds or signs anything.
 */

const labels = {
  [CLOUD_TARGETS['darwin-aarch64'].cdnPlatform]: 'macOS (Apple silicon)',
  [CLOUD_TARGETS['darwin-x86_64'].cdnPlatform]: 'macOS (Intel)',
  [CLOUD_TARGETS['linux-x86_64'].cdnPlatform]: 'Linux x64 (AppImage)',
  [CLOUD_TARGETS['windows-x86_64'].cdnPlatform]: 'Windows x64 installer',
};
const marker = (digest) => `<!-- jackalope-github-release:${digest} -->`;

/** The GitHub Release for a verified Cloud plan: its tag, notes and attached files. */
export async function githubRelease(plan) {
  if (plan.channel !== 'stable') throw new Error('GitHub Releases mirror stable publications only');
  const installers = plan.assets.filter((asset) => labels[asset.publicPlatform]);
  if (!installers.length) throw new Error('The publication has no installers to mirror');
  const files = [];
  for (const asset of installers.sort((a, b) => a.name.localeCompare(b.name)))
    files.push({
      name: asset.name,
      path: asset.path,
      sha256: asset.sha256,
      size: (await stat(asset.path)).size,
      label: labels[asset.publicPlatform],
    });
  const sums = Buffer.from(files.map((file) => `${file.sha256}  ${file.name}\n`).join(''));
  files.push({ name: 'SHA256SUMS', content: sums, sha256: sha256(sums), size: sums.length });
  const downloads = files
    .filter((file) => file.label)
    .map((file) => `- ${file.label}: \`${file.name}\``);
  downloads.push(`- Windows (Microsoft Store): ${MICROSOFT_STORE_URL}`);
  const body = [
    plan.notes.trim(),
    '## Downloads',
    downloads.join('\n'),
    'These are the same signed files published to the Jackalope download service. `SHA256SUMS` lists their SHA-256 checksums.',
    marker(plan.digest),
  ].join('\n\n');
  return {
    tag: `v${plan.version}`,
    name: `Jackalope ${plan.version}`,
    version: plan.version,
    source: plan.source,
    marker: marker(plan.digest),
    body: `${body}\n`,
    assets: files,
  };
}

const sameBytes = (remote, local) =>
  remote.state === 'uploaded' &&
  remote.size === local.size &&
  // GitHub reports a SHA-256 digest for assets uploaded since mid-2025.
  (!remote.digest || remote.digest === `sha256:${local.sha256}`);

/**
 * Creates or completes the GitHub Release. A new release stays a draft until
 * every file is uploaded and verified, so a retry resumes it and readers never
 * see a partial release. Anything that does not match this publication stops
 * for an operator instead of being overwritten.
 */
export async function mirrorGithubRelease(release, github) {
  const checkTag = async () => {
    const tag = await github.findTag(release.tag);
    if (tag && (tag.type !== 'commit' || tag.sha !== release.source))
      throw new Error(`Tag ${release.tag} already identifies another source`);
    return tag;
  };
  await checkTag();
  const releases = await github.listReleases();
  const matches = releases.filter((item) => item.tag_name === release.tag);
  if (matches.length > 1)
    throw new Error(`Several GitHub Releases use ${release.tag}; reconcile them manually`);
  const created = !matches.length;
  let current =
    matches[0] ??
    (await github.createRelease({
      tag_name: release.tag,
      target_commitish: release.source,
      name: release.name,
      body: release.body,
      draft: true,
      prerelease: false,
    }));
  const expected = new Map(release.assets.map((asset) => [asset.name, asset]));
  const validate = () => {
    if (
      current.tag_name !== release.tag ||
      current.prerelease ||
      !Array.isArray(current.assets) ||
      !current.body?.includes(release.marker) ||
      (current.draft && current.target_commitish !== release.source)
    )
      throw new Error(
        `GitHub Release ${release.tag} does not match this publication; inspect it before retrying`,
      );
    for (const asset of current.assets) {
      const local = expected.get(asset.name);
      if (!local) throw new Error(`Unexpected GitHub Release asset: ${asset.name}`);
      if (asset.state === 'uploaded' && !sameBytes(asset, local))
        throw new Error(`GitHub Release asset does not match the publication: ${asset.name}`);
    }
  };
  validate();
  const complete = () =>
    current.assets.length === expected.size &&
    current.assets.every((asset) => asset.state === 'uploaded');
  const published = current.draft;
  if (!current.draft && !complete())
    throw new Error(
      `Published GitHub Release ${release.tag} has missing assets; inspect it before retrying`,
    );
  if (current.draft) {
    for (const asset of current.assets)
      if (asset.state !== 'uploaded') await github.deleteAsset(asset.id);
    const present = new Set(
      current.assets.filter((asset) => asset.state === 'uploaded').map((a) => a.name),
    );
    for (const asset of release.assets)
      if (!present.has(asset.name))
        await github.uploadAsset(
          current,
          asset.name,
          asset.content ?? (await readFile(asset.path)),
        );
    current = await github.getRelease(current.id);
    validate();
    if (!complete()) throw new Error('GitHub Release upload is incomplete; retry this job');
    const newer = releases.some((item) => {
      const version = /^v(\d+\.\d+\.\d+)$/.exec(item.tag_name ?? '')?.[1];
      return !item.draft && !item.prerelease && version && compare(version, release.version) > 0;
    });
    current = await github.updateRelease(current.id, {
      draft: false,
      make_latest: newer ? 'false' : 'true',
    });
    validate();
    if (current.draft) throw new Error('GitHub Release publication was not confirmed');
  }
  if (!(await checkTag())) throw new Error(`Tag ${release.tag} was not created`);
  return { id: current.id, tag: release.tag, url: current.html_url, created, published };
}

/** The GitHub REST calls the mirror needs, authenticated with the workflow token. */
export function githubClient({ token, repository, fetcher = fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''))
    throw new Error('GitHub token and repository are required');
  const api = `https://api.github.com/repos/${repository}`;
  const request = async (method, url, { json, bytes, missing = false } = {}) => {
    const response = await fetcher(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(bytes ? 1800000 : 60000),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(json ? { 'content-type': 'application/json' } : {}),
        ...(bytes ? { 'content-type': 'application/octet-stream' } : {}),
      },
      body: bytes ?? (json ? JSON.stringify(json) : undefined),
    });
    if (missing && response.status === 404) return null;
    if (!response.ok)
      throw new Error(`GitHub ${method} ${new URL(url).pathname} failed (HTTP ${response.status})`);
    return response.status === 204 ? null : response.json();
  };
  return {
    findTag: async (tag) => {
      const refs = await request('GET', `${api}/git/matching-refs/tags/${tag}`);
      const ref = refs.find((item) => item.ref === `refs/tags/${tag}`);
      return ref ? { type: ref.object.type, sha: ref.object.sha } : null;
    },
    listReleases: async () => {
      const all = [];
      for (let page = 1; page <= 10; page++) {
        const items = await request('GET', `${api}/releases?per_page=100&page=${page}`);
        all.push(...items);
        if (items.length < 100) return all;
      }
      throw new Error('Too many GitHub Releases to check for duplicates');
    },
    getRelease: (id) => request('GET', `${api}/releases/${id}`),
    createRelease: (json) => request('POST', `${api}/releases`, { json }),
    updateRelease: (id, json) => request('PATCH', `${api}/releases/${id}`, { json }),
    deleteAsset: (id) => request('DELETE', `${api}/releases/assets/${id}`, { missing: true }),
    uploadAsset: (release, name, bytes) => {
      const upload = new URL(release.upload_url.replace(/\{[^}]*\}$/, ''));
      if (upload.origin !== 'https://uploads.github.com')
        throw new Error('Unexpected GitHub upload URL');
      upload.searchParams.set('name', name);
      return request('POST', upload.href, { bytes });
    },
  };
}

/** The Cloud publication this run confirmed: its source and candidate digest. */
export async function publishedCloudRelease(directory) {
  const records = [];
  const visit = async (path, depth) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = resolve(path, entry.name);
      if (entry.isDirectory() && depth < 1) await visit(full, depth + 1);
      else if (entry.isFile() && entry.name === 'cloud-release.json')
        records.push(JSON.parse(await readFile(full, 'utf8')));
    }
  };
  await visit(resolve(directory), 0);
  const published = records.filter((record) => record.status === 'Published');
  if (
    !published.length ||
    published.some(
      (record) => record.source !== published[0].source || record.digest !== published[0].digest,
    )
  )
    throw new Error('No single confirmed Cloud publication was found for this run');
  return { source: published[0].source, digest: published[0].digest };
}

if (import.meta.main) {
  const [candidates, publication] = process.argv.slice(2).map((path) => resolve(path));
  if (!candidates || !publication)
    throw new Error('Usage: github-release.mjs CANDIDATES PUBLICATION');
  const published = await publishedCloudRelease(publication);
  const plan = await collectCandidates(candidates, {
    expectedTargets: releaseTargets(process.env.CLOUD_RELEASE_TARGETS),
    source: published.source,
    channel: process.env.RELEASE_CHANNEL,
    publicKey: process.env.TAURI_UPDATER_PUBLIC_KEY,
  });
  if (plan.digest !== published.digest)
    throw new Error('Candidates differ from the confirmed Cloud publication');
  const release = await githubRelease(plan);
  // Fail closed: only an installer carrying a valid, timestamped Jackalope
  // Digital LLC Authenticode signature from the Azure signing path is attached.
  for (const asset of release.assets.filter((item) => item.name.endsWith('.exe')))
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
  const result = await mirrorGithubRelease(
    release,
    githubClient({ token: process.env.GH_TOKEN, repository: process.env.GITHUB_REPOSITORY }),
  );
  console.log(
    `${result.published ? 'Published' : 'Already published'} GitHub Release ${result.tag}: ${result.url}`,
  );
}
