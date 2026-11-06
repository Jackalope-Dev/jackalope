import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLOUD_RESOURCES,
  DEFAULT_KINDS,
  orderedKinds,
  parseDomains,
  requiredPermissions,
  resourcePrefix,
  SETUP_ORDER,
  validPrefix,
} from '../src/lib/cloud-resources-plan.ts';

test('project names become valid resource prefixes', () => {
  for (const [name, expected] of [
    ['My Game', 'my-game'],
    ['Café Ünïcode', 'cafe-unicode'],
    ['  --Leading__symbols!! ', 'leading-symbols'],
    ['v2.0 beta', 'v2-0-beta'],
  ]) {
    assert.equal(resourcePrefix(name), expected);
    assert.ok(validPrefix(expected), expected);
  }
  const long = resourcePrefix(`${'a'.repeat(39)} b`);
  assert.ok(long.length <= 40 && validPrefix(long), long);
  assert.equal(resourcePrefix('🚀'), '');
});

test('prefixes follow the same rules as the native check', () => {
  for (const prefix of ['game', 'my-game-2', 'a', 'a'.repeat(40)]) assert.ok(validPrefix(prefix));
  for (const prefix of ['', '-game', 'game-', 'Game', 'my game', 'a--b', 'a'.repeat(41)])
    assert.ok(!validPrefix(prefix), prefix);
});

test('defaults, order and permissions match the setup screen', () => {
  assert.deepEqual(DEFAULT_KINDS, ['r2', 'kv', 'queue', 'durableObjects']);
  assert.deepEqual(
    [...CLOUD_RESOURCES.map((option) => option.kind)].sort(),
    [...SETUP_ORDER].sort(),
  );
  assert.deepEqual(orderedKinds(['turnstile', 'kv', 'workers', 'bogus', 'kv']), [
    'workers',
    'kv',
    'turnstile',
  ]);
  // Durable Objects and Workers need no permission to set up; they deploy with the Worker.
  assert.deepEqual(requiredPermissions(['durableObjects', 'workers']), []);
  assert.deepEqual(requiredPermissions(['kv', 'r2', 'd1']), [
    'Workers R2 Storage: Edit',
    'D1: Edit',
    'Workers KV Storage: Edit',
  ]);
  assert.equal(CLOUD_RESOURCES.find((option) => option.kind === 'hyperdrive').needs, 'postgres');
  assert.equal(CLOUD_RESOURCES.find((option) => option.kind === 'turnstile').needs, 'domains');
});

test('domains accept lines, commas and pasted URLs', () => {
  assert.deepEqual(parseDomains('https://Example.com/\nplay.example.com, example.com  '), [
    'example.com',
    'play.example.com',
  ]);
  assert.deepEqual(parseDomains('   '), []);
});
