import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256 } from './catalog.mjs';
import { channelConfig } from './channels.mjs';
import { validateCloudFiles, validateCloudReceipt } from './cloud-artifacts.mjs';
import { parseDraftId, uploadCandidate } from './cloud-upload.mjs';
import { application, cloudConfig, cloudEndpoint } from './crabnebula-config.mjs';

const publicKey = Buffer.from('test public key').toString('base64');
const id = '01JSGWMMTRBTD4YSBEVE3W5B7V';
test('Cloud channels preserve service URL restrictions and reject unrelated query parameters', () => {
  const endpoints = {
    stableEndpoint: cloudEndpoint('stable'),
    betaEndpoint: cloudEndpoint('beta'),
  };
  assert.equal(channelConfig('beta', endpoints).betaEndpoint, cloudEndpoint('beta'));
  for (const value of [
    cloudEndpoint('stable'),
    `${cloudEndpoint('beta')}&token=secret`,
    cloudEndpoint('beta').replace('cdn.crabnebula.app', 'evil.example'),
    cloudEndpoint('beta').replace('/jackalope/', '/another-app/'),
    cloudEndpoint('beta').replace('https:', 'http:'),
  ]) {
    assert.throws(() => channelConfig('beta', { ...endpoints, betaEndpoint: value }));
  }
  assert.throws(() => channelConfig('beta', { serviceUrl: cloudEndpoint('beta') }));
});
test('rehearsals isolate installed identity and disable live updater/channel switching', () => {
  for (const channel of ['beta', 'stable']) {
    const config = cloudConfig({ mode: 'rehearsal', channel, publicKey });
    assert.equal(config.identifier, 'dev.jackalope.cloud.rehearsal');
    assert.equal(config.mainBinaryName, 'jackalope-rehearsal');
    assert.deepEqual(config.plugins.updater.endpoints, []);
    assert.equal(config.plugins.jackalope.betaEndpoint, undefined);
    assert.equal(config.bundle.windows, undefined);
  }
});

async function fixture(t, mode = 'candidate') {
  const directory = await mkdtemp(join(tmpdir(), 'jackalope-cloud-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const installer = `${mode === 'candidate' ? 'Jackalope' : 'Jackalope Rehearsal'}_0.1.0_x64-setup.exe`;
  const signature = Buffer.from('test signature').toString('base64');
  const config = cloudConfig({
    mode,
    channel: 'beta',
    publicKey,
    signScript: 'C:/repo with spaces/sign.ps1',
  });
  const data = {
    [installer]: 'fixture installer',
    [`${installer}.sig`]: signature,
    'tauri.cloud.json': JSON.stringify(config),
    'notes.md': 'Release notes',
  };
  const receipt = {
    schemaVersion: 1,
    application,
    version: '0.1.0',
    channel: 'beta',
    mode,
    source: 'a'.repeat(40),
    sourceDirty: false,
    target: 'windows-x86_64',
    distribution: 'nsis',
    approvalRequired: true,
    publicSigned: mode === 'candidate',
    files: {},
  };
  for (const [name, text] of Object.entries(data)) {
    await writeFile(join(directory, name), text);
    receipt.files[name] = sha256(Buffer.from(text));
  }
  await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt));
  return { directory, receipt, installer, signature };
}
test('draft uploads reject rehearsal, dirty sources, disabled approval, wrong targets and path traversal', async (t) => {
  const { directory, receipt } = await fixture(t, 'rehearsal');
  await assert.rejects(
    validateCloudFiles(directory, { requireCandidate: true }),
    /signed candidates/,
  );
  const candidate = (await fixture(t)).receipt;
  for (const overrides of [
    { sourceDirty: true },
    { approvalRequired: false },
    { target: 'darwin-aarch64' },
    { application: 'other/app' },
    { files: { ...candidate.files, '../private.key': 'a'.repeat(64) } },
  ])
    assert.throws(() =>
      validateCloudReceipt({ ...candidate, ...overrides }, { requireCandidate: true }),
    );
  assert.equal(receipt.publicSigned, false);
});
test('changed installer bytes fail before any upload', async (t) => {
  const { directory, installer } = await fixture(t);
  await writeFile(join(directory, installer), 'changed');
  await assert.rejects(validateCloudFiles(directory), /Artifact changed/);
});
test('draft upload checkpoints prevent duplicate writes and never publish', async (t) => {
  const { directory, installer, signature } = await fixture(t);
  const commands = [];
  const options = {
    enabled: 'true',
    key: 'test',
    publicKey,
    verifyPublisher: async () => {},
    run: async (args) => {
      commands.push(args);
      if (args[1] === 'list') return '[]';
      if (args[1] === 'draft') return id;
      if (args[1] === 'upload') return '';
      return JSON.stringify({
        id,
        status: 'Draft',
        version: '0.1.0',
        channel: 'beta',
        assets: [
          {
            filename: installer,
            signature,
            updatePlatform: 'windows-x86_64',
            publicPlatform: 'nsis-x86_64',
          },
        ],
      });
    },
  };
  assert.equal((await uploadCandidate(directory, options)).status, 'uploaded');
  await uploadCandidate(directory, options);
  assert.deepEqual(
    commands.map((args) => args[1]),
    ['list', 'draft', 'upload', 'show'],
  );
  assert.equal(
    JSON.parse(await readFile(join(directory, 'cloud-draft.json'), 'utf8')).published,
    false,
  );
});
test('an uncertain creation is not retried and upload gates precede external writes', async (t) => {
  const { directory } = await fixture(t);
  let writes = 0;
  const options = {
    enabled: 'true',
    key: 'test',
    publicKey,
    verifyPublisher: async () => {},
    run: async (args) => {
      if (args[1] === 'list') return '[]';
      writes++;
      throw new Error('connection lost');
    },
  };
  await assert.rejects(uploadCandidate(directory, { ...options, enabled: 'false' }), /Configure/);
  await assert.rejects(
    uploadCandidate(directory, { ...options, publicKey: 'wrong' }),
    /release key/,
  );
  assert.equal(writes, 0);
  await assert.rejects(uploadCandidate(directory, options), /connection lost/);
  await assert.rejects(uploadCandidate(directory, options), /uncertain/);
  assert.equal(writes, 1);
});
test('unrecognized draft responses fail closed', () => {
  assert.equal(parseDraftId(id), id);
  assert.equal(parseDraftId(JSON.stringify({ id })), id);
  assert.throws(() => parseDraftId('created a draft, see dashboard'), /not recognized/);
});

test('an existing version is never duplicated and uncertain uploads are not repeated', async (t) => {
  const { directory } = await fixture(t);
  const commands = [];
  const options = {
    enabled: 'true',
    key: 'test',
    publicKey,
    verifyPublisher: async () => {},
    run: async (args) => {
      commands.push(args[1]);
      return JSON.stringify([{ version: '0.1.0' }]);
    },
  };
  await assert.rejects(uploadCandidate(directory, options), /already exists/);
  assert.deepEqual(commands, ['list']);
  options.run = async (args) => {
    commands.push(args[1]);
    if (args[1] === 'list') return '[]';
    if (args[1] === 'draft') return id;
    throw new Error('lost upload response');
  };
  await assert.rejects(uploadCandidate(directory, options), /lost upload response/);
  await assert.rejects(uploadCandidate(directory, options), /upload is uncertain/);
  assert.equal(commands.filter((command) => command === 'upload').length, 1);
});
