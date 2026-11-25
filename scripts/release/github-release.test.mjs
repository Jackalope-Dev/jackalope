import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { MICROSOFT_STORE_URL } from '../../packages/contracts/src/release.ts';
import { sha256 } from './catalog.mjs';
import { collectCandidates } from './cloud-publish.mjs';
import { cloudFiles, targets } from './cloud-targets.mjs';
import { application, cloudConfig } from './crabnebula-config.mjs';
import {
  githubClient,
  githubRelease,
  mirrorGithubRelease,
  publishedCloudRelease,
  unsignedWindowsNotice,
} from './github-release.mjs';

const publicKey = Buffer.from('test public key').toString('base64');
const source = 'b'.repeat(40);
const unix = ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64'];

async function candidates(t, selected = unix, channel = 'stable', authenticode) {
  const windows = (target) => target === 'windows-x86_64' && authenticode;
  const directory = await mkdtemp(resolve(tmpdir(), 'jackalope-github-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const target of selected) {
    const path = resolve(directory, target);
    await mkdir(path);
    const receipt = {
      schemaVersion: 1,
      application,
      source,
      sourceDirty: false,
      mode: 'candidate',
      version: '0.3.0',
      channel,
      target,
      distribution: target.startsWith('windows-')
        ? 'nsis'
        : target.startsWith('darwin-')
          ? 'dmg'
          : 'appimage',
      approvalRequired: true,
      publicSigned: true,
      ...(windows(target) ? { authenticode } : {}),
      files: {},
    };
    const config = cloudConfig({
      mode: 'candidate',
      channel,
      target,
      publicKey,
      signScript: 'C:/repo/sign.ps1',
      ...(windows(target) ? { authenticode } : {}),
    });
    for (const name of cloudFiles(target, '0.3.0', 'candidate')) {
      const text =
        name === 'tauri.cloud.json'
          ? JSON.stringify(config)
          : name === 'notes.md'
            ? '## Highlights\n\n- A useful improvement.\n'
            : name.endsWith('.sig')
              ? Buffer.from('fixture signature').toString('base64')
              : `fixture bytes: ${name}`;
      await writeFile(resolve(path, name), text);
      receipt.files[name] = sha256(Buffer.from(text));
    }
    await writeFile(resolve(path, 'receipt.json'), JSON.stringify(receipt));
  }
  return collectCandidates(directory, {
    expectedTargets: selected,
    source,
    channel,
    publicKey,
    allowUnsignedWindows: authenticode === 'unsigned',
  });
}

function fakeGithub() {
  const state = { releases: [], tags: new Map(), writes: [], interrupt: null, nextId: 1 };
  const find = (id) => state.releases.find((release) => release.id === id);
  const copy = (value) => structuredClone(value);
  return {
    state,
    client: {
      findTag: async (tag) => copy(state.tags.get(tag) ?? null),
      listReleases: async () => copy(state.releases),
      getRelease: async (id) => copy(find(id)),
      createRelease: async (data) => {
        state.writes.push('create');
        const id = state.nextId++;
        const release = {
          id,
          ...data,
          html_url: `https://github.com/example/releases/${id}`,
          upload_url: `https://uploads.github.com/repos/example/releases/${id}/assets{?name,label}`,
          assets: [],
        };
        state.releases.push(release);
        return copy(release);
      },
      updateRelease: async (id, data) => {
        state.writes.push(`publish:${data.make_latest}`);
        const release = find(id);
        release.draft = data.draft;
        if (!release.draft)
          state.tags.set(release.tag_name, { type: 'commit', sha: release.target_commitish });
        return copy(release);
      },
      deleteAsset: async (id) => {
        state.writes.push('delete');
        for (const release of state.releases)
          release.assets = release.assets.filter((asset) => asset.id !== id);
      },
      uploadAsset: async (release, name, bytes) => {
        state.writes.push(`upload:${name}`);
        const asset = {
          id: state.nextId++,
          name,
          size: bytes.length,
          state: 'uploaded',
          digest: `sha256:${sha256(bytes)}`,
        };
        find(release.id).assets.push(asset);
        if (state.interrupt === name) {
          state.interrupt = null;
          asset.state = 'starter';
          throw new Error('Lost upload response');
        }
        return copy(asset);
      },
    },
  };
}

test('stable releases mirror the published installers with checksums and the release notes', async (t) => {
  const plan = await candidates(t);
  const release = await githubRelease(plan);
  assert.equal(release.tag, 'v0.3.0');
  assert.equal(release.source, source);
  assert.deepEqual(
    release.assets.map((asset) => asset.name),
    [
      'Jackalope_0.3.0_aarch64.dmg',
      'Jackalope_0.3.0_x86_64.AppImage',
      'Jackalope_0.3.0_x86_64.dmg',
      'SHA256SUMS',
    ],
  );
  const sums = release.assets.at(-1).content.toString();
  for (const asset of release.assets.slice(0, -1)) {
    assert.equal(asset.sha256, sha256(Buffer.from(`fixture bytes: ${asset.name}`)));
    assert.match(sums, new RegExp(`^${asset.sha256}  ${asset.name.replaceAll('.', '\\.')}$`, 'm'));
  }
  assert.ok(release.body.startsWith('## Highlights\n\n- A useful improvement.'));
  assert.ok(release.body.includes(MICROSOFT_STORE_URL));
  assert.ok(release.body.includes(release.marker));
  assert.ok(release.marker.includes(plan.digest));

  const windows = await githubRelease(await candidates(t, targets));
  assert.ok(windows.assets.some((asset) => asset.name === 'Jackalope_0.3.0_x64-setup.exe'));
  assert.ok(windows.body.includes('Windows x64 installer: `Jackalope_0.3.0_x64-setup.exe`'));
  assert.ok(windows.body.includes('These are the same signed files'));
  assert.ok(!windows.body.includes(unsignedWindowsNotice));
  assert.ok(!release.body.includes(unsignedWindowsNotice));
  await assert.rejects(
    githubRelease(await candidates(t, unix, 'beta')),
    /stable publications only/,
  );
});

test('an opted-in unsigned Windows installer is marked in the release notes', async (t) => {
  const release = await githubRelease(await candidates(t, targets, 'stable', 'unsigned'));
  assert.ok(
    release.body.includes(
      'Windows x64 installer (not code-signed): `Jackalope_0.3.0_x64-setup.exe`',
    ),
  );
  assert.ok(release.body.includes(unsignedWindowsNotice));
  assert.match(unsignedWindowsNotice, /SmartScreen/);
  assert.match(unsignedWindowsNotice, /More info\*\*, then \*\*Run anyway/);
  assert.ok(!release.body.includes('same signed files'));
  const sums = release.assets.find((asset) => asset.name === 'SHA256SUMS').content.toString();
  const installer = release.assets.find((asset) => asset.name === 'Jackalope_0.3.0_x64-setup.exe');
  assert.ok(sums.includes(`${installer.sha256}  ${installer.name}\n`));
  // Without the opt-in the mirror refuses to collect the same candidates.
  await assert.rejects(
    collectCandidates(resolve(installer.path, '../..'), {
      expectedTargets: targets,
      source,
      channel: 'stable',
      publicKey,
    }),
    /WINDOWS_AUTHENTICODE=unsigned/,
  );
});

test('mirroring publishes one complete release, resumes interrupted uploads and is idempotent', async (t) => {
  const release = await githubRelease(await candidates(t));
  const github = fakeGithub();
  github.state.interrupt = 'Jackalope_0.3.0_x86_64.dmg';
  await assert.rejects(mirrorGithubRelease(release, github.client), /Lost upload response/);
  assert.equal(github.state.releases[0].draft, true);
  assert.ok(!github.state.tags.has('v0.3.0'));

  const result = await mirrorGithubRelease(release, github.client);
  assert.equal(result.published, true);
  assert.equal(github.state.releases.length, 1);
  const published = github.state.releases[0];
  assert.equal(published.draft, false);
  assert.equal(published.target_commitish, source);
  assert.deepEqual(
    published.assets.map((asset) => asset.name).sort(),
    release.assets.map((asset) => asset.name).sort(),
  );
  assert.ok(published.assets.every((asset) => asset.state === 'uploaded'));
  assert.equal(github.state.writes.filter((write) => write === 'create').length, 1);
  assert.ok(github.state.writes.includes('delete'));
  assert.equal(github.state.writes.at(-1), 'publish:true');

  const writes = github.state.writes.length;
  const again = await mirrorGithubRelease(release, github.client);
  assert.equal(again.published, false);
  assert.equal(github.state.writes.length, writes);
});

test('mirroring stops on foreign releases, changed bytes and moved tags', async (t) => {
  const release = await githubRelease(await candidates(t));

  const moved = fakeGithub();
  moved.state.tags.set('v0.3.0', { type: 'commit', sha: 'c'.repeat(40) });
  await assert.rejects(mirrorGithubRelease(release, moved.client), /another source/);

  const foreign = fakeGithub();
  await foreign.client.createRelease({ tag_name: 'v0.3.0', body: 'Hand written', draft: false });
  await assert.rejects(mirrorGithubRelease(release, foreign.client), /does not match/);

  const changed = fakeGithub();
  await mirrorGithubRelease(release, changed.client);
  changed.state.releases[0].assets[0].digest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(mirrorGithubRelease(release, changed.client), /does not match/);

  const missing = fakeGithub();
  await mirrorGithubRelease(release, missing.client);
  missing.state.releases[0].assets.pop();
  await assert.rejects(mirrorGithubRelease(release, missing.client), /missing assets/);

  const extra = fakeGithub();
  await mirrorGithubRelease(release, extra.client);
  extra.state.releases[0].assets.push({ id: 99, name: 'other.zip', size: 1, state: 'uploaded' });
  await assert.rejects(mirrorGithubRelease(release, extra.client), /Unexpected/);

  const newer = fakeGithub();
  newer.state.releases.push({ id: 50, tag_name: 'v0.4.0', draft: false, assets: [] });
  await mirrorGithubRelease(release, newer.client);
  assert.equal(newer.state.writes.at(-1), 'publish:false');
});

test('only a confirmed Cloud publication from this run identifies the release', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'jackalope-publication-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(publishedCloudRelease(directory), /No single confirmed/);
  await mkdir(resolve(directory, 'cloud-publication-1'));
  await writeFile(
    resolve(directory, 'cloud-publication-1/cloud-release.json'),
    JSON.stringify({ status: 'Draft', source, digest: 'd1' }),
  );
  await assert.rejects(publishedCloudRelease(directory), /No single confirmed/);
  await mkdir(resolve(directory, 'cloud-publication-2'));
  await writeFile(
    resolve(directory, 'cloud-publication-2/cloud-release.json'),
    JSON.stringify({ status: 'Published', source, digest: 'd2' }),
  );
  assert.deepEqual(await publishedCloudRelease(directory), { source, digest: 'd2' });
  await mkdir(resolve(directory, 'cloud-publication-3'));
  await writeFile(
    resolve(directory, 'cloud-publication-3/cloud-release.json'),
    JSON.stringify({ status: 'Published', source, digest: 'd3' }),
  );
  await assert.rejects(publishedCloudRelease(directory), /No single confirmed/);
});

test('the GitHub client only uploads to the GitHub upload host', async () => {
  const calls = [];
  const client = githubClient({
    token: 'token',
    repository: 'Jackalope-Dev/jackalope',
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: 1 }), { status: 201 });
    },
  });
  await client.uploadAsset(
    { upload_url: 'https://uploads.github.com/repos/x/y/releases/7/assets{?name,label}' },
    'SHA256SUMS',
    Buffer.from('sums'),
  );
  assert.equal(
    calls[0].url,
    'https://uploads.github.com/repos/x/y/releases/7/assets?name=SHA256SUMS',
  );
  assert.equal(calls[0].options.headers['content-type'], 'application/octet-stream');
  assert.throws(
    () =>
      client.uploadAsset(
        { upload_url: 'https://evil.example/upload{?name,label}' },
        'x',
        Buffer.from(''),
      ),
    /Unexpected GitHub upload URL/,
  );
  assert.throws(() => githubClient({ token: '', repository: 'a/b' }), /required/);
});
