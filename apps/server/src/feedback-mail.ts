import type { Feedback } from './contracts';

export async function deliverFeedback(env: Env, now = Date.now()) {
  if (env.FEEDBACK_EMAIL_ENABLED !== 'true' || !env.FEEDBACK_EMAIL_FROM || !env.FEEDBACK_EMAIL_TO)
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
      await env.FEEDBACK_EMAIL.send({
        to: env.FEEDBACK_EMAIL_TO,
        from: env.FEEDBACK_EMAIL_FROM,
        subject: `Jackalope ${report.kind ?? 'feedback'} · ${id}`,
        text: `Submitted feedback (untrusted user content)\nReference: ${id}\nVersion: ${report.appVersion} · ${report.channel ?? 'unknown'} · ${report.os}\n\n${report.message}\n\nOptional counts: ${JSON.stringify(report.diagnostics ?? {})}\n\nManage this report in the private dashboard. No reply address was collected.`,
      });
      await env.DB.prepare("UPDATE feedback SET email_state='sent' WHERE id=?").bind(id).run();
    } catch {
      await env.DB.prepare("UPDATE feedback SET email_state='failed',email_next=? WHERE id=?")
        .bind(now + Math.min(86400000, 60000 * 2 ** claimed.email_attempts), id)
        .run();
    }
  }
}
