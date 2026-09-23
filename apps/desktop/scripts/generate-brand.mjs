import { copyFileSync, writeFileSync } from 'node:fs';
import { characterMarkViewBox, characterPaths as paths } from '@jackalope/brand/character';

if (process.argv.includes('--copy-icon')) {
  copyFileSync(
    new URL('../src-tauri/icons/128x128.png', import.meta.url),
    new URL('../public/app-icon.png', import.meta.url),
  );
  process.exit(0);
}

const mark = ['antler', 'farEar', 'nearEar', 'head']
  .map((key) => `<path d="${paths[key]}"/>`)
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${characterMarkViewBox}"><title>Jackalope</title><g fill="#f3f4f6">${mark}</g></svg>\n`;
writeFileSync(new URL('../public/mascot.svg', import.meta.url), svg);
const icon = svg.replace(
  '<g fill=',
  '<rect x="25" y="-3" width="128" height="128" rx="26" fill="#1d1a18"/><g fill=',
);
writeFileSync(new URL('../src-tauri/icons/source-icon.svg', import.meta.url), icon);

// macOS menu bar icon: a plain black silhouette, no background. macOS treats
// the fill color as irrelevant and recolors from the alpha channel alone
// once tray-icon-template.png is loaded with `icon_as_template`, but the SVG
// source stays solid black for anyone previewing it directly. Regenerate the
// PNG after editing this with `swift scripts/render-tray-icon.swift` (macOS
// only — there's no cross-platform rasterizer in this pipeline). Don't use
// `qlmanage -t`: it looks like it preserves transparency but actually
// flattens onto opaque white, so the icon renders as a blank square.
const trayIcon = svg
  .replace('fill="#f3f4f6"', 'fill="#000000"')
  .replace('<title>Jackalope</title>', '');
writeFileSync(new URL('../src-tauri/icons/tray-icon-template.svg', import.meta.url), trayIcon);
