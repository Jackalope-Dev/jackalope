import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroPalette, landingCards } from '../src/landing-content.ts';
import {
  contrastRatio,
  heroState,
  hexToRgb,
  READING_WASH,
  scrollEnergy,
} from '../src/landing-motion.ts';

const cards = landingCards('Windows, macOS and Linux');

test('each card keeps 4.5:1 between its text and its surface', () => {
  for (const card of cards) {
    const ratio = contrastRatio(card.ink, card.surface);
    assert.ok(ratio >= 4.5, `${card.name}: ${ratio.toFixed(2)}:1`);
  }
});

test('every palette is three colors the shader can read', () => {
  for (const palette of [heroPalette, ...cards.map((card) => card.palette)]) {
    assert.equal(palette.length, 3);
    for (const color of palette) assert.equal(hexToRgb(color).length, 3);
  }
});

test('platform tags list each platform once', () => {
  assert.deepEqual(cards.at(-1).tags, ['Windows', 'macOS', 'Linux', 'Apache 2.0']);
  assert.deepEqual(landingCards('macOS and Linux').at(-1).tags, ['macOS', 'Linux', 'Apache 2.0']);
});

test('the hero starts as a clear name and ends inside it on the washed field', () => {
  const start = heroState(0, READING_WASH.dark);
  assert.deepEqual(start, { scale: 1, maskOpacity: 1, metaOpacity: 1, wash: 0 });
  const end = heroState(1, READING_WASH.dark);
  assert.equal(end.maskOpacity, 0);
  assert.equal(end.metaOpacity, 0);
  assert.equal(end.wash, READING_WASH.dark);
  assert.ok(end.scale > 50);
  assert.deepEqual(heroState(4, READING_WASH.light), heroState(1, READING_WASH.light));
});

test('scroll energy rises with scrolling and settles when it stops', () => {
  const stirred = scrollEnergy(0, 0.2);
  assert.ok(stirred > 0.9);
  let energy = stirred;
  for (let frame = 0; frame < 120; frame++) energy = scrollEnergy(energy, 0);
  assert.ok(energy < 0.01);
});
