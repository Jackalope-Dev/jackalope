import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const databaseId = process.env.SERVER_STAGING_D1_ID;
if (
  !databaseId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId) ||
  databaseId.startsWith('00000000-')
) {
  throw new Error('SERVER_STAGING_D1_ID must contain the provisioned staging D1 UUID.');
}

const config = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));
const staging = config.env?.staging;
if (staging?.name !== 'jackalope-service-staging') {
  throw new Error('Expected the existing jackalope-service-staging environment.');
}
const database = staging.d1_databases?.find((binding) => binding.binding === 'DB');
if (!database) throw new Error('Missing staging DB binding.');
database.database_id = databaseId;
database.migrations_dir = fileURLToPath(new URL(database.migrations_dir, root));
config.main = fileURLToPath(new URL(config.main, root));
delete config.account_id;
delete config.$schema;
config.env = { staging };
for (const binding of config.d1_databases ?? []) {
  binding.migrations_dir = fileURLToPath(new URL(binding.migrations_dir, root));
}
const output = new URL('.wrangler/deploy/', root);
await mkdir(output, { recursive: true });
await writeFile(new URL('wrangler.json', output), `${JSON.stringify(config, null, 2)}\n`);
console.log('Prepared staging deployment configuration in .wrangler/deploy/wrangler.json.');
