// Builds the Worker into the single ES module and upload settings that the desktop
// app embeds for one-click Swarm setup. `--check` fails when the committed copy is stale.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '../../../scripts/lib/jsonc.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const output = join(app, '../desktop/src-tauri/resources/swarm-worker');
const check = process.argv.includes('--check');

const config = parseJsonc(readFileSync(join(app, 'wrangler.jsonc'), 'utf8'));
const artifacts = config.artifacts ?? [];
const objects = config.durable_objects?.bindings ?? [];
if (artifacts.length !== 1 || !objects.length)
  throw new Error('One-click setup expects one Artifacts binding and the Swarm Durable Object.');

const wrangler = join(
  dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
  'bin/wrangler.js',
);
const scratch = mkdtempSync(join(tmpdir(), 'jackalope-swarm-'));
let code;
try {
  const built = spawnSync(
    process.execPath,
    [wrangler, 'deploy', '--dry-run', '--outdir', scratch],
    { cwd: app, encoding: 'utf8', windowsHide: true, env: { ...process.env, CI: '1' } },
  );
  if (built.status !== 0) {
    process.stderr.write(built.stdout + built.stderr);
    process.exit(built.status ?? 1);
  }
  code = readFileSync(join(scratch, 'index.js'), 'utf8')
    .replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '')
    .replace(/\r\n/g, '\n');
  if (!code.endsWith('\n')) code += '\n';
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const settings = {
  script: config.name,
  mainModule: 'worker.js',
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags ?? [],
  artifactsBinding: artifacts[0].binding,
  durableObjects: objects.map(({ name, class_name }) => ({ name, className: class_name })),
  migrations: config.migrations ?? [],
};
const version = createHash('sha256')
  .update(code)
  .update(JSON.stringify(settings))
  .digest('hex')
  .slice(0, 16);
const manifest = `${JSON.stringify({ version, ...settings }, null, 2)}\n`;

const files = { 'worker.js': code, 'manifest.json': manifest };
if (check) {
  const stale = Object.entries(files).filter(
    ([name, text]) =>
      !existsSync(join(output, name)) || readFileSync(join(output, name), 'utf8') !== text,
  );
  if (stale.length) {
    console.error(
      `The bundled swarm Worker is out of date (${stale.map(([name]) => name).join(', ')}). Run pnpm --filter @jackalope/swarm bundle.`,
    );
    process.exit(1);
  }
  console.log(`Bundled swarm Worker ${version} is current.`);
} else {
  mkdirSync(output, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(output, name), text);
  console.log(`Wrote swarm Worker ${version}.`);
}
