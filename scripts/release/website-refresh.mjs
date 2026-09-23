import { setTimeout } from 'node:timers/promises';
import { readPublicRelease } from './website.mjs';

let hook;
try {
  hook = new URL(process.env.CLOUDFLARE_WEBSITE_DEPLOY_HOOK);
} catch {
  throw new Error('Configure the website Deploy Hook secret before stable publication');
}
if (
  hook.origin !== 'https://api.cloudflare.com' ||
  !/^\/client\/v4\/workers\/builds\/deploy_hooks\/[a-zA-Z0-9_-]+$/.test(hook.pathname) ||
  hook.username ||
  hook.password ||
  hook.search ||
  hook.hash
)
  throw new Error('Invalid website Deploy Hook configuration');
if (process.argv[2] !== 'check') {
  let response;
  try {
    response = await fetch(hook, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('Website build trigger failed; inspect Cloudflare Builds and retry this job');
  }
  if (!response.ok || !(await response.json()).success)
    throw new Error('Cloudflare rejected the website build trigger');
  console.log('Website build requested. Waiting for the published installer link.');
  const release = await readPublicRelease();
  if (!release.VITE_WINDOWS_DOWNLOAD_URL)
    throw new Error('Stable release is missing after publication');
  let verified = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const page = await fetch('https://jackalope.dev/', {
      signal: AbortSignal.timeout(10000),
      headers: { 'cache-control': 'no-cache' },
    }).catch(() => null);
    if (page?.ok && (await page.text()).includes(`href="${release.VITE_WINDOWS_DOWNLOAD_URL}"`)) {
      verified = true;
      break;
    }
    await setTimeout(15000);
  }
  if (!verified)
    throw new Error(
      'Website did not expose the published download within 15 minutes; inspect its native build and retry',
    );
  console.log(`Verified website download for ${release.VITE_RELEASE_VERSION}`);
}
