import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyCommunityConfig } from '../../apps/server/scripts/community-config.mjs';
import { origin, root } from './catalog.mjs';

const environment = process.env.DEPLOY_ENV;
if (!['staging', 'production'].includes(environment))
  throw new Error('Invalid Cloudflare environment');
const base = origin(process.env.UPDATE_BASE_URL);
if (process.argv[2] === 'verify') {
  const ready = await fetch(`${base}/readyz`, {
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  const body = await ready.json();
  if (!ready.ok || body.status !== 'ready' || body.schemaVersion !== 2)
    throw new Error('Deployed service failed readiness');
  console.log(`Verified ${environment} readiness; ingestion enabled: ${body.ingestionEnabled}`);
} else if (process.argv[2] === 'prepare') {
  if (!/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? ''))
    throw new Error('Configure the Cloudflare account ID');
  const database = process.env.SERVER_D1_ID;
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database ?? '') ||
    database.startsWith('00000000-')
  )
    throw new Error('Configure the provisioned environment D1 UUID');
  const config = JSON.parse(await readFile(resolve(root, 'apps/server/wrangler.jsonc'), 'utf8'));
  delete config.$schema;
  delete config.account_id;
  config.main = resolve(root, 'apps/server', config.main);
  for (const settings of [config, ...Object.values(config.env)]) {
    for (const binding of settings.d1_databases ?? [])
      binding.migrations_dir = resolve(root, 'apps/server', binding.migrations_dir);
  }
  config.env[environment].d1_databases.find((item) => item.binding === 'DB').database_id = database;
  applyCommunityConfig(config.env[environment], environment);
  config.env = { [environment]: config.env[environment] };
  const directory = resolve(root, 'apps/server/.wrangler/release');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'wrangler.json'), `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Prepared ${environment} deployment configuration`);
} else throw new Error('Usage: cloudflare.mjs prepare|verify');
