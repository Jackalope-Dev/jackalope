export const application = 'jackalope-digital/jackalope';

export function cloudEndpoint(channel) {
  if (!['beta', 'stable'].includes(channel)) throw new Error('Unknown release channel');
  return `https://cdn.crabnebula.app/update/${application}/{{target}}-{{arch}}/{{current_version}}?channel=${channel}`;
}

export function isCloudEndpoint(value, channel) {
  if (!['beta', 'stable'].includes(channel)) return false;
  return new URL(value).href === new URL(cloudEndpoint(channel)).href;
}

export function cloudConfig({ mode, channel, publicKey, signScript }) {
  if (!['rehearsal', 'candidate'].includes(mode)) throw new Error('Unknown build mode');
  const endpoint = cloudEndpoint(channel);
  if (!publicKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey))
    throw new Error('A valid updater public key is required');
  const preview = mode === 'rehearsal';
  const config = {
    ...(preview
      ? {
          identifier: 'dev.jackalope.cloud.rehearsal',
          productName: 'Jackalope Rehearsal',
          mainBinaryName: 'jackalope-rehearsal',
        }
      : {}),
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: preview ? [] : [endpoint],
        windows: { installMode: 'passive' },
      },
      jackalope: {
        channel,
        accountServiceUrl: 'https://api.jackalope.dev',
        accountWebUrl: 'https://jackalope.dev',
        ...(!preview
          ? { stableEndpoint: cloudEndpoint('stable'), betaEndpoint: cloudEndpoint('beta') }
          : {}),
      },
    },
  };
  if (!preview) {
    if (!signScript || /["\r\n]/.test(signScript)) throw new Error('Invalid signing script path');
    config.bundle.windows = {
      signCommand: {
        cmd: 'pwsh',
        args: ['-NoProfile', '-NonInteractive', '-File', signScript, '%1'],
      },
    };
  }
  return config;
}
