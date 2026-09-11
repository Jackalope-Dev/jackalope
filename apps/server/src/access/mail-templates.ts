import { EMAIL_COMPANY, EMAIL_FONT, EMAIL_PALETTE } from '@jackalope/brand/email';

export type AccessMail = { to: string; kind: 'welcome' | 'invite' | 'login'; token: string };
export type WaitlistMail = { to: string; kind: 'waitlist'; token?: string; newsletter?: boolean };
export type GrowthMail = {
  to: string;
  kind: 'referral' | 'passes_ready' | 'pass_claimed' | 'pass_expired';
  total: number;
};
export type FeedbackMail = { to: string; kind: 'feedback_request'; token: string };
export type Mail = AccessMail | WaitlistMail | GrowthMail | FeedbackMail;
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

export function accessEmail(mail: Mail, origin: string) {
  const total = 'total' in mail ? mail.total : 0;
  const copy = {
    feedback_request: {
      subject: 'How is Jackalope working for you?',
      title: 'How’s it going?',
      intro: 'What’s useful in Jackalope, and what could be better?',
      action: 'Share feedback',
      detail: 'A sentence or two is plenty.',
      stamp: 'Feedback / Early access',
    },
    waitlist: {
      subject: 'You’re on the Jackalope waitlist',
      title: 'You’re on the list.',
      intro:
        'Confirm your email to see your place on the waitlist and get your referral link.' +
        (mail.kind === 'waitlist' && mail.newsletter
          ? ' This also confirms your product-note subscription. If you didn’t request it, don’t use this link.'
          : ''),
      action: 'See my place',
      detail:
        'Each new person who verifies their email through your link earns you one day of waitlist priority. Share it with as many people as you like.',
      // No stamp: the intro already says what the link does, so the button
      // stands alone and centred instead of inside a labelled panel.
      stamp: '',
    },
    welcome: {
      subject: 'You’re in. Welcome to Jackalope',
      title: 'You’re in.',
      intro:
        'Your early access is ready. Find setup steps and available downloads in your account.',
      action: 'Open my account',
      detail:
        'You also have five Instant Access Passes to share. Each lets one person skip the waitlist after verifying their email.',
      stamp: 'Early access / Welcome',
    },
    invite: {
      subject: 'An Instant Access Pass to Jackalope',
      title: 'Skip the line.',
      intro:
        'You’ve been invited to Jackalope. Verify your email to claim a pass while one is available.',
      action: 'Claim my pass',
      detail:
        'Your pass skips the waitlist. Once you’re in, you’ll get five passes to share. Downloads appear in your account when available.',
      stamp: 'Instant access pass / Admit one',
    },
    login: {
      subject: 'Your Jackalope sign-in link',
      title: 'Welcome back.',
      intro: 'Use this link to sign in to your Jackalope account.',
      action: 'Sign in',
      detail: '',
      stamp: 'Your account / Sign in',
    },
    referral: {
      subject: 'Your Jackalope referrals',
      title: 'Thanks for sharing Jackalope.',
      intro: `${total} ${total === 1 ? 'person has' : 'people have'} joined through your link and verified their email.`,
      action: 'See my progress',
      detail:
        'Each verified referral earns one day of waitlist priority. Sharing is unlimited and doesn’t use your Instant Access Passes.',
      stamp: 'Waitlist / Referrals',
    },
    passes_ready: {
      subject: 'Your Jackalope passes are ready',
      title: 'Your passes are ready.',
      intro: `You now have early access and ${total} Instant Access ${total === 1 ? 'Pass' : 'Passes'} to share.`,
      action: 'See my passes',
      detail:
        'Each pass lets one person skip the waitlist after verifying their email. Setup steps and downloads appear in your account when available.',
      stamp: 'Instant access / Pass it on',
    },
    pass_claimed: {
      subject: 'Someone claimed your Jackalope pass',
      title: 'Your pass was claimed.',
      intro: 'Someone you invited has verified their email and joined Jackalope.',
      action: 'See my passes',
      detail: 'See who’s joined and how many passes you have left.',
      stamp: 'Instant access / Claimed',
    },
    pass_expired: {
      subject: 'A Jackalope pass is yours to share again',
      title: 'A pass is ready to share.',
      intro: 'Your invitation wasn’t claimed within 7 days, so the pass is available again.',
      action: 'See my passes',
      detail: 'Send it to the same person or someone new.',
      stamp: 'Instant access / Available again',
    },
  }[mail.kind];
  const link =
    mail.kind === 'feedback_request'
      ? `${origin}/feedback/#token=${mail.token}`
      : mail.kind === 'waitlist'
        ? `${origin}/waitlist/${mail.token ? `#token=${mail.token}` : ''}`
        : 'token' in mail
          ? `${origin}/access/#token=${mail.token}`
          : mail.kind === 'referral'
            ? `${origin}/waitlist/`
            : `${origin}/access/#invitations`;
  const expiry =
    mail.kind === 'invite' || mail.kind === 'welcome'
      ? 'This link expires in 7 days. Keep it private. You can request a new one on the website.'
      : mail.kind === 'waitlist' && mail.token
        ? 'This link works once. Keep it private. If it expires, request another from your waitlist page.'
        : mail.kind === 'login'
          ? 'This link works once and expires in 30 minutes. Keep it private.'
          : '';
  const footer =
    mail.kind === 'feedback_request'
      ? `You opted in to feedback emails. We won’t send reminders. Stop feedback emails: ${origin}/feedback/#unsubscribe=${mail.token}`
      : 'If you didn’t request this email, you can ignore it. Reply for help or to delete your account.';
  const footerHtml =
    mail.kind === 'feedback_request'
      ? `You opted in to feedback emails. We won’t send reminders. <a href="${escapeHtml(origin)}/feedback/#unsubscribe=${escapeHtml(mail.token)}" style="color:inherit">Stop feedback emails</a>.`
      : footer;
  const address = EMAIL_COMPANY.postalAddress;
  const text = [
    copy.title,
    copy.intro,
    `${copy.action}: ${link}`,
    copy.detail,
    expiry,
    footer,
    `${EMAIL_COMPANY.legalName}${address ? ` · ${address}` : ''} · ${EMAIL_COMPANY.companySite}\nPrivacy: ${origin}/privacy/`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    subject: copy.subject,
    preview: copy.intro,
    text,
    body: emailShell({
      subject: copy.subject,
      preheader: copy.intro,
      origin,
      content: `<h1 class="lead-title" style="margin:0 0 22px;font-size:44px;line-height:1.06;letter-spacing:-1.6px;font-weight:600;color:${c.ink}">${escapeHtml(copy.title)}</h1>
<p style="margin:0;font-size:17px;line-height:1.75;color:${c.muted}">${escapeHtml(copy.intro)}</p>
${callout(copy.stamp, copy.action, link)}
${copy.detail ? `<p style="margin:0;font-size:15px;line-height:1.8;color:${c.muted}">${escapeHtml(copy.detail)}</p>` : ''}
${expiry ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.7;color:${c.faint}">${escapeHtml(expiry)}</p>` : ''}`,
      footer: footerHtml,
    }),
  };
}

const c = EMAIL_PALETTE;

/**
 * The one action, drawn as a filled block.
 *
 * The fill and the padding sit on the `<td>` rather than on the `<a>`: Outlook
 * ignores padding and background on an inline-block anchor, which leaves the
 * action looking like plain underlined text. Colours are hex for the same
 * reason - Gmail drops `hsl()` values outright. See EMAIL_PALETTE.
 */
export const button = (
  action: string,
  link: string,
  { arrow = false, align = 'left' }: { arrow?: boolean; align?: 'left' | 'center' } = {},
) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="border-collapse:separate${align === 'center' ? ';margin:0 auto' : ''}"><tr><td align="center" bgcolor="${c.accent}" style="padding:15px 28px;border-radius:8px;background:${c.accent}"><a href="${escapeHtml(link)}" style="display:block;color:${c.onAccent};font-family:${EMAIL_FONT};font-size:16px;font-weight:600;line-height:1;text-decoration:none">${escapeHtml(action)}${arrow ? ' &rarr;' : ''}</a></td></tr></table>`;

/**
 * The one action in a message.
 *
 * With a stamp it sits in a ticket with a perforated action stub, like in-app passes.
 * Without one - where the surrounding copy already says it plainly - the button
 * stands on its own, centred, with nothing around it.
 */
function callout(stamp: string, action: string, link: string) {
  if (!stamp)
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:34px 0"><tr><td align="center">${button(action, link, { align: 'center' })}</td></tr></table>`;
  const [title, detail] = stamp.split(' / ');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.ticketStart}" style="margin:30px 0;border-collapse:separate;border-spacing:0;border:1px solid ${c.ticketStart};border-radius:18px;background-color:${c.ticketStart};background-image:linear-gradient(145deg,${c.ticketStart},${c.ticketEnd})"><tr><td style="padding:24px 26px 28px">
<p style="margin:0 0 24px;font-size:11px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:${c.onTicket}">Jackalope &nbsp;/&nbsp; ${escapeHtml(detail ?? '')}</p>
<p style="margin:0;font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-.8px;color:${c.onTicket}">${escapeHtml(title)}</p>
</td></tr><tr><td bgcolor="${c.ticketEnd}" style="padding:0;mso-padding-alt:18px 26px;border-top:1px dashed ${c.ticketRule};border-radius:0 0 17px 17px;background-color:${c.ticketEnd}"><a class="ticket-action" href="${escapeHtml(link)}" style="display:block;position:relative;padding:18px 26px;color:${c.onTicket};font-family:${EMAIL_FONT};font-size:16px;font-weight:600;line-height:1.5;text-decoration:none">${escapeHtml(action)} &nbsp;&rarr;</a></td></tr></table>`;
}

/**
 * Shared chrome for every Jackalope email: wordmark, rule, letter surface, footer.
 * Broadcasts pass their own `content`, so a product note and an access link
 * arrive looking like the same studio wrote them.
 */
export function emailShell({
  subject,
  preheader,
  origin,
  content,
  footer,
}: {
  subject: string;
  preheader: string;
  origin: string;
  content: string;
  footer: string;
}) {
  const address = EMAIL_COMPANY.postalAddress;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${escapeHtml(subject)}</title><style>:root{color-scheme:light only}.ticket-action::before,.ticket-action::after{content:"";position:absolute;top:-8px;width:14px;height:14px;border-radius:50%;background:${c.surface};pointer-events:none}.ticket-action::before{left:-8px}.ticket-action::after{right:-8px}.ticket-action:focus-visible{outline:2px solid ${c.onTicket};outline-offset:-6px}@media(max-width:480px){.lead-title{font-size:34px!important;letter-spacing:-1px!important}.letter{padding:28px 22px!important}}</style></head><body style="margin:0;padding:0;background:${c.bg};color:${c.ink};font-family:${EMAIL_FONT};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.bg}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background:${c.surface};border:1px solid ${c.border};border-radius:16px">
<tr><td class="letter" style="padding:40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-bottom:22px;border-bottom:1px solid ${c.border};font-size:19px;font-weight:700;letter-spacing:-.3px;color:${c.ink}">Jackalope</td>
<td align="right" style="padding-bottom:22px;border-bottom:1px solid ${c.border}"><img src="${escapeHtml(origin)}/icon-128.png" width="34" height="34" alt="" style="display:block;border:0"></td>
</tr></table>
<div style="height:34px;line-height:34px">&nbsp;</div>
${content}
<p style="margin:32px 0 0;padding-top:22px;border-top:1px solid ${c.borderSubtle};font-size:12px;line-height:1.8;color:${c.faint}">${footer}<br><br>${escapeHtml(EMAIL_COMPANY.legalName)}${address ? ` &middot; ${escapeHtml(address)}` : ''} &middot; <a href="${EMAIL_COMPANY.companySite}" style="color:${c.faint};text-decoration:underline">jackalope.digital</a> &middot; <a href="${escapeHtml(origin)}/privacy/" style="color:${c.faint};text-decoration:underline">Privacy</a></p>
</td></tr></table>
</td></tr></table></body></html>`;
}
