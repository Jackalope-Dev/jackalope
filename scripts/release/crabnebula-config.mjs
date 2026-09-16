export const application = 'jackalope-digital/jackalope';

export function clearAppleSigning(environment) {
  for (const name of [
    'APPLE_CERTIFICATE',
    'APPLE_CERTIFICATE_PASSWORD',
    'APPLE_SIGNING_IDENTITY',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY',
    'APPLE_API_ISSUER',
    'APPLE_API_KEY_PATH',
    'APPLE_API_PRIVATE_KEY',
    'APPLE_ID',
    'APPLE_PASSWORD',
  ])
    delete environment[name];
}

export function cloudEndpoint(channel) {
  if (!['beta', 'stable'].includes(channel)) throw new Error('Unknown release channel');
  return `https://cdn.crabnebula.app/update/${application}/{{target}}-{{arch}}/{{current_version}}?channel=${channel}`;
}

export function isCloudEndpoint(value, channel) {
  if (!['beta', 'stable'].includes(channel)) return false;
  return new URL(value).href === new URL(cloudEndpoint(channel)).href;
}

export function cloudConfig({ mode, channel, publicKey, signScript, target = 'windows-x86_64' }) {
  if (!['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64'].includes(target))
    throw new Error('Unsupported Cloud target');
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
  if (!preview && target === 'windows-x86_64') {
    if (!signScript || /["\r\n]/.test(signScript)) throw new Error('Invalid signing script path');
    config.bundle.windows = {
      signCommand: {
        cmd: 'pwsh',
        args: ['-NoProfile', '-NonInteractive', '-File', signScript, '%1'],
      },
    };
  }
  if (target.startsWith('darwin-')) {
    config.bundle.macOS = {
      hardenedRuntime: true,
      entitlements: 'entitlements.plist',
      ...(preview ? { signingIdentity: '-' } : {}),
    };
  }
  return config;
}
