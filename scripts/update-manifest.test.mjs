import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeManifest } from './update-manifest.mjs';

test('manifest binds both installer formats to the version and rejects unsafe or missing inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jackalope-manifest-'));
  try {
    const nsis = join(root, 'Jackalope_0.2.0_x64-setup.exe');
    const msi = join(root, 'Jackalope_0.2.0_x64_en-US.msi');
    for (const path of [nsis, msi]) {
      await writeFile(path, 'test installer');
      await writeFile(`${path}.sig`, Buffer.from(path).toString('base64'));
    }
    const args = {
      version: '0.2.0',
      baseUrl: 'https://example.com/releases/v0.2.0',
      notes: 'Changes',
      nsis,
      msi,
    };
    const manifest = await makeManifest(args);
    assert.deepEqual(Object.keys(manifest.platforms), [
      'windows-x86_64-nsis',
      'windows-x86_64-msi',
    ]);
    assert.equal(
      manifest.platforms['windows-x86_64-msi'].url,
      'https://example.com/releases/v0.2.0/Jackalope_0.2.0_x64_en-US.msi',
    );
    assert.equal(
      manifest.platforms['windows-x86_64-nsis'].signature,
      Buffer.from(nsis).toString('base64'),
    );
    for (const baseUrl of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com?token=abc',
    ])
      await assert.rejects(makeManifest({ ...args, baseUrl }));
    await assert.rejects(makeManifest({ ...args, version: '0.3.0' }));
    await writeFile(`${msi}.sig`, '');
    await assert.rejects(makeManifest(args));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
