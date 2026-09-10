import assert from 'node:assert/strict';
import test from 'node:test';
import { missingProjectDefaults } from '../src/lib/context/project-defaults.ts';

test('discovered defaults fill only unset preferences without opting into automatic checks', () => {
  const defaults = {
    baseBranch: 'main',
    prepareCommand: 'pnpm install',
    verifyCommand: 'pnpm verify',
  };
  assert.deepEqual(missingProjectDefaults(undefined, defaults), defaults);
  assert.deepEqual(
    missingProjectDefaults(
      { baseBranch: 'release', prepareCommand: '', autoVerify: false },
      defaults,
    ),
    { verifyCommand: 'pnpm verify' },
  );
  assert.deepEqual(
    missingProjectDefaults({ verifyCommand: 'custom check' }, { verifyCommand: 'new check' }),
    {},
  );
  assert.deepEqual(
    missingProjectDefaults(undefined, { baseBranch: null, prepareCommand: null }),
    {},
  );
  assert.deepEqual(missingProjectDefaults(undefined, undefined), {});
});
