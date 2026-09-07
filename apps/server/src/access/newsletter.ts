import { providerJson } from './provider';

export async function syncNewsletter(env: Env, request = fetch, now = Date.now()) {
  if (env.EARLY_ACCESS_ENABLED !== 'true' || !/^[a-z0-9]{20,32}$/.test(env.ACCESS_NEWSLETTER_FORM))
    return;
  const rows = await env.DB.prepare(
    "SELECT id FROM access_members WHERE newsletter=1 AND newsletter_synced_at IS NULL AND newsletter_attempts<5 AND newsletter_next_at<=? AND status!='revoked' LIMIT 5",
  )
    .bind(now)
    .all<{ id: string }>();
  await Promise.all(
    rows.results.map(async ({ id }) => {
      const row = await env.DB.prepare(
        "UPDATE access_members SET newsletter_attempts=newsletter_attempts+1,newsletter_next_at=? WHERE id=? AND newsletter=1 AND newsletter_synced_at IS NULL AND newsletter_attempts<5 AND newsletter_next_at<=? AND status!='revoked' RETURNING email,newsletter_attempts",
      )
        .bind(now + 300000, id, now)
        .first<{ email: string; newsletter_attempts: number }>();
      if (!row) return;
      try {
        const response = await request(
          `https://api.sequenzy.com/api/v1/forms/${env.ACCESS_NEWSLETTER_FORM}`,
          {
            method: 'POST',
            redirect: 'manual',
            signal: AbortSignal.timeout(15000),
            headers: { accept: 'application/json' },
            body: new URLSearchParams({ email: row.email, website: '' }),
          },
        );
        const result = await providerJson(response);
        if (result.success !== true) throw new Error('newsletter_rejected');
        await env.DB.prepare(
          'UPDATE access_members SET newsletter_synced_at=? WHERE id=? AND newsletter_attempts=?',
        )
          .bind(now, id, row.newsletter_attempts)
          .run();
      } catch {
        await env.DB.prepare(
          'UPDATE access_members SET newsletter_next_at=? WHERE id=? AND newsletter_attempts=?',
        )
          .bind(
            now + Math.min(3600000, 60000 * 2 ** row.newsletter_attempts),
            id,
            row.newsletter_attempts,
          )
          .run();
      }
    }),
  );
}
