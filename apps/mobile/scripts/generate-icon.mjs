// Renders the companion's app icon: the Jackalope mark drawn as text, as AsciiMark and the
// terminal draw it, on an indigo field. Writes a 1024px opaque PNG for `tauri icon`.
// Usage: node scripts/generate-icon.mjs [output.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { characterPaths } from '../../../packages/brand/src/character.ts';

const output = process.argv[2] ?? new URL('../src-tauri/icons/source-icon.png', import.meta.url);
const font = readFileSync(
  new URL(
    import.meta.resolve(
      '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
    ),
  ),
).toString('base64');
const paths = ['farEar', 'nearEar', 'antler', 'head'].map((key) => characterPaths[key]);

const page = `<!doctype html><style>
@font-face { font-family: Mark; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 800; }
html, body { margin: 0; background: #000; }
</style><canvas id="icon" width="1024" height="1024"></canvas>`;

/** Runs in the page: the same ramp, echoes and sampling as packages/brand AsciiMark. */
function draw({ paths }) {
  const SIZE = 1024;
  const RAMP = ' .:-=+*#%@';
  const VIEW = { x: 38, y: 4, width: 105, height: 117 };
  const ECHO = { x: 4, y: 1 };
  const ECHOES = 4;
  const canvas = document.getElementById('icon');
  const context = canvas.getContext('2d');

  const field = context.createLinearGradient(0, 0, SIZE, SIZE);
  field.addColorStop(0, '#6d28d9');
  field.addColorStop(0.55, '#4338ca');
  field.addColorStop(1, '#1e1b4b');
  context.fillStyle = field;
  context.fillRect(0, 0, SIZE, SIZE);
  const glow = context.createRadialGradient(470, 480, 40, 470, 480, 520);
  glow.addColorStop(0, 'rgba(165, 180, 252, 0.3)');
  glow.addColorStop(1, 'rgba(99, 102, 241, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, SIZE, SIZE);

  const glyph = 26;
  const cellWidth = glyph * 0.6;
  const cellHeight = glyph * 1.02;
  const cols = Math.floor(SIZE / cellWidth);
  const rows = Math.floor(SIZE / cellHeight);
  const spanX = VIEW.width + ECHO.x * ECHOES;
  const spanY = VIEW.height + ECHO.y * ECHOES;
  // The mark fills the middle of the icon, inside the area iOS never crops.
  const scale = (SIZE * 0.8) / Math.max(spanX, spanY);
  const offsetX = (SIZE - spanX * scale) / 2;
  const offsetY = (SIZE - spanY * scale) / 2;
  const sample = (shapes) => {
    const sampler = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    sampler.canvas.width = cols;
    sampler.canvas.height = rows;
    shapes(sampler, (shift) =>
      sampler.setTransform(
        scale / cellWidth,
        0,
        0,
        scale / cellHeight,
        (offsetX + (ECHO.x * shift - VIEW.x) * scale) / cellWidth,
        (offsetY + (ECHO.y * shift - VIEW.y) * scale) / cellHeight,
      ),
    );
    const data = sampler.getImageData(0, 0, cols, rows).data;
    return Array.from({ length: cols * rows }, (_, index) => data[index * 4 + 3] / 255);
  };
  const marks = paths.map((d) => new Path2D(d));
  const head = sample((sampler, place) => {
    place(0);
    for (const path of marks) sampler.fill(path);
  });
  const echoes = sample((sampler, place) => {
    sampler.lineWidth = 1.8;
    for (let echo = ECHOES; echo >= 1; echo--) {
      place(echo);
      sampler.strokeStyle = `rgba(0,0,0,${0.75 - (echo / ECHOES) * 0.45})`;
      for (const path of marks) sampler.stroke(path);
    }
  });

  context.font = `600 ${glyph}px Mark`;
  context.textBaseline = 'top';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const x = col * cellWidth;
      const y = row * cellHeight;
      const solid = head[index];
      const trail = echoes[index];
      if (solid >= 0.06) {
        context.fillStyle = '#eef2ff';
        context.globalAlpha = 0.35 + solid * 0.65;
        context.fillText(RAMP[Math.min(9, Math.ceil(solid * 9))], x, y);
      } else if (trail >= 0.06) {
        context.fillStyle = '#c4b5fd';
        context.globalAlpha = 0.25 + trail * 0.6;
        context.fillText(RAMP[Math.min(9, Math.ceil(trail * 9))], x, y);
      }
    }
  }
  context.globalAlpha = 1;
}

const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await tab.setContent(page);
  await tab.evaluate(() => document.fonts.load('600 26px Mark'));
  await tab.evaluate(draw, { paths });
  const png = await tab.locator('#icon').screenshot({ omitBackground: false });
  writeFileSync(output, png);
} finally {
  await browser.close();
}
