import { z } from 'zod';
import { providerJson } from './provider';
import { AccessError } from './service';

export async function checkMailDelivery(env: Env, id: string, request = fetch, now = Date.now()) {
  const row = await env.DB.prepare(
    'SELECT provider_send_id,delivery_status,delivery_checked_at FROM access_mail WHERE id=?',
  )
    .bind(id)
    .first<{
      provider_send_id: string | null;
      delivery_status: string | null;
      delivery_checked_at: number | null;
    }>();
  if (!row) throw new AccessError(404, 'mail_not_found');
  if (!row.provider_send_id) throw new AccessError(409, 'delivery_unavailable');
  if (row.delivery_checked_at && row.delivery_checked_at > now - 30000)
    return { status: row.delivery_status, checkedAt: row.delivery_checked_at };
  if (!env.SEQUENZY_API_KEY) throw new AccessError(503, 'mail_not_configured');
  try {
    const response = await request(
      `https://api.sequenzy.com/api/v1/email-sends/${encodeURIComponent(row.provider_send_id)}`,
      {
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.SEQUENZY_API_KEY}` },
      },
    );
    const data = z
      .object({
        success: z.literal(true),
        emailSend: z.object({ id: z.literal(row.provider_send_id), status: z.string().max(100) }),
      })
      .parse(await providerJson(response));
    const known = [
      'pending',
      'queued',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'suppressed',
      'failed',
      'deferred',
    ];
    const status = known.includes(data.emailSend.status) ? data.emailSend.status : 'unknown';
    await env.DB.prepare(
      'UPDATE access_mail SET delivery_status=?,delivery_checked_at=? WHERE id=? AND provider_send_id=?',
    )
      .bind(status, now, id, row.provider_send_id)
      .run();
    return { status, checkedAt: now };
  } catch {
    throw new AccessError(502, 'delivery_check_failed');
  }
}
