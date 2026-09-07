import { randomUUID } from 'node:crypto';

const environments = [
  { name: 'staging', origin: 'https://staging-api.jackalope.dev' },
  { name: 'production', origin: 'https://api.jackalope.dev' },
];

export async function probeBucket({ account, token, bucket, request = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(account ?? '') || !token?.trim())
    throw new Error('Configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  if (!/^jackalope-releases-(staging|production)$/.test(bucket))
    throw new Error('Unexpected release bucket');
  const key = `launch-checks/${randomUUID()}.txt`;
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${key}`;
  const payload = `Jackalope launch check ${randomUUID()}\n`;
  async function send(method, body) {
    try {
      return await request(url, {
        method,
        body,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(`${bucket}: ${method} request failed`);
    }
  }
  let failure;
  try {
    const uploaded = await send('PUT', payload);
    if (!uploaded.ok) throw new Error(`${bucket}: PUT returned HTTP ${uploaded.status}`);
    const downloaded = await send('GET');
    if (!downloaded.ok) throw new Error(`${bucket}: GET returned HTTP ${downloaded.status}`);
    if ((await downloaded.text()) !== payload)
      throw new Error(`${bucket}: downloaded probe content does not match`);
  } catch (error) {
    failure = error;
  }
  try {
    const deleted = await send('DELETE');
    if (!deleted.ok && deleted.status !== 404)
      throw new Error(`DELETE returned HTTP ${deleted.status}`);
    const remaining = await send('GET');
    if (remaining.status !== 404) throw new Error('Probe deletion could not be verified');
  } catch {
    throw new Error(
      `${failure ? `${failure.message}; ` : ''}check cleanup of ${bucket}/${key} before retrying`,
    );
  }
  if (failure) throw failure;
  console.log(`Verified ${bucket}: write, read and cleanup`);
}

export async function verifyReadiness(origin, request = fetch) {
  const response = await request(`${origin}/readyz`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (!response.ok || body.status !== 'ready' || body.schemaVersion !== 1)
    throw new Error(`${origin}: service readiness failed`);
  console.log(`Verified ${origin}: schema 1, ingestion enabled: ${body.ingestionEnabled}`);
}

if (import.meta.main) {
  const checks = await Promise.allSettled(
    environments.flatMap(({ name, origin }) => [
      verifyReadiness(origin),
      probeBucket({
        account: process.env.CLOUDFLARE_ACCOUNT_ID,
        token: process.env.CLOUDFLARE_API_TOKEN,
        bucket: `jackalope-releases-${name}`,
      }),
    ]),
  );
  const failures = checks.filter((result) => result.status === 'rejected');
  for (const failure of failures) console.error(failure.reason.message);
  if (failures.length) process.exitCode = 1;
}
