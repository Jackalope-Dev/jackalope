import assert from 'node:assert/strict';
import { test } from 'node:test';
import { landingPanes, roster } from '../src/landing-content.ts';
import { hexToRgb, laneOpen, laneX, scrollEnergy } from '../src/landing-motion.ts';

const field = {
  center: 0.3,
  spread: 0.6,
  rootY: 0.1,
  forkEnd: 0.9,
  mergeStart: 9,
  mergeEnd: 9.5,
};
const lanes = roster.length;
const positions = (y, time = 0) =>
  Array.from({ length: lanes }, (_, index) => laneX(index, lanes, y, time, field));

test('the lanes start as one line at the root', () => {
  assert.equal(laneOpen(field, field.rootY), 0);
  assert.deepEqual(positions(field.rootY, 7), Array(lanes).fill(field.center));
});

test('the lanes run parallel, in order and inside the bundle, once the fork ends', () => {
  assert.equal(laneOpen(field, field.forkEnd), 1);
  for (const time of [0, 3, 11]) {
    const xs = positions(4, time);
    const gap = field.spread / (lanes - 1);
    for (let index = 1; index < lanes; index++) assert.ok(xs[index] - xs[index - 1] > gap * 0.75);
    assert.ok(xs[0] > field.center - field.spread / 2 - 0.02);
    assert.ok(xs.at(-1) < field.center + field.spread / 2 + 0.02);
  }
});

test('the lanes are one line again after the merge', () => {
  assert.equal(laneOpen(field, field.mergeEnd), 0);
  assert.deepEqual(positions(field.mergeEnd + 0.1, 5), Array(lanes).fill(field.center));
});

test('platform tags list each platform once', () => {
  assert.deepEqual(landingPanes('Windows, macOS and Linux').at(-1).tags, [
    'Windows',
    'macOS',
    'Linux',
    'Apache 2.0',
  ]);
  assert.deepEqual(landingPanes('macOS and Linux').at(-1).tags, ['macOS', 'Linux', 'Apache 2.0']);
});

test('colors convert to the 0..1 components the shader reads', () => {
  assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]);
  assert.throws(() => hexToRgb('red'));
});

test('scroll energy rises with scrolling and settles when it stops', () => {
  const stirred = scrollEnergy(0, 0.2);
  assert.ok(stirred > 0.9);
  let energy = stirred;
  for (let frame = 0; frame < 120; frame++) energy = scrollEnergy(energy, 0);
  assert.ok(energy < 0.01);
});
