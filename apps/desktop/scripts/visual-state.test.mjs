import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyThemeTokens,
  hslToHex,
  isDarkAtTime,
  PRESET_THEMES,
  paletteColors,
  startThemeClock,
  themeTokens,
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
    for (const atmosphere of [0, 12, 32, 48, 64]) {
      for (let accentHue = 0; accentHue < 360; accentHue += 30) {
        for (const accentLight of [0, 25, 50, 75, 100]) {
          for (const harmony of ['single', 'duo', 'trio']) {
            const theme = {
              ...PRESET_THEMES[0],
              isDark,
              atmosphere,
              accentHue,
              accentLight,
              harmony,
            };
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

test('generated palettes wrap hue, preserve the primary and keep legacy themes single', () => {
  const legacy = { ...PRESET_THEMES[0], accentHue: 350 };
  assert.deepEqual(themeTokens(legacy), themeTokens({ ...legacy, harmony: 'single' }));
  assert.deepEqual(
    paletteColors({ ...legacy, harmony: 'duo' }).map((c) => c.hue),
    [350, 170],
  );
  assert.deepEqual(
    paletteColors({ ...legacy, harmony: 'trio' }).map((c) => c.hue),
    [350, 110, 230],
  );
  for (const harmony of ['single', 'duo', 'trio']) {
    const theme = { ...legacy, harmony };
    const tokens = themeTokens(theme);
    assert.equal(tokens['--color-accent'], themeTokens(legacy)['--color-accent']);
    for (const gradient of ['--color-shell-gradient', '--color-onboarding-gradient']) {
      const resolved = tokens[gradient].replace(/var\(([^)]+)\)/g, (_, key) => tokens[key]);
      for (const [background] of resolved.matchAll(/hsl\([\d.]+ [\d.]+% [\d.]+%\)/g)) {
        for (const role of ['text-primary', 'text-secondary', 'text-muted', 'accent-ink']) {
          const a = luminance(tokens[`--color-${role}`]);
          const b = luminance(background);
          assert.ok(
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
            `${role} on ${gradient}, ${harmony}`,
          );
        }
      }
    }
  }
});

test('accent text stays readable on normal and hovered fills, including low-saturation colors', () => {
  for (let hue = 0; hue < 360; hue += 15) {
    for (const saturation of [0, 20, 50, 80, 100]) {
      for (let light = 0; light <= 100; light += 2) {
        const tokens = themeTokens({
          ...PRESET_THEMES[0],
          accentHue: hue,
          accentSat: saturation,
          accentLight: light,
        });
        const foreground = luminance(tokens['--color-on-accent']);
        for (const fill of ['--color-accent', '--color-accent-hover']) {
          const background = luminance(tokens[fill]);
          const ratio =
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          assert.ok(ratio >= 4.5, `${fill} ${hue}/${saturation}/${light}: ${ratio}`);
        }
      }
    }
  }
});

test('action fills prefer white with bounded deepening and keep contrast on hover', () => {
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  for (let hue = 0; hue < 360; hue += 15) {
    for (const saturation of [0, 20, 50, 80, 100]) {
      for (let light = 0; light <= 100; light += 2) {
        const theme = {
          ...PRESET_THEMES[0],
          accentHue: hue,
          accentSat: saturation,
          accentLight: light,
        };
        const tokens = themeTokens(theme);
        const ink = luminance(tokens['--color-on-action']);
        for (const fill of ['--color-action', '--color-action-hover']) {
          assert.ok(
            contrast(ink, luminance(tokens[fill])) >= 4.5,
            `${fill} ${hue}/${saturation}/${light}`,
          );
        }
        const actionLight = Number(tokens['--color-action'].match(/([\d.]+)%\)$/)[1]);
        assert.ok(actionLight <= light && actionLight >= Math.max(0, light - 12));
        assert.equal(tokens['--color-accent'], `hsl(${hue} ${saturation}% ${light}%)`);
      }
    }
  }
  const rose = themeTokens(PRESET_THEMES.find((theme) => theme.id === 'zen-rose'));
  assert.equal(rose['--color-on-action'], '#ffffff');
  assert.notEqual(rose['--color-action'], rose['--color-accent']);
  const yellow = themeTokens(PRESET_THEMES.find((theme) => theme.id === 'neon-amber'));
  assert.equal(yellow['--color-on-action'], '#000000');
  assert.equal(yellow['--color-action'], yellow['--color-accent']);
});
