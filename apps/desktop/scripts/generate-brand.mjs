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
