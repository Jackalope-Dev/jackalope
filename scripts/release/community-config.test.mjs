import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommunityConfig } from '../../apps/server/scripts/community-config.mjs';

const defaults = () => ({
  vars: {
    INGESTION_ENABLED: 'false',
    FEEDBACK_EMAIL_ENABLED: 'false',
    EARLY_ACCESS_ENABLED: 'false',
  },
});
const access = {
  EARLY_ACCESS_ENABLED: 'true',
  ACCESS_WEB_ORIGIN: 'https://jackalope.dev',
  ACCESS_EMAIL_FROM: 'Jackalope <hello@hello.jackalope.dev>',
  ADMIN_EMAIL: 'owner@example.com',
  ACCESS_ISSUER: 'https://fixture.cloudflareaccess.com',
  ACCESS_AUD: 'fixture',
  ACCESS_INSTALLER_KEY: '',
};
test('deployment preserves bundled access settings with explicit environment overrides', () => {
  const settings = defaults();
  applyCommunityConfig(settings, 'production', {
    PRODUCTION_COMMUNITY_CONFIG: JSON.stringify(access),
    PRODUCTION_ACCESS_EMAIL_REPLY_TO: 'reply@example.com',
  });
  assert.equal(settings.vars.EARLY_ACCESS_ENABLED, 'true');
  assert.equal(settings.vars.ADMIN_EMAIL, 'owner@example.com');
  assert.equal(settings.vars.ACCESS_EMAIL_REPLY_TO, 'reply@example.com');
  applyCommunityConfig(settings, 'production', { PRODUCTION_ACCESS_MAC_CHANNELS: 'stable,beta' });
  assert.equal(settings.vars.ACCESS_MAC_CHANNELS, 'stable,beta');
  assert.deepEqual(settings.secrets.required, ['RATE_SECRET', 'ACCESS_SECRET', 'SEQUENZY_API_KEY']);
  applyCommunityConfig(settings, 'production', { PRODUCTION_EARLY_ACCESS_ENABLED: 'false' });
  assert.deepEqual(settings.secrets.required, ['RATE_SECRET']);
});
test('deployment rejects unknown settings, unprotected admin and public installer prefixes', () => {
  for (const changed of [
    { SECRET: 'do-not-accept' },
    { ACCESS_WEB_ORIGIN: 'http://jackalope.dev' },
    { ACCESS_AUD: '' },
    { ACCESS_INSTALLER_KEY: 'stable/Jackalope.exe' },
    { ACCESS_MAC_CHANNELS: 'stable,nightly' },
    { ACCESS_LINUX_CHANNELS: 'nightly' },
    { EARLY_ACCESS_ENABLED: true },
  ]) {
    assert.throws(() =>
      applyCommunityConfig(defaults(), 'staging', {
        STAGING_COMMUNITY_CONFIG: JSON.stringify({ ...access, ...changed }),
      }),
    );
  }
});

test('open signup follows the environment setting and stays a strict flag', () => {
  const settings = { vars: { ...defaults().vars, OPEN_SIGNUP: 'false' } };
  applyCommunityConfig(settings, 'production', { PRODUCTION_OPEN_SIGNUP: '' });
  assert.equal(settings.vars.OPEN_SIGNUP, 'false');
  applyCommunityConfig(settings, 'production', { PRODUCTION_OPEN_SIGNUP: 'true' });
  assert.equal(settings.vars.OPEN_SIGNUP, 'true');
  applyCommunityConfig(settings, 'staging', {
    STAGING_COMMUNITY_CONFIG: JSON.stringify({ OPEN_SIGNUP: 'false' }),
  });
  assert.equal(settings.vars.OPEN_SIGNUP, 'false');
  assert.throws(
    () => applyCommunityConfig(settings, 'production', { PRODUCTION_OPEN_SIGNUP: 'yes' }),
    /true or false/,
  );
});

