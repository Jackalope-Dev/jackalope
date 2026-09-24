import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertVersions, readNotes, root } from './catalog.mjs';

export function storePlan(env, inputs, notes) {
  if (!['beta', 'stable'].includes(env.GITHUB_REF_NAME))
    throw new Error('Store releases require the beta or stable branch');
  const automatic = env.GITHUB_EVENT_NAME === 'push';
  const mode = automatic ? 'submission' : inputs.mode;
  if (!['rehearsal', 'candidate', 'submission'].includes(mode))
    throw new Error('Unknown Store release mode');
  const channel = env.GITHUB_REF_NAME === 'stable' ? 'stable' : 'beta';
  const enabled =
    !automatic || (env.STORE_AUTOMATION_ENABLED === 'true' && !/^Status: draft\r?$/m.test(notes));
  if (enabled && mode === 'submission') {
    if (env.STORE_SUBMISSION_ENABLED !== 'true')
      throw new Error('Complete Partner Center setup and enable STORE_SUBMISSION_ENABLED');
    if (
      env.STORE_ACCEPTED !== 'true' &&
      !(channel === 'beta' && !automatic && env.STORE_BETA_TEST_ENABLED === 'true')
    )
      throw new Error('Complete installed Store acceptance, or enable the manual beta trial');
  }
  return { enabled, channel, mode };
}

async function main() {
  const env = process.env;
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  await assertVersions(version);
  const notes = await readFile(resolve(root, `releases/${version}.md`), 'utf8');
  const plan = storePlan(env, event.inputs ?? {}, notes);
  if (plan.enabled && env.GITHUB_EVENT_NAME === 'push') {
    const tag = `store-${plan.channel}/v${version}`;
    const refs = JSON.parse(
      execFileSync('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/git/matching-refs/tags/${tag}`], {
        encoding: 'utf8',
      }),
    );
    if (refs.some((ref) => ref.ref === `refs/tags/${tag}`)) plan.enabled = false;
  }
  if (plan.enabled) await readNotes(version, plan.mode !== 'rehearsal');
  await appendFile(
    env.GITHUB_OUTPUT,
    Object.entries({ ...plan, version })
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
  console.log(
    `${plan.enabled ? 'Prepare' : 'Skip'} Store ${plan.channel} ${version} (${plan.mode})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
