import { PRESET_THEMES, themeTokens } from '@jackalope/brand/tokens';
import { randomToken, seal, tokenHash, unseal } from './crypto';
import { providerJson } from './provider';

export type AccessMail = { to: string; kind: 'welcome' | 'invite' | 'login'; token: string };
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

export function accessEmail(mail: AccessMail, origin: string) {
  const colors = themeTokens({ ...PRESET_THEMES[0], isDark: false });
  const title =
    mail.kind === 'welcome'
      ? 'There’s room for you.'
      : mail.kind === 'invite'
        ? 'Good things are better shared.'
        : 'Welcome back.';
  const subject =
    mail.kind === 'welcome'
      ? 'You’re in — welcome to Jackalope'
      : mail.kind === 'invite'
        ? 'You’re invited to Jackalope'
        : 'Your Jackalope sign-in link';
  const intro =
    mail.kind === 'welcome'
      ? 'Your early access is approved. Your space in Jackalope is ready — along with five invitations for people you’d love to bring along.'
      : mail.kind === 'invite'
        ? 'A Jackalope member has invited you in. Accept your invitation to get early access, then bring five people of your own.'
        : 'Use this private link to return to your downloads and invitations. No password to remember.';
  const action = mail.kind === 'invite' ? 'Accept your invitation' : 'Open your Jackalope space';
  const link = `${origin}/access/#token=${mail.token}`;
  const detail =
    mail.kind === 'login'
      ? 'This sign-in link expires in 30 minutes.'
      : 'This invitation link expires in 7 days. You can request a fresh sign-in link from the website.';
  const text = `${title}\n\n${intro}\n\n${action}: ${link}\n\nYour space shows the Windows download when a reviewed build is available, setup steps, and your remaining invitations.\n\n${detail} Keep this link private. If you did not expect this email, you can ignore it.\n\nJackalope Digital LLC · https://jackalope.digital`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:${colors['--color-surface-sunken']};color:${colors['--color-text-primary']};font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(intro)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px"><tr><td style="padding:0 0 32px"><img src="${origin}/icon-128.png" width="44" height="44" alt="Jackalope" style="border-radius:12px;vertical-align:middle"><span style="font-size:20px;font-weight:700;margin-left:12px">&nbsp; Jackalope</span></td></tr><tr><td style="background:${colors['--color-surface']};border-radius:24px;padding:36px;border-top:4px solid ${colors['--color-accent']}"><p style="font-size:12px;letter-spacing:2px;color:${colors['--color-accent-ink']}">A LITTLE ROOM FOR BIG IDEAS</p><h1 style="font-size:38px;line-height:1.12;letter-spacing:-1.5px;margin:20px 0">${title}</h1><p style="font-size:17px;line-height:1.75;color:${colors['--color-text-secondary']}">${intro}</p><p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:${colors['--color-accent']};color:${colors['--color-on-accent']};padding:16px 24px;border-radius:12px;text-decoration:none;font-weight:700">${action} &rarr;</a></p><p style="font-size:14px;line-height:1.7;color:${colors['--color-text-secondary']}">Your space has your invitations, setup steps, and the Windows download as soon as a reviewed build is available.</p><p style="font-size:12px;line-height:1.7;color:${colors['--color-text-secondary']}">${detail} Keep this link private.</p></td></tr><tr><td style="padding:24px 4px;font-size:12px;line-height:1.8;color:${colors['--color-text-secondary']}">If you did not expect this email, you can ignore it.<br>Jackalope Digital LLC &middot; <a href="https://jackalope.digital" style="color:inherit">jackalope.digital</a><br><a href="${origin}/privacy/" style="color:inherit">Privacy</a></td></tr></table></td></tr></table></body></html>`;
  return { subject, body, text, preview: intro };
}

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
  guard = `(${guard}) AND NOT EXISTS(SELECT 1 FROM access_mail WHERE email=? AND created_at>?) AND (SELECT count(*) FROM access_mail WHERE email=? AND created_at>?)<10`;
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
      try {
        const mail = await unseal<AccessMail>(row.payload, env.ACCESS_SECRET);
        const content = accessEmail(mail, env.ACCESS_WEB_ORIGIN);
        const response = await request('https://api.sequenzy.com/api/v1/transactional/send', {
          method: 'POST',
          redirect: 'error',
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
          }),
        });
        const result = await providerJson(response);
        if (!result.success || typeof result.jobId !== 'string')
          throw new Error('mail_provider_rejected');
        await env.DB.prepare(
          "UPDATE access_mail SET state='queued',provider_id=?,payload='',lease=NULL WHERE id=? AND lease=?",
        )
          .bind(result.jobId.slice(0, 200), id, lease)
          .run();
      } catch {
        await env.DB.prepare(
          "UPDATE access_mail SET state='failed',next_at=?,lease=NULL WHERE id=? AND lease=?",
        )
          .bind(now + Math.min(3600000, 60000 * 2 ** row.attempts), id, lease)
          .run();
      }
    }),
  );
}
