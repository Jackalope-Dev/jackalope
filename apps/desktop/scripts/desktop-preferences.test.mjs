import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertDictation, pcmWave } from '../src/lib/dictation.ts';
import { validSavedAction } from '../src/stores/savedActionsStore.ts';

test('local dictation encodes bounded mono PCM without clipping overflow', () => {
  const bytes = pcmWave(new Float32Array([-2, -1, 0, 1, 2]));
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true)),
    [-32768, -32768, 0, 32767, 32767],
  );
  assert.throws(() => pcmWave(new Float32Array(960001)), /one minute/);
});

test('dictation lands at the caret, spaced from the surrounding words', () => {
  const field = (value, at) => ({ value, selectionEnd: at });
  assert.deepEqual(insertDictation('', 'hello'), { text: 'hello', caret: 5 });
  assert.deepEqual(insertDictation('Fix the bug', 'login', field('Fix the bug', 7)), {
    text: 'Fix the login bug',
    caret: 13,
  });
  assert.deepEqual(insertDictation('Done.', 'Next', field('Done.', 5)), {
    text: 'Done. Next',
    caret: 10,
  });
  // A field showing other text than the draft (a stale ref) appends instead.
  assert.equal(insertDictation('draft', 'more', field('other', 0)).text, 'draft more');
});

test('saved actions reject malformed persistence while retaining project scope', () => {
  const action = {
    id: 'one',
    name: 'Run tests',
    kind: 'command',
    body: 'pnpm test',
    projectId: 'project-one',
  };
  assert.equal(validSavedAction(action), true);
  assert.equal(validSavedAction({ ...action, projectId: null, kind: 'prompt' }), true);
  for (const change of [
    { name: '' },
    { body: '' },
    { body: 'x'.repeat(12001) },
    { kind: 'execute' },
    { projectId: 7 },
  ])
    assert.equal(validSavedAction({ ...action, ...change }), false);
});
