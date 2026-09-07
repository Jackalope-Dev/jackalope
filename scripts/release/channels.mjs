export function channelConfig(channel, values = {}) {
  if (!['stable', 'beta'].includes(channel)) throw new Error('Unknown release channel');
  const config = { channel };
  for (const [key, value] of Object.entries(values)) {
    if (!['stableEndpoint', 'betaEndpoint', 'serviceUrl'].includes(key) || !value) continue;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error(
        'Channel services must use trusted HTTPS URLs without credentials, queries or fragments',
      );
    if (key === 'serviceUrl' && url.pathname !== '/')
      throw new Error('Service URL must be an origin');
    if (
      key !== 'serviceUrl' &&
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
      }),
    ),
  );
}
