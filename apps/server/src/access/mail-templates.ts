import { PRESET_THEMES, themeTokens } from '@jackalope/brand/tokens';

export type AccessMail = { to: string; kind: 'welcome' | 'invite' | 'login'; token: string };
export type WaitlistMail = { to: string; kind: 'waitlist'; token?: string };
export type GrowthMail = {
  to: string;
  kind: 'referral' | 'passes_ready' | 'pass_claimed' | 'pass_expired';
  total: number;
};
export type Mail = AccessMail | WaitlistMail | GrowthMail;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

export function accessEmail(mail: Mail, origin: string) {
  const colors = themeTokens({ ...PRESET_THEMES[0], isDark: false });
  const copy = {
    waitlist: {
      subject: 'You’re on the Jackalope waitlist',
      title: 'Your next hop starts here.',
      intro:
        'Your place is saved. Confirm your email to see your waitlist number and get your personal referral link.',
      action: 'See my place',
      detail:
        'Share with as many people as you like. Each new person who verifies their email adds one day of priority to your signup time. Your number updates as the queue changes.',
      stamp: 'WAITLIST / MAKE YOUR NEXT HOP',
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
    mail.kind === 'waitlist'
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
    'If you did not expect this email, you can ignore it. Reply if you need help or want your account removed.';
  const text = `${copy.title}\n\n${copy.intro}\n\n${copy.action}: ${link}\n\n${copy.detail}\n\n${expiry}\n\n${footer}\n\nJackalope Digital LLC · https://jackalope.digital\nPrivacy: ${origin}/privacy/`;
  const ink = colors['--color-text-primary'];
  const muted = colors['--color-text-secondary'];
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.subject)}</title><style>@media(max-width:480px){.note-title{font-size:40px!important}.note-content{padding:24px 20px!important}}</style></head><body style="margin:0;background:${colors['--color-bg']};color:${ink};font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(copy.intro)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 0"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px"><tr><td class="note-content" style="padding:32px"><table role="presentation" width="100%"><tr><td style="padding-bottom:24px;border-bottom:2px solid ${ink};font-size:22px;font-weight:700">Jackalope</td><td align="right" style="padding-bottom:24px;border-bottom:2px solid ${ink}"><img src="${escapeHtml(origin)}/icon-128.png" width="40" height="40" alt="" style="display:block"></td></tr></table><h1 class="note-title" style="font-size:52px;line-height:1.05;letter-spacing:-2px;margin:36px 0 24px">${escapeHtml(copy.title)}</h1><p style="font-size:16px;line-height:1.8;color:${muted}">${escapeHtml(copy.intro)}</p><table role="presentation" width="100%" style="margin:28px 0;border:1px solid ${colors['--color-border']};border-left:4px solid ${colors['--color-accent']};border-radius:12px;background:${colors['--color-surface']}"><tr><td style="padding:22px"><p style="margin:0 0 20px;font-size:11px;letter-spacing:1.5px;color:${muted}">${escapeHtml(copy.stamp)}</p><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 18px;border-radius:8px;background:${colors['--color-accent']};color:${colors['--color-on-accent']};font-size:16px;font-weight:700;text-decoration:none">${escapeHtml(copy.action)} →</a></td></tr></table><p style="font-size:15px;line-height:1.8;color:${muted}">${escapeHtml(copy.detail)}</p>${expiry ? `<p style="font-size:12px;line-height:1.8;color:${muted}">${escapeHtml(expiry)} Keep this link private.</p>` : ''}<p style="margin:28px 0;font-size:15px;line-height:1.8">See you in there,<br><strong>Jackalope</strong></p><p style="padding-top:20px;border-top:1px solid ${colors['--color-border']};font-size:11px;line-height:1.8;color:${muted}">${footer}<br><br>Jackalope Digital LLC · <a href="https://jackalope.digital" style="color:inherit">jackalope.digital</a> · <a href="${escapeHtml(origin)}/privacy/" style="color:inherit">Privacy</a></p></td></tr></table></td></tr></table></body></html>`;
  return { subject: copy.subject, preview: copy.intro, text, body };
}
