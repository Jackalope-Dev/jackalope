const environments = [
  { origin: 'https://staging-api.jackalope.dev' },
  { origin: 'https://api.jackalope.dev' },
];

export async function verifyReadiness(origin, request = fetch) {
  const response = await request(`${origin}/readyz`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    throw new Error(
      `${origin}: readiness returned HTTP ${response.status} (${response.headers.get('content-type') ?? 'no content type'}); check edge rules if the service is healthy locally`,
    );
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${origin}: readiness returned invalid JSON`);
  }
  if (body?.status !== 'ready' || ![1, 2].includes(body.schemaVersion))
    throw new Error(`${origin}: service readiness failed`);
  console.log(
    `Verified ${origin}: schema ${body.schemaVersion}, ingestion enabled: ${body.ingestionEnabled}`,
  );
}

if (import.meta.main) {
  const checks = await Promise.allSettled(
    environments.map(({ origin }) => verifyReadiness(origin)),
  );
  const failures = checks.filter((result) => result.status === 'rejected');
  for (const failure of failures) console.error(failure.reason.message);
  if (failures.length) process.exitCode = 1;
}
