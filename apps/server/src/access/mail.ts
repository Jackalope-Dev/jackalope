import { randomToken, seal, tokenHash, unseal } from './crypto';
import { queueGrowthMail } from './growth-mail';
import { type AccessMail, accessEmail, type Mail } from './mail-templates';
import { providerJson } from './provider';

export { type AccessMail, accessEmail, type WaitlistMail } from './mail-templates';

export async function mailStatements(
  env: Env,
  mail: Omit<AccessMail, 'token'>,
  {
    inviteId = null,
    shareCode = null,
    guard = '1',
    guardValues = [],
    now = Date.now(),
  }: {
    inviteId?: string | null;
    shareCode?: string | null;
    guard?: string;
    guardValues?: (string | number)[];
    now?: number;
  } = {},
) {
  const token = randomToken();
  const hash = await tokenHash(token);
  const payload = await seal({ ...mail, token }, env.ACCESS_SECRET);
  const expires = now + (mail.kind === 'login' ? 1800000 : 7 * 86400000);
  guard = `(${guard}) AND NOT EXISTS(SELECT 1 FROM access_mail WHERE email=? AND kind IN ('welcome','invite','login') AND created_at>?) AND (SELECT count(*) FROM access_mail WHERE email=? AND kind IN ('welcome','invite','login') AND created_at>?)<10`;
  guardValues = [...guardValues, mail.to, now - 60000, mail.to, now - 86400000];
  return [
    env.DB.prepare(
      `INSERT INTO access_tokens(hash,email,invite_id,share_code,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE ${guard}`,
    ).bind(hash, mail.to, inviteId, shareCode, now, expires, ...guardValues),
    env.DB.prepare(
      `INSERT INTO access_mail(id,email,kind,payload,created_at) SELECT ?,?,?,?,? WHERE ${guard}`,
    ).bind(crypto.randomUUID(), mail.to, mail.kind, payload, now, ...guardValues),
  ];
}

export async function deliverAccessMail(env: Env, request = fetch, now = Date.now()) {
  if (env.EARLY_ACCESS_ENABLED !== 'true' || !env.SEQUENZY_API_KEY || !env.ACCESS_EMAIL_FROM)
    return;
  await queueGrowthMail(env, now);
  const rows = await env.DB.prepare(
    "SELECT id FROM access_mail WHERE state!='queued' AND attempts<5 AND next_at<=? AND created_at>? ORDER BY created_at LIMIT 5",
  )
    .bind(now, now - 7 * 86400000)
    .all<{ id: string }>();
  await Promise.all(
    rows.results.map(async ({ id }) => {
      const lease = randomToken();
      const row = await env.DB.prepare(
        "UPDATE access_mail SET state='sending',attempts=attempts+1,next_at=?,lease=? WHERE id=? AND state!='queued' AND attempts<5 AND next_at<=? RETURNING payload,attempts",
      )
        .bind(now + 300000, lease, id, now)
        .first<{ payload: string; attempts: number }>();
      if (!row) return;
      let stage = 'decrypt';
      let providerStatus: number | null = null;
      try {
        const mail = await unseal<Mail>(row.payload, env.ACCESS_SECRET);
        stage = 'render';
        const content = accessEmail(mail, env.ACCESS_WEB_ORIGIN);
        stage = 'request';
        const response = await request('https://api.sequenzy.com/api/v1/transactional/send', {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${env.SEQUENZY_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            to: mail.to,
            from: env.ACCESS_EMAIL_FROM,
            replyTo: env.ACCESS_EMAIL_REPLY_TO,
            subject: content.subject,
            body: content.body,
            preview: content.preview,
            trackingSettings: { openTracking: false, clickTracking: false },
          }),
        });
        providerStatus = response.status;
        stage = 'response';
        const result = await providerJson(response);
        if (!result.success || typeof result.jobId !== 'string')
          throw new Error('mail_provider_rejected');
        stage = 'record';
        await env.DB.prepare(
          "UPDATE access_mail SET state='queued',provider_id=?,provider_send_id=?,payload='',lease=NULL WHERE id=? AND lease=?",
        )
          .bind(
            result.jobId.slice(0, 200),
            typeof result.emailSendId === 'string' &&
              /^[a-zA-Z0-9_-]{1,200}$/.test(result.emailSendId)
              ? result.emailSendId
              : null,
            id,
            lease,
          )
          .run();
      } catch {
        console.error('access_mail_delivery_failed', {
          stage,
          providerStatus,
          attempt: row.attempts,
        });
        await env.DB.prepare(
          "UPDATE access_mail SET state='failed',next_at=?,lease=NULL WHERE id=? AND lease=?",
        )
          .bind(now + Math.min(3600000, 60000 * 2 ** row.attempts), id, lease)
          .run();
      }
    }),
  );
}
