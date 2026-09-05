import { copyFileSync, writeFileSync } from 'node:fs';
import { characterPaths as paths } from '../src/components/mascot/character-paths.ts';

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
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="25 -8 128 128"><g fill="#f3f4f6">${mark}</g></svg>\n`;
writeFileSync(new URL('../public/mascot.svg', import.meta.url), svg);
const icon = svg.replace(
  '<g fill=',
  '<rect x="25" y="-8" width="128" height="128" rx="26" fill="#1d1a18"/><g fill=',
);
writeFileSync(new URL('../src-tauri/icons/source-icon.svg', import.meta.url), icon);
