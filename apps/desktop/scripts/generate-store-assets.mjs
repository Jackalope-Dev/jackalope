import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const destination = process.argv[2];
if (!destination) throw new Error('Provide the MSIX Assets directory.');
mkdirSync(destination, { recursive: true });
const icon = readFileSync(new URL('../src-tauri/icons/source-icon.svg', import.meta.url), 'utf8');
const render = (name, size) => {
  const png = new Resvg(icon, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(destination, `${name}.png`), png);
};

for (const [name, size] of [
  ['StoreLogo', 50],
  ['Square44x44Logo', 44],
  ['Square150x150Logo', 150],
]) {
  render(name, size);
  for (const scale of [200, 400]) render(`${name}.scale-${scale}`, (size * scale) / 100);
}
for (const size of [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]) {
  for (const form of ['', '_altform-unplated', '_altform-lightunplated']) {
    render(`Square44x44Logo.targetsize-${size}${form}`, size);
  }
}
