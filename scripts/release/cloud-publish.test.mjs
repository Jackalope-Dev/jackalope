import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { sha256 } from './catalog.mjs';
import {
  collectCandidates,
  publishCloud,
  releaseTargets,
  verifyUpdateFeeds,
} from './cloud-publish.mjs';
import { cloudFiles, targets } from './cloud-targets.mjs';
import { application, cloudConfig } from './crabnebula-config.mjs';
import { nextVersion } from './prepare-release.mjs';

const publicKey = Buffer.from('test public key').toString('base64');
const source = 'a'.repeat(40);
const id = '01JSGWMMTRBTD4YSBEVE3W5B7V';

async function fixture(t, selectedTargets = targets, flat = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'jackalope-multiplatform-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const target of selectedTargets) {
    const path = flat ? directory : resolve(directory, target);
    await mkdir(path, { recursive: true });
    const receipt = {
      schemaVersion: 1,
      application,
      source,
      sourceDirty: false,
      mode: 'candidate',
      version: '0.2.0',
      channel: 'beta',
      target,
      distribution: target.startsWith('windows-')
        ? 'nsis'
        : target.startsWith('darwin-')
          ? 'dmg'
          : 'appimage',
      approvalRequired: true,
      publicSigned: true,
      files: {},
    };
    const config = cloudConfig({
      mode: 'candidate',
      channel: 'beta',
      target,
      publicKey,
      signScript: 'C:/repo/sign.ps1',
    });
    for (const name of cloudFiles(target, '0.2.0', 'candidate')) {
      const text =
        name === 'tauri.cloud.json'
          ? JSON.stringify(config)
          : name === 'notes.md'
            ? 'A useful improvement.'
            : name.endsWith('.sig')
              ? Buffer.from('fixture signature').toString('base64')
              : `fixture bytes: ${name}`;
      await writeFile(resolve(path, name), text);
      receipt.files[name] = sha256(Buffer.from(text));
    }
    await writeFile(resolve(path, 'receipt.json'), JSON.stringify(receipt));
  }
  const options = { expectedTargets: selectedTargets, source, channel: 'beta', publicKey };
  return { directory, options, plan: await collectCandidates(directory, options) };
}

function remoteFixture(plan) {
  const state = {
    release: null,
    writes: [],
    hashes: new Map(),
    failUpload: false,
    failPublish: false,
  };
  const options = {
    publish: true,
    acceptedTargets: targets,
    ensureTag: async (tag, sha) => {
      assert.equal(tag, 'beta-v0.2.0');
      assert.equal(sha, source);
      state.writes.push('tag');
    },
    readAssetHash: async (id) => state.hashes.get(id),
    run: async (args) => {
      const command = args[1];
      assert.ok(args.includes('--channel'));
      if (command === 'list') return JSON.stringify(state.release ? [state.release] : []);
      if (command === 'show') return JSON.stringify(state.release);
      state.writes.push(command);
      if (command === 'draft') {
        state.release = {
          id,
          status: 'Draft',
          version: plan.version,
          channel: plan.channel,
          notes: plan.remoteNotes,
          assets: [],
        };
        return id;
      }
      if (command === 'upload') {
        const asset = plan.assets.find((item) => item.path === args[args.indexOf('--file') + 1]);
        const assetId = `${id}-${state.release.assets.length}`;
        state.release.assets.push({
          id: assetId,
          filename: asset.name,
          publicPlatform: asset.publicPlatform,
          updatePlatform: asset.updatePlatform,
          signature: asset.signature,
        });
        state.hashes.set(assetId, asset.sha256);
        if (state.failUpload) {
          state.failUpload = false;
          throw new Error('Lost upload response');
        }
      }
      if (command === 'publish') {
        state.release.status = 'Published';
        if (state.failPublish) {
          state.failPublish = false;
          throw new Error('Lost publish response');
        }
      }
      return '';
    },
  };
  return { state, options };
}

test('release preparation calculates explicit bumps without prerelease suffixes or downgrades', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.3', '2.3.4'), '2.3.4');
  for (const bump of ['1.2.3', '0.9.0', '2.0.0-beta.1', 'latest'])
    assert.throws(() => nextVersion('1.2.3', bump));
});

