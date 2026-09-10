import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const api = 'https://manage.devcenter.microsoft.com/v1.0/my';

export function submissionPath(appId, channel, flightId) {
  if (!/^[A-Z0-9]{12}$/i.test(appId ?? '')) throw new Error('Invalid Store app ID');
  if (!['beta', 'stable'].includes(channel)) throw new Error('Invalid Store channel');
  if (channel === 'beta' && !/^[a-z0-9-]+$/i.test(flightId ?? ''))
    throw new Error('Beta releases require a Store flight ID');
  return `/applications/${appId}${channel === 'beta' ? `/flights/${flightId}` : ''}`;
}

export function updateSubmission(draft, channel, fileName, version) {
  const key = channel === 'beta' ? 'flightPackages' : 'applicationPackages';
  if (!Array.isArray(draft[key])) throw new Error('Missing Store package metadata');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid package version');
  const candidate = version.split('.').reduce((n, part) => n * 65536n + BigInt(part), 0n) * 65536n;
  for (const pkg of draft[key]) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(pkg.version))
      throw new Error('Invalid existing package version');
    const previous = pkg.version.split('.').reduce((n, part) => n * 65536n + BigInt(part), 0n);
    if (candidate <= previous)
      throw new Error('Increase the version beyond existing Store packages');
    if (pkg.architecture && pkg.architecture.toLowerCase() !== 'x64')
      throw new Error('This release pipeline only replaces x64 packages');
  }
  return {
    ...draft,
    targetPublishMode: 'Immediate',
    targetPublishDate: '',
    [key]: [
      ...draft[key].map((pkg) => ({ ...pkg, fileStatus: 'PendingDelete' })),
      { fileName, fileStatus: 'PendingUpload' },
    ],
    packageDeliveryOptions: {
      ...draft.packageDeliveryOptions,
      packageRollout: { ...draft.packageDeliveryOptions?.packageRollout, isPackageRollout: false },
    },
  };
}

async function response(fetcher, url, options) {
  let result;
  try {
    result = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15 * 60000),
      ...options,
    });
  } catch {
    throw new Error(
      'Store request failed or timed out. Inspect the saved submission before retrying.',
    );
  }
  if (!result.ok)
    throw new Error(
      `Store request failed (HTTP ${result.status}). Inspect Partner Center before retrying.`,
    );
  return result;
}

export async function submit(
  { appId, channel, flightId, token, receipt, fileName, upload, checkpoint },
  fetcher = fetch,
) {
  const target = submissionPath(appId, channel, flightId);
  const request = async (path, method = 'GET', body) => {
    const result = await response(fetcher, `${api}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return result.status === 204 ? {} : result.json();
  };
  const app = await request(`/applications/${appId}`);
  if (app.packageIdentityName !== receipt.identity || app.publisherName !== receipt.publisher)
    throw new Error('Package identity does not match the selected Store product');
  if (!app.lastPublishedApplicationSubmission?.id)
    throw new Error('Complete the first Store submission in Partner Center before automation');
  const state = channel === 'beta' ? await request(target) : app;
  if (state.pendingApplicationSubmission?.id || state.pendingFlightSubmission?.id)
    throw new Error('A pending submission already exists; it was left untouched');
  const published = await request(
    `/applications/${appId}/submissions/${app.lastPublishedApplicationSubmission.id}`,
  );
  updateSubmission(published, 'stable', fileName, receipt.version);
  if (channel === 'beta' && state.lastPublishedFlightSubmission?.id) {
    const previous = await request(
      `${target}/submissions/${state.lastPublishedFlightSubmission.id}`,
    );
    updateSubmission(previous, 'beta', fileName, receipt.version);
  }
  const draft = await request(`${target}/submissions`, 'POST');
  if (!/^\d+$/.test(draft.id)) throw new Error('Invalid Store submission ID');
  const path = `${target}/submissions/${draft.id}`;
  await checkpoint({
    appId,
    channel,
    flightId: channel === 'beta' ? flightId : null,
    submissionId: draft.id,
    status: 'DraftCreated',
  });
  const url = new URL(draft.fileUploadUrl);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.blob.core.windows.net') ||
    url.username ||
    url.password
  )
    throw new Error('Unexpected Store upload destination');
  await request(path, 'PUT', updateSubmission(draft, channel, fileName, receipt.version));
  await upload(url, fetcher);
  await request(`${path}/commit`, 'POST');
  const result = {
    appId,
    channel,
    flightId: channel === 'beta' ? flightId : null,
    submissionId: draft.id,
    status: 'Submitted',
    published: false,
  };
  await checkpoint(result);
  return result;
}

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function main() {
  const folder = process.argv[2];
  if (!folder)
    throw new Error('Usage: node scripts/release/store-submit.mjs <package-output-directory>');
  const receipt = JSON.parse(
    (await readFile(join(folder, 'receipt.json'), 'utf8')).replace(/^\uFEFF/, ''),
  );
  if (
    receipt.mode !== 'submission' ||
    receipt.sourceDirty !== false ||
    !receipt.fixedWebView2 ||
    !receipt.storeManagedUpdates
  )
    throw new Error('Only a clean submission build with bundled WebView2 can be submitted');
  const fileName = `Jackalope_${receipt.version}_x64.msix`;
  const archive = join(folder, 'upload.zip');
  if (
    (await hash(join(folder, fileName))) !== receipt.packageSha256 ||
    (await hash(archive)) !== receipt.uploadSha256
  )
    throw new Error('Package or upload archive differs from the build receipt');
  const env = process.env;
  for (const name of ['STORE_APP_ID', 'STORE_TENANT_ID', 'STORE_CLIENT_ID', 'STORE_CLIENT_SECRET'])
    if (!env[name]) throw new Error(`Missing ${name}`);
  if (!/^[a-z0-9-]+$/i.test(env.STORE_TENANT_ID)) throw new Error('Invalid tenant ID');
  submissionPath(env.STORE_APP_ID, receipt.channel, env.STORE_BETA_FLIGHT_ID);
  const auth = await response(
    fetch,
    `https://login.microsoftonline.com/${env.STORE_TENANT_ID}/oauth2/token`,
    {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.STORE_CLIENT_ID,
        client_secret: env.STORE_CLIENT_SECRET,
        resource: 'https://manage.devcenter.microsoft.com',
      }),
    },
  );
  const { access_token: token } = await auth.json();
  if (!token) throw new Error('Store authentication did not return a token');
  const result = await submit({
    appId: env.STORE_APP_ID,
    channel: receipt.channel,
    flightId: env.STORE_BETA_FLIGHT_ID,
    token,
    receipt,
    fileName,
    checkpoint: (value) =>
      writeFile(join(dirname(archive), 'submission.json'), `${JSON.stringify(value, null, 2)}\n`),
    upload: async (url, fetcher) => {
      await response(fetcher, url, {
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'x-ms-version': '2023-11-03',
          'Content-Type': 'application/zip',
          'Content-Length': String((await stat(archive)).size),
        },
        body: createReadStream(archive),
        duplex: 'half',
      });
    },
  });
  console.log(JSON.stringify(result));
  console.log(
    'Submitted for Store processing. Certification and publication are not yet confirmed.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
