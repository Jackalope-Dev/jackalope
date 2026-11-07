import { httpsUrl } from '../../packages/contracts/src/platform.ts';
import { cloudUpdateEndpoint } from '../../packages/contracts/src/release.ts';
import { isMain } from '../lib/cli.mjs';

export const ACCOUNT_SERVICE_URL = 'https://api.jackalope.dev';
export const ACCOUNT_WEB_URL = 'https://jackalope.dev';
const endpointKeys = ['stableEndpoint', 'betaEndpoint'];
const originKeys = ['serviceUrl', 'accountServiceUrl', 'accountWebUrl'];

export function isCloudEndpoint(value, channel) {
  if (!['beta', 'stable'].includes(channel)) return false;
  return new URL(value).href === new URL(cloudUpdateEndpoint(channel)).href;
}

/**
 * The `plugins.jackalope` block of the desktop's Tauri config, which the native
 * app reads at startup. Unset values are left out: a local build has no
 * community transport.
 */
export function channelConfig(channel, values = {}) {
  if (!['stable', 'beta'].includes(channel)) throw new Error('Unknown release channel');
  const config = { channel };
  for (const [key, value] of Object.entries(values)) {
    if (![...endpointKeys, ...originKeys].includes(key) || !value) continue;
    const updateChannel = key === 'stableEndpoint' ? 'stable' : 'beta';
    const cloud = endpointKeys.includes(key) && isCloudEndpoint(value, updateChannel);
    const url = httpsUrl(value, { query: cloud });
    if (!url)
      throw new Error(
        'Channel services must use trusted HTTPS URLs without credentials, queries or fragments',
      );
    if (originKeys.includes(key) && url.pathname !== '/')
      throw new Error('Service URL must be an origin');
    if (
      endpointKeys.includes(key) &&
      !cloud &&
      !url.pathname.endsWith(`/updates/${updateChannel}/latest.json`)
    )
      throw new Error('Update endpoint does not match its channel');
    config[key] = value;
  }
  if (Boolean(config.stableEndpoint) !== Boolean(config.betaEndpoint))
    throw new Error('Configure both update channels or neither');
  return config;
}

/** The block a release build ships: the public account service unless overridden. */
export function releaseChannelConfig(
  channel,
  { accountServiceUrl = ACCOUNT_SERVICE_URL, accountWebUrl = ACCOUNT_WEB_URL, ...values } = {},
) {
  return channelConfig(channel, { ...values, accountServiceUrl, accountWebUrl });
}

/** `releaseChannelConfig` from the release environment variables. */
export function environmentChannelConfig(environment = process.env) {
  return releaseChannelConfig(environment.RELEASE_CHANNEL ?? 'stable', {
    stableEndpoint: environment.STABLE_UPDATE_ENDPOINT,
    betaEndpoint: environment.BETA_UPDATE_ENDPOINT,
    serviceUrl: environment.COMMUNITY_SERVICE_URL,
    accountServiceUrl: environment.JACKALOPE_ACCOUNT_API,
    accountWebUrl: environment.JACKALOPE_ACCOUNT_WEB,
  });
}

if (isMain(import.meta)) console.log(JSON.stringify(environmentChannelConfig()));
