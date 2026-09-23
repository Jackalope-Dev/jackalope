import assert from 'node:assert/strict';
import test from 'node:test';
import { assertServiceReadiness, expectedIngestion } from './service-readiness.mjs';

test('deployment requires an explicit ingestion decision in the selected controller environment', () => {
  for (const environment of ['staging', 'production']) {
    const key = `${environment.toUpperCase()}_INGESTION_ENABLED`;
    for (const value of [undefined, '', 'yes', true])
      assert.throws(() => expectedIngestion(environment, { [key]: value }), /explicitly/);
    assert.equal(expectedIngestion(environment, { [key]: 'true' }), true);
    assert.equal(expectedIngestion(environment, { [key]: 'false' }), false);
  }
  assert.throws(() => expectedIngestion('production', { STAGING_INGESTION_ENABLED: 'true' }));
});

test('bundled ingestion survives empty CI variables while explicit incident disable wins', () => {
  const source = {
    PRODUCTION_COMMUNITY_CONFIG: JSON.stringify({ INGESTION_ENABLED: 'true' }),
    PRODUCTION_INGESTION_ENABLED: '',
  };
  assert.equal(expectedIngestion('production', source), true);
  source.PRODUCTION_INGESTION_ENABLED = 'false';
  assert.equal(expectedIngestion('production', source), false);
});

test('a healthy but disabled service fails verification when ingestion is expected', () => {
  const ready = { status: 'ready', schemaVersion: 2, ingestionEnabled: false };
  assert.throws(() => assertServiceReadiness(true, ready, true), /ingestion setting/);
  assertServiceReadiness(true, ready, false);
  ready.ingestionEnabled = true;
  assertServiceReadiness(true, ready, true);
  assert.throws(() => assertServiceReadiness(true, ready, false), /ingestion setting/);
  for (const body of [null, {}, { ...ready, schemaVersion: 1 }])
    assert.throws(() => assertServiceReadiness(true, body, true), /readiness/);
  assert.throws(() => assertServiceReadiness(false, ready, true), /readiness/);
  for (const value of [undefined, 'true', 1])
    assert.throws(() => assertServiceReadiness(true, { ...ready, ingestionEnabled: value }, true));
});
