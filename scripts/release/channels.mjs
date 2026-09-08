import { isCloudEndpoint } from './crabnebula-config.mjs';

export function channelConfig(channel, values = {}) {
  if (!['stable', 'beta'].includes(channel)) throw new Error('Unknown release channel');
  const config = { channel };
  for (const [key, value] of Object.entries(values)) {
    if (
      ![
        'stableEndpoint',
        'betaEndpoint',
        'serviceUrl',
        'accountServiceUrl',
        'accountWebUrl',
      ].includes(key) ||
      !value
    )
      continue;
    const url = new URL(value);
    const updateChannel = key === 'stableEndpoint' ? 'stable' : 'beta';
    const cloud =
      ['stableEndpoint', 'betaEndpoint'].includes(key) && isCloudEndpoint(value, updateChannel);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.search && !cloud) ||
      url.hash
    )
      throw new Error(
        'Channel services must use trusted HTTPS URLs without credentials, queries or fragments',
      );
    if (['serviceUrl', 'accountServiceUrl', 'accountWebUrl'].includes(key) && url.pathname !== '/')
      throw new Error('Service URL must be an origin');
    if (
      ['stableEndpoint', 'betaEndpoint'].includes(key) &&
      !cloud &&
      !url.pathname.endsWith(`/updates/${key === 'stableEndpoint' ? 'stable' : 'beta'}/latest.json`)
    )
      throw new Error('Update endpoint does not match its channel');
    config[key] = value;
  }
  if (Boolean(config.stableEndpoint) !== Boolean(config.betaEndpoint))
    throw new Error('Configure both update channels or neither');
  return config;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/channels.mjs')) {
  console.log(
    JSON.stringify(
      channelConfig(process.env.RELEASE_CHANNEL ?? 'stable', {
        stableEndpoint: process.env.STABLE_UPDATE_ENDPOINT,
        betaEndpoint: process.env.BETA_UPDATE_ENDPOINT,
        serviceUrl: process.env.COMMUNITY_SERVICE_URL,
        accountServiceUrl: process.env.JACKALOPE_ACCOUNT_API ?? 'https://api.jackalope.dev',
        accountWebUrl: process.env.JACKALOPE_ACCOUNT_WEB ?? 'https://jackalope.dev',
      }),
    ),
  );
}
