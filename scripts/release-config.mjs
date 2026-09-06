import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [endpoint, publicKey, certificateThumbprint, timestampUrl] = process.argv.slice(2);
for (const value of [endpoint, timestampUrl]) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Release and timestamp URLs must use HTTPS without credentials or fragments.');
  }
}
if (!publicKey || !/^[A-Za-z0-9+/=]+$/.test(publicKey)) throw new Error('Supply the Tauri updater public key.');
if (!/^[a-fA-F0-9]{40}$/.test(certificateThumbprint ?? '')) throw new Error('Supply the installed Windows signing certificate thumbprint.');
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Set TAURI_SIGNING_PRIVATE_KEY in the signing environment.');
const directory = resolve('output/release');
await mkdir(directory, { recursive: true });
const config = {
  bundle: { createUpdaterArtifacts: true, windows: { certificateThumbprint, digestAlgorithm: 'sha256', timestampUrl, tsp: true } },
  plugins: { updater: { pubkey: publicKey, endpoints: [endpoint] } },
};
await writeFile(resolve(directory, 'tauri.release.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log('Release configuration prepared. Private signing material was not written.');
