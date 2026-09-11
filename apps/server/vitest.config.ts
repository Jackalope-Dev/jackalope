import { fileURLToPath, URL } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import changelog from '../website/src/changelog.json' with { type: 'json' };
import { buildAdmin } from './scripts/build-admin.mjs';

await buildAdmin();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      remoteBindings: false,
      miniflare: {
        serviceBindings: {
          ACCESS_WEBSITE: async (request) =>
            new URL(request.url).pathname === '/changelog.json'
              ? Response.json(changelog)
              : new Response(null, { status: 404 }),
        },
        bindings: {
          INGESTION_ENABLED: 'true',
          RATE_SECRET: 'local-test-secret-not-a-production-credential',
          TEST_MIGRATIONS: await readD1Migrations(
            fileURLToPath(new URL('./migrations', import.meta.url)),
          ),
        },
      },
    }),
  ],
});
