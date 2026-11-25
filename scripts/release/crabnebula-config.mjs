import { isReleaseChannel } from '../../packages/contracts/src/platform.ts';
import {
  CLOUD_APPLICATION,
  cloudUpdateEndpoint,
  isCloudTarget,
  PUBLIC_SERVICE_ORIGIN,
} from '../../packages/contracts/src/release.ts';
import { releaseChannelConfig } from './channels.mjs';

export const application = CLOUD_APPLICATION;

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

/**
 * How a candidate's Windows installer is Authenticode-signed. Azure Artifact
 * Signing wins whenever CLOUD_SIGNING_READY is set; otherwise the installer
 * ships without Authenticode only with the explicit WINDOWS_AUTHENTICODE=unsigned
 * opt-in. Null means Windows candidates cannot be built. Either way the Tauri
 * updater signature is still required.
 */
export function windowsSigning({ CLOUD_SIGNING_READY, WINDOWS_AUTHENTICODE } = {}) {
  if (CLOUD_SIGNING_READY === 'true') return 'azure';
  return WINDOWS_AUTHENTICODE === 'unsigned' ? 'unsigned' : null;
}

export function cloudEndpoint(channel) {
  if (!isReleaseChannel(channel)) throw new Error('Unknown release channel');
  return cloudUpdateEndpoint(channel);
}

export function cloudConfig({
  mode,
  channel,
  publicKey,
  signScript,
  target = 'windows-x86_64',
  authenticode = 'azure',
}) {
  if (!isCloudTarget(target)) throw new Error('Unsupported Cloud target');
  if (!['rehearsal', 'candidate'].includes(mode)) throw new Error('Unknown build mode');
  if (!['azure', 'unsigned'].includes(authenticode))
    throw new Error('Unknown Windows signing mode');
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
        endpoints: preview ? [] : [cloudEndpoint(channel)],
        windows: { installMode: 'passive' },
      },
      // Feedback and opt-in usage reports go to the account service; without
      // it the app shows feedback as unavailable.
      jackalope: releaseChannelConfig(channel, {
        serviceUrl: PUBLIC_SERVICE_ORIGIN,
        ...(!preview
          ? { stableEndpoint: cloudEndpoint('stable'), betaEndpoint: cloudEndpoint('beta') }
          : {}),
      }),
    },
  };
  if (!preview && target === 'windows-x86_64' && authenticode === 'azure') {
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
