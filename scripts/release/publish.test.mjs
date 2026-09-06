import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channel,
  compare,
  feed,
  origin,
  parseNotes,
  prefix,
  releasePlan,
  sha256,
  version,
} from './catalog.mjs';
import { publish } from './publish.mjs';

function fixture() {
  const files = new Map();
  const remote = new Map();
  const operations = [];
  const v = '0.2.0';
  const base = 'https://jackalope.dev';
  const exe = `Jackalope_${v}_x64-setup.exe`;
  const msi = `Jackalope_${v}_x64_en-US.msi`;
  for (const name of [exe, `${exe}.sig`, msi, `${msi}.sig`, 'checksums.json'])
    files.set(name, Buffer.from(name));
  const receipt = {
    version: v,
    channel: 'stable',
    source: 'a'.repeat(40),
    publicSigned: true,
    files: Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)])),
    manifest: {
      version: v,
      platforms: Object.fromEntries(
        [
          ['nsis', exe],
          ['msi', msi],
        ].map(([type, name]) => [
          `windows-x86_64-${type}`,
          { signature: `${name}.sig`, url: `${base}/updates/releases/v${v}/${name}` },
        ]),
      ),
    },
  };
  const store = {
    read: async (name) => files.get(name),
    immutable: async (key, bytes) => {
      if (remote.has(key))
        assert.equal(sha256(remote.get(key)), sha256(bytes), 'immutable mismatch');
      remote.set(key, bytes);
      operations.push(key);
    },
    put: async (key, bytes) => {
      remote.set(key, bytes);
      operations.push(key);
    },
  };
  const publicRead = async (key, json = false) =>
    remote.has(key) ? (json ? JSON.parse(remote.get(key)) : remote.get(key)) : null;
  return {
    receipt,
    notes: { version: v, date: '2026-09-06T00:00:00.000Z', notes: '## Fixes\n\n- A useful fix.' },
    base,
    store,
    publicRead,
    remote,
    operations,
    files,
  };
}
test('release identifiers and origins cannot inject paths or commands', () => {
  for (const v of ['../1.0.0', '1.0.0-beta', '1.0.0; echo bad', '01.0.0'])
    assert.throws(() => version(v));
  assert.throws(() => channel('preview/../stable'));
  for (const url of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/path',
  ])
    assert.throws(() => origin(url));
  assert.equal(prefix('1.2.3', 'beta'), 'releases/beta/v1.2.3');
  assert.equal(compare('10.0.0', '2.0.0'), 1);
});
test('drafts and malformed/future notes cannot be published', () => {
  const text = '# Jackalope 0.1.0\n\nStatus: draft\nDate: 2026-09-06\n\n## Highlights\n\nTODO';
  assert.equal(parseNotes(text, '0.1.0').version, '0.1.0');
  assert.throws(() => parseNotes(text, '0.1.0', true));
  assert.throws(() => parseNotes(text.replace('draft', 'ready'), '0.1.0', true));
  assert.throws(() => parseNotes(text.replace('2026-09-06', '2026-02-30'), '0.1.0'));
});
test('publication verifies artifacts and publishes a single pointer last', async () => {
  const f = fixture();
  const plan = await publish(f);
  assert.equal(f.operations.at(-1), 'stable/latest.json');
  assert.equal(plan.manifest.catalog, 'releases/v0.2.0/catalog.json');
  assert.equal(JSON.parse(f.remote.get('stable/latest.json')).notes, f.notes.notes);
  assert.match(f.remote.get('releases/v0.2.0/feed.xml').toString(), /A useful fix/);
});
test('identical retry preserves immutable bytes', async () => {
  const f = fixture();
  await publish(f);
  await publish(f);
  assert.equal(JSON.parse(f.remote.get('releases/v0.2.0/catalog.json')).length, 1);
});
test('rehearsal receipts never write public objects', async () => {
  const f = fixture();
  f.receipt.publicSigned = false;
  await assert.rejects(publish(f), /signed release receipt/);
  assert.equal(f.operations.length, 0);
});
test('a corrupt local installer is rejected before publishing the pointer', async () => {
  const f = fixture();
  f.files.set('Jackalope_0.2.0_x64-setup.exe', Buffer.from('tampered'));
  await assert.rejects(publish(f), /hash mismatch/);
  assert.ok(!f.remote.has('stable/latest.json'));
});
test('a bad public download leaves the update pointer untouched', async () => {
  const f = fixture();
  const read = f.publicRead;
  f.publicRead = async (key, json) =>
    key.endsWith('.exe') ? Buffer.from('wrong bytes') : read(key, json);
  await assert.rejects(publish(f), /Public download/);
  assert.ok(!f.remote.has('stable/latest.json'));
});
test('incomplete uploads leave the update pointer untouched', async () => {
  const f = fixture();
  f.store.immutable = async () => {
    throw new Error('network unavailable');
  };
  await assert.rejects(publish(f), /network unavailable/);
  assert.ok(!f.remote.has('stable/latest.json'));
});
test('wrong installer URL and signature cannot reach the update feed', async () => {
  const f = fixture();
  f.receipt.manifest.platforms['windows-x86_64-nsis'].url = 'https://untrusted.example/file.exe';
  await assert.rejects(publish(f), /URL\/signature/);
  assert.ok(!f.remote.has('stable/latest.json'));
});
test('publication refuses downgrades and unlisted artifacts', async () => {
  const f = fixture();
  assert.throws(() => releasePlan({ ...f, current: { version: '0.3.0' } }), /backwards/);
  f.receipt.files['../private.key'] = 'a'.repeat(64);
  await assert.rejects(publish(f), /Unexpected release files/);
});
test('release history is newest-first and RSS escapes untrusted text', () => {
  const f = fixture();
  const plan = releasePlan({
    ...f,
    previous: [{ version: '0.1.0', date: f.notes.date, notes: 'Earlier' }],
  });
  assert.deepEqual(
    plan.releases.map((x) => x.version),
    ['0.2.0', '0.1.0'],
  );
  assert.ok(
    feed([{ ...f.notes, notes: '<script>&"' }], f.base, 'stable').includes(
      '&lt;script&gt;&amp;&quot;',
    ),
  );
});
