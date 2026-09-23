export function expectedIngestion(environment, source = process.env) {
  if (!['staging', 'production'].includes(environment))
    throw new Error('Invalid Cloudflare environment');
  const prefix = environment.toUpperCase();
  const bundled = JSON.parse(source[`${prefix}_COMMUNITY_CONFIG`] || '{}');
  const value = source[`${prefix}_INGESTION_ENABLED`] || bundled?.INGESTION_ENABLED;
  if (!['true', 'false'].includes(value))
    throw new Error(
      `Set ${prefix}_INGESTION_ENABLED explicitly to true or false in the active deployment controller`,
    );
  return value === 'true';
}

export function assertServiceReadiness(ok, body, ingestionEnabled) {
  if (!ok || body?.status !== 'ready' || body.schemaVersion !== 2)
    throw new Error('Deployed service failed readiness');
  if (body.ingestionEnabled !== ingestionEnabled)
    throw new Error(`Deployed ingestion setting does not match expected ${ingestionEnabled}`);
}
