import assert from 'node:assert/strict';
import test from 'node:test';
import { canUndoSharpen, sharpenUnavailableReason } from '../src/lib/sharpen.ts';

const base = {
  desktop: true,
  runners: [{ id: 'claude', available: true }],
  adapterFor: (id) => (id === 'work-claude' ? 'claude' : id),
  isEnabled: () => true,
};

test('sharpen is available only with a ready, enabled helper agent in the desktop app', () => {
  assert.equal(sharpenUnavailableReason(base), undefined);
  assert.match(sharpenUnavailableReason({ ...base, desktop: false }), /desktop app/);
  assert.match(
    sharpenUnavailableReason({ ...base, runners: [{ id: 'claude', available: false }] }),
    /signed-in Claude Code, Codex/,
  );
  assert.match(sharpenUnavailableReason({ ...base, isEnabled: () => false }), /signed-in/);
  assert.match(
    sharpenUnavailableReason({ ...base, runners: [{ id: 'gemini', available: true }] }),
    /signed-in/,
  );
  assert.equal(
    sharpenUnavailableReason({ ...base, runners: [{ id: 'work-claude', available: true }] }),
    undefined,
    'custom agents count through their adapter',
  );
});

test('undo restores the draft only while the rewrite is untouched', () => {
  const undo = { original: 'Fix login', rewritten: 'Fix login and prove it with a test' };
  assert.equal(canUndoSharpen(undo.rewritten, undo), true);
  assert.equal(canUndoSharpen(`${undo.rewritten}!`, undo), false);
  assert.equal(canUndoSharpen(undo.rewritten, null), false);
});
