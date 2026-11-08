import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadPercent, formatSize, localHelperModels, modelFit } from '../src/lib/local-ai.ts';

const model = (id, recommendedMemoryGb) => ({
  id,
  name: id,
  downloadBytes: 1e9,
  recommendedMemoryGb,
  description: '',
});

const inspection = {
  hardware: {
    os: 'windows',
    arch: 'x86_64',
    memoryBytes: 32 * 1024 ** 3,
    availableMemoryBytes: null,
    freeDiskBytes: null,
    gpu: null,
    diskLocation: null,
  },
  models: [model('small', 16), model('medium', 24), model('large', 48)],
  installedModels: ['small', 'medium'],
  ollamaOnline: true,
  opencodeInstalled: true,
  canInstall: false,
  runtimeDiskBytes: 0,
  catalogCheckedAt: '2026-01-01',
};

test('helper choices require an installed catalog model distinct from the coding model', () => {
  assert.deepEqual(
    localHelperModels({ ...inspection, installedModels: ['small', 'uncatalogued'] }, 'small'),
    [],
  );
  assert.deepEqual(localHelperModels(inspection, 'medium').map((entry) => entry.id), ['small']);
});

test('hardware advice distinguishes unknown memory from insufficient memory', () => {
  const large = inspection.models[2];
  assert.equal(modelFit(large, inspection), 'limited');
  assert.equal(
    modelFit(large, { ...inspection, hardware: { ...inspection.hardware, memoryBytes: null } }),
    'unknown',
  );
  assert.equal(modelFit(inspection.models[0], inspection), 'fits');
  assert.equal(formatSize(null), 'Not detected');
});

test('download display uses measured bytes and leaves unknown totals indeterminate', () => {
  assert.equal(
    downloadPercent({ phase: 'download', message: '', completed: 500, total: null }),
    undefined,
  );
  assert.equal(
    downloadPercent({ phase: 'download', message: '', completed: 250, total: 1000 }),
    25,
  );
  assert.equal(
    downloadPercent({ phase: 'download', message: '', completed: 1500, total: 1000 }),
    100,
  );
});
