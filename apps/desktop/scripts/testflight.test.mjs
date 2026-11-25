import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FILE_SECRET_MAX_BYTES,
  fileSecretError,
  keyIdFromFileName,
  safeFileName,
} from '../src/lib/secret-file.ts';
import {
  BUILD_PATTERN,
  compareBuilds,
  isUploading,
  needsNewBuild,
  TESTFLIGHT_GOAL,
  TESTFLIGHT_PREPARATION,
  uploadLabel,
} from '../src/lib/testflight.ts';

test('file secrets are bounded text', () => {
  assert.equal(fileSecretError('line one\nline two\n'), '');
  assert.match(fileSecretError('  \n'), /Choose a file/);
  assert.equal(fileSecretError('k'.repeat(FILE_SECRET_MAX_BYTES)), '');
  assert.match(fileSecretError('k'.repeat(FILE_SECRET_MAX_BYTES + 1)), /64 KB/);
  // Multi-byte characters count by their encoded size, as the native limit does.
  assert.match(fileSecretError('é'.repeat(FILE_SECRET_MAX_BYTES / 2 + 1)), /64 KB/);
  assert.match(fileSecretError('a\0b'), /text/);
});

test('picked file names become names native storage accepts', () => {
  assert.equal(safeFileName('AuthKey_ABC123XYZ9.p8'), 'AuthKey_ABC123XYZ9.p8');
  assert.equal(safeFileName('my key (1).p8'), 'my_key_1_.p8');
  assert.equal(safeFileName('.hidden'), 'hidden');
  assert.equal(safeFileName('   '), null);
});

test('the key ID comes from an App Store Connect key file name', () => {
  assert.equal(keyIdFromFileName('AuthKey_ABC123XYZ9.p8'), 'ABC123XYZ9');
  assert.equal(keyIdFromFileName('authkey_abc123xyz9.P8'), 'ABC123XYZ9');
  assert.equal(keyIdFromFileName('AuthKey_SHORT.p8'), '');
  assert.equal(keyIdFromFileName(null), '');
});

test('the confirmation names the exact app, version and build', () => {
  assert.equal(
    uploadLabel({ appName: 'Example', version: '1.2', build: '13' }),
    'Upload Example 1.2 (13) to TestFlight',
  );
});

test('build numbers compare numerically and must rise past the last upload', () => {
  assert.equal(compareBuilds('10', '9'), 1);
  assert.equal(compareBuilds('1.0.1', '1.0'), 1);
  assert.equal(compareBuilds('2', '2.0'), 0);
  assert.equal(compareBuilds('3', '12'), -1);
  assert.equal(needsNewBuild({ build: '12', latestUploaded: '12' }), true);
  assert.equal(needsNewBuild({ build: '13', latestUploaded: '12' }), false);
  assert.equal(needsNewBuild({ build: '1', latestUploaded: null }), false);
  for (const valid of ['1', '13', '1.2', '1.2.3']) assert.ok(BUILD_PATTERN.test(valid), valid);
  for (const invalid of ['', '1.', 'a', '1.2.3.4', '1 2']) assert.ok(!BUILD_PATTERN.test(invalid));
});

test('only running phases count as uploading', () => {
  for (const phase of ['archiving', 'exporting', 'processing']) assert.ok(isUploading({ phase }));
  for (const phase of ['done', 'failed', 'canceled']) assert.ok(!isUploading({ phase }));
  assert.ok(!isUploading(null));
});

test('agents prepare for TestFlight without uploading or asking for the key', () => {
  assert.equal(TESTFLIGHT_GOAL, 'a TestFlight upload');
  for (const check of [
    'signing',
    'bundle identifier',
    'MARKETING_VERSION',
    'CURRENT_PROJECT_VERSION',
    'PrivacyInfo.xcprivacy',
    'usage-description',
    'Never archive, export or upload',
    'request_human_action with kind "signing"',
    'Upload to TestFlight',
  ])
    assert.ok(TESTFLIGHT_PREPARATION.includes(check), check);
});
