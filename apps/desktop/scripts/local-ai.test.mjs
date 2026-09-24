import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localAiFixture } from '../src/design-lab/local-ai-fixture.ts';
import { downloadPercent, formatSize, localHelperModels, modelFit } from '../src/lib/local-ai.ts';

test('helper choices require an installed catalog model distinct from the coding model', () => {
  assert.deepEqual(
    localHelperModels(
      { ...localAiFixture, installedModels: ['qwen3.5:4b', 'uncatalogued'] },
      'qwen3.5:4b',
    ),
    [],
  );
  assert.deepEqual(
    localHelperModels(localAiFixture, 'qwen3.5:9b').map((model) => model.id),
    ['qwen3.5:4b'],
  );
});

test('hardware advice distinguishes unknown memory from insufficient memory', () => {
  const model = localAiFixture.models[2];
  assert.equal(modelFit(model, localAiFixture), 'limited');
  assert.equal(
    modelFit(model, {
      ...localAiFixture,
      hardware: { ...localAiFixture.hardware, memoryBytes: null },
    }),
    'unknown',
  );
  assert.equal(modelFit(localAiFixture.models[0], localAiFixture), 'fits');
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
