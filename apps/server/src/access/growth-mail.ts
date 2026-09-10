import { seal } from './crypto';
import type { GrowthMail } from './mail-templates';

export async function queueGrowthMail(env: Env, now = Date.now()) {
  await env.DB.prepare(`INSERT OR IGNORE INTO access_growth_events(id,member_id,kind,created_at)
    SELECT 'expired:'||i.id,i.owner_id,'pass_expired',? FROM access_invites i JOIN access_members m ON m.id=i.owner_id
    WHERE i.status='pending' AND i.expires_at<=? AND i.expires_at>? AND m.status='approved' AND NOT EXISTS(SELECT 1 FROM access_growth_events e WHERE e.id='expired:'||i.id) ORDER BY i.expires_at LIMIT 100`)
    .bind(now, now, now - 7 * 86400000)
    .run();
  const events =
    await env.DB.prepare(`SELECT e.id,e.member_id,e.kind,e.total,m.email FROM access_growth_events e JOIN access_members m ON m.id=e.member_id
    WHERE e.queued_at IS NULL AND m.status!='revoked' ORDER BY e.created_at LIMIT 20`).all<{
      id: string;
      member_id: string;
      kind: GrowthMail['kind'];
      total: number;
      email: string;
    }>();
  for (const event of events.results) {
    const payload = await seal(
      { to: event.email, kind: event.kind, total: event.total } satisfies GrowthMail,
      env.ACCESS_SECRET,
    );
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO access_mail(id,email,kind,payload,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM access_growth_events e JOIN access_members m ON m.id=e.member_id WHERE e.id=? AND e.queued_at IS NULL AND m.status!='revoked')`,
      ).bind(id, event.email, event.kind, payload, now, event.id),
      env.DB.prepare(
        'UPDATE access_growth_events SET queued_at=? WHERE id=? AND EXISTS(SELECT 1 FROM access_mail WHERE id=?)',
      ).bind(now, event.id, id),
    ]);
  }
}
