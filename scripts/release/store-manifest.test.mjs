import assert from 'node:assert/strict';
import test from 'node:test';
import { storeManifest } from './store-manifest.mjs';

const identity = {
  name: 'Jackalope.LocalRehearsal',
  publisher: 'CN=Local Test',
  publisherDisplayName: 'Local Test',
  version: '0.1.0',
};
test('Store manifest escapes publisher data and uses full trust with Store versioning', () => {
  const manifest = storeManifest({
    ...identity,
    publisher: 'CN=Test & Co',
    publisherDisplayName: '<Test>',
  });
  assert.match(manifest, /CN=Test &amp; Co/);
  assert.match(manifest, /&lt;Test&gt;/);
  assert.match(manifest, /Version="0.1.0.0"/);
  assert.match(manifest, /TrustLevel="mediumIL"/);
  assert.match(manifest, /Name="runFullTrust"/);
});
test('invalid identities and non-Store versions fail before packaging', () => {
  for (const version of ['0.0.0', '1.2.3-beta', '1.2.3.4', '65536.0.0', '01.2.3', ''])
    assert.throws(() => storeManifest({ ...identity, version }));
  for (const name of ['', '../app', 'x', 'x'.repeat(51)])
    assert.throws(() => storeManifest({ ...identity, name }));
  assert.throws(() => storeManifest({ ...identity, publisher: 'test' }));
  assert.throws(() => storeManifest({ ...identity, publisherDisplayName: '' }));
});
