import { PRESET_THEMES, themeTokens } from '@jackalope/brand/tokens';
import { randomToken, seal, tokenHash, unseal } from './crypto';
import { providerJson } from './provider';

export type AccessMail = { to: string; kind: 'welcome' | 'invite' | 'login'; token: string };
export type WaitlistMail = { to: string; kind: 'waitlist' };
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

export function accessEmail(mail: AccessMail | WaitlistMail, origin: string) {
  const colors = themeTokens({ ...PRESET_THEMES[0], isDark: false });
  if (mail.kind === 'waitlist') return waitlistEmail(origin, colors);
  const title =
    mail.kind === 'welcome'
      ? 'There’s room for you.'
      : mail.kind === 'invite'
        ? 'Good things are better shared.'
        : 'Welcome back.';
  const subject =
    mail.kind === 'welcome'
      ? 'You’re in. Welcome to Jackalope'
      : mail.kind === 'invite'
        ? 'You’re invited to Jackalope'
        : 'Your Jackalope sign-in link';
  const intro =
    mail.kind === 'welcome'
      ? 'Your early access is approved. Your space in Jackalope is ready, along with five invitations for people you’d love to bring along.'
      : mail.kind === 'invite'
        ? 'A Jackalope member has invited you in. Accept your invitation to get early access, then bring five people of your own.'
        : 'Use this private link to return to your downloads and invitations. No password to remember.';
  const action = mail.kind === 'invite' ? 'Accept your invitation' : 'Open your Jackalope space';
  const link = `${origin}/access/#token=${mail.token}`;
  const detail =
    mail.kind === 'login'
      ? 'This sign-in link expires in 30 minutes.'
      : 'This invitation link expires in 7 days. You can request a fresh sign-in link from the website.';
  const text = `${title}\n\n${intro}\n\n${action}: ${link}\n\nYour space shows available downloads when a reviewed build is available, setup steps, and your remaining invitations.\n\n${detail} Keep this link private. If you did not expect this email, you can ignore it.\n\nJackalope Digital LLC · https://jackalope.digital`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:${colors['--color-bg']};color:${colors['--color-text-primary']};font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(intro)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif"><tr><td align="center" style="padding:32px 20px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;font-family:Arial,Helvetica,sans-serif"><tr><td style="padding:0 0 22px;border-bottom:2px solid ${colors['--color-text-primary']};font-size:22px;font-weight:700;letter-spacing:-1px"><img src="${origin}/icon-128.png" width="36" height="36" alt="" style="vertical-align:middle"> &nbsp;Jackalope</td></tr><tr><td style="padding:20px 0"><h1 style="font-size:48px;line-height:1.08;letter-spacing:-2px;margin:20px 0">${title}</h1><p style="font-size:16px;line-height:1.8;color:${colors['--color-text-secondary']}">${intro}</p><p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;color:${colors['--color-text-primary']};padding:14px 0;border-bottom:2px solid ${colors['--color-accent']};text-decoration:none;font-weight:700">${action} →</a></p><p style="font-size:14px;line-height:1.8;color:${colors['--color-text-secondary']}">Your space has your invitations, setup steps, and available downloads as soon as a reviewed build is available.</p><p style="font-size:12px;line-height:1.8;color:${colors['--color-text-secondary']}">${detail} Keep this link private.</p></td></tr><tr><td style="padding:20px 0;border-top:1px solid ${colors['--color-border']};font-size:11px;line-height:1.8;color:${colors['--color-text-secondary']}">If you did not expect this email, you can ignore it.<br>Jackalope Digital LLC &middot; <a href="https://jackalope.digital" style="color:inherit">jackalope.digital</a> &middot; <a href="${origin}/privacy/" style="color:inherit">Privacy</a></td></tr></table></td></tr></table></body></html>`;
  return { subject, body, text, preview: intro };
}

function waitlistEmail(origin: string, colors: ReturnType<typeof themeTokens>) {
  const subject = 'You’re on the Jackalope waitlist';
  const preview = 'Your signup is confirmed. We’ll be in touch when early access opens.';
  const text = `You’re on the list.\n\nThanks for joining Jackalope. Your signup is confirmed. There’s nothing else you need to do.\n\nYour project. Your agents. Your final say.\nGive your coding agents room to work side by side. Keep the context, changes, and review together in one desktop workspace.\n\nWe’ll email you as early-access places open. Our first launch is planned for macOS, Windows, and Linux.\n\nTake a look inside: ${origin}/tour/\n\nSee you in there,\nJackalope\n\nYou received this because this address joined the Jackalope waitlist. If that wasn’t you, reply to ask us to remove it.\n\nJackalope Digital LLC · https://jackalope.digital\nPrivacy: ${origin}/privacy/`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title><style>@media(max-width:480px){.note-title{font-size:48px!important}.note-content{padding-left:20px!important;padding-right:20px!important}}</style></head>
<body style="margin:0;padding:0;background:${colors['--color-bg']};color:${colors['--color-text-primary']};font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif"><tr><td align="center" style="padding:32px 0">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;font-family:Arial,Helvetica,sans-serif">
<tr><td class="note-content" style="padding:0 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif"><tr><td style="padding-bottom:22px;border-bottom:2px solid ${colors['--color-text-primary']};font-size:22px;font-weight:700;letter-spacing:-1px">Jackalope</td><td align="right" style="padding-bottom:22px;border-bottom:2px solid ${colors['--color-text-primary']}"><img src="${escapeHtml(origin)}/icon-128.png" width="42" height="42" alt="" style="display:block"></td></tr></table>
<h1 class="note-title" style="margin:36px 0 24px;font-size:68px;line-height:1.02;letter-spacing:-3px;font-weight:700">You’re on<br>the list<span style="color:${colors['--color-accent-ink']}">.</span></h1>
<p style="margin:0 0 32px;font-size:16px;line-height:1.8;color:${colors['--color-text-secondary']}">Thanks for joining Jackalope. Your signup is confirmed. There’s nothing else you need to do.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif"><tr><td style="border-left:3px solid ${colors['--color-accent']};padding:4px 0 4px 22px">
<p style="margin:0 0 16px;font-size:27px;font-weight:700;line-height:1.3;letter-spacing:-0.7px">Your project.<br>Your agents.<br><span style="color:${colors['--color-accent-ink']}">Your final say.</span></p>
<p style="margin:0;font-size:15px;line-height:1.8;color:${colors['--color-text-secondary']}">Give your coding agents room to work side by side. Keep the context, changes, and review together in one desktop workspace.</p>
</td></tr></table>
<p style="margin:32px 0 20px;font-size:16px;line-height:1.8;color:${colors['--color-text-secondary']}">We’ll email you as early-access places open. Our first launch is planned for macOS, Windows, and Linux.</p>
<p style="margin:0 0 36px"><a href="${escapeHtml(origin)}/tour/" style="display:inline-block;padding:12px 0;font-size:17px;font-weight:700;text-decoration:none;border-bottom:2px solid ${colors['--color-accent']};color:${colors['--color-text-primary']}">Take a look inside →</a></p>
<p style="margin:0 0 32px;font-size:15px;line-height:1.8">See you in there,<br><strong>Jackalope</strong></p>
<p style="border-top:1px solid ${colors['--color-border']};padding-top:20px;margin:0;font-size:11px;line-height:1.8;color:${colors['--color-text-secondary']}">You received this because this address joined the Jackalope waitlist. If that wasn’t you, reply to ask us to remove it.<br><br>Jackalope Digital LLC &middot; <a href="https://jackalope.digital" style="color:inherit">jackalope.digital</a> &middot; <a href="${escapeHtml(origin)}/privacy/" style="color:inherit">Privacy</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, preview, text, body };
}

export async function waitlistMailStatement(
  env: Env,
  email: string,
  memberId: string,
  now = Date.now(),
) {
  const payload = await seal(
    { to: email, kind: 'waitlist' } satisfies WaitlistMail,
    env.ACCESS_SECRET,
  );
  return env.DB.prepare(
    "INSERT INTO access_mail(id,email,kind,payload,created_at) SELECT ?,?,'waitlist',?,? WHERE EXISTS(SELECT 1 FROM access_members WHERE id=? AND email=? AND status='waiting')",
  ).bind(crypto.randomUUID(), email, payload, now, memberId, email);
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
  guard = `(${guard}) AND NOT EXISTS(SELECT 1 FROM access_mail WHERE email=? AND kind!='waitlist' AND created_at>?) AND (SELECT count(*) FROM access_mail WHERE email=? AND kind!='waitlist' AND created_at>?)<10`;
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
      let stage = 'decrypt';
      let providerStatus: number | null = null;
      try {
        const mail = await unseal<AccessMail | WaitlistMail>(row.payload, env.ACCESS_SECRET);
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
