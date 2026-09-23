import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { characterMarkViewBox, characterPaths } from '@jackalope/brand/character';
import { applyThemeTokens, DEFAULT_THEME, hslToHex } from '@jackalope/brand/theme';
import { Resvg } from '@resvg/resvg-js';

// Finder lays out the disk image window in points; these must match
// bundle.macOS.dmg in tauri.conf.json.
const width = 660;
const height = 400;
const app = { x: 180, y: 190 };
const applications = { x: 480, y: 190 };

if (process.platform !== 'darwin')
  throw new Error('Run on macOS: the Retina background is assembled with tiffutil.');

// The marketing website's appearance: the brand default in light mode.
function palette() {
  const tokens = new Map();
  globalThis.document = {
    documentElement: { style: { setProperty: (key, value) => tokens.set(key, value) } },
  };
  applyThemeTokens({ ...DEFAULT_THEME, isDark: false, atmosphere: 18 });
  delete globalThis.document;
  return (name) => {
    const color = tokens.get(`--color-${name}`);
    const hsl = color?.match(/^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/);
    if (!hsl) throw new Error(`Expected an opaque theme color: ${name}`);
    return hslToHex(...hsl.slice(1).map(Number));
  };
}

// Finder draws icon labels in dark text regardless of the background, so the
// window uses the light palette to keep "Jackalope" and "Applications" legible.
const color = palette();
const head = ['antler', 'farEar', 'nearEar', 'head']
  .map((key) => `<path d="${characterPaths[key]}"/>`)
  .join('');

// The desktop mark repeats its silhouette at falling opacity; the same echo
// trails the mark here.
function echoMark(x, y, size) {
  const echoes = [4, 3, 2, 1]
    .map(
      (step) =>
        `<svg x="${x - step * 13}" y="${y - step * 4}" width="${size}" height="${size}" viewBox="${characterMarkViewBox}"><g fill="${color('accent')}" opacity="${(0.07 * (5 - step)).toFixed(2)}">${head}</g></svg>`,
    )
    .join('');
  return `${echoes}<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${characterMarkViewBox}"><g fill="${color('accent-ink')}">${head}</g></svg>`;
}

const arrowStart = app.x + 78;
const arrowEnd = applications.x - 78;
const arrowY = app.y - 6;
// Point the head along the curve's final tangent, from its last control point.
const arrowAngle = (Math.atan2(34, 40) * 180) / Math.PI;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.85">
      <stop stop-color="${color('accent')}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${color('accent')}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="floor" y1="0.55" y2="1" x2="0">
      <stop stop-color="${color('surface-sunken')}" stop-opacity="0"/>
      <stop offset="1" stop-color="${color('surface-sunken')}" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${color('surface')}"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <rect width="${width}" height="${height}" fill="url(#floor)"/>
  ${echoMark(width / 2 - 20, 34, 64)}
  <path d="M ${arrowStart} ${arrowY} C ${arrowStart + 40} ${arrowY - 34}, ${arrowEnd - 40} ${arrowY - 34}, ${arrowEnd} ${arrowY}"
    fill="none" stroke="${color('accent')}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>
  <path d="M -13 -7 L 1 0 L -13 7" transform="translate(${arrowEnd} ${arrowY}) rotate(${arrowAngle})"
    fill="none" stroke="${color('accent')}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const output = new URL('../src-tauri/installer/dmg-background.tiff', import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'jackalope-dmg-'));
try {
  const standard = join(scratch, 'background.png');
  const retina = join(scratch, 'background@2x.png');
  for (const [file, scale] of [
    [standard, 1],
    [retina, 2],
  ]) {
    const image = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } }).render();
    writeFileSync(file, image.asPng());
  }
  // One TIFF holding both resolutions lets Finder pick the sharp image on
  // Retina displays while keeping the window size in points.
  execFileSync('tiffutil', ['-cathidpicheck', standard, retina, '-out', output.pathname]);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(
  'Generated the macOS disk image background from the brand default theme and shared mark.',
);
