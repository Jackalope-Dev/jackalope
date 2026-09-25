import { escapeHtml } from './access/mail-templates';
import { providerJson } from './access/provider';
import type { Feedback } from './contracts';

/**
 * Emails retained feedback through Sequenzy's transactional API. The domain's
 * inbound mail is hosted elsewhere, so Cloudflare Email Routing is not used.
 */
export async function deliverFeedback(env: Env, now = Date.now(), request = fetch) {
  if (
    env.FEEDBACK_EMAIL_ENABLED !== 'true' ||
    !env.FEEDBACK_EMAIL_FROM ||
    !env.FEEDBACK_EMAIL_TO ||
    !env.SEQUENZY_API_KEY
  )
    return;
  const rows = await env.DB.prepare(
    "SELECT id FROM feedback WHERE expires_at>? AND email_state!='sent' AND email_attempts<5 AND email_next<=? ORDER BY received_at LIMIT 20",
  )
    .bind(now, now)
    .all<{ id: string }>();
  for (const { id } of rows.results) {
    const claimed = await env.DB.prepare(
      "UPDATE feedback SET email_state='sending',email_attempts=email_attempts+1,email_next=? WHERE id=? AND email_state!='sent' AND email_attempts<5 AND email_next<=? RETURNING payload,email_attempts",
    )
      .bind(now + 300000, id, now)
      .first<{ payload: string; email_attempts: number }>();
    if (!claimed) continue;
    try {
      const report = JSON.parse(claimed.payload) as Feedback;
      const text = `Submitted feedback (untrusted user content)\nReference: ${id}\nVersion: ${report.appVersion} · ${report.channel ?? 'unknown'} · ${report.os}\n\n${report.message}\n\nOptional counts: ${JSON.stringify(report.diagnostics ?? {})}\n\nManage this report in the private dashboard. No reply address was collected.`;
      const response = await request('https://api.sequenzy.com/api/v1/transactional/send', {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${env.SEQUENZY_API_KEY}`,
          'content-type': 'application/json',
          'Idempotency-Key': `product-feedback:${id}`,
        },
        body: JSON.stringify({
          to: env.FEEDBACK_EMAIL_TO,
          from: env.FEEDBACK_EMAIL_FROM,
          subject: `Jackalope ${report.kind ?? 'feedback'} · ${id}`,
          body: `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace">${escapeHtml(text)}</pre>`,
          trackingSettings: { openTracking: false, clickTracking: false },
        }),
      });
      if (!(await providerJson(response)).success) throw new Error('mail_provider_rejected');
      await env.DB.prepare("UPDATE feedback SET email_state='sent' WHERE id=?").bind(id).run();
    } catch {
      await env.DB.prepare("UPDATE feedback SET email_state='failed',email_next=? WHERE id=?")
        .bind(now + Math.min(86400000, 60000 * 2 ** claimed.email_attempts), id)
        .run();
    }
  }
}
