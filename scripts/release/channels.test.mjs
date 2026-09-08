import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommunityConfig } from '../../apps/server/scripts/community-config.mjs';
import { channelConfig } from './channels.mjs';

test('private deployment settings stay scoped to their environment and require complete admin/mail configuration', () => {
  const settings = () => ({
    vars: {
      ADMIN_EMAIL: '',
      ACCESS_ISSUER: '',
      ACCESS_AUD: '',
      INGESTION_ENABLED: 'false',
      FEEDBACK_EMAIL_ENABLED: 'false',
      FEEDBACK_EMAIL_FROM: '',
      FEEDBACK_EMAIL_TO: 'inbox@example.com',
    },
  });
  const source = {
    STAGING_ADMIN_EMAIL: 'owner@example.com',
    STAGING_ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
    STAGING_ACCESS_AUD: 'staging-app',
    STAGING_INGESTION_ENABLED: 'true',
    PRODUCTION_INGESTION_ENABLED: 'false',
  };
  const staging = settings(),
    production = settings();
  applyCommunityConfig(staging, 'staging', source);
  applyCommunityConfig(production, 'production', source);
  assert.equal(staging.vars.ADMIN_EMAIL, 'owner@example.com');
  assert.equal(production.vars.ADMIN_EMAIL, '');
  assert.equal(staging.vars.INGESTION_ENABLED, 'true');
  assert.equal(production.vars.INGESTION_ENABLED, 'false');
  assert.deepEqual(staging.send_email, []);
  applyCommunityConfig(staging, 'staging', {
    STAGING_FEEDBACK_EMAIL_ENABLED: 'true',
    STAGING_FEEDBACK_EMAIL_FROM: 'feedback@example.com',
  });
  assert.deepEqual(staging.send_email, [
    { name: 'FEEDBACK_EMAIL', allowed_destination_addresses: ['inbox@example.com'] },
  ]);
  assert.throws(() =>
    applyCommunityConfig(settings(), 'staging', { STAGING_ADMIN_EMAIL: 'owner@example.com' }),
  );
  assert.throws(() =>
    applyCommunityConfig(settings(), 'staging', { STAGING_FEEDBACK_EMAIL_ENABLED: 'true' }),
  );
});

test('local builds have no community transport; trusted endpoints must match both channels', () => {
  assert.deepEqual(channelConfig('beta'), { channel: 'beta' });
  const endpoints = {
    stableEndpoint: 'https://api.example/updates/stable/latest.json',
    betaEndpoint: 'https://beta.example/updates/beta/latest.json',
  };
  assert.equal(channelConfig('beta', endpoints).channel, 'beta');
  for (const values of [
    { serviceUrl: 'http://api.example' },
    { serviceUrl: 'https://secret@api.example' },
    { serviceUrl: 'https://api.example?secret=x' },
    { accountServiceUrl: 'http://api.example' },
    { accountWebUrl: 'https://example.com/access/' },
    { accountServiceUrl: 'https://secret@api.example' },
    { stableEndpoint: endpoints.betaEndpoint },
    { stableEndpoint: endpoints.stableEndpoint },
  ])
    assert.throws(() => channelConfig('stable', values));
  assert.throws(() => channelConfig('internal'));
});
