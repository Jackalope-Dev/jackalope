import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assertVersions, channel, readNotes, root, sha256 } from './catalog.mjs';
import { validateCloudFiles } from './cloud-artifacts.mjs';
import { cloudAssets, cloudFiles } from './cloud-targets.mjs';
import { application, clearAppleSigning, cloudConfig } from './crabnebula-config.mjs';

const mode = process.argv[2];
const selectedChannel = channel(process.argv[3]);
const mac = process.platform === 'darwin';
if (!['darwin', 'linux'].includes(process.platform) || !['candidate', 'rehearsal'].includes(mode))
  throw new Error('Usage on macOS/Linux: cloud-build-unix.mjs candidate|rehearsal beta|stable');
const target = `${mac ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`;
if (!['x64', 'arm64'].includes(process.arch) || (!mac && process.arch !== 'x64'))
  throw new Error('Unsupported build architecture');
const run = (cmd, args, options = {}) => {
  try {
    return execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
  } catch {
    throw new Error(`${cmd} failed during release preparation`);
  }
};
const capture = (cmd, args) => run(cmd, args, { stdio: 'pipe', encoding: 'utf8' }).trim();
const source = capture('git', ['rev-parse', 'HEAD']);
const dirty = () => Boolean(capture('git', ['status', '--porcelain', '--untracked-files=normal']));
const candidate = mode === 'candidate';
if (candidate && dirty()) throw new Error('Candidates require a clean committed checkout');
const v = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
await assertVersions(v);
const notes = await readNotes(v, candidate);
const directory = resolve(root, 'output/cloud', randomUUID());
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(resolve(tmpdir(), 'jackalope-signing-'));
let keychain;
let oldKeychains;
try {
  if (candidate) {
    const required = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_UPDATER_PUBLIC_KEY'];
    if (mac)
      required.push(
        'APPLE_CERTIFICATE',
        'APPLE_CERTIFICATE_PASSWORD',
        'APPLE_SIGNING_IDENTITY',
        'APPLE_TEAM_ID',
        'APPLE_API_KEY',
        'APPLE_API_ISSUER',
        'APPLE_API_PRIVATE_KEY',
      );
    for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);
    if (mac && process.env.APPLE_SIGNING_READY !== 'true')
      throw new Error('Apple signing is not enabled');
  } else {
    clearAppleSigning(process.env);
    const key = resolve(temporary, 'updater');
    run('pnpm', ['tauri', 'signer', 'generate', '--ci', '--write-keys', key], { stdio: 'pipe' });
    process.env.TAURI_SIGNING_PRIVATE_KEY = await readFile(key, 'utf8');
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '';
    process.env.TAURI_UPDATER_PUBLIC_KEY = (await readFile(`${key}.pub`, 'utf8')).trim();
  }
  if (mac && candidate) {
    if (
      !/^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(process.env.APPLE_SIGNING_IDENTITY) ||
      !process.env.APPLE_SIGNING_IDENTITY.endsWith(`(${process.env.APPLE_TEAM_ID})`)
    )
      throw new Error('Use the expected team Developer ID Application identity');
    const certificate = resolve(temporary, 'certificate.p12');
    await writeFile(certificate, Buffer.from(process.env.APPLE_CERTIFICATE, 'base64'), {
      mode: 0o600,
    });
    const apiKey = resolve(temporary, `AuthKey_${process.env.APPLE_API_KEY}.p8`);
    await writeFile(apiKey, process.env.APPLE_API_PRIVATE_KEY, { mode: 0o600 });
    process.env.APPLE_API_KEY_PATH = apiKey;
    keychain = resolve(temporary, 'signing.keychain-db');
    const password = randomUUID();
    oldKeychains = [
      ...capture('security', ['list-keychains', '-d', 'user']).matchAll(/"([^"]+)"/g),
    ].map((match) => match[1]);
    run('security', ['create-keychain', '-p', password, keychain], { stdio: 'pipe' });
    run('security', ['set-keychain-settings', '-lut', '21600', keychain]);
    run('security', ['unlock-keychain', '-p', password, keychain], { stdio: 'pipe' });
    run(
      'security',
      [
        'import',
        certificate,
        '-k',
        keychain,
        '-P',
        process.env.APPLE_CERTIFICATE_PASSWORD,
        '-T',
        '/usr/bin/codesign',
      ],
      { stdio: 'pipe' },
    );
    run(
      'security',
      [
        'set-key-partition-list',
        '-S',
        'apple-tool:,apple:,codesign:',
        '-s',
        '-k',
        password,
        keychain,
      ],
      { stdio: 'pipe' },
    );
    run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...oldKeychains]);
    delete process.env.APPLE_CERTIFICATE;
    delete process.env.APPLE_CERTIFICATE_PASSWORD;
  }
  const config = cloudConfig({
    mode,
    channel: selectedChannel,
    target,
    publicKey: process.env.TAURI_UPDATER_PUBLIC_KEY,
  });
  const configPath = resolve(directory, 'tauri.cloud.json');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(resolve(directory, 'notes.md'), notes.notes);
  const common = [
    '--features',
    'beta-access',
    '--config',
    configPath,
    ...(candidate ? [] : ['--debug']),
  ];
  run('pnpm', ['tauri', 'build', '--no-bundle', ...common]);
  const profile = candidate ? 'release' : 'debug';
  const native = resolve(
    process.env.CARGO_TARGET_DIR ?? resolve(root, 'apps/desktop/src-tauri/target'),
    profile,
  );
  if (mac) {
    // The terminal command ships beside the app executable and must carry the
    // same signature and hardened runtime for notarization. It needs none of
    // the app's entitlements.
    run('codesign', [
      '--force',
      '--sign',
      candidate ? process.env.APPLE_SIGNING_IDENTITY : '-',
      ...(candidate ? ['--keychain', keychain, '--timestamp', '--options', 'runtime'] : []),
      resolve(native, 'jackalope'),
    ]);
    for (const resource of [
      'agent-browser/agent-browser',
      'desktop-control/jackalope-desktop-control',
    ]) {
      run('codesign', [
        '--force',
        '--sign',
        candidate ? process.env.APPLE_SIGNING_IDENTITY : '-',
        ...(candidate ? ['--keychain', keychain, '--timestamp', '--options', 'runtime'] : []),
        '--entitlements',
        resolve(root, 'apps/desktop/src-tauri/entitlements.plist'),
        resolve(root, 'apps/desktop/src-tauri/resources', resource),
      ]);
    }
  }
  // Tauri skips the Finder layout pass (background, window size, icon
  // positions) when CI is set, which leaves the DMG unstyled.
  run('pnpm', ['tauri', 'bundle', ...common, '--bundles', mac ? 'app,dmg' : 'appimage'], {
    env: { ...process.env, CI: undefined },
  });
  const name = candidate ? 'Jackalope' : 'Jackalope Rehearsal';
  if (mac) {
    const app = resolve(native, 'bundle/macos', `${name}.app`);
    run('codesign', ['--verify', '--deep', '--strict', app]);
    if (candidate) {
      const info = spawnSync('codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
      if (
        info.status !== 0 ||
        !info.stderr.includes(`TeamIdentifier=${process.env.APPLE_TEAM_ID}`) ||
        !info.stderr.includes(`Authority=${process.env.APPLE_SIGNING_IDENTITY}`)
      )
        throw new Error('Signed app does not match the expected Apple publisher');
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
      run('xcrun', ['stapler', 'validate', app]);
    }
  }
  for (const asset of cloudAssets(target, v, mode)) {
    const folder = asset.name.endsWith('.dmg') ? 'dmg' : mac ? 'macos' : 'appimage';
    const extension = asset.name.endsWith('.dmg') ? '.dmg' : mac ? '.app.tar.gz' : '.AppImage';
    const candidates = (await readdir(resolve(native, 'bundle', folder))).filter(
      (file) =>
        file.startsWith(name) &&
        file.endsWith(extension) &&
        (extension === '.app.tar.gz' || file.includes(`_${v}_`)),
    );
    if (candidates.length !== 1) throw new Error(`Expected one current ${extension} artifact`);
    const from = resolve(native, 'bundle', folder, candidates[0]);
    await copyFile(from, resolve(directory, asset.name));
    if (asset.updatePlatform)
      await copyFile(`${from}.sig`, resolve(directory, `${asset.name}.sig`));
  }
  const files = {};
  for (const name of cloudFiles(target, v, mode))
    files[name] = sha256(await readFile(resolve(directory, name)));
  const receipt = {
    schemaVersion: 1,
    application,
    version: v,
    channel: selectedChannel,
    mode,
    source,
    sourceDirty: dirty(),
    target,
    distribution: mac ? 'dmg' : 'appimage',
    approvalRequired: true,
    publicSigned: candidate,
    files,
  };
  await writeFile(resolve(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  await validateCloudFiles(directory, { requireCandidate: candidate });
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `directory=${directory}\n`);
  console.log(`Prepared ${target} ${selectedChannel} ${v} in ${directory}`);
} finally {
  try {
    if (oldKeychains) run('security', ['list-keychains', '-d', 'user', '-s', ...oldKeychains]);
    if (keychain) run('security', ['delete-keychain', keychain]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
