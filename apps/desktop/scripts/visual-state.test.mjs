import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyThemeTokens, hslToHex, PRESET_THEMES } from '../src/lib/theme-engine.ts';
import { useMascotStore } from '../src/stores/mascotStore.ts';

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
