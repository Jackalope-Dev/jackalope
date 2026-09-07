export function applyCommunityConfig(settings, environment, source = process.env) {
  const prefix = environment === 'production' ? 'PRODUCTION_' : 'STAGING_';
  for (const name of [
    'ADMIN_EMAIL',
    'ACCESS_ISSUER',
    'ACCESS_AUD',
    'INGESTION_ENABLED',
    'FEEDBACK_EMAIL_ENABLED',
    'FEEDBACK_EMAIL_FROM',
    'FEEDBACK_EMAIL_TO',
  ]) {
    const value = source[prefix + name];
    if (value !== undefined && value !== '') settings.vars[name] = value;
  }
  const vars = settings.vars;
  if (
    !['true', 'false'].includes(vars.INGESTION_ENABLED) ||
    !['true', 'false'].includes(vars.FEEDBACK_EMAIL_ENABLED)
  )
    throw new Error('Service flags must be true or false');
  if (
    vars.ADMIN_EMAIL &&
    (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_ISSUER) || !vars.ACCESS_AUD)
  )
    throw new Error('Admin access requires its issuer and application audience');
  if (
    vars.FEEDBACK_EMAIL_ENABLED === 'true' &&
    (!vars.FEEDBACK_EMAIL_FROM || !vars.FEEDBACK_EMAIL_TO)
  )
    throw new Error('Feedback email requires verified sender and recipient');
  settings.send_email =
    vars.FEEDBACK_EMAIL_ENABLED === 'true'
      ? [{ name: 'FEEDBACK_EMAIL', allowed_destination_addresses: [vars.FEEDBACK_EMAIL_TO] }]
      : [];
}
