export function applyCommunityConfig(settings, environment, source = process.env) {
  const prefix = environment === 'production' ? 'PRODUCTION_' : 'STAGING_';
  const names = [
    'EARLY_ACCESS_ENABLED',
    'ACCESS_WEB_ORIGIN',
    'ACCESS_EMAIL_FROM',
    'ACCESS_EMAIL_REPLY_TO',
    'ACCESS_INSTALLER_KEY',
    'ACCESS_STORE_URL',
    'ACCESS_NEWSLETTER_FORM',
    'ADMIN_EMAIL',
    'ACCESS_ISSUER',
    'ACCESS_AUD',
    'INGESTION_ENABLED',
    'FEEDBACK_EMAIL_ENABLED',
    'FEEDBACK_EMAIL_FROM',
    'FEEDBACK_EMAIL_TO',
  ];
  const encoded = source[`${prefix}COMMUNITY_CONFIG`];
  const bundled = encoded ? JSON.parse(encoded) : {};
  if (
    !bundled ||
    typeof bundled !== 'object' ||
    Array.isArray(bundled) ||
    Object.entries(bundled).some(
      ([key, value]) => !names.includes(key) || typeof value !== 'string' || value.length > 2048,
    )
  )
    throw new Error('Community configuration must contain only known string settings');
  for (const name of names) {
    const value = source[prefix + name] || bundled[name];
    if (value !== undefined) settings.vars[name] = value;
  }
  const vars = settings.vars;
  if (vars.ACCESS_STORE_URL) {
    const url = new URL(vars.ACCESS_STORE_URL);
    const path =
      url.hostname === 'apps.microsoft.com'
        ? /^\/detail\/[a-z0-9]{12}\/?$/i
        : /^\/store\/apps\/[a-z0-9]{12}\/?$/i;
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !['apps.microsoft.com', 'www.microsoft.com'].includes(url.hostname) ||
      !path.test(url.pathname)
    )
      throw new Error('Store link must be an official Microsoft product URL');
  }
  vars.EARLY_ACCESS_ENABLED ??= 'false';
  if (!['true', 'false'].includes(vars.EARLY_ACCESS_ENABLED))
    throw new Error('Early access flag must be true or false');
  if (vars.EARLY_ACCESS_ENABLED === 'true') {
    if (
      !vars.ACCESS_WEB_ORIGIN ||
      new URL(vars.ACCESS_WEB_ORIGIN).origin !== vars.ACCESS_WEB_ORIGIN ||
      !vars.ACCESS_WEB_ORIGIN.startsWith('https://') ||
      !vars.ACCESS_EMAIL_FROM ||
      !vars.ADMIN_EMAIL
    )
      throw new Error(
        'Early access requires an HTTPS website, verified sender and private administrator',
      );
    if (
      vars.ACCESS_INSTALLER_KEY &&
      !/^early-access\/v\d+\.\d+\.\d+\/[a-zA-Z0-9_.-]+\.exe$/.test(vars.ACCESS_INSTALLER_KEY)
    )
      throw new Error('Private installer key must use the early-access prefix');
    if (vars.ACCESS_NEWSLETTER_FORM && !/^[a-z0-9]{20,32}$/.test(vars.ACCESS_NEWSLETTER_FORM))
      throw new Error('Newsletter form ID is invalid');
  }
  settings.secrets = {
    required:
      vars.EARLY_ACCESS_ENABLED === 'true'
        ? ['RATE_SECRET', 'ACCESS_SECRET', 'SEQUENZY_API_KEY']
        : ['RATE_SECRET'],
  };
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
