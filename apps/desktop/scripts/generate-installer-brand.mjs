import { mkdirSync, writeFileSync } from 'node:fs';
import { characterMarkViewBox, characterPaths } from '@jackalope/brand/character';
import { applyThemeTokens, DEFAULT_THEME, hslToHex } from '@jackalope/brand/theme';
import { Resvg } from '@resvg/resvg-js';

const output = new URL('../src-tauri/installer/', import.meta.url);
mkdirSync(output, { recursive: true });

function palette(isDark) {
  const tokens = new Map();
  globalThis.document = {
    documentElement: { style: { setProperty: (key, value) => tokens.set(key, value) } },
  };
  applyThemeTokens({ ...DEFAULT_THEME, isDark });
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
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${characterMarkViewBox}"><g fill="${color}">${paths}</g></svg>`;

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
  const image = renderer.render();
  writeFileSync(new URL(`${name}.bmp`, output), bitmap(image));
  return image;
}

// NSIS stretches artwork into its controls with nearest-neighbour sampling, so
// each display scale gets a bitmap at the control's exact pixel size. Controls
// are sized in dialog units, which depend on hooks.nsh's Segoe UI 9pt font:
// the wizard image is 109x193 DLU and the header image 100x35 DLU. Sizes were
// measured with the dialog manager's base-unit rule and confirmed against a
// running installer at 96 DPI; the aspect ratio differs between scales.
const nsisScales = [
  { dpi: 96, wizard: [191, 362], header: [175, 66] },
  { dpi: 120, wizard: [218, 483], header: [200, 88] },
  { dpi: 144, wizard: [273, 603], header: [250, 109] },
  { dpi: 168, wizard: [327, 724], header: [300, 131] },
  { dpi: 192, wizard: [354, 772], header: [325, 140] },
  { dpi: 216, wizard: [409, 893], header: [375, 162] },
  { dpi: 240, wizard: [463, 989], header: [425, 179] },
  { dpi: 288, wizard: [545, 1158], header: [500, 210] },
];

// Artwork keeps its 164px and 150px design widths; height follows the control.
function renderExact(name, designWidth, [width, height], draw) {
  const zoom = width / designWidth;
  const designHeight = height / zoom;
  const image = render(name, designWidth, designHeight, draw(designWidth, designHeight), zoom);
  if (image.width !== width || image.height !== height) {
    throw new Error(
      `${name} rendered at ${image.width}x${image.height}, expected ${width}x${height}`,
    );
  }
}

const header = (width, height) =>
  `<rect width="${width}" height="${height}" fill="${light('surface')}"/>${mark(width - 52, (height - 43) / 2, 43, light('accent-ink'))}`;

for (const { dpi, wizard, header: headerSize } of nsisScales) {
  const suffix = dpi === 96 ? '' : `-${dpi}`;
  renderExact(`nsis-sidebar${suffix}`, 164, wizard, sidebar);
  renderExact(`nsis-header${suffix}`, 150, headerSize, header);
}
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
    '!macro JACKALOPE_ARTWORK_SCALES UN',
    ...nsisScales
      .slice(1)
      .map(({ dpi }) => `  !insertmacro JACKALOPE_ARTWORK_SCALE "\${UN}" ${dpi}`),
    '!macroend',
    '',
  ].join('\n'),
);
console.log(
  'Generated Windows installer artwork from the brand default theme and shared mascot paths.',
);
