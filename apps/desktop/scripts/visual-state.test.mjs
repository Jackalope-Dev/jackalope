import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyThemeTokens,
  hslToHex,
  isDarkAtTime,
  PRESET_THEMES,
  startThemeClock,
} from '@jackalope/brand/theme';
import { useMascotStore } from '../src/stores/mascotStore.ts';

function luminance(color) {
  const hsl = color.match(/^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/);
  const hex = hsl ? hslToHex(...hsl.slice(1).map(Number)) : color;
  const [r, g, b] = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

test('automatic appearance uses local day boundaries and preserves manual preferences', () => {
  const theme = { ...PRESET_THEMES[0], appearance: 'automatic' };
  for (const [hour, minute, dark] of [
    [0, 0, true],
    [6, 59, true],
    [7, 0, false],
    [18, 59, false],
    [19, 0, true],
    [23, 59, true],
  ]) {
    assert.equal(isDarkAtTime(theme, new Date(2026, 8, 4, hour, minute)), dark);
  }
  for (const isDark of [false, true]) {
    assert.equal(isDarkAtTime({ ...PRESET_THEMES[0], isDark }, new Date(2026, 8, 4, 12)), isDark);
  }
});

test('theme clock switches at the boundary, respects previews, catches wake-up and cleans up', (context) => {
  context.mock.timers.enable({
    apis: ['Date', 'setTimeout'],
    now: new Date(2026, 8, 4, 18, 59, 30).getTime(),
  });
  const tokens = new Map();
  const events = new Map();
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const listeners = {
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
  };
  globalThis.window = { ...listeners, setTimeout, clearTimeout };
  globalThis.document = {
    ...listeners,
    documentElement: { style: { setProperty: (key, value) => tokens.set(key, value) } },
  };
  const theme = { ...PRESET_THEMES[0], appearance: 'automatic', atmosphere: 24 };
  applyThemeTokens(theme);
  const stop = startThemeClock();
  try {
    const accent = tokens.get('--color-accent');
    assert.equal(tokens.get('color-scheme'), 'light');
    context.mock.timers.tick(30_000);
    assert.equal(tokens.get('color-scheme'), 'dark');
    assert.equal(tokens.get('--color-accent'), accent);
    applyThemeTokens({ ...theme, appearance: 'manual', isDark: false });
    context.mock.timers.tick(60_000);
    assert.equal(tokens.get('color-scheme'), 'light');
    applyThemeTokens(theme);
    assert.equal(tokens.get('color-scheme'), 'dark');
    context.mock.timers.setTime(new Date(2026, 8, 5, 8).getTime());
    events.get('focus')();
    assert.equal(tokens.get('color-scheme'), 'light');
    context.mock.timers.setTime(new Date(2026, 8, 5, 20).getTime());
    events.get('visibilitychange')();
    assert.equal(tokens.get('color-scheme'), 'dark');
  } finally {
    stop();
    assert.equal(events.size, 0);
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});

test('both appearances keep text readable across tinted surfaces and custom accents', () => {
  const tokens = new Map();
  globalThis.document = {
    documentElement: { style: { setProperty: (key, value) => tokens.set(key, value) } },
  };
  for (const isDark of [true, false]) {
    for (const atmosphere of [0, 12, 32]) {
      for (let accentHue = 0; accentHue < 360; accentHue += 30) {
        for (const accentLight of [0, 25, 50, 75, 100]) {
          const theme = { ...PRESET_THEMES[0], isDark, atmosphere, accentHue, accentLight };
          applyThemeTokens(theme);
          for (const foreground of [
            'text-primary',
            'text-secondary',
            'text-muted',
            'accent-ink',
            'success',
            'warning',
            'danger',
          ]) {
            for (const surface of [
              'bg',
              'surface',
              'surface-elevated',
              'surface-sunken',
              'surface-hover',
              'shell',
              'shell-end',
            ]) {
              const a = luminance(tokens.get(`--color-${foreground}`));
              const b = luminance(tokens.get(`--color-${surface}`));
              const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
              assert.ok(
                contrast >= 4.5,
                `${foreground}/${surface}: ${contrast} (${JSON.stringify(theme)})`,
              );
            }
          }
        }
      }
    }
  }
});

test('switching appearance back restores every token without changing the selected color', () => {
  const tokens = new Map();
  globalThis.document = {
    documentElement: { style: { setProperty: (key, value) => tokens.set(key, value) } },
  };
  for (const theme of PRESET_THEMES) {
    applyThemeTokens(theme);
    const dark = new Map(tokens);
    applyThemeTokens({ ...theme, isDark: false });
    assert.equal(tokens.get('color-scheme'), 'light');
    assert.notEqual(tokens.get('--color-bg'), dark.get('--color-bg'));
    assert.equal(tokens.get('--color-accent'), dark.get('--color-accent'));
    applyThemeTokens(theme);
    assert.deepEqual(tokens, dark);
  }
});

test('pet feedback returns to work and cannot overwrite a newer activity', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const mascot = useMascotStore.getState;
  mascot().setMood('working');
  mascot().pet();
  context.mock.timers.tick(2500);
  assert.equal(mascot().mood, 'working');
  assert.equal(mascot().message, null);
  mascot().pet();
  mascot().setMood('thinking');
  context.mock.timers.tick(3000);
  assert.equal(mascot().mood, 'thinking');
});

test('repeated pets extend feedback and retain the original activity', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const mascot = useMascotStore.getState;
  mascot().setMood('working');
  mascot().pet();
  context.mock.timers.tick(2000);
  mascot().pet();
  context.mock.timers.tick(600);
  assert.equal(mascot().mood, 'success');
  context.mock.timers.tick(1900);
  assert.equal(mascot().mood, 'working');
});

test('button labels keep at least 4.5:1 contrast across the custom color field', () => {
  const tokens = new Map();
  globalThis.document = {
    documentElement: { style: { setProperty: (key, value) => tokens.set(key, value) } },
  };
  for (let hue = 0; hue <= 360; hue += 15) {
    for (let light = 0; light <= 100; light += 5) {
      applyThemeTokens({ ...PRESET_THEMES[0], accentHue: hue, accentSat: 80, accentLight: light });
      const channels = hslToHex(hue, 80, light)
        .slice(1)
        .match(/.{2}/g)
        .map((value) => {
          const s = parseInt(value, 16) / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
      const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      const contrast =
        tokens.get('--color-on-accent') === '#000000'
          ? (luminance + 0.05) / 0.05
          : 1.05 / (luminance + 0.05);
      assert.ok(contrast >= 4.5, `Contrast ${contrast} at hue ${hue}, lightness ${light}`);
    }
  }
});
