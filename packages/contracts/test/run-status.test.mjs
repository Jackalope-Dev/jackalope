import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as runs from '../src/runs.ts';

// The desktop's Rust RunStatus checks the same table (cli/protocol.rs).
const table = JSON.parse(readFileSync(new URL('./run-status.json', import.meta.url), 'utf8'));

test('run status predicates match the truth table shared with the native side', () => {
  assert.deepEqual(Object.keys(table).sort(), Object.keys(runs.statusLabel).sort());
  for (const [status, row] of Object.entries(table))
    for (const [predicate, expected] of Object.entries(row)) {
      assert.equal(typeof runs[predicate], 'function', `${predicate} is exported`);
      assert.equal(runs[predicate](status), expected, `${predicate}('${status}')`);
      assert.equal(runs[predicate]({ status }), expected, `${predicate}({ status: '${status}' })`);
    }
});
