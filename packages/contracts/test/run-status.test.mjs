import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isActive,
  isDone,
  isLive,
  isRetryable,
  isRunning,
  isTerminal,
  needsAttention,
  statusLabel,
} from '../src/runs.ts';

const predicates = {
  isActive,
  isRunning,
  isLive,
  isDone,
  isTerminal,
  isRetryable,
  needsAttention,
};

// The desktop's Rust RunStatus checks the same table (cli/protocol.rs).
const table = JSON.parse(readFileSync(new URL('./run-status.json', import.meta.url), 'utf8'));

test('run status predicates match the truth table shared with the native side', () => {
  assert.deepEqual(Object.keys(table).sort(), Object.keys(statusLabel).sort());
  for (const [status, row] of Object.entries(table))
    for (const [predicate, expected] of Object.entries(row)) {
      assert.equal(typeof predicates[predicate], 'function', `${predicate} is exported`);
      assert.equal(predicates[predicate](status), expected, `${predicate}('${status}')`);
      assert.equal(
        predicates[predicate]({ status }),
        expected,
        `${predicate}({ status: '${status}' })`,
      );
    }
});
