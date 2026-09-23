import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { root } from './catalog.mjs';

test('workflow planning maps release branches, isolates rehearsals and fails before builds when signing is unavailable', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'jackalope-release-plan-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(resolve(root, 'scripts/release'), resolve(directory, 'scripts/release'), {
    recursive: true,
  });
  const files = {
    'package.json': '{"version":"0.1.0"}',
    'apps/desktop/package.json': '{"version":"0.1.0"}',
    'apps/desktop/src-tauri/tauri.conf.json': '{"version":"0.1.0"}',
    'apps/desktop/src-tauri/Cargo.toml': 'version = "0.1.0"',
    'apps/desktop/src-tauri/Cargo.lock': 'name = "jackalope-desktop"\nversion = "0.1.0"',
    'releases/0.1.0.md': '# Jackalope 0.1.0\n\nStatus: ready\nDate: 2020-01-01\n\nA useful change.',
  };
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(dirname(resolve(directory, name)), { recursive: true });
    await writeFile(resolve(directory, name), contents);
  }
  const event = resolve(directory, 'event.json');
  const output = resolve(directory, 'output.txt');
  const execute = async (inputs, env = {}) => {
    await writeFile(event, JSON.stringify({ inputs }));
    await writeFile(output, '');
    const result = spawnSync(
      process.execPath,
      [resolve(directory, 'scripts/release/cloud-plan.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF_NAME: 'beta',
          GITHUB_EVENT_PATH: event,
          GITHUB_OUTPUT: output,
          CLOUD_RELEASE_ENABLED: 'false',
          CLOUD_SIGNING_READY: 'false',
          APPLE_SIGNING_READY: 'false',
          CLOUD_RELEASE_TARGETS: '["windows-x86_64","darwin-aarch64"]',
          ...env,
        },
      },
    );
    return { ...result, outputs: await readFile(output, 'utf8') };
  };
  const trial = await execute({ mode: 'rehearsal', targets: 'windows' });
  assert.equal(trial.status, 0, trial.stderr);
  assert.match(trial.outputs, /channel=beta/);
  assert.match(trial.outputs, /targets=\["windows-x86_64"\]/);
  const stable = await execute(
    { mode: 'rehearsal', targets: 'configured' },
    { GITHUB_REF_NAME: 'stable' },
  );
  assert.equal(stable.status, 0, stable.stderr);
  assert.match(stable.outputs, /channel=stable/);
  assert.notEqual((await execute({ mode: 'publish' }, { GITHUB_REF_NAME: 'master' })).status, 0);
  assert.notEqual(
    (await execute({ mode: 'rehearsal' }, { GITHUB_REF_NAME: 'untrusted' })).status,
    0,
  );
  const blocked = await execute({ mode: 'candidate', targets: 'windows' });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Complete Azure setup/);
  const mac = await execute(
    { mode: 'candidate', targets: 'configured' },
    { CLOUD_SIGNING_READY: 'true' },
  );
  assert.match(mac.stderr, /Complete Apple setup/);
  const store = await execute(
    { mode: 'candidate', targets: 'configured' },
    {
      RELEASE_DISTRIBUTION: 'store',
      APPLE_SIGNING_READY: 'true',
    },
  );
  assert.equal(store.status, 0, store.stderr);
  assert.match(store.outputs, /targets=\["darwin-aarch64"\]/);
  const direct = await execute(
    { mode: 'candidate', targets: 'windows' },
    { RELEASE_DISTRIBUTION: 'store' },
  );
  assert.match(direct.stderr, /Windows releases use Microsoft Store/);
  const disabled = await execute({}, { GITHUB_EVENT_NAME: 'push' });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.match(disabled.outputs, /enabled=false/);
});