test('empty CI variables preserve bundled configuration and disabled defaults', () => {
  const settings = defaults();
  applyCommunityConfig(settings, 'production', {
    PRODUCTION_COMMUNITY_CONFIG: JSON.stringify(access),
    PRODUCTION_ADMIN_EMAIL: '',
    PRODUCTION_INGESTION_ENABLED: '',
    PRODUCTION_FEEDBACK_EMAIL_ENABLED: '',
  });
  assert.equal(settings.vars.ADMIN_EMAIL, access.ADMIN_EMAIL);
  assert.equal(settings.vars.INGESTION_ENABLED, 'false');
  assert.equal(settings.vars.FEEDBACK_EMAIL_ENABLED, 'false');
  applyCommunityConfig(settings, 'production', {
    PRODUCTION_COMMUNITY_CONFIG: JSON.stringify({ ACCESS_INSTALLER_KEY: '' }),
  });
  assert.equal(settings.vars.ACCESS_INSTALLER_KEY, '');
});

test('audience list survives deployment with scoped overrides and can be explicitly cleared', () => {
  const settings = defaults();
  applyCommunityConfig(settings, 'production', {
    PRODUCTION_COMMUNITY_CONFIG: JSON.stringify({ ACCESS_AUDIENCE_LIST: 'production-list' }),
    PRODUCTION_ACCESS_AUDIENCE_LIST: '',
    STAGING_ACCESS_AUDIENCE_LIST: 'staging-list',
  });
  assert.equal(settings.vars.ACCESS_AUDIENCE_LIST, 'production-list');
  applyCommunityConfig(settings, 'production', {
    PRODUCTION_COMMUNITY_CONFIG: JSON.stringify({ ACCESS_AUDIENCE_LIST: 'production-list' }),
    PRODUCTION_ACCESS_AUDIENCE_LIST: 'replacement-list',
  });
  assert.equal(settings.vars.ACCESS_AUDIENCE_LIST, 'replacement-list');
  applyCommunityConfig(settings, 'production', {
    PRODUCTION_COMMUNITY_CONFIG: JSON.stringify({ ACCESS_AUDIENCE_LIST: '' }),
  });
  assert.equal(settings.vars.ACCESS_AUDIENCE_LIST, '');
});

test('product notes stay off by default and require their key and sender when on', () => {
  const off = defaults();
  applyCommunityConfig(off, 'production', {});
  assert.equal(off.vars.PRODUCT_NOTES_ENABLED, undefined);
  assert.ok(!off.secrets.required.includes('ANTHROPIC_API_KEY'));

  const on = defaults();
  applyCommunityConfig(on, 'production', {
    PRODUCTION_PRODUCT_NOTES_ENABLED: 'true',
    PRODUCTION_ADMIN_EMAIL: 'owner@example.com',
    PRODUCTION_ACCESS_ISSUER: 'https://fixture.cloudflareaccess.com',
    PRODUCTION_ACCESS_AUD: 'fixture',
    PRODUCTION_ACCESS_EMAIL_FROM: 'Jackalope <hello@hello.jackalope.dev>',
  });
  assert.equal(on.vars.PRODUCT_NOTES_ENABLED, 'true');
  assert.ok(on.secrets.required.includes('ANTHROPIC_API_KEY'));
  assert.ok(on.secrets.required.includes('SEQUENZY_API_KEY'));

  for (const changed of [
    { PRODUCTION_PRODUCT_NOTES_ENABLED: 'yes' },
    { PRODUCTION_PRODUCT_NOTES_ENABLED: 'true' },
    { PRODUCTION_PRODUCT_NOTES_AUTOSEND: 'true' },
    { PRODUCTION_PRODUCT_NOTES_ADMIN_URL: 'http://api.jackalope.dev/admin/access#notes' },
  ])
    assert.throws(() => applyCommunityConfig(defaults(), 'production', changed));
});