test('candidate collection requires complete targets with matching source, notes, key and hashes', async (t) => {
  const { directory, options, plan } = await fixture(t);
  assert.equal(plan.assets.length, 6);
  assert.equal(new Set(plan.assets.map((asset) => asset.name)).size, 6);
  for (const overrides of [
    { expectedTargets: targets.slice(1) },
    { source: 'b'.repeat(40) },
    { channel: 'stable' },
    { publicKey: 'wrong' },
  ])
    await assert.rejects(collectCandidates(directory, { ...options, ...overrides }));
  await writeFile(resolve(directory, 'linux-x86_64', 'notes.md'), 'changed');
  await assert.rejects(collectCandidates(directory, options), /Artifact changed/);
});

test('target selections reject duplicates, empty sets and unsupported platforms', () => {
  for (const selected of [[], ['windows-x86_64', 'windows-x86_64'], ['darwin-arm64'], {}])
    assert.throws(() => releaseTargets(JSON.stringify(selected)));
});

test('single artifact downloads accept flat and nested layouts with identical release identity', async (t) => {
  const nested = await fixture(t, ['linux-x86_64']);
  const flat = await fixture(t, ['linux-x86_64'], true);
  assert.equal(flat.plan.digest, nested.plan.digest);
  assert.deepEqual(flat.plan.targets, ['linux-x86_64']);
  await assert.rejects(
    collectCandidates(flat.directory, { ...flat.options, expectedTargets: targets }),
    /Missing, duplicate or unexpected/,
  );
  await assert.rejects(
    collectCandidates(flat.directory, { ...flat.options, source: 'b'.repeat(40) }),
    /Candidates disagree/,
  );
  await writeFile(resolve(flat.directory, 'notes.md'), 'changed');
  await assert.rejects(collectCandidates(flat.directory, flat.options), /Artifact changed/);
});

test('mixed artifact layouts cannot hide a duplicate platform candidate', async (t) => {
  const nested = await fixture(t, ['linux-x86_64']);
  const flat = await fixture(t, ['linux-x86_64'], true);
  await cp(resolve(nested.directory, 'linux-x86_64'), resolve(flat.directory, 'duplicate'), {
    recursive: true,
  });
  await assert.rejects(
    collectCandidates(flat.directory, flat.options),
    /Missing, duplicate or unexpected/,
  );
});

test('publication waits for all six assets and binds an immutable tag to candidate source', async (t) => {
  const { plan } = await fixture(t);
  const { options, state } = remoteFixture(plan);
  const result = await publishCloud(plan, options);
  assert.equal(result.status, 'Published');
  assert.deepEqual(state.writes, ['draft', ...Array(6).fill('upload'), 'tag', 'publish']);
  await publishCloud(plan, options);
  assert.equal(state.writes.filter((entry) => entry === 'upload').length, 6);
  assert.equal(state.writes.filter((entry) => entry === 'publish').length, 1);
});

test('draft-only mode uploads without a tag or publication; later promotion uses the same bytes', async (t) => {
  const { plan } = await fixture(t);
  const { options, state } = remoteFixture(plan);
  assert.equal((await publishCloud(plan, { ...options, publish: false })).status, 'Draft');
  assert.ok(!state.writes.includes('tag'));
  assert.ok(!state.writes.includes('publish'));
  await publishCloud(plan, options);
  assert.equal(state.writes.filter((entry) => entry === 'upload').length, 6);
});

test('uncertain upload and publish responses are reconciled without repeating successful mutations', async (t) => {
  const { plan } = await fixture(t);
  const { options, state } = remoteFixture(plan);
  state.failUpload = true;
  await assert.rejects(publishCloud(plan, options), /Lost upload/);
  state.failPublish = true;
  await assert.rejects(publishCloud(plan, options), /Lost publish/);
  await publishCloud(plan, options);
  assert.equal(state.writes.filter((entry) => entry === 'draft').length, 1);
  assert.equal(state.writes.filter((entry) => entry === 'upload').length, 6);
  assert.equal(state.writes.filter((entry) => entry === 'publish').length, 1);
});

