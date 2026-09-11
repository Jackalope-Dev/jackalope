import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function buildAdmin() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['admin/main.tsx'],
    bundle: true,
    minify: true,
    write: false,
    outfile: 'admin.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
    legalComments: 'inline',
  });
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text;
  if (!script || !css) throw new Error('Admin bundle is incomplete.');
  await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../src/generated/admin-assets.ts', import.meta.url),
    `export const adminScript = ${JSON.stringify(script)};\nexport const adminCss = ${JSON.stringify(css)};\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildAdmin();
