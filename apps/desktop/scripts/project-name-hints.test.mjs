import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNameHints } from '../src/lib/project-name-hints.ts';

const hints = (projects) =>
  Object.fromEntries(
    projectNameHints(projects.map(([id, name, path]) => ({ id, name, path }))).entries(),
  );

test('unique project names get no hint', () => {
  assert.deepEqual(
    hints([
      ['a', 'jackalope', '/Users/me/Code/jackalope'],
      ['b', 'pocket-shop', '/Users/me/trials/pocket-shop'],
    ]),
    {},
  );
});

test('clashing names get the shortest distinguishing parent folders', () => {
  assert.deepEqual(
    hints([
      ['a', 'pocket-shop', '/Users/me/trials/a/pocket-shop'],
      ['b', 'pocket-shop', '/Users/me/trials/b/pocket-shop'],
      ['c', 'Pocket-Shop', '/Users/me/demo/a/pocket-shop'],
      ['d', 'jackalope', '/Users/me/Code/jackalope'],
    ]),
    { a: 'trials/a', b: 'b', c: 'demo/a' },
  );
});

test('Windows paths and trailing separators split the same way', () => {
  assert.deepEqual(
    hints([
      ['a', 'site', 'C:\\work\\one\\site\\'],
      ['b', 'site', 'C:\\work\\two\\site'],
    ]),
    { a: 'one', b: 'two' },
  );
});

test('renamed projects in one parent fall back to the full path', () => {
  assert.deepEqual(
    hints([
      ['a', 'shop', '/srv/shop-v1'],
      ['b', 'shop', '/srv/shop-v2'],
    ]),
    { a: '/srv/shop-v1', b: '/srv/shop-v2' },
  );
});

test('the same folder added twice gets no hint', () => {
  assert.deepEqual(
    hints([
      ['a', 'pocket-shop', '/tmp/pocket-shop'],
      ['b', 'pocket-shop', '/tmp/pocket-shop/'],
    ]),
    {},
  );
});
