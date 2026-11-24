// Runs a package's bin, found the way Node resolves an import: from the current
// folder up. In a worktree with no node_modules of its own (scripts/worktree.mjs)
// that finds the main checkout's copy, where a hard-coded node_modules/... path
// fails and npx/bunx can run an unrelated global or freshly downloaded version.
//   node scripts/run-bin.mjs eslint --fix ...              the package's own bin
//   node scripts/run-bin.mjs @biomejs/biome check ...       scoped packages too
//   node scripts/run-bin.mjs typescript:tsc --noEmit       a named bin of several
// Reads the bin from the package's package.json, so packages whose "exports"
// hide their bin file (eslint) still work.
// Canonical copy: jackalope-digital-hub/templates/scripts/run-bin.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const [spec, ...args] = process.argv.slice(2);
if (!spec) {
  console.error('Usage: node scripts/run-bin.mjs <package>[:<bin>] [args...]');
  process.exit(1);
}
const [name, binName] = spec.split(':');
const require = createRequire(join(process.cwd(), 'package.json'));
const parts = name.split('/');
const pkg = parts.slice(0, name.startsWith('@') ? 2 : 1).join('/');

function binPath() {
  // A file inside the package (@biomejs/biome/bin/biome): resolve it directly.
  if (pkg !== name) return require.resolve(name);
  const manifestPath = require.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rel =
    typeof bin === 'string'
      ? bin
      : (bin?.[binName ?? pkg.split('/').pop()] ?? (bin && Object.values(bin)[0]));
  if (!rel) {
    console.error(`${pkg} has no bin${binName ? ` named ${binName}` : ''}.`);
    process.exit(1);
  }
  return join(dirname(manifestPath), rel);
}

const r = spawnSync(process.execPath, [binPath(), ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
