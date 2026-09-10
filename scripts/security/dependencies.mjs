import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const provenance = JSON.parse(read('patches/glib/provenance.json'));
const files = (directory) =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`],
  );
const retained = files('patches/glib')
  .filter(
    (file) =>
      !file.endsWith('/provenance.json') &&
      !file.includes('/target/') &&
      !file.endsWith('/Cargo.lock'),
  )
  .sort();
if (JSON.stringify(retained) !== JSON.stringify(Object.keys(provenance.files).sort()))
  throw new Error('Vendored GLib files differ from the reviewed manifest.');
for (const file of retained) {
  const hash = createHash('sha256').update(read(file).replaceAll('\r\n', '\n')).digest('hex');
  if (hash !== provenance.files[file]) throw new Error(`Vendored GLib checksum mismatch: ${file}`);
}
const manifest = read('apps/desktop/src-tauri/Cargo.toml');
const lock = read('apps/desktop/src-tauri/Cargo.lock');
const glib = lock.split('[[package]]').find((block) => /^name = "glib"$/m.test(block));
if (
  !manifest.includes('glib = { path = "../../../patches/glib" }') ||
  !glib ||
  /^source =/m.test(glib) ||
  !/^version = "0.18.5"$/m.test(glib)
)
  throw new Error('The patched GLib source is not locked.');
if (process.argv.includes('--patch-only')) {
  console.log('Vendored GLib provenance and source override verified.');
  process.exit(0);
}
const runJson = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Audit did not return JSON: ${result.stderr || result.stdout}`);
  }
  return { value, status: result.status };
};
const pnpm = process.env.npm_execpath;
if (!pnpm || !/\.[cm]?js$/i.test(pnpm)) throw new Error('Run with pnpm check:dependencies.');
const js = runJson(process.execPath, [pnpm, 'audit', '--json']);
if (
  js.status !== 0 ||
  !js.value.metadata ||
  Object.values(js.value.metadata.vulnerabilities).some((count) => count > 0)
)
  throw new Error(
    `JavaScript dependency audit failed: ${JSON.stringify(js.value.metadata ?? js.value.error)}`,
  );
const rust = runJson(process.env.CARGO_AUDIT || 'cargo-audit', [
  'audit',
  '--file',
  'apps/desktop/src-tauri/Cargo.lock',
  '--json',
]);
if (rust.status !== 0 || !rust.value.vulnerabilities || rust.value.vulnerabilities.count > 0)
  throw new Error(
    `Rust dependency audit failed: ${JSON.stringify(rust.value.vulnerabilities ?? rust.value.error)}`,
  );
const policy = JSON.parse(read('scripts/security/dependency-policy.json'));
const warnings = Object.values(rust.value.warnings ?? {}).flat();
for (const warning of warnings) {
  if (
    warning.kind !== 'unmaintained' ||
    !policy.rustWarnings.some(
      (rule) =>
        rule.package === warning.package.name &&
        rule.version === warning.package.version &&
        rule.advisory === warning.advisory.id,
    )
  )
    throw new Error(
      `Unreviewed Rust advisory: ${warning.advisory?.id ?? warning.kind} (${warning.package?.name})`,
    );
}
console.log(
  `Dependency audits passed; ${warnings.length} explicitly tracked upstream maintenance warnings.`,
);
