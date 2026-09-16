import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertVersions, readNotes, root } from './catalog.mjs';
import { releaseTargets } from './cloud-publish.mjs';

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const automatic = process.env.GITHUB_EVENT_NAME === 'push';
const branch = process.env.GITHUB_REF_NAME;
if (!['stable', 'beta'].includes(branch)) throw new Error('Cloud releases require stable or beta');
const channel = branch === 'stable' ? 'stable' : 'beta';
const mode = automatic ? 'publish' : event.inputs?.mode;
if (!['rehearsal', 'candidate', 'draft', 'publish'].includes(mode))
  throw new Error('Unknown release mode');
let enabled = !automatic || process.env.CLOUD_RELEASE_ENABLED === 'true';
const v = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
await assertVersions(v);
const noteText = await readFile(resolve(root, `releases/${v}.md`), 'utf8');
if (automatic && /^Status: draft\r?$/m.test(noteText)) enabled = false;
if (automatic && enabled) {
  const tag = `${channel}-v${v}`;
  const refs = JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/${process.env.GITHUB_REPOSITORY}/git/matching-refs/tags/${tag}`],
      { encoding: 'utf8' },
    ),
  );
  if (refs.some((ref) => ref.ref === `refs/tags/${tag}`)) enabled = false;
}
if (enabled) await readNotes(v, mode !== 'rehearsal');
let selected =
  !automatic && event.inputs?.targets === 'windows'
    ? ['windows-x86_64']
    : releaseTargets(process.env.CLOUD_RELEASE_TARGETS);
if (process.env.RELEASE_DISTRIBUTION === 'store') {
  if (event.inputs?.targets === 'windows')
    throw new Error('Windows releases use Microsoft Store; run Store release');
  selected = selected.filter((target) => target !== 'windows-x86_64');
  if (!selected.length) throw new Error('Configure Mac/Linux Cloud targets for Store distribution');
}
const runners = {
  'windows-x86_64': 'windows-2022',
  'darwin-aarch64': 'macos-15',
  'darwin-x86_64': 'macos-15-intel',
  'linux-x86_64': 'ubuntu-22.04',
};
if (enabled && mode !== 'rehearsal') {
  if (selected.includes('windows-x86_64') && process.env.CLOUD_SIGNING_READY !== 'true')
    throw new Error(
      'Complete Azure setup and set CLOUD_SIGNING_READY before requesting Windows candidates',
    );
  if (
    selected.some((target) => target.startsWith('darwin-')) &&
    process.env.APPLE_SIGNING_READY !== 'true'
  )
    throw new Error(
      'Complete Apple setup and set APPLE_SIGNING_READY before requesting Mac candidates',
    );
  if (['draft', 'publish'].includes(mode) && process.env.CLOUD_DRAFT_UPLOAD_ENABLED !== 'true')
    throw new Error('Enable validated Cloud draft uploads before requesting this mode');
  if (mode === 'publish' && process.env.CLOUD_PUBLISH_ENABLED !== 'true')
    throw new Error('Cloud publication is disabled');
}
await appendFile(
  process.env.GITHUB_OUTPUT,
  Object.entries({
    enabled,
    channel,
    mode,
    version: v,
    targets: JSON.stringify(selected),
    matrix: JSON.stringify({
      include: selected.map((target) => ({ target, os: runners[target] })),
    }),
  })
    .map(([key, value]) => `${key}=${value}\n`)
    .join(''),
);
console.log(`${enabled ? 'Prepare' : 'Skip'} ${channel} ${v} (${mode})`);