test('missing acceptance, foreign drafts, changed remote bytes and tag conflicts block publication', async (t) => {
  const { plan } = await fixture(t);
  const { options, state } = remoteFixture(plan);
  await assert.rejects(
    publishCloud(plan, { ...options, acceptedTargets: ['windows-x86_64'] }),
    /acceptance/,
  );
  assert.deepEqual(state.writes, []);
  await publishCloud(plan, { ...options, publish: false });
  state.release.notes = 'another source';
  await assert.rejects(publishCloud(plan, options), /identity/);
  state.release.notes = plan.remoteNotes;
  const asset = state.release.assets[0];
  state.hashes.set(asset.id, 'wrong');
  await assert.rejects(publishCloud(plan, options), /artifact/);
  state.hashes.set(asset.id, plan.assets[0].sha256);
  await assert.rejects(
    publishCloud(plan, {
      ...options,
      ensureTag: async () => {
        throw new Error('Tag conflict');
      },
    }),
    /Tag conflict/,
  );
  assert.ok(!state.writes.includes('publish'));
});

test('newer remote versions and extra assets cannot be overwritten by a retry', async (t) => {
  const { plan } = await fixture(t);
  const { options, state } = remoteFixture(plan);
  await publishCloud(plan, { ...options, publish: false });
  state.release.version = '0.3.0';
  await assert.rejects(publishCloud(plan, options), /newer/);
  state.release.version = plan.version;
  state.release.assets.push({ filename: 'unexpected.exe' });
  await assert.rejects(publishCloud(plan, options), /Unexpected/);
  assert.ok(!state.writes.includes('publish'));
});

test('macOS receipt configuration retains hardened runtime and no Windows signing command', async (t) => {
  const { directory } = await fixture(t);
  const config = JSON.parse(
    await readFile(resolve(directory, 'darwin-aarch64', 'tauri.cloud.json'), 'utf8'),
  );
  assert.equal(config.bundle.macOS.hardenedRuntime, true);
  assert.equal(config.bundle.windows, undefined);
});

test('initial beta update trials are explicit and never bypass stable acceptance', async (t) => {
  const { plan } = await fixture(t);
  const { options } = remoteFixture(plan);
  await publishCloud(plan, { ...options, acceptedTargets: [], betaTestTargets: targets });
  await assert.rejects(
    publishCloud(
      { ...plan, channel: 'stable' },
      { ...options, acceptedTargets: [], betaTestTargets: targets },
    ),
    /acceptance/,
  );
});

test('published updater feeds must return the candidate version, signature and exact bytes on every platform', async (t) => {
  const { plan } = await fixture(t);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    assert.equal(new URL(url).searchParams.get('channel'), 'beta');
    const asset = plan.assets.find(
      (item) => item.updatePlatform && url.includes(`/${item.updatePlatform}/`),
    );
    return Response.json({
      version: plan.version,
      signature: asset.signature,
      url: `https://cdn.crabnebula.app/download/${asset.name}`,
    });
  };
  const readDownloadHash = async (url) =>
    plan.assets.find((asset) => url.endsWith(asset.name)).sha256;
  await verifyUpdateFeeds(plan, { fetcher, readDownloadHash });
  assert.equal(calls.length, 4);
  await assert.rejects(
    verifyUpdateFeeds(plan, { fetcher, readDownloadHash: async () => 'wrong' }),
    /does not match/,
  );
  await assert.rejects(
    verifyUpdateFeeds(plan, {
      fetcher: async () => new Response(null, { status: 404 }),
      readDownloadHash,
    }),
    /not ready/,
  );
  const withQuery = (query) => async (url) => {
    const manifest = await (await fetcher(url)).json();
    return Response.json({ ...manifest, url: `${manifest.url}?${query}` });
  };
  const hashIgnoringQuery = (url) => readDownloadHash(new URL(url).pathname);
  await verifyUpdateFeeds(plan, {
    fetcher: withQuery('from=%7B%22channel%22%3A%22beta%22%7D'),
    readDownloadHash: hashIgnoringQuery,
  });
  await assert.rejects(
    verifyUpdateFeeds(plan, {
      fetcher: withQuery('from=x&redirect=https%3A%2F%2Fexample.invalid'),
      readDownloadHash: hashIgnoringQuery,
    }),
    /does not match/,
  );
  for (const override of [
    { version: '0.1.0' },
    { signature: 'wrong' },
    { url: 'https://evil.example/app.exe' },
  ]) {
    await assert.rejects(
      verifyUpdateFeeds(plan, {
        fetcher: async (url) =>
          Response.json({ ...(await (await fetcher(url)).json()), ...override }),
        readDownloadHash,
      }),
      /does not match/,
    );
  }
});
