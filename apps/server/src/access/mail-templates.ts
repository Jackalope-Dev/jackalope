import { EMAIL_COMPANY, EMAIL_FONT, EMAIL_PALETTE } from '@jackalope/brand/email';

export type AccessMail = { to: string; kind: 'welcome' | 'invite' | 'login'; token: string };
export type WaitlistMail = { to: string; kind: 'waitlist'; token?: string };
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
  const copy = {
    feedback_request: {
      subject: 'How is Jackalope working for you?',
      title: 'What could feel better?',
      intro:
        'You’ve had some time with Jackalope. How has it fit into your workflow? What’s useful, and what’s getting in your way?',
      action: 'Share a thought',
      detail:
        'A sentence or two is plenty. Good experiences, rough edges, and ideas are all welcome. Your feedback goes directly to the people building Jackalope.',
      stamp: 'EARLY ACCESS / YOUR EXPERIENCE',
    },
    waitlist: {
      subject: 'You’re on the Jackalope waitlist',
      title: 'Your next hop starts here.',
      intro:
        'Your place is saved. Confirm your email to see your waitlist number and get your personal referral link.',
      action: 'See my place',
      detail:
        'Share with as many people as you like. Each new person who verifies their email adds one day of priority to your signup time. Your number updates as the queue changes.',
      // No stamp: the intro already says what the link does, so the button
      // stands alone and centred instead of inside a labelled panel.
      stamp: '',
    },
    welcome: {
      subject: 'You’re in. Welcome to Jackalope',
      title: 'There’s room for you.',
      intro:
        'Your early access is approved. You can now open your Jackalope space and share your five Instant Access Passes.',
      action: 'Open my Jackalope space',
      detail:
        'Each pass lets one person skip the waitlist after email verification. Available downloads and setup steps live in your space.',
      stamp: 'YOU’RE IN / BRING FIVE',
    },
    invite: {
      subject: 'An Instant Access Pass to Jackalope',
      title: 'Skip the line. Come on in.',
      intro:
        'A Jackalope member is sharing early access with you. Verify your email to claim a pass while their allowance is available.',
      action: 'Claim my pass',
      detail:
        'No second approval needed. Once you’re in, you get five passes of your own. Downloads appear when a reviewed build is available.',
      stamp: 'INSTANT ACCESS PASS / ADMIT ONE',
    },
    login: {
      subject: 'Your Jackalope sign-in link',
      title: 'Welcome back.',
      intro: 'Your downloads, setup steps, and Instant Access Passes are one click away.',
      action: 'Open my Jackalope space',
      detail: 'This private, single-use sign-in link expires in 30 minutes.',
      stamp: 'YOUR SPACE / YOUR AGENTS',
    },
    referral: {
      subject: 'Your Jackalope referrals are adding up',
      title: 'Good company. A little closer.',
      intro: `${'total' in mail ? mail.total : 0} people have joined through your waitlist link and verified their email. Thanks for bringing them along.`,
      action: 'See my progress',
      detail:
        'Each verified referral earns one day of waitlist priority. Check your page for your current number. Referral sharing is unlimited and never spends an Instant Access Pass.',
      stamp: 'WAITLIST / A HOP FORWARD',
    },
    passes_ready: {
      subject: 'You’re in. Your Jackalope passes are ready',
      title: 'Now bring your people.',
      intro: `Your pass is claimed and your early access is ready. You have ${'total' in mail ? mail.total : 5} Instant Access Passes to share.`,
      action: 'See my passes',
      detail:
        'Each pass brings one person straight into early access after email verification. Your space also shows setup steps and downloads as reviewed builds become available.',
      stamp: 'INSTANT ACCESS / PASS IT ON',
    },
    pass_claimed: {
      subject: 'Someone claimed your Jackalope pass',
      title: 'One more in your corner.',
      intro: 'Someone you invited has verified their email and joined Jackalope early access.',
      action: 'See my passes',
      detail:
        'Your pass page shows who has joined, who has requested a download, and who has connected the desktop. Claimed passes count toward your allowance.',
      stamp: 'INSTANT ACCESS / CLAIMED',
    },
    pass_expired: {
      subject: 'A Jackalope pass is yours to share again',
      title: 'Back in your pocket.',
      intro:
        'An email pass reservation expired without being claimed. That place is available again.',
      action: 'See my passes',
      detail:
        'Email reservations last seven days. You can send a new pass to the same person or share it with someone else. Your page always shows the current allowance.',
      stamp: 'INSTANT ACCESS / AVAILABLE AGAIN',
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
      ? 'This private link expires in 7 days. Request a fresh link on the website if needed.'
      : mail.kind === 'waitlist' && mail.token
        ? 'This is a private, single-use link. If it expires, request another from your waitlist page.'
        : '';
  const footer =
    mail.kind === 'feedback_request'
      ? `Your Jackalope email preferences include this feedback invitation. This is a one-time invitation, with no reminders. Stop feedback emails: ${origin}/feedback/#unsubscribe=${mail.token}`
      : 'If you did not expect this email, you can ignore it. Reply if you need help or want your account removed.';
  const footerHtml =
    mail.kind === 'feedback_request'
      ? `Your Jackalope email preferences include this feedback invitation. This is a one-time invitation, with no reminders. <a href="${escapeHtml(origin)}/feedback/#unsubscribe=${escapeHtml(mail.token)}" style="color:inherit">Stop feedback emails</a>.`
      : footer;
  const address = EMAIL_COMPANY.postalAddress;
  const text = `${copy.title}\n\n${copy.intro}\n\n${copy.action}: ${link}\n\n${copy.detail}\n\n${expiry}\n\n${footer}\n\n${EMAIL_COMPANY.legalName}${address ? ` · ${address}` : ''} · ${EMAIL_COMPANY.companySite}\nPrivacy: ${origin}/privacy/`;
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
<p style="margin:0;font-size:15px;line-height:1.8;color:${c.muted}">${escapeHtml(copy.detail)}</p>
${expiry ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.7;color:${c.faint}">${escapeHtml(expiry)} Keep this link private.</p>` : ''}
<p style="margin:30px 0 0;font-size:15px;line-height:1.8;color:${c.muted}">See you in there,<br><strong style="color:${c.ink}">Jackalope</strong></p>`,
      footer: footerHtml,
    }),
  };
}

const c = EMAIL_PALETTE;

const button = (action: string, link: string, arrow = false) =>
  `<a href="${escapeHtml(link)}" style="display:inline-block;padding:15px 28px;border-radius:8px;background:${c.accent};color:${c.onAccent};font-size:16px;font-weight:600;line-height:1;text-decoration:none">${escapeHtml(action)}${arrow ? ' &rarr;' : ''}</a>`;

/**
 * The one action in a message.
 *
 * With a stamp it sits in a labelled panel that names what the link is for.
 * Without one - where the surrounding copy already says it plainly - the button
 * stands on its own, centred, with nothing around it.
 */
function callout(stamp: string, action: string, link: string) {
  if (!stamp)
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:34px 0"><tr><td align="center">${button(action, link)}</td></tr></table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0;border-collapse:separate;border:1px solid ${c.borderSubtle};border-left:3px solid ${c.accent};border-radius:12px;background:${c.panel}"><tr><td style="padding:24px">
<p style="margin:0 0 18px;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${c.faint}">${escapeHtml(stamp)}</p>
${button(action, link, true)}
</td></tr></table>`;
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${escapeHtml(subject)}</title><style>:root{color-scheme:light only}@media(max-width:480px){.lead-title{font-size:34px!important;letter-spacing:-1px!important}.letter{padding:28px 22px!important}}</style></head><body style="margin:0;padding:0;background:${c.bg};color:${c.ink};font-family:${EMAIL_FONT};-webkit-font-smoothing:antialiased">
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
