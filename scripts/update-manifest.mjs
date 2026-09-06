import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function makeManifest({ version, baseUrl, notes, nsis, msi }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Use a stable major.minor.patch release version.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.hash || base.search) throw new Error('Artifact base URL must use HTTPS without credentials, query or fragment.');
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const platforms = {};
  for (const [installer, path, expected] of [
    ['nsis', nsis, `Jackalope_${version}_x64-setup.exe`],
    ['msi', msi, `Jackalope_${version}_x64_en-US.msi`],
  ]) {
    if (basename(path) !== expected || !(await stat(path)).isFile() || !(await stat(path)).size) throw new Error(`Missing or mismatched ${installer} installer for ${version}.`);
    const signature = (await readFile(`${path}.sig`, 'utf8')).trim();
    if (!signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error(`Invalid ${installer} signature file.`);
    platforms[`windows-x86_64-${installer}`] = { signature, url: new URL(encodeURIComponent(expected), base).href };
  }
  return { version, notes, pub_date: new Date().toISOString(), platforms };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, baseUrl, notesPath, nsis, msi, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node scripts/update-manifest.mjs VERSION ARTIFACT_BASE_URL NOTES_FILE NSIS_FILE MSI_FILE OUTPUT_JSON');
  const manifest = await makeManifest({ version, baseUrl, notes: await readFile(notesPath, 'utf8'), nsis, msi });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Update manifest generated locally. Upload installers first, then publish the manifest.');
}
