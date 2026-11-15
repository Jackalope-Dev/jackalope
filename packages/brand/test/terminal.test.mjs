import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_THEME, themeTokens } from '../src/tokens.ts';

// The terminal (apps/desktop/src-tauri/src/cli/brand.rs) reads terminal.json; the app derives
// the same colours from themeTokens. The terminal tints neutral surfaces with the accent's hue,
// so neutral entries are [saturation, lightness] and status entries are [hue, saturation, lightness].
const terminal = JSON.parse(readFileSync(new URL('../src/terminal.json', import.meta.url), 'utf8'));

const TOKENS = {
  shell: '--color-navigation',
  ground: '--color-surface',
  elevated: '--color-surface-elevated',
  hairline: '--color-border-subtle',
  text: '--color-text-primary',
  muted: '--color-text-muted',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
};

function hsl(value) {
  const match = value.match(/^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/);
  assert.ok(match, value);
  return match.slice(1).map(Number);
}

function assertClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-9, `${label}: ${actual} vs ${expected}`);
  });
}

test('terminal colours match the default theme tokens in both appearances', () => {
  assert.equal(terminal.defaultAccent, DEFAULT_THEME.accentHex);
  for (const [scheme, isDark] of [
    ['dark', true],
    ['light', false],
  ]) {
    const tokens = themeTokens({ ...DEFAULT_THEME, isDark });
    for (const [name, token] of Object.entries(TOKENS)) {
      const [hue, saturation, lightness] = hsl(tokens[token]);
      const expected =
        terminal[scheme][name].length === 2
          ? [saturation, lightness]
          : [hue, saturation, lightness];
      if (expected.length === 2) assert.equal(hue, DEFAULT_THEME.accentHue, token);
      assertClose(terminal[scheme][name], expected, `${scheme} ${name}`);
    }
  }
});

test('the noise glyphs are single distinct characters', () => {
  const glyphs = [...terminal.noise];
  assert.equal(new Set(glyphs).size, glyphs.length);
  assert.ok(glyphs.every((glyph) => glyph.length === 1 && glyph !== ' '));
});
