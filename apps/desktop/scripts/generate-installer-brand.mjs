import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { characterPaths } from '../src/components/mascot/character-paths.ts';
import { applyThemeTokens, hslToHex, PRESET_THEMES } from '../src/lib/theme-engine.ts';

const output = new URL('../src-tauri/installer/', import.meta.url);
mkdirSync(output, { recursive: true });

function palette(isDark) {
  const tokens = new Map();
  globalThis.document = {
    documentElement: { style: { setProperty: (key, value) => tokens.set(key, value) } },
  };
  applyThemeTokens({ ...PRESET_THEMES[0], isDark });
  delete globalThis.document;
  return (name) => {
    const color = tokens.get(`--color-${name}`);
    const hsl = color?.match(/^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/);
    if (!hsl) throw new Error(`Expected an opaque theme color: ${name}`);
    return hslToHex(...hsl.slice(1).map(Number));
  };
}

const light = palette(false);
const dark = palette(true);
const paths = ['antler', 'farEar', 'nearEar', 'head']
  .map((key) => `<path d="${characterPaths[key]}"/>`)
  .join('');
const mark = (x, y, size, color) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="25 -8 128 128"><g fill="${color}">${paths}</g></svg>`;

function sidebar(width, height) {
  return `<defs>
    <linearGradient id="shell" x2="0.2" y2="1"><stop stop-color="${dark('surface-elevated')}"/><stop offset="1" stop-color="${dark('surface-sunken')}"/></linearGradient>
    <radialGradient id="glow" cx="0.15" cy="0.05" r="0.9"><stop stop-color="${dark('accent')}" stop-opacity="0.25"/><stop offset="1" stop-color="${dark('accent')}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#shell)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${mark((width - 110) / 2, 49, 110, dark('text-primary'))}
  <text x="22" y="${height - 81}" fill="${dark('text-primary')}" font-family="Segoe UI" font-size="21" font-weight="600">Jackalope</text>
  <text x="22" y="${height - 51}" fill="${dark('text-secondary')}" font-family="Segoe UI" font-size="13">A place to get</text>
  <text x="22" y="${height - 32}" fill="${dark('text-secondary')}" font-family="Segoe UI" font-size="13">things done.</text>`;
}

function bitmap(image) {
  const { width, height, pixels } = image;
  const stride = (width * 3 + 3) & ~3;
  const data = Buffer.alloc(54 + stride * height);
  data.write('BM');
  data.writeUInt32LE(data.length, 2);
  data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14);
  data.writeInt32LE(width, 18);
  data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26);
  data.writeUInt16LE(24, 28);
  data.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const target = 54 + (height - 1 - y) * stride + x * 3;
      if (pixels[source + 3] !== 255) throw new Error('Installer artwork must be opaque');
      data[target] = pixels[source + 2];
      data[target + 1] = pixels[source + 1];
      data[target + 2] = pixels[source];
    }
  }
  return data;
}

function render(name, width, height, content, scale = 1) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
  const renderer = new Resvg(svg, {
    font: { defaultFontFamily: 'Segoe UI' },
    fitTo: { mode: 'zoom', value: scale },
  });
  writeFileSync(new URL(`${name}.bmp`, output), bitmap(renderer.render()));
}

render('nsis-sidebar', 164, 314, sidebar(164, 314), 3);
render(
  'nsis-header',
  150,
  57,
  `<rect width="150" height="57" fill="${light('surface')}"/>${mark(98, 7, 43, light('accent-ink'))}`,
  3,
);
render(
  'wix-dialog',
  493,
  312,
  `<rect width="493" height="312" fill="${light('surface')}"/>${sidebar(164, 312)}`,
);
render(
  'wix-banner',
  493,
  58,
  `<rect width="493" height="58" fill="${light('surface')}"/>${mark(439, 7, 43, light('accent-ink'))}`,
);

writeFileSync(
  new URL('theme.nsh', output),
  [
    `!define JACKALOPE_SURFACE "${light('surface').slice(1)}"`,
    `!define JACKALOPE_TEXT "${light('text-primary').slice(1)}"`,
    '',
  ].join('\n'),
);
console.log('Generated Windows installer artwork from the Mojave theme and shared mascot paths.');
